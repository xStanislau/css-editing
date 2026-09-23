import ingestWgsl from '../shaders/ingest.wgsl?raw';
import type { EnhancePass } from './passes';

const FORMAT: GPUTextureFormat = 'rgba16float';
const WG = 8;

interface CompiledPass {
  pass: EnhancePass;
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup | null;
  width: number;
  height: number;
}

/**
 * Executes the enhancement (Anime4K) compute graph:
 *
 *   VideoFrame --ingest--> SOURCE --pass 1--> ... --pass N--> OUTPUT
 *
 * Pipelines are compiled once; textures and bind groups are rebuilt only when
 * the video resolution changes. Per frame, the only new GPU object is the
 * ingest bind group (external textures expire every frame by spec).
 */
export class EnhanceGraph {
  private readonly ingest: GPUComputePipeline;
  private readonly passes: CompiledPass[];
  private readonly sampler: GPUSampler;
  private textures = new Map<string, GPUTexture>();
  private srcW = 0;
  private srcH = 0;

  constructor(
    private readonly device: GPUDevice,
    passes: EnhancePass[],
  ) {
    this.ingest = device.createComputePipeline({
      label: 'enhance-ingest',
      layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'ingest', code: ingestWgsl }), entryPoint: 'main' },
    });
    this.passes = passes.map((pass) => ({
      pass,
      pipeline: device.createComputePipeline({
        label: pass.label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label: pass.label, code: pass.code }), entryPoint: pass.entryPoint ?? 'main' },
      }),
      bindGroup: null,
      width: 0,
      height: 0,
    }));
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  /** Output texture of the last run (null until the first frame). */
  get output(): GPUTexture | null {
    return this.textures.get('OUTPUT') ?? null;
  }

  encode(encoder: GPUCommandEncoder, frame: GPUExternalTexture, width: number, height: number): void {
    if (width !== this.srcW || height !== this.srcH) this.allocate(width, height);

    const cpass = encoder.beginComputePass({ label: 'enhance' });

    cpass.setPipeline(this.ingest);
    cpass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.ingest.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: frame },
          { binding: 1, resource: this.textures.get('SOURCE')!.createView() },
        ],
      }),
    );
    cpass.dispatchWorkgroups(Math.ceil(width / WG), Math.ceil(height / WG));

    for (const p of this.passes) {
      cpass.setPipeline(p.pipeline);
      cpass.setBindGroup(0, p.bindGroup!);
      cpass.dispatchWorkgroups(Math.ceil(p.width / WG), Math.ceil(p.height / WG));
    }
    cpass.end();
  }

  destroy(): void {
    for (const t of this.textures.values()) t.destroy();
    this.textures.clear();
  }

  private allocate(width: number, height: number): void {
    this.destroy();
    this.srcW = width;
    this.srcH = height;

    const make = (name: string, w: number, h: number) => {
      const existing = this.textures.get(name);
      if (existing) {
        if (existing.width !== w || existing.height !== h) throw new Error(`Enhance texture ${name} used with two sizes`);
        return existing;
      }
      const tex = this.device.createTexture({
        label: `enhance:${name}`,
        size: { width: w, height: h },
        format: FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.textures.set(name, tex);
      return tex;
    };

    make('SOURCE', width, height);
    for (const p of this.passes) {
      p.width = Math.round(width * p.pass.scale);
      p.height = Math.round(height * p.pass.scale);
      const out = make(p.pass.output, p.width, p.height);
      const entries: GPUBindGroupEntry[] = [];
      if (p.pass.usesSampler) entries.push({ binding: 0, resource: this.sampler });
      p.pass.inputs.forEach((name, i) => {
        const tex = this.textures.get(name);
        if (!tex) throw new Error(`Enhance pass ${p.pass.label} reads ${name} before it is written`);
        entries.push({ binding: i + 1, resource: tex.createView() });
      });
      entries.push({ binding: p.pass.inputs.length + 1, resource: out.createView() });
      p.bindGroup = this.device.createBindGroup({ label: p.pass.label, layout: p.pipeline.getBindGroupLayout(0), entries });
    }
  }
}
