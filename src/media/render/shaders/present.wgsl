// Final presentation pass: draws a letterboxed quad onto the OffscreenCanvas.
//
// Two fragment entry points share this module:
//   fs_external : zero-copy path, samples the decoder's VideoFrame directly
//                 through a GPUExternalTexture (YUV->RGB done by the sampler).
//   fs_texture  : samples the output of the enhancement (Anime4K) graph.
//
// Auto-generated pipeline layouts only include the bindings each entry point
// actually uses, so the two paths can live side by side.

struct Uniforms {
  // NDC half-extent of the video quad (aspect-fit letterbox / pillarbox).
  scale : vec2f,
  _pad  : vec2f,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var frameExt : texture_external;
@group(0) @binding(3) var frameTex : texture_2d<f32>;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> VsOut {
  // Triangle-strip quad.
  var corners = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let c = corners[i];
  var out : VsOut;
  out.pos = vec4f(c * u.scale, 0.0, 1.0);
  out.uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  return out;
}

@fragment
fn fs_external(in : VsOut) -> @location(0) vec4f {
  return vec4f(textureSampleBaseClampToEdge(frameExt, samp, in.uv).rgb, 1.0);
}

@fragment
fn fs_texture(in : VsOut) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(frameTex, samp, in.uv, 0.0).rgb, 1.0);
}
