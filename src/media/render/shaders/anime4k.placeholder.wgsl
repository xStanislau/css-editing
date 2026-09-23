// ╔══════════════════════════════════════════════════════════════════════════╗
// ║                     ANIME4K SHADER INJECTION POINT                       ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ This file is a PLACEHOLDER pass so the enhancement graph is exercised    ║
// ║ end-to-end today: 2x bilinear upscale + light contrast-adaptive sharpen. ║
// ║                                                                          ║
// ║ To inject Anime4K (e.g. ports from SegaraRai/anime4k-wgpu):              ║
// ║   1. Drop each Anime4K pass in as its own .wgsl compute shader.          ║
// ║   2. Register them, in order, in `render/enhance/passes.ts`, naming      ║
// ║      their input/output textures (SOURCE -> conv feature maps -> OUTPUT) ║
// ║      and the output scale factor (1 for CNN layers, 2 for depth2space).  ║
// ║   3. Follow the binding convention below; the graph executor wires the   ║
// ║      textures and the sampler for you.                                   ║
// ║                                                                          ║
// ║ Binding convention for every enhancement pass:                           ║
// ║   @binding(0)          sampler (linear, clamp)   — optional              ║
// ║   @binding(1 ... N)    inputs, texture_2d<f32>, in declared order        ║
// ║   @binding(N + 1)      output, texture_storage_2d<rgba16float, write>    ║
// ║   @workgroup_size(8, 8), one invocation per OUTPUT texel                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

@group(0) @binding(0) var linearSamp : sampler;
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex : texture_storage_2d<rgba16float, write>;

fn luma(c : vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let outDims = textureDimensions(dstTex);
  if (id.x >= outDims.x || id.y >= outDims.y) {
    return;
  }
  let texel = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = (vec2f(id.xy) + 0.5) / vec2f(outDims);

  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> BEGIN PLACEHOLDER >>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  let c = textureSampleLevel(srcTex, linearSamp, uv, 0.0).rgb;
  let n = textureSampleLevel(srcTex, linearSamp, uv + vec2f(0.0, -texel.y), 0.0).rgb;
  let s = textureSampleLevel(srcTex, linearSamp, uv + vec2f(0.0, texel.y), 0.0).rgb;
  let e = textureSampleLevel(srcTex, linearSamp, uv + vec2f(texel.x, 0.0), 0.0).rgb;
  let w = textureSampleLevel(srcTex, linearSamp, uv + vec2f(-texel.x, 0.0), 0.0).rgb;

  // Contrast-adaptive weight: sharpen flat regions more than strong edges to
  // avoid ringing on line art.
  let mn = min(luma(c), min(min(luma(n), luma(s)), min(luma(e), luma(w))));
  let mx = max(luma(c), max(max(luma(n), luma(s)), max(luma(e), luma(w))));
  let amount = 0.35 * sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));

  let sharpened = c + (4.0 * c - n - s - e - w) * amount;
  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< END PLACEHOLDER <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

  textureStore(dstTex, id.xy, vec4f(clamp(sharpened, vec3f(0.0), vec3f(1.0)), 1.0));
}
