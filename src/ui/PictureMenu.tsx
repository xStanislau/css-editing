import type { PlayerController, PlayerSnapshot } from '../player/PlayerController';
import type { PictureSettings } from '../shared/protocol';

const SLIDERS: { key: keyof PictureSettings; label: string; min: number; max: number; step: number; format: (v: number) => string }[] = [
  { key: 'brightness', label: 'Brightness', min: -0.3, max: 0.3, step: 0.01, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}` },
  { key: 'contrast', label: 'Contrast', min: 0.5, max: 1.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}` },
];

/** Live picture controls, applied in the present shader at zero extra cost. */
export function PictureMenu({ player, snap, onClose }: { player: PlayerController; snap: PlayerSnapshot; onClose(): void }) {
  const { picture, view } = snap;
  return (
    <div
      className="absolute right-3 bottom-20 z-30 w-72 rounded-xl bg-neutral-900/90 p-4 text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold">Picture</span>
        <button className="text-white/50 hover:text-white" onClick={onClose} aria-label="Close picture settings">
          ✕
        </button>
      </div>
      <div className="space-y-3">
        {SLIDERS.map((s) => (
          <label key={s.key} className="block">
            <span className="mb-1 flex justify-between text-xs text-white/70">
              <span>{s.label}</span>
              <span className="font-mono tabular-nums">{s.format(picture[s.key])}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={picture[s.key]}
              onChange={(e) => player.setPicture({ [s.key]: Number(e.target.value) })}
              onDoubleClick={() => player.setPicture({ [s.key]: { brightness: 0, contrast: 1, saturation: 1, sharpness: 0 }[s.key] })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-white/60">
        <span>
          Zoom <span className="font-mono text-white">{view.zoom.toFixed(1)}×</span>
          <span className="ml-1 text-white/40">(Ctrl+scroll, drag)</span>
        </span>
        <button className="rounded-md bg-white/10 px-2 py-1 text-white hover:bg-white/20" onClick={() => (player.resetPicture(), player.resetView())}>
          Reset all
        </button>
      </div>
    </div>
  );
}
