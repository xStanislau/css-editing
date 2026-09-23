import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlayerController, PlayerSnapshot } from '../player/PlayerController';
import { useFrame } from '../player/usePlayer';
import { T } from '../shared/telemetry';
import { formatTime } from './format';

const PREVIEW_W = 192;

/**
 * Seek bar driven straight from the telemetry SharedArrayBuffer at display
 * refresh rate. Progress is applied as a compositor-only transform through a
 * CSS variable, so it never triggers React renders or layout.
 *
 * Hovering shows a real decoded frame (from the worker's preview decoder)
 * above the time label.
 */
export function SeekBar({
  controller,
  loop,
  duration,
  aspect = 16 / 9,
}: {
  controller: PlayerController;
  loop?: PlayerSnapshot['loop'];
  duration?: number;
  aspect?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewTime = useRef<number | null>(null);
  const previewScheduled = useRef(false);
  const previewH = Math.round(PREVIEW_W / aspect);

  // Paint preview bitmaps as they arrive.
  useEffect(
    () =>
      controller.onPreview((bitmap) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        canvas.dataset.ready = '1';
      }),
    [controller],
  );
  const dragFraction = useRef<number | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useFrame(
    controller,
    useCallback((t: Float64Array) => {
      const el = rootRef.current;
      const d = t[T.Duration];
      if (!el || !d) return;
      const played = dragFraction.current ?? t[T.CurrentTime] / d;
      el.style.setProperty('--played', String(Math.min(1, played)));
      el.style.setProperty('--buffered', String(Math.min(1, t[T.BufferedEnd] / d)));
      el.setAttribute('aria-valuenow', String(Math.round(played * d)));
      el.setAttribute('aria-valuetext', formatTime(played * d));
    }, []),
  );

  const fractionAt = (clientX: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  // Coalesce scrub seeks to one per frame: the worker drops stale work anyway,
  // but this keeps the decoder busy on the frame the user is actually on.
  const scheduleSeek = (fraction: number) => {
    const first = pendingSeek.current === null;
    pendingSeek.current = fraction;
    if (!first) return;
    requestAnimationFrame(() => {
      const f = pendingSeek.current;
      pendingSeek.current = null;
      if (f !== null) controller.seek(f * controller.readTelemetry()[T.Duration]);
    });
  };

  const showTooltip = (clientX: number) => {
    const tip = tooltipRef.current;
    const root = rootRef.current;
    const d = controller.duration();
    if (!tip || !root || !d) return;
    const f = fractionAt(clientX);
    if (labelRef.current) labelRef.current.textContent = formatTime(f * d);
    // Keep the tooltip inside the bar horizontally.
    const width = root.clientWidth;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(width - half, Math.max(half, f * width))}px`;

    // One preview request per display frame, for the latest pointer position.
    previewTime.current = f * d;
    if (!previewScheduled.current) {
      previewScheduled.current = true;
      requestAnimationFrame(() => {
        previewScheduled.current = false;
        if (previewTime.current !== null) controller.requestPreview(previewTime.current);
      });
    }
  };

  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      className="group/seek relative flex h-5 cursor-pointer touch-none items-center outline-none"
      style={{ '--played': 0, '--buffered': 0 } as CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragFraction.current = fractionAt(e.clientX);
        setDragging(true);
        scheduleSeek(dragFraction.current);
      }}
      onPointerLeave={() => {
        previewTime.current = null;
        if (canvasRef.current) delete canvasRef.current.dataset.ready;
      }}
      onPointerMove={(e) => {
        showTooltip(e.clientX);
        if (dragFraction.current === null) return;
        dragFraction.current = fractionAt(e.clientX);
        scheduleSeek(dragFraction.current);
      }}
      onPointerUp={(e) => {
        if (dragFraction.current === null) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        controller.seek(fractionAt(e.clientX) * controller.readTelemetry()[T.Duration]);
        dragFraction.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          controller.seekBy(e.key === 'ArrowLeft' ? -5 : 5);
        }
      }}
    >
      <div
        className={`relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/seek:h-1.5 ${dragging ? 'h-1.5' : ''}`}
      >
        <div className="absolute inset-0 origin-left bg-white/35" style={{ transform: 'scaleX(var(--buffered))' }} />
        <div className="absolute inset-0 origin-left bg-accent" style={{ transform: 'scaleX(var(--played))' }} />
      </div>
      {loop && duration ? <LoopMarkers loop={loop} duration={duration} /> : null}
      <div
        className={`pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg shadow-black/40 transition-transform duration-150 ${dragging ? 'scale-100' : 'scale-0 group-hover/seek:scale-100 group-focus-visible/seek:scale-100'}`}
        style={{ left: 'calc(var(--played) * 100%)' }}
      />
      <div
        ref={tooltipRef}
        className={`pointer-events-none absolute bottom-6 flex -translate-x-1/2 flex-col items-center gap-1 opacity-0 transition-opacity group-hover/seek:opacity-100 ${dragging ? 'opacity-100' : ''}`}
      >
        <canvas
          ref={canvasRef}
          width={PREVIEW_W * 2}
          height={previewH * 2}
          style={{ width: PREVIEW_W, height: previewH }}
          className="hidden rounded-lg bg-black shadow-xl ring-2 ring-white/80 data-[ready]:block"
        />
        <span ref={labelRef} className="rounded-md bg-black/80 px-2 py-1 font-mono text-xs text-white backdrop-blur" />
      </div>
    </div>
  );
}

/** A-B loop band and handles drawn over the seek track. */
function LoopMarkers({ loop, duration }: { loop: NonNullable<PlayerSnapshot['loop']>; duration: number }) {
  const a = (loop.a / duration) * 100;
  const b = loop.b === null ? null : (loop.b / duration) * 100;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2">
      {b !== null && <div className="absolute inset-y-0 rounded-sm bg-amber-400/30" style={{ left: `${a}%`, width: `${b - a}%` }} />}
      <div className="absolute inset-y-0 w-0.5 bg-amber-400" style={{ left: `${a}%` }} />
      {b !== null && <div className="absolute inset-y-0 w-0.5 bg-amber-400" style={{ left: `${b}%` }} />}
    </div>
  );
}
