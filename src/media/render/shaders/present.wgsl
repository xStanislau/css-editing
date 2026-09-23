// Final presentation pass: draws a letterboxed quad onto the OffscreenCanvas
// and applies the user's picture controls (colour, sharpness, zoom/pan).
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
  scale      : vec2f,
  // Zoom/pan: uv = 0.5 + (uv - 0.5) / zoom + pan.
  pan        : vec2f,
  // 1 / source size in texels, for the sharpen taps.
  texel      : vec2f,
  zoom       : f32,
  brightness : f32,  // additive, 0 = neutral
  contrast   : f32,  // multiplicative around mid-grey, 1 = neutral
  saturation : f32,  // 0 = greyscale, 1 = neutral
  sharpness  : f32,  // unsharp amount, 0 = off
  _pad       : f32,
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
  let uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  out.uv = vec2f(0.5) + (uv - vec2f(0.5)) / u.zoom + u.pan;
  return out;
}

fn grade(rgb : vec3f) -> vec4f {
  var c = (rgb - vec3f(0.5)) * u.contrast + vec3f(0.5) + vec3f(u.brightness);
  let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(vec3f(luma), c, u.saturation);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}

fn sampleExt(uv : vec2f) -> vec3f {
  return textureSampleBaseClampToEdge(frameExt, samp, uv).rgb;
}

fn sampleTex(uv : vec2f) -> vec3f {
  return textureSampleLevel(frameTex, samp, uv, 0.0).rgb;
}

@fragment
fn fs_external(in : VsOut) -> @location(0) vec4f {
  var c = sampleExt(in.uv);
  if (u.sharpness > 0.0) {
    let d = u.texel;
    let edges = 4.0 * c - sampleExt(in.uv + vec2f(d.x, 0.0)) - sampleExt(in.uv - vec2f(d.x, 0.0))
                        - sampleExt(in.uv + vec2f(0.0, d.y)) - sampleExt(in.uv - vec2f(0.0, d.y));
    c += edges * u.sharpness;
  }
  return grade(c);
}

@fragment
fn fs_texture(in : VsOut) -> @location(0) vec4f {
  var c = sampleTex(in.uv);
  if (u.sharpness > 0.0) {
    let d = u.texel;
    let edges = 4.0 * c - sampleTex(in.uv + vec2f(d.x, 0.0)) - sampleTex(in.uv - vec2f(d.x, 0.0))
                        - sampleTex(in.uv + vec2f(0.0, d.y)) - sampleTex(in.uv - vec2f(0.0, d.y));
    c += edges * u.sharpness;
  }
  return grade(c);
}
