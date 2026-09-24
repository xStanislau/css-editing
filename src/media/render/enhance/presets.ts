import type { EnhancePreset } from '../../../shared/protocol';
import { ANIME4K_SHADERS, type Anime4KShaderName } from './anime4k/registry';
import { composeChain } from './anime4k/compose';
import type { EnhancePass } from './passes';

/**
 * Anime4K chains per preset. `restore` runs at native resolution (line
 * reconstruction, de-blur); `upscale` doubles resolution with a CNN and only
 * runs when the picture is actually displayed larger than the source
 * (Anime4K's own rule: output ≥ 1.2× source), otherwise it would be wasted.
 */
// Restore is trained on degraded (blurry, compressed) anime and redraws lines
// aggressively; on clean sources it shifts colour, so only the Restore preset
// uses it (measured in tests/gpu: Upscale VL alone scores best on clean art).
const CHAINS: Record<EnhancePreset, { restore: Anime4KShaderName[]; upscale: Anime4KShaderName[] }> = {
  fast: { restore: [], upscale: ['Upscale_CNN_x2_S'] },
  balanced: { restore: [], upscale: ['Upscale_CNN_x2_M'] },
  quality: { restore: [], upscale: ['Upscale_CNN_x2_VL'] },
  restore: { restore: ['Restore_CNN_M'], upscale: ['Upscale_CNN_x2_M'] },
  denoise: { restore: [], upscale: ['Upscale_Denoise_CNN_x2_M'] },
};

/** When downgrading automatically, step to the next cheaper preset. */
export const CHEAPER: Record<EnhancePreset, EnhancePreset | null> = {
  quality: 'balanced',
  restore: 'balanced',
  balanced: 'fast',
  denoise: 'fast',
  fast: null,
};

export async function loadChain(preset: EnhancePreset, upscale: boolean): Promise<EnhancePass[]> {
  const { restore, upscale: up } = CHAINS[preset];
  const names = upscale ? [...restore, ...up] : restore;
  const shaders = await Promise.all(names.map((n) => ANIME4K_SHADERS[n]()));
  return composeChain(shaders);
}
