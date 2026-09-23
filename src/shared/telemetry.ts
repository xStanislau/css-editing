/**
 * Worker -> UI telemetry over a SharedArrayBuffer.
 *
 * The seek bar, clock readout and stats overlay are driven by the UI's own
 * requestAnimationFrame loop reading this block directly, so the playhead
 * moves at display refresh rate with ZERO postMessage traffic and zero React
 * re-renders. A seqlock guards against torn multi-field reads.
 */

export const enum T {
  CurrentTime = 0,
  Duration,
  BufferedEnd,
  RenderFps,
  FramesPresented,
  FramesDropped,
  DecodeQueue,
  FrameQueue,
  AudioBufferedMs,
  AvDriftMs,
  VideoWidth,
  VideoHeight,
  OutputWidth,
  OutputHeight,
  AudioUnderruns,
  SLOTS,
}

export type TelemetrySnapshot = Float64Array;

const HEADER_BYTES = 8; // Int32 seq + padding so the Float64 view stays aligned.

export class Telemetry {
  readonly sab: SharedArrayBuffer;
  private readonly seq: Int32Array;
  private readonly values: Float64Array;

  static create(): Telemetry {
    return new Telemetry(new SharedArrayBuffer(HEADER_BYTES + T.SLOTS * 8));
  }

  constructor(sab: SharedArrayBuffer) {
    this.sab = sab;
    this.seq = new Int32Array(sab, 0, 1);
    this.values = new Float64Array(sab, HEADER_BYTES, T.SLOTS);
  }

  /** Writer (worker only). Batch all fields of one tick inside `fn`. */
  write(fn: (v: Float64Array) => void): void {
    Atomics.add(this.seq, 0, 1); // odd: write in progress
    fn(this.values);
    Atomics.add(this.seq, 0, 1); // even: consistent
  }

  /** Reader (UI). Copies a consistent snapshot into `out`. */
  read(out: Float64Array): Float64Array {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = Atomics.load(this.seq, 0);
      if (before & 1) continue;
      out.set(this.values);
      if (Atomics.load(this.seq, 0) === before) return out;
    }
    out.set(this.values); // Give up on perfect consistency; it's UI-only.
    return out;
  }
}
