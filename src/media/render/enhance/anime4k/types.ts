/** One Anime4K pass as transpiled from GLSL (names are local to its shader file). */
export interface Anime4KPass {
  label: string;
  code: string;
  /** Texture names bound at @binding(1..N), in order. `MAIN` = the chain's current image. */
  inputs: string[];
  /** Saved texture; `MAIN` means "the new image for the next shader in the chain". */
  output: string;
  /** Output size = size of `sizeOf` × `factor`. */
  sizeOf: string;
  factor: number;
  usesSampler: boolean;
}
