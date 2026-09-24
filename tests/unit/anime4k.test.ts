import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transpile } from '../../scripts/anime4k-transpile.mjs';
import { composeChain } from '../../src/media/render/enhance/anime4k/compose';
import upscaleM from '../../src/media/render/enhance/anime4k/Upscale_CNN_x2_M';
import restoreM from '../../src/media/render/enhance/anime4k/Restore_CNN_M';
import upscaleVL from '../../src/media/render/enhance/anime4k/Upscale_CNN_x2_VL';

const glsl = (name: string) => readFileSync(new URL(`../../third_party/anime4k/glsl/Anime4K_${name}.glsl`, import.meta.url), 'utf8');

describe('Anime4K transpiler', () => {
  it('turns every mpv hook into a WGSL compute pass with the right plumbing', () => {
    const passes = transpile(glsl('Upscale_CNN_x2_S'));
    expect(passes.map((p) => [p.output, p.sizeOf, p.factor])).toEqual([
      ['conv2d_tf', 'MAIN', 1],
      ['conv2d_1_tf', 'conv2d_tf', 1],
      ['conv2d_2_tf', 'conv2d_1_tf', 1],
      ['conv2d_last_tf', 'conv2d_2_tf', 1],
      ['MAIN', 'conv2d_last_tf', 2],
    ]);
    expect(passes[0].code).toContain('@workgroup_size(8, 8)');
    expect(passes[4].inputs).toEqual(['MAIN', 'conv2d_last_tf']);
    expect(passes[4].usesSampler).toBe(true);
  });

  it('keeps every trained weight: one mat4x4f per GLSL mat4, values verbatim', () => {
    for (const name of ['Upscale_CNN_x2_M', 'Restore_CNN_VL']) {
      const src = glsl(name);
      const code = transpile(src).map((p) => p.code).join('\n');
      expect((code.match(/mat4x4f\(/g) ?? []).length).toBe((src.match(/mat4\(/g) ?? []).length);
      const firstWeights = src.match(/mat4\(([^)]*)\)/)![1];
      expect(code).toContain(`mat4x4f(${firstWeights.split(', ').map((v) => (/[.e]/.test(v) ? v : `${v}.0`)).join(', ')})`);
    }
  });

  it('generated modules are up to date with the vendored GLSL', () => {
    const regenerated = transpile(glsl('Upscale_CNN_x2_VL'));
    expect(regenerated).toEqual(upscaleVL);
  });
});

describe('composeChain', () => {
  it('threads MAIN through shader files and names the final image OUTPUT', () => {
    const chain = composeChain([restoreM, upscaleM]);
    const outputs = chain.map((p) => p.output);
    expect(new Set(outputs).size).toBe(outputs.length); // unique names across files
    expect(chain[0].inputs).toEqual(['SOURCE']);
    expect(chain.at(-1)!.output).toBe('OUTPUT');
    expect(chain.at(-1)!.scale).toBe(2);
    // Upscale's first layer reads Restore's result, at native scale.
    const restoreOut = chain[restoreM.length - 1].output;
    expect(chain[restoreM.length].inputs).toEqual([restoreOut]);
    expect(chain[restoreM.length].scale).toBe(1);
  });
});
