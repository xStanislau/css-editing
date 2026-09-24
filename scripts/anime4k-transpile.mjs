#!/usr/bin/env node
/**
 * Transpile Anime4K CNN shaders (mpv GLSL hooks) into WGSL compute passes for
 * Prism's EnhanceGraph. Weights are copied verbatim; only the plumbing
 * (texture access, bindings, dispatch) is rewritten.
 *
 *   third_party/anime4k/glsl/*.glsl  ->  src/media/render/enhance/anime4k/<Name>.ts
 *
 * Every Anime4K CNN pass is one of three shapes, all handled here:
 *   1. convolution:   result = Σ mat4 * relu(±feature[x+dx, y+dy]) + bias
 *                     (optionally "+ MAIN" for Restore's residual output)
 *   2. depth-to-space x2 with 1 or 3 residual planes (luma / per-channel RGB)
 *
 * Binding convention (see enhance/passes.ts):
 *   @binding(0) sampler (only when needed), @binding(1..N) inputs,
 *   @binding(N+1) rgba16float storage output, workgroup 8x8.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inDir = join(root, 'third_party/anime4k/glsl');
const outDir = join(root, 'src/media/render/enhance/anime4k');

/** Parse one mpv hook block. */
export function parsePass(block) {
  const header = (key) => [...block.matchAll(new RegExp(`^//!${key} (.*)$`, 'gm'))].map((m) => m[1].trim());
  const [desc] = header('DESC');
  const binds = header('BIND');
  const [save] = header('SAVE');
  const [width] = header('WIDTH');
  const size = width.split(/\s+/); // "conv2d_tf.w" or "conv2d_last_tf.w 2 *"
  const sizeOf = size[0].replace(/\.w$/, '');
  const factor = size.length === 3 && size[2] === '*' ? Number(size[1]) : 1;

  const macros = {};
  for (const m of block.matchAll(/^#define (\w+)(\(x_off, y_off\))? \((.*)\)$/gm)) {
    const [, name, args, expr] = m;
    const tex = expr.match(/(\w+?)_tex(?:Off)?\(/)[1];
    const relu = expr.startsWith('max(-(') ? 'neg' : expr.startsWith('max((') ? 'pos' : 'none';
    macros[name] = { tex, neighbour: !!args, relu };
  }

  const body = block.slice(block.indexOf('vec4 hook()'));
  if (body.includes('fract(')) {
    const planes = [...body.matchAll(/(\w+)_tex\(\(vec2\(0\.5\) - f\d\)/g)].map((m) => m[1]);
    return { kind: 'd2s', desc, binds, save, sizeOf, factor, planes };
  }

  const terms = [];
  let bias = null;
  for (const line of body.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^(?:vec4 result =|result \+=) mat4\(([^)]*)\) \* (\w+)(?:\(([^)]*)\))?;$/))) {
      const weights = m[1].split(',').map((s) => s.trim());
      if (weights.length !== 16) throw new Error(`${desc}: mat4 with ${weights.length} values`);
      const offs = m[3] ? m[3].split(',').map((s) => Math.round(Number(s))) : [0, 0];
      terms.push({ weights, macro: m[2], dx: offs[0], dy: offs[1] });
    } else if ((m = t.match(/^result \+= vec4\(([^)]*)\);$/))) {
      bias = m[1].split(',').map((s) => s.trim());
    }
  }
  if (!terms.length || !bias) throw new Error(`${desc}: unrecognised convolution body`);
  const residual = /return result \+ MAIN_tex\(MAIN_pos\);/.test(body);
  return { kind: 'conv', desc, binds, save, sizeOf, factor, macros, terms, bias, residual };
}

const f = (s) => (/[.e]/.test(s) ? s : `${s}.0`); // keep WGSL literals float-typed

function convWgsl(p) {
  const used = [...new Set(Object.values(p.macros).map((m) => m.tex).concat(p.residual ? ['MAIN'] : []))];
  const inputs = p.binds.filter((b) => used.includes(b));
  const decl = inputs.map((t, i) => `@group(0) @binding(${i + 1}) var t_${t} : texture_2d<f32>;`);
  // Edge clamp bound computed once per pass (all conv inputs share the output size).
  const helpers = Object.entries(p.macros).map(([name, m]) => {
    const load = m.neighbour ? `textureLoad(t_${m.tex}, clamp(p + vec2i(dx, dy), vec2i(0), b), 0)` : `textureLoad(t_${m.tex}, p, 0)`;
    const value = m.relu === 'pos' ? `max(${load}, vec4f(0.0))` : m.relu === 'neg' ? `max(-${load}, vec4f(0.0))` : load;
    const params = m.neighbour ? 'p : vec2i, dx : i32, dy : i32, b : vec2i' : 'p : vec2i';
    return `fn ${name}(${params}) -> vec4f {\n  return ${value};\n}`;
  });
  const lines = p.terms.map((t, i) => {
    const call = p.macros[t.macro].neighbour ? `${t.macro}(p, ${t.dx}, ${t.dy}, b)` : `${t.macro}(p)`;
    return `  ${i === 0 ? 'var result =' : 'result +='} mat4x4f(${t.weights.map(f).join(', ')}) * ${call};`;
  });
  lines.push(`  result += vec4f(${p.bias.map(f).join(', ')});`);
  if (p.residual) lines.push('  result = vec4f(result.rgb + textureLoad(t_MAIN, p, 0).rgb, 1.0);');
  const code = [
    `// ${p.desc}`,
    ...decl,
    `@group(0) @binding(${inputs.length + 1}) var dst : texture_storage_2d<rgba16float, write>;`,
    '',
    ...helpers,
    '',
    '@compute @workgroup_size(8, 8)',
    'fn main(@builtin(global_invocation_id) gid : vec3u) {',
    '  let size = textureDimensions(dst);',
    '  if (gid.x >= size.x || gid.y >= size.y) { return; }',
    '  let p = vec2i(gid.xy);',
    '  let b = vec2i(size) - 1;',
    ...lines,
    '  textureStore(dst, gid.xy, result);',
    '}',
  ].join('\n');
  return { code, inputs, usesSampler: false };
}

function d2sWgsl(p) {
  const inputs = ['MAIN', ...p.planes];
  const decl = inputs.map((t, i) => `@group(0) @binding(${i + 1}) var t_${t} : texture_2d<f32>;`);
  const c = p.planes.map((t, i) => `  let c${i} = textureLoad(t_${t}, src, 0)[ch];`);
  const rgb = p.planes.length === 1 ? 'vec3f(c0)' : `vec3f(${p.planes.map((_, i) => `c${i}`).join(', ')})`;
  const code = [
    `// ${p.desc}`,
    '@group(0) @binding(0) var samp : sampler;',
    ...decl,
    `@group(0) @binding(${inputs.length + 1}) var dst : texture_storage_2d<rgba16float, write>;`,
    '',
    '@compute @workgroup_size(8, 8)',
    'fn main(@builtin(global_invocation_id) gid : vec3u) {',
    '  let size = textureDimensions(dst);',
    '  if (gid.x >= size.x || gid.y >= size.y) { return; }',
    '  let q = vec2i(gid.xy);',
    '  // Each 2x2 output block takes its 4 values from the 4 channels of one low-res texel.',
    '  let src = q / 2;',
    '  let ch = (q.y % 2) * 2 + (q.x % 2);',
    ...c,
    '  let base = textureSampleLevel(t_MAIN, samp, (vec2f(q) + 0.5) / vec2f(size), 0.0);',
    `  textureStore(dst, gid.xy, vec4f(${rgb} + base.rgb, 1.0));`,
    '}',
  ].join('\n');
  return { code, inputs, usesSampler: true };
}

export function transpile(source) {
  const blocks = source.split(/(?=^\/\/!DESC)/m).filter((b) => b.startsWith('//!DESC'));
  return blocks.map((block) => {
    const p = parsePass(block);
    const { code, inputs, usesSampler } = p.kind === 'conv' ? convWgsl(p) : d2sWgsl(p);
    return { label: p.desc, code, inputs, output: p.save, sizeOf: p.sizeOf, factor: p.factor, usesSampler };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(outDir, { recursive: true });
  const names = [];
  for (const file of readdirSync(inDir).filter((n) => n.endsWith('.glsl')).sort()) {
    const name = basename(file, '.glsl').replace(/^Anime4K_/, '');
    const passes = transpile(readFileSync(join(inDir, file), 'utf8'));
    const ts = [
      `// GENERATED by scripts/anime4k-transpile.mjs from third_party/anime4k/glsl/${file}. Do not edit.`,
      '// Anime4K (c) 2019-2021 bloc97, MIT License.',
      "import type { Anime4KPass } from './types';",
      '',
      `const passes: Anime4KPass[] = ${JSON.stringify(passes, null, 2)};`,
      '',
      'export default passes;',
      '',
    ].join('\n');
    writeFileSync(join(outDir, `${name}.ts`), ts);
    names.push(name);
    console.log(`${name}: ${passes.length} passes`);
  }
  const registry = [
    '// GENERATED by scripts/anime4k-transpile.mjs. Do not edit.',
    "import type { Anime4KPass } from './types';",
    '',
    '/** Lazy loaders: each shader becomes its own chunk, fetched only when used. */',
    'export const ANIME4K_SHADERS = {',
    ...names.map((n) => `  ${n}: () => import('./${n}').then((m) => m.default),`),
    '} satisfies Record<string, () => Promise<Anime4KPass[]>>;',
    '',
    'export type Anime4KShaderName = keyof typeof ANIME4K_SHADERS;',
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'registry.ts'), registry);
}
