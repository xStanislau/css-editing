import { useCallback, useRef } from 'react';
import type { PlayerController, PlayerSnapshot } from '../player/PlayerController';
import { useFrame } from '../player/usePlayer';
import { T } from '../shared/telemetry';

/** "Stats for nerds": refreshed 4x per second from shared telemetry. */
export function StatsOverlay({ controller, snapshot }: { controller: PlayerController; snapshot: PlayerSnapshot }) {
  const ref = useRef<HTMLPreElement>(null);
  const lastUpdate = useRef(0);
  const { info, gpu, renderMode, enhance } = snapshot;

  useFrame(
    controller,
    useCallback(
      (t: Float64Array) => {
        const now = performance.now();
        if (now - lastUpdate.current < 250 || !ref.current) return;
        lastUpdate.current = now;
        const rows: [string, string][] = [
          ['GPU', gpu ?? '…'],
          ['Pipeline', pipelineLine(snapshot)],
          ['Video', info?.video ? `${info.video.codec} · ${info.video.hardware ? 'HW' : 'SW'} decode · ${info.video.fps.toFixed(2)} fps` : '—'],
          ['Audio', info?.audio ? `${info.audio.codec} · ${info.audio.sampleRate} Hz · ${info.audio.channels} ch` : '—'],
          ['Resolution', `${t[T.VideoWidth]}×${t[T.VideoHeight]} → ${t[T.OutputWidth]}×${t[T.OutputHeight]}`],
          ['Render', `${t[T.RenderFps].toFixed(1)} fps · ${t[T.FramesPresented]} shown · ${t[T.FramesDropped]} dropped`],
          ['Pacing', `${t[T.DisplayHz].toFixed(0)} Hz display · ${t[T.PacingJitterMs] < 1 ? 'smooth' : `jitter ${t[T.PacingJitterMs].toFixed(1)} ms`}`],
          ['Queues', `decode ${t[T.DecodeQueue]} · frames ${t[T.FrameQueue]}`],
          ['Audio buf', `${t[T.AudioBufferedMs].toFixed(0)} ms · ${t[T.AudioUnderruns]} underruns`],
          ['A/V offset', `${t[T.AvDriftMs] >= 0 ? '+' : ''}${t[T.AvDriftMs].toFixed(1)} ms`],
          ['QoE', qoeLine(controller)],
          ['Buffered', `${Math.max(0, t[T.BufferedEnd] - t[T.CurrentTime]).toFixed(1)} s ahead`],
        ];
        ref.current.textContent = rows.map(([k, v]) => `${k.padEnd(11)} ${v}`).join('\n');
      },
      [gpu, info, renderMode, enhance, snapshot],
    ),
  );

  return (
    <pre
      ref={ref}
      className="pointer-events-none absolute top-3 left-3 z-20 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-lg bg-black/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-300 ring-1 ring-white/10 backdrop-blur-md"
    />
  );
}

function qoeLine(c: PlayerController): string {
  const q = c.qoe;
  const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`);
  const avgSeek = q.seekCount ? q.seekTotalMs / q.seekCount : null;
  return `TTFF ${ms(q.ttffMs)} · seek ${ms(avgSeek)} avg (instant ${ms(q.lastSeekInstantMs)}) · rebuffers ${q.rebufferCount}`;
}

function pipelineLine(s: PlayerSnapshot): string {
  if (s.renderMode === 'direct' || !s.enhance?.active) {
    return s.renderMode === 'direct' ? 'WebGPU zero-copy external texture' : `Anime4K ${s.renderMode} (compiling…)`;
  }
  return `Anime4K ${s.enhance.active.replace(':up', ' · 2× upscale').replace(':native', ' · restore')} · ${s.enhance.passes} compute passes`;
}
