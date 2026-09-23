/**
 * Encoded chunks -> VideoDecoder -> presentation-ordered VideoFrame queue.
 *
 * Backpressure matters more than raw speed here: a VideoFrame pins a slot in
 * the (usually hardware) decoder's surface pool. Holding too many stalls the
 * decoder, and leaking one eventually freezes playback. So we keep a small,
 * bounded number of decoded frames ahead of the playhead and close every
 * frame we will not present, immediately.
 */

/** Decoded frames kept ahead of the playhead (~130ms at 60fps). */
const MAX_DECODED_FRAMES = 8;
/** Chunks allowed inside the decoder at once. */
const MAX_DECODE_QUEUE = 4;

export interface VideoDecodeCallbacks {
  onFatal(error: Error): void;
}

export class VideoDecodePipe {
  readonly frames: VideoFrame[] = [];
  private readonly pending: EncodedVideoChunk[] = [];
  private decoder: VideoDecoder;
  private config: VideoDecoderConfig | null = null;
  private needKeyframe = true;
  /** Frames with timestamp (µs) below this are decoded but discarded (accurate seek). */
  private discardBeforeUs = 0;
  private flushing = false;
  private endOfStream = false;
  /** Set once flush() after end-of-stream resolved: no more frames will come. */
  drained = false;
  hardware = false;

  constructor(private readonly cb: VideoDecodeCallbacks) {
    this.decoder = this.createDecoder();
  }

  private createDecoder(): VideoDecoder {
    return new VideoDecoder({
      output: (frame) => this.handleFrame(frame),
      error: (e) => this.cb.onFatal(e instanceof Error ? e : new Error(String(e))),
    });
  }

  /**
   * Prefer hardware decoding (lower power, frees CPU for audio/UI), fall back
   * to software when the GPU driver can't handle the profile.
   */
  async configure(config: VideoDecoderConfig): Promise<boolean> {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      const candidate = { ...config, hardwareAcceleration };
      const support = await VideoDecoder.isConfigSupported(candidate);
      if (support.supported) {
        this.config = support.config ?? candidate;
        this.hardware = hardwareAcceleration === 'prefer-hardware';
        this.decoder.configure(this.config);
        this.decoder.addEventListener('dequeue', () => this.feed());
        return true;
      }
    }
    return false;
  }

  /** The configuration actually in use (after hardware/software negotiation). */
  get activeConfig(): VideoDecoderConfig | null {
    return this.config;
  }

  get decodeQueueSize(): number {
    return this.decoder.state === 'configured' ? this.decoder.decodeQueueSize : 0;
  }

  push(chunk: EncodedVideoChunk): void {
    if (this.needKeyframe) {
      if (chunk.type !== 'key') return; // Can't start decoding mid-GOP.
      this.needKeyframe = false;
    }
    this.pending.push(chunk);
    this.feed();
  }

  markEndOfStream(): void {
    this.endOfStream = true;
    this.feed();
  }

  /** Pull as much through the decoder as the frame budget allows. */
  feed(): void {
    if (this.decoder.state !== 'configured' || this.flushing) return;
    while (
      this.pending.length > 0 &&
      this.decoder.decodeQueueSize < MAX_DECODE_QUEUE &&
      this.frames.length + this.decoder.decodeQueueSize < MAX_DECODED_FRAMES
    ) {
      this.decoder.decode(this.pending.shift()!);
    }
    // Reordering decoders (H.264/HEVC B-frames) hold the last frames back
    // until flushed; do that once the stream is exhausted.
    if (this.endOfStream && this.pending.length === 0 && !this.drained) {
      this.flushing = true;
      this.decoder
        .flush()
        .then(() => (this.drained = true))
        .catch(() => {})
        .finally(() => (this.flushing = false));
    }
  }

  /** Remove and return the head frame (caller owns it and must close it). */
  shift(): VideoFrame | undefined {
    const f = this.frames.shift();
    if (f) queueMicrotask(() => this.feed());
    return f;
  }

  /** Seek: drop everything in flight; decode from the next keyframe. */
  reset(discardBeforeSeconds: number): void {
    this.pending.length = 0;
    for (const f of this.frames) f.close();
    this.frames.length = 0;
    this.needKeyframe = true;
    this.endOfStream = false;
    this.drained = false;
    this.flushing = false;
    this.discardBeforeUs = discardBeforeSeconds * 1e6;
    if (this.decoder.state === 'configured') {
      this.decoder.reset();
      if (this.config) this.decoder.configure(this.config);
    }
  }

  close(): void {
    this.reset(0);
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  private handleFrame(frame: VideoFrame): void {
    // Seek pre-roll: frames between the keyframe and the target are needed
    // for decoding but must never be shown.
    const end = frame.timestamp + (frame.duration ?? 0);
    if (end <= this.discardBeforeUs) {
      frame.close();
      return;
    }
    this.frames.push(frame);
  }
}
