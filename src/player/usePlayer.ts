import { useEffect, useState, useSyncExternalStore } from 'react';
import { PlayerController, type PlayerSnapshot } from './PlayerController';

const IDLE: PlayerSnapshot = {
  state: 'idle',
  info: null,
  sourceName: null,
  renderMode: 'direct',
  gpu: null,
  volume: 1,
  muted: false,
  error: null,
};
const noopSubscribe = () => () => {};

/** Creates a PlayerController bound to `host` for the lifetime of the component. */
export function usePlayer(host: HTMLElement | null): [PlayerController | null, PlayerSnapshot] {
  const [controller, setController] = useState<PlayerController | null>(null);

  useEffect(() => {
    if (!host) return;
    const c = new PlayerController(host);
    setController(c);
    return () => {
      c.destroy();
      setController(null);
    };
  }, [host]);

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => IDLE),
  );
  return [controller, snapshot];
}

/** Subscribe to per-frame telemetry without re-rendering. */
export function useFrame(controller: PlayerController | null, fn: (t: Float64Array) => void): void {
  useEffect(() => (controller ? controller.onFrame(fn) : undefined), [controller, fn]);
}
