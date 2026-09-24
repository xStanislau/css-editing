import { describe, expect, it } from 'vitest';
import { AudioRing } from '../../src/shared/audioRing';

const quantum = (channels: number, frames = 128) => Array.from({ length: channels }, () => new Float32Array(frames));
const ramp = (n: number, start = 0) => Float32Array.from({ length: n }, (_, i) => start + i);

describe('AudioRing', () => {
  it('round-trips planar PCM through the interleaved ring', () => {
    const ring = AudioRing.create(1000, 2, 1); // 1024 frames (rounded to quanta)
    expect(ring.write([ramp(256), ramp(256, 1000)], 0, 256)).toBe(256);
    ring.setPlaying(true);

    const out = quantum(2);
    expect(new AudioRing(ring.sab).read(out)).toBe(true);
    expect(Array.from(out[0].subarray(0, 3))).toEqual([0, 1, 2]);
    expect(Array.from(out[1].subarray(0, 3))).toEqual([1000, 1001, 1002]);
    expect(ring.readCursor).toBe(128);
    expect(ring.available()).toBe(128);
  });

  it('duplicates a mono source into every ring channel', () => {
    const ring = AudioRing.create(1000, 2, 1);
    ring.write([ramp(128, 5)], 0, 128);
    ring.setPlaying(true);
    const out = quantum(2);
    ring.read(out);
    expect(out[1][0]).toBe(5);
  });

  it('never overwrites unread samples and wraps around correctly', () => {
    const ring = AudioRing.create(1000, 1, 1);
    const cap = ring.capacity;
    expect(ring.write([ramp(cap + 100)], 0, cap + 100)).toBe(cap); // clipped to free space
    expect(ring.free()).toBe(0);

    ring.setPlaying(true);
    const consumer = new AudioRing(ring.sab);
    const out = quantum(1);
    consumer.read(out); // frees 128
    expect(ring.write([ramp(128, 5000)], 0, 128)).toBe(128);

    // Drain everything; the last quantum must be the wrapped data.
    let last = out[0][0];
    while (ring.available() > 0) {
      consumer.read(out);
      last = out[0][0];
    }
    expect(last).toBe(5000);
  });

  it('holds the clock and outputs silence while paused', () => {
    const ring = AudioRing.create(1000, 1, 1);
    ring.write([ramp(512, 1)], 0, 512);
    const out = quantum(1);
    out[0].fill(9);
    ring.read(out);
    expect(out[0].every((v) => v === 0)).toBe(true);
    expect(ring.readCursor).toBe(0);
  });

  it('pads with silence and counts underruns when starved', () => {
    const ring = AudioRing.create(1000, 1, 1);
    ring.setPlaying(true);
    ring.write([ramp(64, 1)], 0, 64);
    const out = quantum(1);
    expect(ring.read(out)).toBe(false); // partial quantum
    expect(out[0][63]).toBe(64);
    expect(out[0][64]).toBe(0);
    expect(ring.read(out)).toBe(false); // fully starved
    expect(ring.underruns).toBe(1);
    expect(ring.readCursor).toBe(64); // clock stalls instead of running ahead
  });

  it('discards queued audio on flush, applied by the consumer', () => {
    const ring = AudioRing.create(1000, 1, 1);
    ring.write([ramp(512)], 0, 512);
    const target = ring.flush();
    expect(ring.flushSettled()).toBe(false);

    const consumer = new AudioRing(ring.sab);
    ring.setPlaying(true);
    ring.write([ramp(128, 7000)], 0, 128);
    const out = quantum(1);
    consumer.read(out);
    expect(ring.flushSettled()).toBe(true);
    expect(out[0][0]).toBe(7000);
    expect(ring.readCursor).toBe(target + 128);
  });
});

describe('AudioRing cursor wrap', () => {
  it('stays continuous across the 2^32 cursor wrap', () => {
    const ring = AudioRing.create(1000, 1, 1);
    const ctl = new Int32Array(ring.sab, 0, 2);
    ctl[0] = ctl[1] = -64; // both cursors 64 frames before wrapping to 0
    ring.write([ramp(128, 1)], 0, 128);
    ring.setPlaying(true);
    const out = quantum(1);
    new AudioRing(ring.sab).read(out);
    expect(Array.from(out[0])).toEqual(Array.from(ramp(128, 1)));
    expect(ring.readCursor).toBe(64);
  });
});

describe('AudioRing playable()', () => {
  it('does not count audio that a pending flush will discard', () => {
    const ring = AudioRing.create(1000, 1, 1);
    ring.write([ramp(512)], 0, 512);
    expect(ring.playable()).toBe(512);
    ring.flush(); // seek: consumer hasn't applied it yet
    expect(ring.available()).toBe(512); // still occupies space (free() stays conservative)
    expect(ring.playable()).toBe(0); // but none of it will be heard
    ring.write([ramp(128)], 0, 128);
    expect(ring.playable()).toBe(128);
  });
});
