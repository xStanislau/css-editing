import { describe, expect, it } from 'vitest';
import { T, Telemetry } from '../../src/shared/telemetry';

describe('Telemetry', () => {
  it('shares a consistent snapshot between writer and reader views', () => {
    const writer = Telemetry.create();
    const reader = new Telemetry(writer.sab);
    writer.write((v) => {
      v[T.CurrentTime] = 12.5;
      v[T.Duration] = 90;
    });
    const out = reader.read(new Float64Array(T.SLOTS));
    expect(out[T.CurrentTime]).toBe(12.5);
    expect(out[T.Duration]).toBe(90);
  });
});
