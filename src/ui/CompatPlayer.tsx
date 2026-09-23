import { useEffect, useRef, useState } from 'react';
import type { MediaSourceInput } from '../shared/protocol';
import type { Capability } from './capabilities';
import { SourceBar } from './SourceBar';

/**
 * Compatibility mode for browsers missing part of the WebGPU/WebCodecs stack:
 * plain <video> playback, so people can always watch, plus a short note on
 * what the full engine needs.
 */
export function CompatPlayer({ missing }: { missing: Capability[] }) {
  const [src, setSrc] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const load = (s: MediaSourceInput) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = s.kind === 'file' ? URL.createObjectURL(s.file) : null;
    setSrc(objectUrl.current ?? (s.kind === 'url' ? s.url : null));
  };

  return (
    <>
      <div className="flex items-start gap-3 rounded-xl bg-amber-950/40 px-4 py-3 text-sm text-amber-100 ring-1 ring-amber-500/30">
        <span className="font-semibold">Compatibility mode.</span>
        <span className="text-amber-100/80">
          Enhancement and the custom engine need: {missing.map((c) => c.name).join(', ')}.{' '}
          <span className="text-amber-100/60">{missing[0]?.hint}</span>
        </span>
      </div>
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10">
        {src ? (
          <video key={src} src={src} controls autoPlay playsInline className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">Pick a source below</div>
        )}
      </div>
      <SourceBar onLoad={load} />
    </>
  );
}
