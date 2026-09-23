/**
 * Lock-free single-producer / single-consumer PCM ring buffer over a
 * SharedArrayBuffer.
 *
 *   producer: media worker  (AudioDecoder output -> write())
 *   consumer: AudioWorklet  (process()           -> read())
 *
 * The consumer's read cursor doubles as the MASTER CLOCK of the whole player:
 * it only advances when the sound card actually pulls samples, so it is the
 * most accurate "what is the user hearing right now" signal available on the
 * web. The worker maps it back to a media timestamp to pick video frames.
 *
 * Cursors are monotonic frame counters stored as Int32 and compared with
 * wrap-around-safe unsigned arithmetic (`(a - b) >>> 0`), so they never need
 * resetting. At 48 kHz an Int32 cursor wraps after ~24.8h, which the
 * arithmetic already handles.
 *
 * This file is imported by three different global scopes (window, worker,
 * worklet), so it must stay free of any environment-specific globals.
 */

/** Int32 control-block slots. */
const enum Ctl {
  /** Frames written (producer-owned). */
  Write = 0,
  /** Frames consumed (consumer-owned). */
  Read = 1,
  /** 1 = consumer should pull samples, 0 = output silence and hold the clock. */
  Playing = 2,
  /** Incremented by the consumer every render quantum it had to pad with silence. */
  Underruns = 3,
  /** Producer bumps this to ask the consumer to jump its read cursor... */
  FlushSeq = 4,
  /** ...to this position (used on seek to discard stale audio instantly). */
  FlushTo = 5,
  Channels = 6,
  CapacityFrames = 7,
  SampleRate = 8,
  SLOTS = 16,
}

const CTL_BYTES = Ctl.SLOTS * Int32Array.BYTES_PER_ELEMENT;

export interface AudioRingInit {
  sab: SharedArrayBuffer;
}

export class AudioRing {
  readonly sab: SharedArrayBuffer;
  readonly channels: number;
  readonly capacity: number;
  readonly sampleRate: number;
  private readonly ctl: Int32Array;
  /** Interleaved samples, `capacity * channels` long. */
  private readonly data: Float32Array;
  /** Consumer-local: last FlushSeq observed. */
  private seenFlushSeq = 0;

  static create(sampleRate: number, channels: number, seconds = 2): AudioRing {
    // Round capacity to a multiple of the 128-frame render quantum.
    const capacity = Math.ceil((sampleRate * seconds) / 128) * 128;
    const sab = new SharedArrayBuffer(CTL_BYTES + capacity * channels * Float32Array.BYTES_PER_ELEMENT);
    const ctl = new Int32Array(sab, 0, Ctl.SLOTS);
    ctl[Ctl.Channels] = channels;
    ctl[Ctl.CapacityFrames] = capacity;
    ctl[Ctl.SampleRate] = sampleRate;
    return new AudioRing(sab);
  }

  constructor(sab: SharedArrayBuffer) {
    this.sab = sab;
    this.ctl = new Int32Array(sab, 0, Ctl.SLOTS);
    this.channels = this.ctl[Ctl.Channels];
    this.capacity = this.ctl[Ctl.CapacityFrames];
    this.sampleRate = this.ctl[Ctl.SampleRate];
    this.data = new Float32Array(sab, CTL_BYTES, this.capacity * this.channels);
    this.seenFlushSeq = Atomics.load(this.ctl, Ctl.FlushSeq);
  }

  // ---------------------------------------------------------------- shared

  /** Frames currently queued (written but not yet played). */
  available(): number {
    return (Atomics.load(this.ctl, Ctl.Write) - Atomics.load(this.ctl, Ctl.Read)) >>> 0;
  }

  get readCursor(): number {
    return Atomics.load(this.ctl, Ctl.Read) >>> 0;
  }

  get writeCursor(): number {
    return Atomics.load(this.ctl, Ctl.Write) >>> 0;
  }

  get underruns(): number {
    return Atomics.load(this.ctl, Ctl.Underruns);
  }

  get playing(): boolean {
    return Atomics.load(this.ctl, Ctl.Playing) === 1;
  }

  // -------------------------------------------------------------- producer

  setPlaying(playing: boolean): void {
    Atomics.store(this.ctl, Ctl.Playing, playing ? 1 : 0);
  }

  /** Free space in frames, conservative while a flush is still pending. */
  free(): number {
    return this.capacity - this.available();
  }

  /**
   * Copy planar PCM into the ring (interleaving on the fly).
   * Returns frames written; may be less than requested if the ring is full.
   */
  write(planes: readonly Float32Array[], frameOffset: number, frameCount: number): number {
    const n = Math.min(frameCount, this.free());
    if (n <= 0) return 0;
    const ch = this.channels;
    const cap = this.capacity;
    let w = Atomics.load(this.ctl, Ctl.Write) >>> 0;
    const srcChannels = Math.min(ch, planes.length);
    for (let i = 0; i < n; i++) {
      const base = (w % cap) * ch;
      const src = frameOffset + i;
      for (let c = 0; c < srcChannels; c++) this.data[base + c] = planes[c][src];
      // Mono source into a stereo ring etc: duplicate the last plane.
      for (let c = srcChannels; c < ch; c++) this.data[base + c] = planes[srcChannels - 1][src];
      w = (w + 1) >>> 0;
    }
    // Release: publish samples before the cursor.
    Atomics.store(this.ctl, Ctl.Write, w | 0);
    return n;
  }

  /**
   * Discard everything queued. The consumer applies the jump on its next
   * quantum; returns the cursor at which fresh audio will start.
   */
  flush(): number {
    const w = Atomics.load(this.ctl, Ctl.Write);
    Atomics.store(this.ctl, Ctl.FlushTo, w);
    Atomics.add(this.ctl, Ctl.FlushSeq, 1);
    return w >>> 0;
  }

  /** True once the consumer has applied the last flush(). */
  flushSettled(): boolean {
    return ((Atomics.load(this.ctl, Ctl.Read) - Atomics.load(this.ctl, Ctl.FlushTo)) | 0) >= 0;
  }

  // -------------------------------------------------------------- consumer

  /**
   * Fill `outputs` (one Float32Array per channel, 128 frames each in an
   * AudioWorklet). Never allocates. Returns false if it had to pad with silence.
   */
  read(outputs: Float32Array[]): boolean {
    const seq = Atomics.load(this.ctl, Ctl.FlushSeq);
    if (seq !== this.seenFlushSeq) {
      this.seenFlushSeq = seq;
      Atomics.store(this.ctl, Ctl.Read, Atomics.load(this.ctl, Ctl.FlushTo));
    }

    const frames = outputs[0]?.length ?? 0;
    if (!this.playing) {
      for (const o of outputs) o.fill(0);
      return true;
    }

    const ch = this.channels;
    const cap = this.capacity;
    let r = Atomics.load(this.ctl, Ctl.Read) >>> 0;
    const avail = (Atomics.load(this.ctl, Ctl.Write) - r) >>> 0;
    const n = Math.min(frames, avail);
    const outCh = outputs.length;
    for (let i = 0; i < n; i++) {
      const base = (r % cap) * ch;
      for (let c = 0; c < outCh; c++) outputs[c][i] = this.data[base + (c < ch ? c : ch - 1)];
      r = (r + 1) >>> 0;
    }
    if (n < frames) {
      for (const o of outputs) o.fill(0, n);
    }
    Atomics.store(this.ctl, Ctl.Read, r | 0);
    if (n < frames && n === 0) {
      // Pure starvation: the clock stalls, so video naturally waits for audio.
      Atomics.add(this.ctl, Ctl.Underruns, 1);
      return false;
    }
    return n === frames;
  }
}
