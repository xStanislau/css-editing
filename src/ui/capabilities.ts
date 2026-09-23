export interface Capability {
  name: string;
  ok: boolean;
  hint: string;
}

/** Everything the zero-<video> pipeline depends on. */
export function detectCapabilities(): Capability[] {
  return [
    {
      name: 'Cross-origin isolation',
      ok: self.crossOriginIsolated === true,
      hint: 'Serve with COOP: same-origin and COEP: credentialless (or require-corp) to enable SharedArrayBuffer.',
    },
    { name: 'WebCodecs', ok: 'VideoDecoder' in self && 'AudioDecoder' in self, hint: 'Use Chrome/Edge 94+, Safari 17+ or Firefox 130+.' },
    { name: 'WebGPU', ok: 'gpu' in navigator, hint: 'Use Chrome/Edge 113+, Safari 26+ or Firefox 141+ (and a supported GPU).' },
    {
      name: 'OffscreenCanvas',
      ok: typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype,
      hint: 'Required to render from the media worker.',
    },
    { name: 'AudioWorklet', ok: typeof AudioWorkletNode !== 'undefined', hint: 'Required for sample-accurate audio output.' },
  ];
}
