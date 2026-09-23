import MediaWorker from '../media/media.worker.ts?worker';
import pcmWorkletUrl from '../audio/pcm-player.worklet.ts?worker&url';
import {
  DEFAULT_PICTURE,
  DEFAULT_VIEW,
  type FromWorker,
  type LoopRange,
  type MediaInfo,
  type MediaSourceInput,
  type PictureSettings,
  type PlaybackState,
  type RenderMode,
  type ToWorker,
  type ViewSettings,
} from '../shared/protocol';
import { T, Telemetry } from '../shared/telemetry';

export interface PlayerSnapshot {
  state: PlaybackState;
  info: MediaInfo | null;
  sourceName: string | null;
  renderMode: RenderMode;
  gpu: string | null;
  volume: number;
  muted: boolean;
  error: { message: string; fatal: boolean; id: number } | null;
  notice: { message: string; id: number } | null;
  picture: PictureSettings;
  view: ViewSettings;
  /** A-B loop; `b` is null while only A is set. */
  loop: { a: number; b: number | null } | null;
}

const MAX_ZOOM = 8;

type FrameListener = (t: Float64Array) => void;
type PreviewListener = (bitmap: ImageBitmap, time: number) => void;

/**
 * UI-thread facade over the media worker.
 *
 * Responsibilities kept on the main thread are exactly the ones that cannot
 * live anywhere else: owning the <canvas> element (then handing it off),
 * the AudioContext (not available in workers), user-gesture-gated calls and
 * React state. Everything heavy happens in the worker.
 */
export class PlayerController {
  readonly canvas: HTMLCanvasElement;
  private readonly worker: Worker;
  private readonly telemetry = Telemetry.create();
  private readonly telemetrySnapshot = new Float64Array(T.SLOTS);
  private readonly resizeObserver: ResizeObserver;

  private audioCtx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private pcmNode: AudioWorkletNode | null = null;
  private latencyTimer: ReturnType<typeof setInterval> | null = null;

  private snapshot: PlayerSnapshot = {
    state: 'idle',
    info: null,
    sourceName: null,
    renderMode: 'direct',
    gpu: null,
    volume: 1,
    muted: false,
    error: null,
    notice: null,
    picture: DEFAULT_PICTURE,
    view: DEFAULT_VIEW,
    loop: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly frameListeners = new Set<FrameListener>();
  private rafId = 0;
  private errorSeq = 0;
  private disposed = false;
  /**
   * Target of the last seek until the worker's telemetry catches up, so
   * rapid key presses (→ → →, 5 then B) build on each other instead of all
   * reading the stale playhead.
   */
  private pendingSeek: { time: number; until: number } | null = null;
  private readonly previewListeners = new Set<PreviewListener>();
  private previewSeq = 0;

  constructor(host: HTMLElement) {
    // The canvas is created imperatively: transferControlToOffscreen() is a
    // one-shot operation, and a fresh element per controller keeps React
    // StrictMode's mount/unmount/mount cycle safe.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'absolute inset-0 h-full w-full';
    host.prepend(this.canvas);

    const offscreen = this.canvas.transferControlToOffscreen();
    this.worker = new MediaWorker({ name: 'media-pipeline' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorkerMessage(e.data);
    this.worker.onerror = (e) => this.setError(e.message || 'Media worker crashed', true);

    const [w, h] = this.devicePixelSize(host.getBoundingClientRect().width, host.getBoundingClientRect().height);
    this.send({ type: 'init', canvas: offscreen, telemetry: this.telemetry.sab, width: w, height: h }, [offscreen]);

    this.resizeObserver = new ResizeObserver(([entry]) => {
      // devicePixelContentBoxSize gives exact physical pixels (crisp output,
      // no resampling by the compositor).
      const dp = entry.devicePixelContentBoxSize?.[0];
      const [pw, ph] = dp ? [dp.inlineSize, dp.blockSize] : this.devicePixelSize(entry.contentRect.width, entry.contentRect.height);
      this.send({ type: 'resize', width: pw, height: ph });
    });
    try {
      this.resizeObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(this.canvas);
    }
  }

  // ============================================================ React store

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  /**
   * Per-display-frame telemetry for imperative DOM updates (seek bar, clock,
   * stats). Runs one shared rAF loop only while someone is listening.
   */
  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    if (!this.rafId) this.rafId = requestAnimationFrame(this.frameLoop);
    return () => {
      this.frameListeners.delete(fn);
      if (this.frameListeners.size === 0 && this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    };
  }

  /** Latest telemetry without subscribing (e.g. inside event handlers). */
  readTelemetry(): Float64Array {
    return this.telemetry.read(this.telemetrySnapshot);
  }

  // =============================================================== commands

  load(source: MediaSourceInput): void {
    const sourceName = source.kind === 'file' ? source.file.name : source.url.split('/').pop() || source.url;
    this.update({ info: null, error: null, sourceName, loop: null });
    this.send({ type: 'load', source });
  }

  play(): void {
    // Must run synchronously inside the user gesture to satisfy autoplay policy.
    void this.audioCtx?.resume();
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  togglePlay(): void {
    const s = this.snapshot.state;
    if (s === 'playing' || s === 'buffering') this.pause();
    else this.play();
  }

  /** Media duration; falls back to media-info before the first telemetry tick. */
  duration(): number {
    return this.readTelemetry()[T.Duration] || this.snapshot.info?.duration || 0;
  }

  seek(time: number): void {
    const duration = this.duration();
    const target = Math.max(0, duration ? Math.min(time, duration) : time);
    this.pendingSeek = { time: target, until: performance.now() + 400 };
    this.send({ type: 'seek', time: target });
  }

  seekBy(delta: number): void {
    this.seek(this.currentTime() + delta);
  }

  /** Playhead in seconds, including a seek that the worker hasn't reported yet. */
  currentTime(): number {
    if (this.pendingSeek && performance.now() < this.pendingSeek.until) return this.pendingSeek.time;
    this.pendingSeek = null;
    return this.readTelemetry()[T.CurrentTime];
  }

  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.update({ volume: v, muted: v === 0 ? this.snapshot.muted : false });
    this.applyGain();
  }

  toggleMute(): void {
    this.update({ muted: !this.snapshot.muted });
    this.applyGain();
  }

  setRenderMode(mode: RenderMode): void {
    this.send({ type: 'set-render-mode', mode });
  }

  dismissError(): void {
    this.update({ error: null });
  }

  dismissNotice(): void {
    this.update({ notice: null });
  }

  // ------------------------------------------------------- picture / view

  setPicture(patch: Partial<PictureSettings>): void {
    const picture = { ...this.snapshot.picture, ...patch };
    this.update({ picture });
    this.send({ type: 'set-picture', picture });
  }

  resetPicture(): void {
    this.setPicture(DEFAULT_PICTURE);
  }

  /**
   * Zoom by `factor` keeping the video point under (fx, fy) fixed.
   * fx/fy are 0..1 coordinates inside the displayed video rectangle.
   */
  zoomAt(factor: number, fx = 0.5, fy = 0.5): void {
    const v = this.snapshot.view;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
    // uv under the cursor must stay put: 0.5 + (f - 0.5) / zoom + pan
    const ux = 0.5 + (fx - 0.5) / v.zoom + v.panX;
    const uy = 0.5 + (fy - 0.5) / v.zoom + v.panY;
    this.setView({ zoom, panX: ux - 0.5 - (fx - 0.5) / zoom, panY: uy - 0.5 - (fy - 0.5) / zoom });
  }

  /** Pan by a fraction of the displayed video size (drag delta / rect size). */
  panBy(dx: number, dy: number): void {
    const v = this.snapshot.view;
    this.setView({ ...v, panX: v.panX - dx / v.zoom, panY: v.panY - dy / v.zoom });
  }

  resetView(): void {
    this.setView(DEFAULT_VIEW);
  }

  private setView(view: ViewSettings): void {
    // Keep the zoomed window inside the frame: |pan| <= 0.5 - 0.5 / zoom.
    const limit = 0.5 - 0.5 / view.zoom;
    const clamped = {
      zoom: view.zoom,
      panX: Math.max(-limit, Math.min(limit, view.panX)),
      panY: Math.max(-limit, Math.min(limit, view.panY)),
    };
    this.update({ view: clamped });
    this.send({ type: 'set-view', view: clamped });
  }

  // ------------------------------------------------------ seek previews

  /** Ask for a real-frame preview at `time`; only the latest answer is delivered. */
  requestPreview(time: number): void {
    this.send({ type: 'preview', id: ++this.previewSeq, time });
  }

  /** Receive preview bitmaps; the listener must draw synchronously (the bitmap is closed after). */
  onPreview(fn: PreviewListener): () => void {
    this.previewListeners.add(fn);
    return () => this.previewListeners.delete(fn);
  }

  // ------------------------------------------------------ precision tools

  stepFrame(direction: 1 | -1): void {
    this.send({ type: 'step-frame', direction });
  }

  /** Save the current frame (as displayed, at full resolution) as PNG. */
  snapshotFrame(): void {
    this.send({ type: 'snapshot' });
  }

  /** First press sets A, second sets B, third clears. */
  cycleLoop(): void {
    const t = this.currentTime();
    const loop = this.snapshot.loop;
    if (!loop) this.setLoopState({ a: t, b: null });
    else if (loop.b === null) {
      if (t > loop.a + 0.1) this.setLoopState({ a: loop.a, b: t });
      else this.setLoopState({ a: t, b: null });
    } else this.setLoopState(null);
  }

  clearLoop(): void {
    this.setLoopState(null);
  }

  private setLoopState(loop: PlayerSnapshot['loop']): void {
    this.update({ loop });
    const range: LoopRange | null = loop && loop.b !== null ? { a: loop.a, b: loop.b } : null;
    this.send({ type: 'set-loop', loop: range });
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.send({ type: 'dispose' });
    // Give the worker a moment to release GPU/decoder resources cleanly.
    setTimeout(() => this.worker.terminate(), 250);
    this.resizeObserver.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    void this.audioCtx?.close();
    this.canvas.remove();
    this.listeners.clear();
    this.frameListeners.clear();
  }

  // ============================================================== internals

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    if (!this.disposed || msg.type === 'dispose') this.worker.postMessage(msg, transfer);
  }

  private frameLoop = () => {
    const t = this.telemetry.read(this.telemetrySnapshot);
    for (const fn of this.frameListeners) fn(t);
    this.rafId = this.frameListeners.size ? requestAnimationFrame(this.frameLoop) : 0;
  };

  private onWorkerMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'gpu-ready':
        this.update({ gpu: msg.adapter });
        break;
      case 'media-info':
        this.update({ info: msg.info });
        break;
      case 'audio-ring':
        void this.attachAudio(msg.sab, msg.sampleRate, msg.channels);
        break;
      case 'state':
        this.update({ state: msg.state });
        break;
      case 'render-mode':
        this.update({ renderMode: msg.mode });
        break;
      case 'error':
        this.setError(msg.message, msg.fatal);
        break;
      case 'notice':
        this.update({ notice: { message: msg.message, id: ++this.errorSeq } });
        break;
      case 'snapshot':
        this.downloadSnapshot(msg.blob, msg.time);
        break;
      case 'preview':
        if (msg.bitmap) {
          if (msg.id === this.previewSeq) for (const fn of this.previewListeners) fn(msg.bitmap, msg.time);
          msg.bitmap.close();
        }
        break;
    }
  }

  /**
   * Spin up (or reuse) the AudioContext at the stream's native sample rate
   * and connect a worklet node to the worker's PCM ring.
   */
  private async attachAudio(sab: SharedArrayBuffer, sampleRate: number, channels: number): Promise<void> {
    this.pcmNode?.disconnect();
    this.pcmNode = null;

    if (this.audioCtx && this.audioCtx.sampleRate !== sampleRate) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext({ sampleRate, latencyHint: 'playback' });
      } catch {
        this.setError(`Audio output at ${sampleRate} Hz is not supported by this device`, false);
        return;
      }
      await this.audioCtx.audioWorklet.addModule(pcmWorkletUrl);
      this.gain = new GainNode(this.audioCtx);
      this.gain.connect(this.audioCtx.destination);
      this.applyGain();
    }
    if (this.disposed) return;

    const ctx = this.audioCtx;
    this.pcmNode = new AudioWorkletNode(ctx, 'pcm-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      processorOptions: { sab },
    });
    this.pcmNode.connect(this.gain!);

    // Resume now if the user already asked to play (sticky activation lets
    // this succeed outside the original click handler).
    const s = this.snapshot.state;
    if (s === 'playing' || s === 'buffering') await ctx.resume().catch(() => {});

    this.reportLatency();
    this.latencyTimer ??= setInterval(() => this.reportLatency(), 2000);
  }

  private downloadSnapshot(blob: Blob, time: number): void {
    const base = (this.snapshot.sourceName ?? 'frame').replace(/\.[^.]+$/, '');
    const fps = this.snapshot.info?.video?.fps || 30;
    const stamp = `${Math.floor(time / 60)}m${Math.floor(time % 60).toString().padStart(2, '0')}s-f${Math.round((time % 1) * fps)}`;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `${base}-${stamp}.png` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.update({ notice: { message: `Saved ${a.download}`, id: ++this.errorSeq } });
  }

  private reportLatency(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    // Bluetooth headphones can add 150-250ms; compensating keeps lips in sync.
    this.send({ type: 'audio-latency', seconds: (ctx.outputLatency || 0) + (ctx.baseLatency || 0) });
  }

  private applyGain(): void {
    if (!this.gain || !this.audioCtx) return;
    const target = this.snapshot.muted ? 0 : this.snapshot.volume ** 2; // perceptual curve
    this.gain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.015); // click-free
  }

  private devicePixelSize(w: number, h: number): [number, number] {
    const dpr = window.devicePixelRatio || 1;
    return [Math.round(w * dpr), Math.round(h * dpr)];
  }

  private setError(message: string, fatal: boolean): void {
    this.update({ error: { message, fatal, id: ++this.errorSeq } });
  }

  private update(patch: Partial<PlayerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn();
  }
}
