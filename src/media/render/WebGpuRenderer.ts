import presentWgsl from './shaders/present.wgsl?raw';
import { EnhanceGraph } from './enhance/EnhanceGraph';
import { loadChain } from './enhance/presets';
import {
  DEFAULT_PICTURE,
  DEFAULT_VIEW,
  type EnhancePreset,
  type EnhanceStatus,
  type PictureSettings,
  type RenderMode,
  type ViewSettings,
} from '../../shared/protocol';

/** Anime4K's rule: only upscale when the picture is shown ≥ 1.2× its source size. */
const UPSCALE_THRESHOLD = 1.2;
/**
 * Compiled chains kept around (textures trimmed) so switching presets or
 * toggling Anime4K off/on is instant instead of recompiling 10-35 pipelines.
 */
const GRAPH_CACHE_SIZE = 4;

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
  private readonly comparePipeline: GPURenderPipeline;
  private readonly uniforms: GPUBuffer;
  private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4);
  private readonly sampler: GPUSampler;
  /** Graph currently used for drawing, and the key (preset:upscale) it was built for. */
  private enhance: EnhanceGraph | null = null;
  private enhanceKey: string | null = null;
  /** Key the renderer is waiting on (its build is in `builds`). */
  private building: string | null = null;
  /** Compiled chains by key, least recently used first (null = empty chain). */
  private readonly graphs = new Map<string, EnhanceGraph | null>();
  private readonly builds = new Map<string, Promise<EnhanceGraph | null>>();
  /** Whether the last drawn frame was shown large enough to upscale. */
  private lastUpscale = true;
  private mode: RenderMode = 'direct';
  /** A/B split position (0..1 across the picture) or null when not comparing. */
  private split: number | null = null;
  /** Called when a newly built chain becomes active (to repaint while paused). */
  onEnhanceChange: ((status: EnhanceStatus) => void) | null = null;
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
    this.comparePipeline = makePipeline('fs_compare');

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
    if (mode === 'direct') this.deactivate();
  }

  /** Side-by-side compare: original left of `split`, enhanced right (null = off). */
  setCompare(split: number | null): void {
    this.split = split === null ? null : Math.min(1, Math.max(0, split));
  }

  get enhanceStatus(): EnhanceStatus {
    return {
      mode: this.mode,
      active: this.enhanceKey,
      passes: this.enhance?.passCount ?? 0,
      upscaling: this.enhanceKey?.endsWith(':up') ?? false,
    };
  }

  /**
   * Compile `preset` in the background without activating it, so the first
   * press of E is instant. Uses the upscale decision of the last drawn frame.
   */
  prewarm(preset: EnhancePreset): void {
    void this.build(preset, this.lastUpscale).catch(() => {});
  }

  /**
   * Make sure the graph for the current mode and display size is active or
   * being built. Drawing continues with the previous graph (or zero-copy)
   * until the new one has compiled; cached graphs switch in immediately.
   */
  private syncEnhance(frame: VideoFrame, boxHeight: number): void {
    const upscale = boxHeight >= frame.displayHeight * UPSCALE_THRESHOLD;
    this.lastUpscale = upscale;
    if (this.mode === 'direct') return;
    const key = keyOf(this.mode, upscale);
    if (key === this.enhanceKey || key === this.building) return;
    if (this.graphs.has(key)) return this.activate(key);
    this.building = key;
    this.build(this.mode, upscale)
      .then(() => {
        if (this.building === key && !this._lost) this.activate(key);
      })
      .catch((e) => {
        console.error('[anime4k] failed to build chain', e);
        if (this.building === key) this.building = null;
      });
  }

  /** Compile (or reuse) the chain for preset/upscale and put it in the cache. */
  private build(preset: EnhancePreset, upscale: boolean): Promise<EnhanceGraph | null> {
    const key = keyOf(preset, upscale);
    if (this.graphs.has(key)) return Promise.resolve(this.graphs.get(key)!);
    let pending = this.builds.get(key);
    if (!pending) {
      pending = loadChain(preset, upscale)
        .then((passes) => (passes.length ? EnhanceGraph.create(this.device, passes) : null))
        .then((graph) => {
          if (this._lost) {
            graph?.destroy();
            return null;
          }
          this.graphs.set(key, graph);
          this.evict();
          return graph;
        })
        .finally(() => this.builds.delete(key));
      this.builds.set(key, pending);
    }
    return pending;
  }

  private activate(key: string): void {
    const graph = this.graphs.get(key) ?? null;
    // Refresh LRU order.
    this.graphs.delete(key);
    this.graphs.set(key, graph);
    if (this.enhance !== graph) this.enhance?.trim();
    this.enhance = graph;
    this.enhanceKey = key;
    this.building = null;
    this.onEnhanceChange?.(this.enhanceStatus);
  }

  /** Stop using the active chain but keep it compiled for a quick return. */
  private deactivate(): void {
    this.building = null;
    this.enhance?.trim();
    this.enhance = null;
    this.enhanceKey = null;
  }

  private evict(): void {
    for (const [key, graph] of this.graphs) {
      if (this.graphs.size <= GRAPH_CACHE_SIZE) break;
      if (key === this.enhanceKey) continue;
      graph?.destroy();
      this.graphs.delete(key);
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
    const out = this.mode !== 'direct' ? this.enhance?.output : null;
    return out ? [out.width, out.height] : [frame.displayWidth, frame.displayHeight];
  }

  /** Present one frame (false if skipped). The frame stays owned by the caller. */
  draw(frame: VideoFrame): boolean {
    if (this._lost) return false;
    const box = this.letterbox(frame, this.canvas.width, this.canvas.height);
    this.syncEnhance(frame, box[1] * this.canvas.height * this.view.zoom);
    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const texel = this.encodeSource(encoder, frame);
    this.writeUniforms(this.uniforms, box, this.view, texel, this.split, true);
    this.encodePresent(encoder, this.ctx.getCurrentTexture(), this.uniforms, frame, this.split !== null);
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
    this.writeUniforms(uniforms, [1, 1], DEFAULT_VIEW, texel, null, false);
    this.encodePresent(encoder, ctx.getCurrentTexture(), uniforms, frame, false);
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
    this.deactivate();
    for (const graph of this.graphs.values()) graph?.destroy();
    this.graphs.clear();
    this.uniforms.destroy();
    this.device.destroy();
  }

  // -----------------------------------------------------------------------

  /** Run the enhancement graph if active; returns the texel size the present pass samples. */
  private encodeSource(encoder: GPUCommandEncoder, frame: VideoFrame): [number, number] {
    this.pendingExternal = this.device.importExternalTexture({ source: frame });
    if (this.mode !== 'direct' && this.enhance) {
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

  private encodePresent(encoder: GPUCommandEncoder, target: GPUTexture, uniforms: GPUBuffer, frame: VideoFrame, compare: boolean): void {
    const enhanced = this.mode !== 'direct' && this.enhance?.output;
    const external = (): GPUBindGroupEntry => ({
      binding: 2,
      resource: this.pendingExternal ?? this.device.importExternalTexture({ source: frame }),
    });
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: this.sampler }];
    let pipeline = this.directPipeline;
    if (enhanced) {
      pipeline = compare ? this.comparePipeline : this.texturePipeline;
      entries.push({ binding: 3, resource: this.enhance!.output!.createView() });
      if (compare) entries.push(external());
    } else entries.push(external());
    const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
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

  private writeUniforms(
    buffer: GPUBuffer,
    scale: [number, number],
    view: ViewSettings,
    texel: [number, number],
    split: number | null,
    cache: boolean,
  ): void {
    const p = this.picture;
    const d = this.uniformData;
    d.set([scale[0], scale[1], view.panX, view.panY, texel[0], texel[1], view.zoom, p.brightness, p.contrast, p.saturation, p.sharpness, split ?? -1]);
    if (cache) {
      const key = d.join(',');
      if (key === this.uniformsKey) return;
      this.uniformsKey = key;
    }
    this.device.queue.writeBuffer(buffer, 0, d);
  }
}

const keyOf = (preset: EnhancePreset, upscale: boolean) => `${preset}:${upscale ? 'up' : 'native'}`;
