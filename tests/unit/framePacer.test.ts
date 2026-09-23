import { describe, expect, it } from 'vitest';
import { CadenceMonitor, SmoothClock, VsyncEstimator } from '../../src/media/sync/FramePacer';

/**
 * Simulated playback: 23.976 fps video on a 60 Hz display, audio clock that
 * advances in 10 ms bursts (what AudioWorklet cursors actually look like),
 * plus a little rAF timing noise. Compares the naive selector (sample the raw
 * clock now) with the paced one (smoothed clock, predicted vsync).
 */
function simulate(paced: boolean, hz = 60, fps = 24000 / 1001, seconds = 10) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const vsyncMs = 1000 / hz;
  const vsync = new VsyncEstimator();
  const smooth = new SmoothClock();
  const monitor = new CadenceMonitor();
  const burst = 0.01;
  const audioPhase = 0.0037;
  let shown = -1;
  let worst = 0;

  for (let i = 0; i < seconds * hz; i++) {
    const raf = i * vsyncMs + rand() * 0.6;
    vsync.tick(raf);
    const trueTime = raf / 1000;
    const raw = Math.floor((trueTime + audioPhase) / burst) * burst - audioPhase;

    const target = paced ? smooth.sample(raw, raf, true) + vsync.interval / 1000 : raw + 0.5 / fps;
    const frame = Math.floor((target + (paced ? 0.001 : 0)) * fps);
    if (frame !== shown) {
      shown = frame;
      // Displayed at the next vsync; skip the first second (PLL lock-in).
      if (i > hz) monitor.present(frame / fps, (i + 1) * vsyncMs);
    }
    if (i > hz * 2) worst = Math.max(worst, monitor.jitterMs(vsyncMs));
  }
  return { worst, hz: vsync.hz };
}

describe('frame pacing', () => {
  it('estimates the display refresh rate from rAF timing', () => {
    expect(simulate(true).hz).toBeCloseTo(60, 0);
    expect(simulate(true, 144).hz).toBeCloseTo(144, 0);
  });

  it('naive selection from a bursty audio clock produces uneven cadence', () => {
    expect(simulate(false).worst).toBeGreaterThan(3);
  });

  it('paced selection keeps 24p on 60 Hz at a clean 3:2 cadence', () => {
    expect(simulate(true).worst).toBeLessThan(1);
  });

  it('paced selection gives perfect 5:5 cadence on 120 Hz', () => {
    expect(simulate(true, 120).worst).toBeLessThan(1);
  });

  it('smooth clock stays locked to the raw clock and snaps on jumps', () => {
    const c = new SmoothClock();
    let out = 0;
    let now = 0;
    for (let i = 0; i < 600; i++) {
      now = i * 16.667;
      out = c.sample(Math.floor(now / 10) / 100, now, true);
    }
    // Raw lags true time by 5 ms on average (10 ms steps); smoothed tracks that mean.
    expect(Math.abs(out - (now / 1000 - 0.005))).toBeLessThan(0.003);
    expect(c.sample(42, 600 * 16.667, true)).toBe(42); // seek-sized jump snaps immediately
  });
});
