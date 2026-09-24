import { useCallback, useRef } from 'react';
import type { PlayerController } from '../player/PlayerController';
import { useFrame } from '../player/usePlayer';
import { T } from '../shared/telemetry';
import { formatTime } from './format';

export function TimeDisplay({ controller }: { controller: PlayerController }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef('');
  useFrame(
    controller,
    useCallback((t: Float64Array) => {
      // currentTime() includes a seek the worker hasn't reported yet, so the
      // readout follows the thumb while scrubbing instead of lagging behind.
      const text = `${formatTime(controller.currentTime())} / ${formatTime(t[T.Duration])}`;
      if (text !== last.current && ref.current) ref.current.textContent = last.current = text;
    }, [controller]),
  );
  return <span ref={ref} className="font-mono text-[13px] tabular-nums text-white/90" />;
}
