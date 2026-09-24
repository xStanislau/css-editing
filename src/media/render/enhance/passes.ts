/**
 * One compute pass in the enhancement graph.
 *
 * Texture names are resolved by the graph: `SOURCE` is the ingested video
 * frame (rgba16float, native resolution) and `OUTPUT` is what gets presented.
 * Any other name is an intermediate texture allocated on demand (Anime4K's
 * CNN feature maps).
 */
export interface EnhancePass {
  label: string;
  code: string;
  /** Bound at @binding(1..N) as texture_2d<f32>, in order. */
  inputs: string[];
  /** Bound at @binding(N+1) as texture_storage_2d<rgba16float, write>. */
  output: string;
  /** Output size relative to SOURCE (1 = native, 2 = 2x upscale). */
  scale: number;
  /** Whether the shader declares the linear sampler at @binding(0). */
  usesSampler: boolean;
}
