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
      const text = `${formatTime(t[T.CurrentTime])} / ${formatTime(t[T.Duration])}`;
      if (text !== last.current && ref.current) ref.current.textContent = last.current = text;
    }, []),
  );
  return <span ref={ref} className="font-mono text-[13px] tabular-nums text-white/90" />;
}
