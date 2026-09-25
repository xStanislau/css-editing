// Final presentation pass: draws a letterboxed quad onto the OffscreenCanvas
// and applies the user's picture controls (colour, sharpness, zoom/pan).
//
// Two fragment entry points share this module:
//   fs_external : zero-copy path, samples the decoder's VideoFrame directly
//                 through a GPUExternalTexture (YUV->RGB done by the sampler).
//   fs_texture  : samples the output of the enhancement (Anime4K) graph.
//   fs_compare  : A/B split, original (external) left of u.split, enhanced right.
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
  split      : f32,  // compare divider in picture x (0..1), < 0 = off
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var frameExt : texture_external;
@group(0) @binding(3) var frameTex : texture_2d<f32>;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  // Horizontal position across the picture on screen (0..1), unaffected by zoom.
  @location(1) quad : f32,
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
  out.quad = uv.x;
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

fn sharpExt(uv : vec2f, d : vec2f) -> vec3f {
  var c = sampleExt(uv);
  if (u.sharpness > 0.0) {
    let edges = 4.0 * c - sampleExt(uv + vec2f(d.x, 0.0)) - sampleExt(uv - vec2f(d.x, 0.0))
                        - sampleExt(uv + vec2f(0.0, d.y)) - sampleExt(uv - vec2f(0.0, d.y));
    c += edges * u.sharpness;
  }
  return c;
}

fn sharpTex(uv : vec2f, d : vec2f) -> vec3f {
  var c = sampleTex(uv);
  if (u.sharpness > 0.0) {
    let edges = 4.0 * c - sampleTex(uv + vec2f(d.x, 0.0)) - sampleTex(uv - vec2f(d.x, 0.0))
                        - sampleTex(uv + vec2f(0.0, d.y)) - sampleTex(uv - vec2f(0.0, d.y));
    c += edges * u.sharpness;
  }
  return c;
}

@fragment
fn fs_external(in : VsOut) -> @location(0) vec4f {
  return grade(sharpExt(in.uv, u.texel));
}

@fragment
fn fs_texture(in : VsOut) -> @location(0) vec4f {
  return grade(sharpTex(in.uv, u.texel));
}

@fragment
fn fs_compare(in : VsOut) -> @location(0) vec4f {
  // Derivative first: must be in uniform control flow.
  let px = fwidth(in.quad);
  let d = in.quad - u.split;
  var c : vec3f;
  if (d < 0.0) {
    c = sharpExt(in.uv, 1.0 / vec2f(textureDimensions(frameExt)));
  } else {
    c = sharpTex(in.uv, u.texel);
  }
  // 2px divider with a dark edge so it reads on bright and dark pictures.
  let a = abs(d) / px;
  if (a < 1.0) { return vec4f(1.0); }
  if (a < 2.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return grade(c);
}
