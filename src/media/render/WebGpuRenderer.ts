import presentWgsl from './shaders/present.wgsl?raw';
import { EnhanceGraph } from './enhance/EnhanceGraph';
import { ENHANCE_PASSES } from './enhance/passes';
import type { RenderMode } from '../../shared/protocol';

/**
 * WebGPU presenter living entirely inside the media worker.
 *
 *  direct   : VideoFrame -> importExternalTexture -> present   (zero copy)
 *  enhanced : VideoFrame -> importExternalTexture -> EnhanceGraph (compute,
 *             Anime4K goes here) -> present
 */
export class WebGpuRenderer {
  private readonly ctx: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly directPipeline: GPURenderPipeline;
  private readonly texturePipeline: GPURenderPipeline;
  private readonly uniforms: GPUBuffer;
  private readonly uniformData = new Float32Array(4);
  private readonly sampler: GPUSampler;
  private enhance: EnhanceGraph | null = null;
  private mode: RenderMode = 'direct';
  private lastAspect = 0;
  private lastCanvasW = 0;
  private lastCanvasH = 0;
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

    this.uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    const device = this.device;
    this.updateLetterbox(frame.displayWidth / frame.displayHeight);

    // External textures are only valid until the current task ends, so they
    // must be imported (and bound) fresh for every draw.
    const external = device.importExternalTexture({ source: frame });
    const encoder = device.createCommandEncoder({ label: 'frame' });

    let bindGroup: GPUBindGroup;
    let pipeline: GPURenderPipeline;
    if (this.mode === 'enhanced' && this.enhance) {
      const { width, height } = frame.visibleRect ?? { width: frame.codedWidth, height: frame.codedHeight };
      this.enhance.encode(encoder, external, width, height);
      pipeline = this.texturePipeline;
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforms } },
          { binding: 1, resource: this.sampler },
          { binding: 3, resource: this.enhance.output!.createView() },
        ],
      });
    } else {
      pipeline = this.directPipeline;
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforms } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: external },
        ],
      });
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
    return true;
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

  private updateLetterbox(aspect: number): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (aspect === this.lastAspect && cw === this.lastCanvasW && ch === this.lastCanvasH) return;
    this.lastAspect = aspect;
    this.lastCanvasW = cw;
    this.lastCanvasH = ch;
    const canvasAspect = cw / ch;
    this.uniformData[0] = aspect > canvasAspect ? 1 : aspect / canvasAspect;
    this.uniformData[1] = aspect > canvasAspect ? canvasAspect / aspect : 1;
    this.device.queue.writeBuffer(this.uniforms, 0, this.uniformData);
  }
}
