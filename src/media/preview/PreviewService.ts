import type { Demuxer } from '../demux/Demuxer';

/** Preview width in pixels (height follows the video aspect ratio). */
const PREVIEW_WIDTH = 256;
/** Cached thumbnails (~256×144 RGBA ≈ 150 KB each on the GPU). */
const CACHE_SIZE = 160;
/** Keyframes decoded ahead around the one being hovered. */
const PREFETCH_RADIUS = 2;

export interface PreviewResult {
  /** Presentation time of the keyframe shown (seconds). */
  time: number;
  bitmap: ImageBitmap;
}

/**
 * Seek-bar previews made from *real decoded frames*.
 *
 * Runs its own VideoDecoder, separate from playback, and fetches only the
 * bytes of the keyframe it needs (a byte-range read via the demuxer index),
 * so hovering never disturbs what's playing. Thumbnails are cached and
 * neighbours prefetched while idle, so moving along the bar feels instant.
 *
 * The last full-resolution keyframe is kept as well: clicking where you were
 * hovering puts that frame on screen immediately while the exact target
 * frame decodes (instant-feeling seeks).
 */
export class PreviewService {
  private decoder: VideoDecoder | null = null;
  private output: ((frame: VideoFrame) => void) | null = null;
  private readonly cache = new Map<number, ImageBitmap>();
  private pending: { time: number; resolve: (r: PreviewResult | null) => void } | null = null;
  private readonly prefetchQueue: number[] = [];
  private busy = false;
  private disposed = false;
  /** Full-resolution frame of the most recently rendered keyframe. */
  private lastFull: { index: number; frame: VideoFrame } | null = null;

  constructor(
    private readonly demuxer: Demuxer,
    private readonly config: VideoDecoderConfig,
    private readonly aspect: number,
  ) {}

  /** Latest request wins: older in-flight hovers are dropped, not queued. */
  request(time: number): Promise<PreviewResult | null> {
    this.pending?.resolve(null);
    return new Promise((resolve) => {
      this.pending = { time, resolve };
      void this.pump();
    });
  }

  /** Warm the cache with an evenly spaced set of keyframes (for local files). */
  warmup(count: number): void {
    const n = this.demuxer.keyframeTimes().length;
    if (!n) return;
    const step = Math.max(1, Math.floor(n / count));
    for (let i = 0; i < n; i += step) this.prefetchQueue.push(i);
    void this.pump();
  }

  /**
   * The decoded full-resolution keyframe a seek to `time` will start from,
   * if we happen to have it (caller receives a clone it must close).
   */
  frameForSeek(time: number): VideoFrame | null {
    const index = this.indexFor(time);
    return this.lastFull && this.lastFull.index === index ? this.lastFull.frame.clone() : null;
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.resolve(null);
    this.pending = null;
    for (const b of this.cache.values()) b.close();
    this.cache.clear();
    this.lastFull?.frame.close();
    this.lastFull = null;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
  }

  // -----------------------------------------------------------------------

  private indexFor(time: number): number {
    const times = this.demuxer.keyframeTimes();
    let lo = 0;
    let hi = times.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= time + 1e-3) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (!this.disposed) {
        const req = this.pending;
        if (req) {
          this.pending = null;
          const index = this.indexFor(req.time);
          const bitmap = index >= 0 ? await this.thumbnail(index, true) : null;
          const times = this.demuxer.keyframeTimes();
          // Hand out a copy: the cached bitmap stays ours.
          req.resolve(bitmap ? { time: times[index], bitmap: await createImageBitmap(bitmap) } : null);
          if (index >= 0) {
            // Cached thumbnail answered instantly; now make sure the full-res
            // frame under the cursor is ready too, so a click seeks instantly.
            if (!this.pending && this.lastFull?.index !== index) await this.decodeFull(index);
            this.queueNeighbours(index);
          }
          continue;
        }
        const next = this.prefetchQueue.shift();
        if (next === undefined) break;
        if (!this.cache.has(next)) await this.thumbnail(next, false);
      }
    } finally {
      this.busy = false;
    }
  }

  private queueNeighbours(index: number): void {
    const n = this.demuxer.keyframeTimes().length;
    for (let d = 1; d <= PREFETCH_RADIUS; d++) {
      for (const i of [index + d, index - d]) {
        if (i >= 0 && i < n && !this.cache.has(i)) this.prefetchQueue.unshift(i);
      }
    }
  }

  private async thumbnail(index: number, keepFull: boolean): Promise<ImageBitmap | null> {
    const cached = this.cache.get(index);
    if (cached) {
      // LRU: move to the end.
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const chunk = await this.demuxer.readKeyframe(index);
    if (!chunk || this.disposed) return null;
    const frame = await this.decode(chunk);
    if (!frame) return null;
    const bitmap = await createImageBitmap(frame, {
      resizeWidth: PREVIEW_WIDTH,
      resizeHeight: Math.round(PREVIEW_WIDTH / this.aspect),
      resizeQuality: 'medium',
    });
    if (keepFull) {
      this.lastFull?.frame.close();
      this.lastFull = { index, frame };
    } else {
      frame.close();
    }
    this.cache.set(index, bitmap);
    if (this.cache.size > CACHE_SIZE) {
      const [oldest, old] = this.cache.entries().next().value!;
      this.cache.delete(oldest);
      old.close();
    }
    return bitmap;
  }

  private async decodeFull(index: number): Promise<void> {
    const chunk = await this.demuxer.readKeyframe(index);
    if (!chunk || this.disposed) return;
    const frame = await this.decode(chunk);
    if (!frame) return;
    this.lastFull?.frame.close();
    this.lastFull = { index, frame };
  }

  /** Decode one self-contained keyframe on the preview decoder. */
  private async decode(chunk: EncodedVideoChunk): Promise<VideoFrame | null> {
    if (!this.decoder || this.decoder.state === 'closed') {
      this.decoder = new VideoDecoder({
        output: (f) => (this.output ? this.output(f) : f.close()),
        error: () => (this.decoder = null),
      });
      this.decoder.configure(this.config);
    }
    let result: VideoFrame | null = null;
    this.output = (f) => {
      result?.close();
      result = f;
    };
    try {
      this.decoder.decode(chunk);
      await this.decoder.flush();
    } catch {
      return null;
    } finally {
      this.output = null;
    }
    return result;
  }
}
