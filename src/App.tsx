import { useCallback, useMemo, useState } from 'react';
import { VideoPlayer, type VideoPlayerHandle } from './ui/VideoPlayer';
import { SourceBar } from './ui/SourceBar';
import { detectCapabilities } from './ui/capabilities';
import { CompatPlayer } from './ui/CompatPlayer';
import type { MediaSourceInput } from './shared/protocol';

const SHORTCUTS = [
  ['Space / K', 'Play · pause'],
  ['← / →', 'Seek 5s'],
  ['J / L', 'Seek 10s'],
  ['0–9', 'Jump to %'],
  [', / .', 'Frame step'],
  ['B', 'Loop A-B'],
  ['X', 'Save frame'],
  ['Ctrl+scroll / + −', 'Zoom'],
  ['↑ / ↓', 'Volume'],
  ['M', 'Mute'],
  ['E', 'Enhance'],
  ['S', 'Stats'],
  ['F', 'Fullscreen'],
];

export function App() {
  const caps = useMemo(detectCapabilities, []);
  const missing = caps.filter((c) => !c.ok);
  const [player, setPlayer] = useState<VideoPlayerHandle | null>(null);
  const onReady = useCallback((p: VideoPlayerHandle) => setPlayer(p), []);
  const load = useCallback((s: MediaSourceInput) => player?.load(s), [player]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Prism<span className="text-accent">.</span>
          </h1>
          <p className="text-sm text-white/50">WebCodecs · WebGPU · AudioWorklet — no &lt;video&gt; element</p>
        </div>
      </header>

      {missing.length > 0 ? (
        <CompatPlayer missing={missing} />
      ) : (
        <>
          <VideoPlayer onReady={onReady} />
          <SourceBar onLoad={load} />
        </>
      )}

      <footer className="mt-auto flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/40">
        {SHORTCUTS.map(([k, v]) => (
          <span key={k}>
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-white/70">{k}</kbd> {v}
          </span>
        ))}
      </footer>
    </main>
  );
}
