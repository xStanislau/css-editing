import type { PlayerController, PlayerSnapshot } from '../player/PlayerController';
import { ENHANCE_PRESETS } from '../shared/protocol';

/** Anime4K preset picker. Shows what's actually running (chains compile in the background). */
export function EnhanceMenu({ player, snap }: { player: PlayerController; snap: PlayerSnapshot }) {
  const mode = snap.renderMode;
  const status = snap.enhance;
  const building = mode !== 'direct' && !status?.active?.startsWith(mode);
  const row = (id: typeof mode, label: string, detail: string) => (
    <button
      key={id}
      role="menuitemradio"
      aria-checked={mode === id}
      onClick={() => player.setRenderMode(id)}
      className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition hover:bg-white/10 ${mode === id ? 'text-white' : 'text-white/70'}`}
    >
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${mode === id ? 'bg-accent' : 'bg-transparent'}`} />
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-white/45">{detail}</span>
      </span>
    </button>
  );

  return (
    <div
      role="menu"
      aria-label="Anime4K"
      className="absolute right-3 bottom-20 z-30 w-72 rounded-xl bg-neutral-900/90 p-2 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pt-1 pb-2">
        <span className="text-xs font-semibold tracking-wide text-white/50 uppercase">Anime4K</span>
        <span className="text-[11px] text-white/40">
          {mode === 'direct' ? 'off' : building ? 'compiling…' : `${status?.passes ?? 0} passes${status?.upscaling ? ' · 2× upscale' : ' · restore only'}`}
        </span>
      </div>
      {row('direct', 'Off', 'Zero-copy, lowest power')}
      {ENHANCE_PRESETS.map((p) => row(p.id, p.label, p.detail))}
      <div className="my-1 h-px bg-white/10" />
      <button
        role="menuitemcheckbox"
        aria-checked={snap.compare !== null}
        onClick={() => player.toggleCompare()}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10"
      >
        <span>
          <span className="block">Compare before / after</span>
          <span className="block text-xs text-white/45">Drag the divider · V</span>
        </span>
        <span className={`h-5 w-9 rounded-full p-0.5 transition ${snap.compare !== null ? 'bg-accent' : 'bg-white/20'}`}>
          <span className={`block size-4 rounded-full bg-white transition ${snap.compare !== null ? 'translate-x-4' : ''}`} />
        </span>
      </button>
    </div>
  );
}
