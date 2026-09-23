// Ingest pass: VideoFrame (GPUExternalTexture, any YUV layout) -> linear
// rgba16float storage texture that the enhancement graph can read with plain
// texture_2d bindings and sample at arbitrary coordinates.

@group(0) @binding(0) var src : texture_external;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let dims = textureDimensions(dst);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  textureStore(dst, id.xy, vec4f(textureLoad(src, id.xy).rgb, 1.0));
}
