/**
 * Independent float32 CPU reference for Anime4K CNN hooks, evaluated straight
 * from the original GLSL (not from the generated WGSL). Used to validate the
 * GPU implementation numerically. Supports convolution passes at native
 * resolution (the Restore family); slow, test-only.
 */
type Plane = { w: number; h: number; data: Float32Array }; // RGBA float32

export function runGlslReference(glsl: string, main: Plane): Plane {
  const textures = new Map<string, Plane>([['MAIN', main]]);
  for (const block of glsl.split(/(?=^\/\/!DESC)/m).filter((b) => b.startsWith('//!DESC'))) {
    const save = block.match(/^\/\/!SAVE (\S+)/m)![1];
    const macros = new Map<string, { tex: string; sign: 1 | -1 | 0 }>();
    for (const m of block.matchAll(/^#define (\w+)(?:\(x_off, y_off\))? \((.*)\)$/gm)) {
      const expr = m[2];
      const tex = expr.match(/([A-Za-z0-9_]+?)_tex(?:Off)?\(/)![1];
      macros.set(m[1], { tex, sign: expr.startsWith('max(-(') ? -1 : expr.startsWith('max((') ? 1 : 0 });
    }
    const body = block.slice(block.indexOf('vec4 hook()'));
    if (body.includes('fract(')) throw new Error('reference only covers native-resolution passes');
    const terms = [...body.matchAll(/mat4\(([^)]*)\) \* (\w+)(?:\(([^)]*)\))?;/g)].map((m) => ({
      w: m[1].split(',').map(Number),
      macro: macros.get(m[2])!,
      dx: m[3] ? Math.round(Number(m[3].split(',')[0])) : 0,
      dy: m[3] ? Math.round(Number(m[3].split(',')[1])) : 0,
    }));
    const bias = body.match(/result \+= vec4\(([^)]*)\);/)![1].split(',').map(Number);
    const residual = body.includes('return result + MAIN_tex(MAIN_pos);');

    const ref = textures.get(terms[0].macro.tex)!;
    const { w: W, h: H } = ref;
    const out = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = [bias[0], bias[1], bias[2], bias[3]];
        for (const t of terms) {
          const src = textures.get(t.macro.tex)!;
          const sx = Math.min(src.w - 1, Math.max(0, x + t.dx));
          const sy = Math.min(src.h - 1, Math.max(0, y + t.dy));
          const o = (sy * src.w + sx) * 4;
          for (let j = 0; j < 4; j++) {
            let v = src.data[o + j];
            if (t.macro.sign === 1) v = Math.max(v, 0);
            else if (t.macro.sign === -1) v = Math.max(-v, 0);
            // GLSL mat4(...) is column-major: column j = w[4j..4j+3]; (M * v)[i] = Σ_j M[j][i] v[j]
            for (let i = 0; i < 4; i++) r[i] += t.w[j * 4 + i] * v;
          }
        }
        const o = (y * W + x) * 4;
        if (residual) {
          const m = textures.get('MAIN')!.data;
          out.set([r[0] + m[o], r[1] + m[o + 1], r[2] + m[o + 2], 1], o);
        } else out.set(r, o);
      }
    }
    textures.set(save, { w: W, h: H, data: out });
  }
  return textures.get('MAIN')!;
}
