import { useEffect, useRef, useState } from 'react';

/**
 * Draggable divider for the A/B view. The worker draws the actual split
 * (original left, Anime4K right) in the present shader; this is only the
 * handle and labels, positioned over the letterboxed picture.
 */
export function CompareOverlay({
  host,
  aspect,
  split,
  label,
  onChange,
}: {
  host: HTMLElement;
  aspect: number;
  split: number;
  label: string;
  onChange(split: number): void;
}) {
  const [size, setSize] = useState({ w: host.clientWidth, h: host.clientHeight });
  const dragging = useRef(false);

  useEffect(() => {
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);

  const width = Math.min(size.w, size.h * aspect);
  const height = width / aspect;
  const left = (size.w - width) / 2;
  const top = (size.h - height) / 2;

  const moveTo = (clientX: number) => {
    const r = host.getBoundingClientRect();
    onChange((clientX - r.left - left) / width);
  };

  return (
    <div className="pointer-events-none absolute z-10" style={{ left, top, width, height }}>
      <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white/85 uppercase ring-1 ring-white/15 backdrop-blur">
        Original
      </span>
      <span className="absolute top-3 right-3 rounded-full bg-accent/90 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white uppercase shadow-lg shadow-accent/30">
        {label}
      </span>
      <div
        role="slider"
        aria-label="Compare split"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        tabIndex={0}
        className="group/split pointer-events-auto absolute inset-y-0 w-8 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
        style={{ left: split * width }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
        onPointerUp={(e) => {
          e.stopPropagation();
          dragging.current = false;
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            onChange(split + (e.key === 'ArrowLeft' ? -step : step));
          }
        }}
      >
        <span className="absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-xl ring-2 ring-black/30 transition group-hover/split:scale-110 group-focus-visible/split:ring-accent">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
          </svg>
        </span>
      </div>
    </div>
  );
}
