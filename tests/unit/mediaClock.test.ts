import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioMasterClock, WallClock } from '../../src/media/sync/MediaClock';
import type { AudioDecodePipe } from '../../src/media/decode/AudioDecodePipe';

beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
afterEach(() => vi.useRealTimers());

describe('WallClock', () => {
  it('advances only while playing and honours seeks', () => {
    const c = new WallClock();
    c.seek(10);
    vi.advanceTimersByTime(500);
    expect(c.now()).toBe(10);
    c.play();
    vi.advanceTimersByTime(500);
    expect(c.now()).toBeCloseTo(10.5);
    c.pause();
    vi.advanceTimersByTime(500);
    expect(c.now()).toBeCloseTo(10.5);
  });
});

describe('AudioMasterClock', () => {
  const fakeAudio = () => {
    const state = { t: null as number | null, finished: false, playing: false };
    const audio = {
      timeAtReadCursor: () => state.t,
      get finished() {
        return state.finished;
      },
      ring: { setPlaying: (p: boolean) => (state.playing = p) },
    } as unknown as AudioDecodePipe;
    return { state, audio };
  };

  it('follows the audio cursor minus output latency, never before the seek point', () => {
    const { state, audio } = fakeAudio();
    const c = new AudioMasterClock(audio);
    c.outputLatency = 0.1;
    c.seek(5);
    expect(c.now()).toBe(5); // no audio yet
    state.t = 5.05;
    expect(c.now()).toBe(5); // clamped: latency would put us before the seek
    state.t = 6;
    expect(c.now()).toBeCloseTo(5.9);
  });

  it('continues on a wall clock after audio finishes (video longer than audio)', () => {
    const { state, audio } = fakeAudio();
    const c = new AudioMasterClock(audio);
    c.play();
    state.t = 11.9;
    state.finished = true;
    expect(c.now()).toBeCloseTo(11.9);
    expect(state.playing).toBe(false); // ring stopped: no underrun spam
    vi.advanceTimersByTime(100);
    expect(c.now()).toBeCloseTo(12.0);
  });
});
