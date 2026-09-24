/**
 * GPU quality harness (served by Vite dev, driven by tests/gpu/anime4k.spec.ts).
 * Runs the production EnhanceGraph + Anime4K chains on a line-art frame and
 * scores the 2x result against the ground truth, alongside bilinear.
 */
import { EnhanceGraph } from '../../src/media/render/enhance/EnhanceGraph';
import { loadChain } from '../../src/media/render/enhance/presets';
import { ANIME4K_SHADERS, type Anime4KShaderName } from '../../src/media/render/enhance/anime4k/registry';
import { composeChain } from '../../src/media/render/enhance/anime4k/compose';
import { runGlslReference } from './reference';
import type { EnhancePreset } from '../../src/shared/protocol';

interface Image {
  width: number;
  height: number;
  rgb: Float32Array; // 0..1
}

async function decode(url: string): Promise<{ bitmap: ImageBitmap; image: Image }> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none' });
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const rgb = new Float32Array(bitmap.width * bitmap.height * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    rgb[j] = px[i] / 255;
    rgb[j + 1] = px[i + 1] / 255;
    rgb[j + 2] = px[i + 2] / 255;
  }
  return { bitmap, image: { width: bitmap.width, height: bitmap.height, rgb } };
}

/** Bilinear 2x with pixel-centre alignment (what a GPU sampler / the direct path does). */
function bilinear(src: Image, W: number, H: number): Image {
  const out = new Float32Array(W * H * 3);
  const at = (x: number, y: number, c: number) =>
    src.rgb[(Math.min(src.height - 1, Math.max(0, y)) * src.width + Math.min(src.width - 1, Math.max(0, x))) * 3 + c];
  for (let y = 0; y < H; y++) {
    const sy = ((y + 0.5) * src.height) / H - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = ((x + 0.5) * src.width) / W - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
        const bot = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
        out[(y * W + x) * 3 + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { width: W, height: H, rgb: out };
}

function psnr(a: Image, b: Image): number {
  let mse = 0;
  for (let i = 0; i < a.rgb.length; i++) {
    const d = Math.min(1, Math.max(0, a.rgb[i])) - b.rgb[i];
    mse += d * d;
  }
  mse /= a.rgb.length;
  return 10 * Math.log10(1 / mse);
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

async function readback(device: GPUDevice, tex: GPUTexture): Promise<Image> {
  const bytesPerRow = Math.ceil((tex.width * 8) / 256) * 256;
  const buf = device.createBuffer({ size: bytesPerRow * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, { width: tex.width, height: tex.height });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(buf.getMappedRange());
  const rgb = new Float32Array(tex.width * tex.height * 3);
  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      const s = (y * bytesPerRow) / 2 + x * 4;
      const d = (y * tex.width + x) * 3;
      rgb[d] = halfToFloat(halves[s]);
      rgb[d + 1] = halfToFloat(halves[s + 1]);
      rgb[d + 2] = halfToFloat(halves[s + 2]);
    }
  }
  buf.unmap();
  return { width: tex.width, height: tex.height, rgb };
}

function toPng(img: Image): Promise<string> {
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  const data = ctx.createImageData(img.width, img.height);
  for (let i = 0, j = 0; j < img.rgb.length; i += 4, j += 3) {
    data.data[i] = Math.round(Math.min(1, Math.max(0, img.rgb[j])) * 255);
    data.data[i + 1] = Math.round(Math.min(1, Math.max(0, img.rgb[j + 1])) * 255);
    data.data[i + 2] = Math.round(Math.min(1, Math.max(0, img.rgb[j + 2])) * 255);
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.convertToBlob({ type: 'image/png' }).then(
    (b) => new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result as string);
      fr.readAsDataURL(b);
    }),
  );
}

/** Diagnostics: run an explicit list of shader files; `native` = compare against the input (no upscale). */
async function runShaders(names: Anime4KShaderName[], native = false) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const gt = (await decode('/tests/fixtures/lineart-gt.png')).image;
  const input = await decode('/tests/fixtures/lineart-in.png');
  const passes = composeChain(await Promise.all(names.map((n) => ANIME4K_SHADERS[n]())));
  const graph = await EnhanceGraph.create(device, passes);
  const frame = new VideoFrame(input.bitmap, { timestamp: 0 });
  const enc = device.createCommandEncoder();
  graph.encode(enc, device.importExternalTexture({ source: frame }), input.image.width, input.image.height);
  device.queue.submit([enc.finish()]);
  frame.close();
  const out = await readback(device, graph.output!);
  const ref = native ? input.image : gt;
  return { psnr: psnr(out, ref), png: await toPng(out) };
}

/** GPU vs CPU float32 reference for a native-resolution shader file. Returns error stats. */
async function compareWithReference(name: Anime4KShaderName) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const input = await decode('/tests/fixtures/lineart-in.png');
  const main = { w: input.image.width, h: input.image.height, data: new Float32Array(input.image.width * input.image.height * 4) };
  for (let i = 0; i < main.w * main.h; i++) main.data.set([input.image.rgb[i * 3], input.image.rgb[i * 3 + 1], input.image.rgb[i * 3 + 2], 1], i * 4);
  const glsl = await (await fetch(`/third_party/anime4k/glsl/Anime4K_${name}.glsl`)).text();
  const ref = runGlslReference(glsl, main);
  const gpu = await runShaders([name], true);
  // Decode the GPU PNG is lossy (8-bit); use full-precision readback instead.
  const passes = composeChain([await ANIME4K_SHADERS[name]()]);
  const graph = await EnhanceGraph.create(device, passes);
  const frame = new VideoFrame(input.bitmap, { timestamp: 0 });
  const enc = device.createCommandEncoder();
  graph.encode(enc, device.importExternalTexture({ source: frame }), main.w, main.h);
  device.queue.submit([enc.finish()]);
  frame.close();
  const out = await readback(device, graph.output!);
  let maxErr = 0;
  let sumErr = 0;
  const chroma = [0, 0, 0];
  for (let i = 0; i < main.w * main.h; i++) {
    for (let c = 0; c < 3; c++) {
      const d = out.rgb[i * 3 + c] - ref.data[i * 4 + c];
      maxErr = Math.max(maxErr, Math.abs(d));
      sumErr += Math.abs(d);
      chroma[c] += d;
    }
  }
  const n = main.w * main.h;
  return { maxErr, meanErr: sumErr / (n * 3), meanBias: chroma.map((c) => c / n), refPng: await toPng({ width: main.w, height: main.h, rgb: rgbOf(ref) }), gpuPsnr: gpu.psnr };
}

function rgbOf(p: { w: number; h: number; data: Float32Array }): Float32Array {
  const rgb = new Float32Array(p.w * p.h * 3);
  for (let i = 0; i < p.w * p.h; i++) rgb.set([p.data[i * 4], p.data[i * 4 + 1], p.data[i * 4 + 2]], i * 3);
  return rgb;
}

async function run(presets: EnhancePreset[]) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const gt = (await decode('/tests/fixtures/lineart-gt.png')).image;
  const input = await decode('/tests/fixtures/lineart-in.png');

  const results: Record<string, { psnr: number; ms: number; passes: number; png: string }> = {};
  const bl = bilinear(input.image, gt.width, gt.height);
  results.bilinear = { psnr: psnr(bl, gt), ms: 0, passes: 0, png: await toPng(bl) };

  for (const preset of presets) {
    const passes = await loadChain(preset, true);
    const graph = await EnhanceGraph.create(device, passes);
    const frame = new VideoFrame(input.bitmap, { timestamp: 0 });
    const t0 = performance.now();
    const enc = device.createCommandEncoder();
    graph.encode(enc, device.importExternalTexture({ source: frame }), input.image.width, input.image.height);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    frame.close();
    const out = await readback(device, graph.output!);
    results[preset] = { psnr: psnr(out, gt), ms, passes: passes.length, png: await toPng(out) };
    graph.destroy();
  }
  return results;
}

Object.assign(window, { runAnime4K: run, runShaders, compareWithReference });
document.title = 'ready';
