import presentWgsl from './shaders/present.wgsl?raw';
import { EnhanceGraph } from './enhance/EnhanceGraph';
import { ENHANCE_PASSES } from './enhance/passes';
import { DEFAULT_PICTURE, DEFAULT_VIEW, type PictureSettings, type RenderMode, type ViewSettings } from '../../shared/protocol';

/** Uniform block size in bytes (see `struct Uniforms` in present.wgsl). */
const UNIFORM_BYTES = 48;

/**
 * WebGPU presenter living entirely inside the media worker.
 *
 *  direct   : VideoFrame -> importExternalTexture -> present   (zero copy)
 *  enhanced : VideoFrame -> importExternalTexture -> EnhanceGraph (compute,
 *             Anime4K goes here) -> present
 *
 * The present pass also applies picture controls (colour, sharpness) and
 * GPU zoom/pan, so they cost one fragment shader, not an extra pass.
 */
export class WebGpuRenderer {
  private readonly ctx: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly directPipeline: GPURenderPipeline;
  private readonly texturePipeline: GPURenderPipeline;
  private readonly uniforms: GPUBuffer;
  private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4);
  private readonly sampler: GPUSampler;
  private enhance: EnhanceGraph | null = null;
  private mode: RenderMode = 'direct';
  private picture: PictureSettings = DEFAULT_PICTURE;
  private view: ViewSettings = DEFAULT_VIEW;
  private uniformsKey = '';
  /** @internal set when the device is lost; never touch a lost device. */
  _lost = false;

  static async create(canvas: OffscreenCanvas, onLost: (reason: string) => void): Promise<WebGpuRenderer> {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found');
    const device = await adapter.requestDevice({ label: 'video-player' });
    device.addEventListener('uncapturederror', (e) => console.error('[webgpu]', (e as GPUUncapturedErrorEvent).error.message));
    const renderer = new WebGpuRenderer(canvas, adapter, device);
    device.lost.then((info) => {
      renderer._lost = true;
      if (info.reason !== 'destroyed') onLost(info.message);
    });
    return renderer;
  }

  private constructor(
    private readonly canvas: OffscreenCanvas,
    // Hold the adapter for the renderer's whole lifetime: if it is garbage
    // collected, some Chromium builds tear down the underlying GPU instance
    // and the device is lost ("external Instance reference no longer exists").
    private readonly adapter: GPUAdapter,
    readonly device: GPUDevice,
  ) {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Could not create a WebGPU canvas context');
    this.ctx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ label: 'present', code: presentWgsl });
    const makePipeline = (fragmentEntry: string) =>
      device.createRenderPipeline({
        label: `present:${fragmentEntry}`,
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: fragmentEntry, targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-strip' },
      });
    this.directPipeline = makePipeline('fs_external');
    this.texturePipeline = makePipeline('fs_texture');

    this.uniforms = device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  /** False once the GPU device is lost; draws are skipped until replaced. */
  get usable(): boolean {
    return !this._lost;
  }

  get adapterInfo(): GPUAdapterInfo {
    return this.adapter.info;
  }

  get renderMode(): RenderMode {
    return this.mode;
  }

  setMode(mode: RenderMode): void {
    this.mode = mode;
    if (mode === 'enhanced' && !this.enhance) this.enhance = new EnhanceGraph(this.device, ENHANCE_PASSES);
    if (mode === 'direct' && this.enhance) {
      this.enhance.destroy();
      this.enhance = null;
    }
  }

  setPicture(picture: PictureSettings): void {
    this.picture = picture;
  }

  setView(view: ViewSettings): void {
    this.view = view;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Size of the image actually produced by the last draw (after enhancement). */
  outputSize(frame: VideoFrame): [number, number] {
    const out = this.mode === 'enhanced' ? this.enhance?.output : null;
    return out ? [out.width, out.height] : [frame.displayWidth, frame.displayHeight];
  }

  /** Present one frame (false if skipped). The frame stays owned by the caller. */
  draw(frame: VideoFrame): boolean {
    if (this._lost) return false;
    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const texel = this.encodeSource(encoder, frame);
    this.writeUniforms(this.uniforms, this.letterbox(frame, this.canvas.width, this.canvas.height), this.view, texel, true);
    this.encodePresent(encoder, this.ctx.getCurrentTexture(), this.uniforms, frame);
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  /**
   * Render `frame` exactly as the user sees it (enhancement + picture
   * controls) but at full source/output resolution, without zoom or
   * letterboxing, and encode it as PNG.
   */
  async snapshot(frame: VideoFrame): Promise<Blob> {
    if (this._lost) throw new Error('GPU unavailable');
    const encoder = this.device.createCommandEncoder({ label: 'snapshot' });
    const texel = this.encodeSource(encoder, frame);
    const [w, h] = this.outputSize(frame);

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('webgpu')!;
    ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    const uniforms = this.device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.writeUniforms(uniforms, [1, 1], DEFAULT_VIEW, texel, false);
    this.encodePresent(encoder, ctx.getCurrentTexture(), uniforms, frame);
    this.device.queue.submit([encoder.finish()]);
    // Must be taken in the same task as the submit (before the canvas texture expires).
    const blob = canvas.convertToBlob({ type: 'image/png' });
    uniforms.destroy();
    return blob;
  }

  /**
   * Close a frame once the GPU has finished all work submitted so far.
   * Closing a VideoFrame that an in-flight submit still samples from is legal
   * per spec, but some drivers stall or crash on it, and this costs nothing.
   */
  release(frame: VideoFrame): void {
    const close = () => frame.close();
    if (this._lost) return close();
    this.device.queue.onSubmittedWorkDone().then(close, close);
  }

  destroy(): void {
    this.enhance?.destroy();
    this.uniforms.destroy();
    this.device.destroy();
  }

  // -----------------------------------------------------------------------

  /** Run the enhancement graph if active; returns the texel size the present pass samples. */
  private encodeSource(encoder: GPUCommandEncoder, frame: VideoFrame): [number, number] {
    this.pendingExternal = this.device.importExternalTexture({ source: frame });
    if (this.mode === 'enhanced' && this.enhance) {
      const { width, height } = frame.visibleRect ?? { width: frame.codedWidth, height: frame.codedHeight };
      this.enhance.encode(encoder, this.pendingExternal, width, height);
      const out = this.enhance.output!;
      return [1 / out.width, 1 / out.height];
    }
    return [1 / frame.displayWidth, 1 / frame.displayHeight];
  }

  // External textures are only valid until the current task ends, so they
  // are imported fresh for every draw and consumed right away.
  private pendingExternal: GPUExternalTexture | null = null;

  private encodePresent(encoder: GPUCommandEncoder, target: GPUTexture, uniforms: GPUBuffer, frame: VideoFrame): void {
    const enhanced = this.mode === 'enhanced' && this.enhance?.output;
    const pipeline = enhanced ? this.texturePipeline : this.directPipeline;
    const source: GPUBindGroupEntry = enhanced
      ? { binding: 3, resource: this.enhance!.output!.createView() }
      : { binding: 2, resource: this.pendingExternal ?? this.device.importExternalTexture({ source: frame }) };
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: this.sampler }, source],
    });
    this.pendingExternal = null;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
  }

  /** NDC half-extents that aspect-fit the frame into a w×h target. */
  private letterbox(frame: VideoFrame, w: number, h: number): [number, number] {
    const aspect = frame.displayWidth / frame.displayHeight;
    const canvasAspect = w / h;
    return aspect > canvasAspect ? [1, canvasAspect / aspect] : [aspect / canvasAspect, 1];
  }

  private writeUniforms(buffer: GPUBuffer, scale: [number, number], view: ViewSettings, texel: [number, number], cache: boolean): void {
    const p = this.picture;
    const d = this.uniformData;
    d.set([scale[0], scale[1], view.panX, view.panY, texel[0], texel[1], view.zoom, p.brightness, p.contrast, p.saturation, p.sharpness, 0]);
    if (cache) {
      const key = d.join(',');
      if (key === this.uniformsKey) return;
      this.uniformsKey = key;
    }
    this.device.queue.writeBuffer(buffer, 0, d);
  }
}
