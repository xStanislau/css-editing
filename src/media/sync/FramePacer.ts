/**
 * Frame pacing: deciding *which* decoded frame to show on each vsync so that
 * motion cadence is as even as the display allows (perfect 5:5 for 24p on
 * 120 Hz, a steady 3:2 on 60 Hz), instead of the irregular 2-2-3-3 / 1-4
 * patterns you get from sampling a jumpy clock.
 *
 * Two sources of jitter are removed:
 *  1. The audio clock advances in bursts (the OS hands the worklet ~10 ms of
 *     audio at once), so it is smoothed with a PLL that tracks it slowly.
 *  2. A frame drawn now appears at the *next* vsync, so selection targets the
 *     predicted presentation time, not the current time.
 */

/** Estimates the display refresh interval from rAF timestamps. */
export class VsyncEstimator {
  private readonly deltas: number[] = [];
  private last = 0;
  /** Milliseconds between vsyncs (median of recent rAF deltas). */
  interval = 1000 / 60;

  tick(rafTime: number): void {
    if (this.last) {
      const d = rafTime - this.last;
      // Ignore stalls (tab switch, GC) and duplicate callbacks.
      if (d > 3 && d < 60) {
        this.deltas.push(d);
        if (this.deltas.length > 64) this.deltas.shift();
        const sorted = [...this.deltas].sort((a, b) => a - b);
        this.interval = sorted[sorted.length >> 1];
      }
    }
    this.last = rafTime;
  }

  get hz(): number {
    return 1000 / this.interval;
  }
}

/** Beyond this error the smoothed clock snaps to the raw clock (seek, stall, drift). */
const SNAP_THRESHOLD = 0.06;
/** Phase correction gain per update (~1s time constant at 60 Hz). */
const PHASE_GAIN = 0.02;
/** Frequency correction gain; absorbs sound-card vs system-clock drift. */
const RATE_GAIN = 0.0002;

/**
 * Phase-locked smoothing of a steppy media clock. Output advances linearly
 * with real time while continuously and gently steering towards the raw
 * (audio) clock, so it never drifts, yet never jumps.
 */
export class SmoothClock {
  private base = 0;
  private baseAt = 0;
  private rate = 1;
  private locked = false;

  /** Feed the raw clock at wall time `nowMs`; returns the smoothed media time. */
  sample(raw: number, nowMs: number, running: boolean): number {
    if (!running) {
      this.locked = false;
      return raw;
    }
    if (!this.locked) {
      this.lock(raw, nowMs);
      return raw;
    }
    const predicted = this.base + ((nowMs - this.baseAt) / 1000) * this.rate;
    const error = raw - predicted;
    if (Math.abs(error) > SNAP_THRESHOLD) {
      this.lock(raw, nowMs);
      return raw;
    }
    this.rate = Math.min(1.005, Math.max(0.995, this.rate + error * RATE_GAIN));
    this.base = predicted + error * PHASE_GAIN;
    this.baseAt = nowMs;
    return this.base;
  }

  reset(): void {
    this.locked = false;
  }

  private lock(raw: number, nowMs: number): void {
    this.base = raw;
    this.baseAt = nowMs;
    this.rate = 1;
    this.locked = true;
  }
}

/**
 * Measures pacing quality. Each new frame's display time is compared with its
 * ideal time (its timestamp on the wall clock). With perfect pacing these
 * offsets all fall within one vsync interval (the unavoidable quantisation),
 * e.g. a clean 3:2 cadence for 24p on 60 Hz. Anything beyond that, such as
 * 2-2-3-3 patterns, a frame shown a vsync early or late, or a skipped frame,
 * shows up as extra jitter.
 */
export class CadenceMonitor {
  private readonly offsets: number[] = [];

  /** A new frame (media timestamp `frameTime` s) reached the screen at `displayMs`. */
  present(frameTime: number, displayMs: number): void {
    this.offsets.push(displayMs - frameTime * 1000);
    if (this.offsets.length > 48) this.offsets.shift();
  }

  /** Jitter beyond vsync quantisation, in ms (0 = perfect). */
  jitterMs(vsyncMs: number): number {
    if (this.offsets.length < 8) return 0;
    let min = Infinity;
    let max = -Infinity;
    for (const o of this.offsets) {
      if (o < min) min = o;
      if (o > max) max = o;
    }
    return Math.max(0, max - min - vsyncMs);
  }

  reset(): void {
    this.offsets.length = 0;
  }
}
