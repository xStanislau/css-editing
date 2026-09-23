import { AudioRing } from '../../shared/audioRing';

/** AudioData objects waiting for ring space. Audio is tiny; this is ~1-2s. */
const MAX_PENDING_AUDIO = 96;
/** Gaps larger than this (in seconds) get padded with silence to keep A/V locked. */
const GAP_TOLERANCE = 0.01;

export interface AudioDecodeCallbacks {
  onFatal(error: Error): void;
  /** Called once, when the first AudioData reveals the real output format. */
  onRingCreated(ring: AudioRing): void;
}

/**
 * Encoded chunks -> AudioDecoder -> PCM in the shared ring buffer.
 *
 * Also owns the mapping from ring read-cursor to media time, which is what
 * makes the AudioWorklet the master clock:
 *
 *   mediaTime(cursor) = anchorTime + (cursor - anchorCursor) / sampleRate
 *
 * The anchor is re-established after every seek, and gaps/overlaps in the
 * stream are corrected on write so the linear mapping stays exact.
 */
export class AudioDecodePipe {
  ring: AudioRing | null = null;
  private decoder: AudioDecoder;
  private config: AudioDecoderConfig | null = null;
  private readonly pendingChunks: EncodedAudioChunk[] = [];
  private readonly decoded: AudioData[] = [];
  /** Frame offset already consumed from decoded[0] (partial writes). */
  private headOffset = 0;
  private planes: Float32Array[] = [];
  private silence: Float32Array[] = [];

  private anchorCursor = 0;
  private anchorTime = 0;
  private anchored = false;
  /** Media time (s) of the next sample to be written to the ring. */
  private writeTime = 0;
  private discardBefore = -Infinity;
  private endOfStream = false;
  private flushing = false;
  /** Decoder flushed after end-of-stream: no more AudioData will be produced. */
  drained = false;

  constructor(private readonly cb: AudioDecodeCallbacks) {
    this.decoder = new AudioDecoder({
      output: (data) => this.handleData(data),
      error: (e) => this.cb.onFatal(e instanceof Error ? e : new Error(String(e))),
    });
  }

  async configure(config: AudioDecoderConfig): Promise<boolean> {
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) return false;
    this.config = support.config ?? config;
    this.decoder.configure(this.config);
    return true;
  }

  get decodeQueueSize(): number {
    return this.decoder.state === 'configured' ? this.decoder.decodeQueueSize : 0;
  }

  /** Everything decoded has been played out: no more audio will ever come. */
  get finished(): boolean {
    return this.drained && this.pendingChunks.length === 0 && this.decoded.length === 0 && this.bufferedSeconds === 0;
  }

  /** Seconds of audio queued in the ring (what the sound card will play next). */
  get bufferedSeconds(): number {
    return this.ring ? this.ring.available() / this.ring.sampleRate : 0;
  }

  push(chunk: EncodedAudioChunk): void {
    this.pendingChunks.push(chunk);
    this.pump();
  }

  markEndOfStream(): void {
    this.endOfStream = true;
    this.pump();
  }

  /**
   * Media time currently leaving the speakers (before output latency
   * compensation), or null until audio has started for the current segment.
   */
  timeAtReadCursor(): number | null {
    if (!this.ring || !this.anchored || !this.ring.flushSettled()) return null;
    const delta = (this.ring.readCursor - this.anchorCursor) | 0;
    return this.anchorTime + delta / this.ring.sampleRate;
  }

  /** Called every tick: decode more, move decoded PCM into the ring. */
  pump(): void {
    if (this.decoder.state !== 'configured') return;
    while (this.pendingChunks.length > 0 && this.decoder.decodeQueueSize < 8 && this.decoded.length < MAX_PENDING_AUDIO) {
      this.decoder.decode(this.pendingChunks.shift()!);
    }
    this.drainToRing();

    if (this.endOfStream && this.pendingChunks.length === 0 && !this.drained && !this.flushing) {
      this.flushing = true;
      this.decoder
        .flush()
        .then(() => (this.drained = true))
        .catch(() => {})
        .finally(() => (this.flushing = false));
    }
  }

  reset(discardBeforeSeconds: number): void {
    this.pendingChunks.length = 0;
    for (const d of this.decoded) d.close();
    this.decoded.length = 0;
    this.headOffset = 0;
    this.anchored = false;
    this.endOfStream = false;
    this.drained = false;
    this.flushing = false;
    this.discardBefore = discardBeforeSeconds;
    this.ring?.flush();
    if (this.decoder.state === 'configured') {
      this.decoder.reset();
      if (this.config) this.decoder.configure(this.config);
    }
  }

  close(): void {
    this.reset(0);
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  // -----------------------------------------------------------------------

  private handleData(data: AudioData): void {
    if (!this.ring) {
      // Create the ring from the ACTUAL decoder output format (HE-AAC/SBR
      // doubles the rate; Opus is always 48k) so the AudioContext can run at
      // the native rate with zero resampling.
      this.ring = AudioRing.create(data.sampleRate, Math.min(data.numberOfChannels, 8));
      this.cb.onRingCreated(this.ring);
    }
    this.decoded.push(data);
    this.drainToRing();
  }

  private ensurePlanes(frames: number, channels: number): void {
    if (this.planes.length !== channels || this.planes[0].length < frames) {
      this.planes = Array.from({ length: channels }, () => new Float32Array(frames));
    }
  }

  private drainToRing(): void {
    const ring = this.ring;
    if (!ring) return;

    while (this.decoded.length > 0) {
      const data = this.decoded[0];
      const sr = data.sampleRate;
      const start = data.timestamp / 1e6;
      const end = start + data.numberOfFrames / sr;

      // Drop audio before the seek target, trimming partially-covered buffers.
      if (end <= this.discardBefore) {
        this.decoded.shift()!.close();
        continue;
      }
      if (this.headOffset === 0 && start < this.discardBefore) {
        this.headOffset = Math.round((this.discardBefore - start) * sr);
      }

      if (!this.anchored) {
        this.anchorCursor = ring.writeCursor;
        this.anchorTime = start + this.headOffset / sr;
        this.writeTime = this.anchorTime;
        this.anchored = true;
      }

      // Keep the cursor->time mapping linear: pad gaps, trim overlaps.
      if (this.headOffset === 0) {
        const drift = start - this.writeTime;
        if (drift > GAP_TOLERANCE) {
          if (!this.writeSilence(Math.round(drift * sr))) return;
          continue;
        } else if (drift < -GAP_TOLERANCE) {
          this.headOffset = Math.min(data.numberOfFrames, Math.round(-drift * sr));
        }
      }

      const remaining = data.numberOfFrames - this.headOffset;
      if (remaining <= 0) {
        this.decoded.shift()!.close();
        this.headOffset = 0;
        continue;
      }
      if (ring.free() === 0) return; // Ring full: retry next tick.

      const channels = Math.min(data.numberOfChannels, ring.channels);
      // Copy only what fits; the decoder's native layout (often interleaved
      // f32 or s16) is converted to planar float by copyTo itself.
      const count = Math.min(remaining, ring.free());
      this.ensurePlanes(count, channels);
      for (let c = 0; c < channels; c++) {
        data.copyTo(this.planes[c], { planeIndex: c, format: 'f32-planar', frameOffset: this.headOffset, frameCount: count });
      }
      const written = ring.write(this.planes, 0, count);
      this.writeTime += written / sr;
      this.headOffset += written;
      if (this.headOffset >= data.numberOfFrames) {
        this.decoded.shift()!.close();
        this.headOffset = 0;
      } else {
        return; // Ring full.
      }
    }
  }

  private writeSilence(frames: number): boolean {
    const ring = this.ring!;
    if (this.silence.length !== ring.channels || this.silence[0].length < frames) {
      this.silence = Array.from({ length: ring.channels }, () => new Float32Array(Math.max(frames, 1024)));
    }
    const written = ring.write(this.silence, 0, Math.min(frames, ring.free()));
    this.writeTime += written / ring.sampleRate;
    return written === frames;
  }
}
