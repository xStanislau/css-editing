import anime4kPlaceholder from '../shaders/anime4k.placeholder.wgsl?raw';

/**
 * One compute pass in the enhancement graph.
 *
 * Texture names are resolved by the graph: `SOURCE` is the ingested video
 * frame (rgba16float, native resolution) and `OUTPUT` is what gets presented.
 * Any other name is an intermediate texture allocated on demand, so Anime4K's
 * multi-layer CNNs (feature maps feeding later layers) map directly.
 */
export interface EnhancePass {
  label: string;
  code: string;
  entryPoint?: string;
  /** Bound at @binding(1..N) as texture_2d<f32>, in order. */
  inputs: string[];
  /** Bound at @binding(N+1) as texture_storage_2d<rgba16float, write>. */
  output: string;
  /** Output size relative to SOURCE (1 = native, 2 = 2x upscale). */
  scale: number;
  /** Whether the shader declares the linear sampler at @binding(0). */
  usesSampler: boolean;
}

// ============================================================================
//  ANIME4K PASS LIST — replace the placeholder with the real Anime4K chain.
//  e.g. Anime4K_Restore_CNN_M -> Anime4K_Upscale_CNN_x2_M (conv layers at
//  scale 1 writing intermediate feature maps, final depth-to-space at scale 2).
// ============================================================================
export const ENHANCE_PASSES: EnhancePass[] = [
  {
    label: 'anime4k-placeholder-upscale-x2',
    code: anime4kPlaceholder,
    inputs: ['SOURCE'],
    output: 'OUTPUT',
    scale: 2,
    usesSampler: true,
  },
];
