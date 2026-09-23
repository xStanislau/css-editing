import { useRef } from 'react';
import { subtitleLabel, type PlayerController, type PlayerSnapshot } from '../player/PlayerController';

/** Subtitle track picker: embedded tracks, external file, off, and "load file…". */
export function SubtitlesMenu({ player, snap, onClose }: { player: PlayerController; snap: PlayerSnapshot; onClose(): void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { tracks, external, active } = snap.subtitles;
  const item = (key: string, label: string, selected: boolean, onClick: () => void) => (
    <button
      key={key}
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-white/10 ${selected ? 'text-white' : 'text-white/70'}`}
    >
      <span className={`size-1.5 rounded-full ${selected ? 'bg-accent' : 'bg-transparent'}`} />
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div
      role="menu"
      aria-label="Subtitles"
      className="absolute right-3 bottom-20 z-30 w-64 rounded-xl bg-neutral-900/90 p-2 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-1 pb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">Subtitles</div>
      {item('off', 'Off', active === null, () => player.selectSubtitle(null))}
      {tracks.map((t) => item(String(t.id), subtitleLabel(t), active === t.id, () => player.selectSubtitle(t.id)))}
      {external && item('external', external, active === 'external', () => player.selectSubtitle('external'))}
      <div className="my-1 border-t border-white/10" />
      <button
        className="w-full rounded-md px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
        onClick={() => fileRef.current?.click()}
      >
        Load .ass / .srt / .vtt…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ass,.ssa,.srt,.vtt"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void player.loadSubtitleFile(file).then(onClose);
          e.target.value = '';
        }}
      />
    </div>
  );
}
