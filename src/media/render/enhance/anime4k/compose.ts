import type { EnhancePass } from '../passes';
import type { Anime4KPass } from './types';

/**
 * Chain several Anime4K shader files into one EnhanceGraph pass list.
 *
 * Each file's textures get a unique prefix; `MAIN` is threaded through the
 * chain (SOURCE → shader 1 → shader 2 …) and the final image is `OUTPUT`.
 * Sizes are resolved to a scale relative to SOURCE.
 */
export function composeChain(shaders: Anime4KPass[][]): EnhancePass[] {
  const scales = new Map<string, number>([['SOURCE', 1]]);
  const out: EnhancePass[] = [];
  let main = 'SOURCE';
  shaders.forEach((passes, s) => {
    const name = (local: string) => (local === 'MAIN' ? main : `s${s}_${local}`);
    for (const p of passes) {
      const scale = scales.get(name(p.sizeOf));
      if (scale === undefined) throw new Error(`${p.label}: size of unknown texture ${p.sizeOf}`);
      const inputs = p.inputs.map(name);
      const output = p.output === 'MAIN' ? `s${s}_MAIN` : name(p.output);
      scales.set(output, scale * p.factor);
      out.push({ label: p.label, code: p.code, inputs, output, scale: scale * p.factor, usesSampler: p.usesSampler });
      if (p.output === 'MAIN') main = output;
    }
  });
  // The chain's final image is what gets presented.
  const finalName = main;
  for (const p of out) {
    if (p.output === finalName) p.output = 'OUTPUT';
    p.inputs = p.inputs.map((i) => (i === finalName ? 'OUTPUT' : i));
  }
  return out;
}
