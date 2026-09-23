import type { AudioDecodePipe } from '../decode/AudioDecodePipe';

/**
 * The single source of truth for "what time is it in the media right now".
 * Video frames are chosen against this, never against their own cadence.
 */
export interface MediaClock {
  /** Current media time in seconds. */
  now(): number;
  play(): void;
  pause(): void;
  /** Jump to `time`; the clock holds there until media resumes. */
  seek(time: number): void;
}

/**
 * Audio master clock: derived from how many samples the AudioWorklet has
 * actually pulled, minus the hardware output latency. If the network stalls,
 * the worklet starves, this clock stops, and video politely waits: lip-sync
 * is preserved by construction.
 */
export class AudioMasterClock implements MediaClock {
  outputLatency = 0;
  private held = 0;
  private playing = false;
  /**
   * Audio tracks often end a few frames before video. Once audio is fully
   * drained, time keeps flowing on a wall clock so the trailing video frames
   * are shown and playback reaches `ended`.
   */
  private tail: WallClock | null = null;

  constructor(private readonly audio: AudioDecodePipe) {}

  now(): number {
    if (this.tail) return this.tail.now();
    const t = this.audio.timeAtReadCursor();
    if (t === null) return this.held;
    // Output latency: samples pulled by the worklet reach the speaker later.
    // Never report a time before the segment start (right after a seek).
    const now = Math.max(this.held, t - this.outputLatency);
    if (this.audio.finished) {
      this.audio.ring?.setPlaying(false);
      this.tail = new WallClock();
      this.tail.seek(now);
      if (this.playing) this.tail.play();
    }
    return now;
  }

  play(): void {
    this.playing = true;
    if (this.tail) this.tail.play();
    else this.audio.ring?.setPlaying(true);
  }

  pause(): void {
    this.playing = false;
    this.tail?.pause();
    this.audio.ring?.setPlaying(false);
  }

  seek(time: number): void {
    this.held = time;
    this.tail = null;
  }
}

/** Fallback for media without (decodable) audio: performance.now() based. */
export class WallClock implements MediaClock {
  private base = 0;
  private startedAt: number | null = null;

  now(): number {
    return this.startedAt === null ? this.base : this.base + (performance.now() - this.startedAt) / 1000;
  }

  play(): void {
    if (this.startedAt === null) this.startedAt = performance.now();
  }

  pause(): void {
    this.base = this.now();
    this.startedAt = null;
  }

  seek(time: number): void {
    this.base = time;
    if (this.startedAt !== null) this.startedAt = performance.now();
  }
}
