import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { usePlayer } from '../player/usePlayer';
import type { PlayerController, PlayerSnapshot } from '../player/PlayerController';
import type { MediaSourceInput } from '../shared/protocol';
import { SeekBar } from './SeekBar';
import { TimeDisplay } from './TimeDisplay';
import { StatsOverlay } from './StatsOverlay';
import { PictureMenu } from './PictureMenu';
import {
  CameraIcon,
  FullscreenIcon,
  LoopIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
  SparklesIcon,
  StatsIcon,
  TuneIcon,
  UploadIcon,
  VolumeIcon,
} from './icons';

const IDLE_HIDE_MS = 2500;
const NOTICE_MS = 3500;
/** Pointer travel (px) that turns a click into a pan drag. */
const DRAG_THRESHOLD = 4;

/** Where the letterboxed video sits inside the host element. */
function videoRect(host: HTMLElement, aspect: number) {
  const r = host.getBoundingClientRect();
  const width = Math.min(r.width, r.height * aspect);
  const height = width / aspect;
  return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height };
}

export interface VideoPlayerHandle {
  load(source: MediaSourceInput): void;
}

export function VideoPlayer({ onReady }: { onReady?: (player: VideoPlayerHandle) => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [player, snap] = usePlayer(host);
  const [showStats, setShowStats] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showPicture, setShowPicture] = useState(false);
  const panDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const playing = snap.state === 'playing' || snap.state === 'buffering';
  const hasMedia = snap.info !== null;
  const spinner = snap.state === 'loading' || (snap.state === 'buffering' && hasMedia);
  const aspect = snap.info?.video ? snap.info.video.width / snap.info.video.height : 16 / 9;
  const zoomed = snap.view.zoom > 1.001;

  // ------------------------------------------------ notices auto-dismiss
  useEffect(() => {
    if (!snap.notice || !player) return;
    const t = setTimeout(() => player.dismissNotice(), NOTICE_MS);
    return () => clearTimeout(t);
  }, [snap.notice, player]);

  // ------------------------------------------------ zoom: Ctrl/⌘ + wheel, trackpad pinch
  // Native non-passive listener: React's onWheel can't preventDefault, and
  // Ctrl+wheel would otherwise zoom the whole page.
  useEffect(() => {
    if (!host || !player) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !player.getSnapshot().info) return;
      e.preventDefault();
      const r = videoRect(host, aspect);
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      player.zoomAt(Math.exp(-e.deltaY * 0.01), fx, fy);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [host, player, aspect]);

  useEffect(() => {
    if (player) onReady?.({ load: (s) => player.load(s) });
  }, [player, onReady]);

  // ------------------------------------------------ auto-hiding chrome
  const poke = useCallback(() => {
    setChromeVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), IDLE_HIDE_MS);
  }, []);
  useEffect(() => {
    if (!playing) {
      clearTimeout(hideTimer.current);
      setChromeVisible(true);
    } else poke();
    return () => clearTimeout(hideTimer.current);
  }, [playing, poke]);

  // ------------------------------------------------ fullscreen
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen({ navigationUI: 'hide' });
  }, []);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ------------------------------------------------ keyboard
  useEffect(() => {
    if (!player) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const handled = handleKey(player, e.key, {
        toggleFullscreen,
        toggleStats: () => setShowStats((s) => !s),
        renderMode: snap.renderMode,
      });
      if (handled) {
        e.preventDefault();
        poke();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, toggleFullscreen, poke, snap.renderMode]);

  // ------------------------------------------------ drag & drop
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && player) player.load({ kind: 'file', file });
  };

  return (
    <div
      ref={rootRef}
      className={`group relative isolate aspect-video w-full overflow-hidden bg-black select-none ${fullscreen ? '' : 'rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10'} ${chromeVisible ? '' : 'cursor-none'}`}
      onPointerMove={poke}
      onPointerLeave={() => playing && setChromeVisible(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* The worker renders here; PlayerController injects the <canvas>. */}
      <div
        ref={setHost}
        className={`absolute inset-0 ${zoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          panDrag.current = { x: e.clientX, y: e.clientY, moved: false };
          if (zoomed) e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = panDrag.current;
          if (!d || !zoomed || !host) return;
          if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
          d.moved = true;
          const r = videoRect(host, aspect);
          player?.panBy((e.clientX - d.x) / r.width, (e.clientY - d.y) / r.height);
          d.x = e.clientX;
          d.y = e.clientY;
        }}
        onPointerUp={() => {
          const d = panDrag.current;
          panDrag.current = null;
          if (showPicture) return setShowPicture(false);
          if (!d?.moved && hasMedia) player?.togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
      />

      {zoomed && (
        <button
          className="absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 font-mono text-xs text-white ring-1 ring-white/15 backdrop-blur hover:bg-black/80"
          onClick={() => player?.resetView()}
          title="Reset zoom (z)"
        >
          {snap.view.zoom.toFixed(1)}× · reset
        </button>
      )}

      {snap.notice && (
        <div
          key={snap.notice.id}
          className="pointer-events-none absolute top-14 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white ring-1 ring-white/15 backdrop-blur"
        >
          {snap.notice.message}
        </div>
      )}

      {!hasMedia && snap.state !== 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60">
          <UploadIcon className="size-10" />
          <p className="text-sm">Drop an MP4, MKV or WebM here, or pick a source below</p>
        </div>
      )}

      {spinner && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-14 animate-spin rounded-full border-[3px] border-white/15 border-t-white" />
        </div>
      )}

      {hasMedia && !playing && !spinner && (
        <button
          aria-label={snap.state === 'ended' ? 'Replay' : 'Play'}
          className="absolute top-1/2 left-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-md transition hover:scale-105 hover:bg-black/60 active:scale-95"
          onClick={() => player?.play()}
        >
          {snap.state === 'ended' ? <ReplayIcon className="size-9" /> : <PlayIcon className="ml-1 size-9" />}
        </button>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-lg font-medium text-white backdrop-blur-sm">
          Drop to play
        </div>
      )}

      {snap.error && (
        <div className="absolute top-3 right-3 z-30 flex max-w-sm items-start gap-3 rounded-lg bg-red-950/90 px-4 py-3 text-sm text-red-100 ring-1 ring-red-500/40 backdrop-blur">
          <span className="flex-1">{snap.error.message}</span>
          <button className="text-red-300 hover:text-white" onClick={() => player?.dismissError()} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {showStats && player && <StatsOverlay controller={player} snapshot={snap} />}

      {showPicture && player && hasMedia && <PictureMenu player={player} snap={snap} onClose={() => setShowPicture(false)} />}

      {player && hasMedia && (
        <Controls
          player={player}
          visible={chromeVisible}
          playing={playing}
          ended={snap.state === 'ended'}
          volume={snap.volume}
          muted={snap.muted}
          enhanced={snap.renderMode === 'enhanced'}
          showStats={showStats}
          fullscreen={fullscreen}
          onToggleStats={() => setShowStats((s) => !s)}
          onToggleFullscreen={toggleFullscreen}
          title={snap.sourceName}
          loop={snap.loop}
          duration={snap.info?.duration ?? 0}
          aspect={aspect}
          showPicture={showPicture}
          onTogglePicture={() => setShowPicture((v) => !v)}
        />
      )}
    </div>
  );
}

interface ControlsProps {
  player: PlayerController;
  visible: boolean;
  playing: boolean;
  ended: boolean;
  volume: number;
  muted: boolean;
  enhanced: boolean;
  showStats: boolean;
  fullscreen: boolean;
  title: string | null;
  loop: PlayerSnapshot['loop'];
  duration: number;
  aspect: number;
  showPicture: boolean;
  onToggleStats(): void;
  onToggleFullscreen(): void;
  onTogglePicture(): void;
}

function Controls(p: ControlsProps) {
  const level = p.muted ? 0 : p.volume;
  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pt-16 pb-3 transition-opacity duration-300 ${p.visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <SeekBar controller={p.player} loop={p.loop} duration={p.duration} aspect={p.aspect} />
      <div className="mt-1.5 flex items-center gap-1 text-white">
        <IconButton label={p.playing ? 'Pause (k)' : p.ended ? 'Replay' : 'Play (k)'} onClick={() => p.player.togglePlay()}>
          {p.playing ? <PauseIcon className="size-6" /> : p.ended ? <ReplayIcon className="size-6" /> : <PlayIcon className="size-6" />}
        </IconButton>

        <div className="group/vol flex items-center">
          <IconButton label="Mute (m)" onClick={() => p.player.toggleMute()}>
            <VolumeIcon level={level} className="size-6" />
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={level}
            aria-label="Volume"
            onChange={(e) => p.player.setVolume(Number(e.target.value))}
            className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 accent-white opacity-0 transition-all duration-200 group-hover/vol:ml-1 group-hover/vol:w-20 group-hover/vol:opacity-100 focus-visible:ml-1 focus-visible:w-20 focus-visible:opacity-100"
          />
        </div>

        <span className="ml-2">
          <TimeDisplay controller={p.player} />
        </span>

        <span className="mx-3 hidden min-w-0 flex-1 truncate text-center text-sm text-white/60 sm:block">{p.title}</span>
        <span className="flex-1 sm:hidden" />

        <button
          onClick={() => p.player.setRenderMode(p.enhanced ? 'direct' : 'enhanced')}
          title="WebGPU enhancement (e)"
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition ${p.enhanced ? 'bg-accent text-white shadow-lg shadow-accent/40' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
        >
          <SparklesIcon className="size-4" />
          {p.enhanced ? 'ENHANCED' : 'ENHANCE'}
        </button>
        <IconButton
          label={!p.loop ? 'Set loop start (b)' : p.loop.b === null ? 'Set loop end (b)' : 'Clear loop (b)'}
          onClick={() => p.player.cycleLoop()}
          active={p.loop !== null}
        >
          <span className="relative">
            <LoopIcon className="size-5" />
            {p.loop && <span className="absolute -top-1.5 -right-2 text-[9px] font-bold">{p.loop.b === null ? 'A' : 'AB'}</span>}
          </span>
        </IconButton>
        <IconButton label="Save frame as PNG (x)" onClick={() => p.player.snapshotFrame()}>
          <CameraIcon className="size-5" />
        </IconButton>
        <IconButton label="Picture settings" onClick={p.onTogglePicture} active={p.showPicture}>
          <TuneIcon className="size-5" />
        </IconButton>
        <IconButton label="Stats (s)" onClick={p.onToggleStats} active={p.showStats}>
          <StatsIcon className="size-5" />
        </IconButton>
        <IconButton label="Fullscreen (f)" onClick={p.onToggleFullscreen}>
          <FullscreenIcon active={p.fullscreen} className="size-5" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children, active }: { label: string; onClick(): void; children: ReactNode; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-10 items-center justify-center rounded-full transition hover:bg-white/15 active:scale-90 ${active ? 'text-accent' : ''}`}
    >
      {children}
    </button>
  );
}

function handleKey(
  player: PlayerController,
  key: string,
  ctx: {
    toggleFullscreen(): void;
    toggleStats(): void;
    renderMode: string;
  },
): boolean {
  switch (key) {
    case ',':
      player.stepFrame(-1);
      return true;
    case '.':
      player.stepFrame(1);
      return true;
    case 'x':
      player.snapshotFrame();
      return true;
    case 'b':
      player.cycleLoop();
      return true;
    case '+':
    case '=':
      player.zoomAt(1.25);
      return true;
    case '-':
      player.zoomAt(0.8);
      return true;
    case 'z':
      player.resetView();
      return true;
    case ' ':
    case 'k':
      player.togglePlay();
      return true;
    case 'ArrowLeft':
      player.seekBy(-5);
      return true;
    case 'ArrowRight':
      player.seekBy(5);
      return true;
    case 'j':
      player.seekBy(-10);
      return true;
    case 'l':
      player.seekBy(10);
      return true;
    case 'ArrowUp':
      player.setVolume(player.getSnapshot().volume + 0.05);
      return true;
    case 'ArrowDown':
      player.setVolume(player.getSnapshot().volume - 0.05);
      return true;
    case 'm':
      player.toggleMute();
      return true;
    case 'f':
      ctx.toggleFullscreen();
      return true;
    case 's':
      ctx.toggleStats();
      return true;
    case 'e':
      player.setRenderMode(ctx.renderMode === 'enhanced' ? 'direct' : 'enhanced');
      return true;
    case 'Home':
      player.seek(0);
      return true;
    default:
      // 0-9 jump to 0%..90%, like every major player.
      if (/^[0-9]$/.test(key)) {
        player.seek((Number(key) / 10) * player.duration());
        return true;
      }
      return false;
  }
}
