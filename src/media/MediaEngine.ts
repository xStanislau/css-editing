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
  type SubtitleChunk,
  type ViewSettings,
} from '../shared/protocol';
import { T, Telemetry } from '../shared/telemetry';
import type { AudioRing } from '../shared/audioRing';
import { createByteSource } from './source/ByteSource';
import type { Demuxer, DemuxSink } from './demux/Demuxer';
import { createDemuxer } from './demux/createDemuxer';
import { VideoDecodePipe } from './decode/VideoDecodePipe';
import { AudioDecodePipe } from './decode/AudioDecodePipe';
import { AudioMasterClock, WallClock, type MediaClock } from './sync/MediaClock';
import { WebGpuRenderer } from './render/WebGpuRenderer';
import { CadenceMonitor, SmoothClock, VsyncEstimator } from './sync/FramePacer';
import { PreviewService } from './preview/PreviewService';

/** Network/demux read-ahead window (seconds). Encoded media is cheap to hold. */
const READ_AHEAD_HIGH = 30;
const READ_AHEAD_LOW = 20;
/** Pre-roll needed before (re)starting the clock, to avoid stutter. */
const START_AUDIO_SECONDS = 0.25;
const START_VIDEO_FRAMES = 3;
/** Background service interval: keeps audio fed when rAF is throttled (hidden tab). */
const SERVICE_INTERVAL_MS = 50;
/** GPU device-loss recoveries allowed per 30s before giving up. */
const MAX_GPU_RECOVERIES = 3;
/** Enhanced mode falls back to direct if more than this share of frames drop over the window. */
const AUTO_DEGRADE_DROP_RATIO = 0.2;
const AUTO_DEGRADE_WINDOW_MS = 3000;

type Post = (msg: FromWorker, transfer?: Transferable[]) => void;

interface LoadedMedia {
  demuxer: Demuxer;
  preview: PreviewService | null;
  video: VideoDecodePipe | null;
  audio: AudioDecodePipe | null;
  clock: MediaClock;
  info: MediaInfo;
  demuxEnded: boolean;
}

/**
 * Orchestrates the whole media pipeline inside the worker:
 *
 *   ByteSource -> Demuxer -> {Video,Audio}DecodePipe -> frame queue / PCM ring
 *                                                    -> MediaClock -> WebGPU
 */
export class MediaEngine implements DemuxSink {
  private renderer: WebGpuRenderer | null = null;
  private canvas: OffscreenCanvas | null = null;
  private telemetry: Telemetry | null = null;
  private media: LoadedMedia | null = null;
  private loadGeneration = 0;
  private state: PlaybackState = 'idle';
  private wantPlay = false;
  private renderMode: RenderMode = 'direct';
  private outputLatency = 0;

  /** Frame currently on screen (kept open so we can redraw on resize/mode change). */
  private current: VideoFrame | null = null;
  private needsRedraw = false;
  /** Show the next decoded frame immediately, regardless of clock (load/seek while paused). */
  private preroll = true;

  private demandWaiters: (() => void)[] = [];
  private lastRaf = 0;
  private fpsWindowStart = 0;
  private fpsCount = 0;
  private fps = 0;
  private presented = 0;
  private dropped = 0;
  private serviceTimer: ReturnType<typeof setInterval> | null = null;
  private gpuRecoveries: number[] = [];
  private disposed = false;
  private picture: PictureSettings = DEFAULT_PICTURE;
  private view: ViewSettings = DEFAULT_VIEW;
  private loop: LoopRange | null = null;
  private lastSeekTarget = 0;
  /** What the pending preroll frame answers (for QoE timing on the UI side). */
  private prerollReason: 'load' | 'seek' = 'load';
  /** UI sequence number of the seek the pending preroll answers. */
  private seekSeq: number | undefined;
  /** Subtitle events gathered since the last tick (posted in one batch). */
  private pendingSubtitles: SubtitleChunk[] = [];
  // Frame pacing (see FramePacer.ts).
  private readonly vsync = new VsyncEstimator();
  private readonly smoothClock = new SmoothClock();
  private readonly cadence = new CadenceMonitor();
  /** Presented/dropped counters at the start of the auto-degrade window. */
  private degradeWindow = { start: 0, presented: 0, dropped: 0 };

  constructor(private readonly post: Post) {}

  // =============================================================== commands

  async init(canvas: OffscreenCanvas, telemetrySab: SharedArrayBuffer, width: number, height: number): Promise<void> {
    this.canvas = canvas;
    this.telemetry = new Telemetry(telemetrySab);
    await this.createRenderer();
    this.renderer?.resize(width, height);
    this.startLoops();
  }

  async load(input: MediaSourceInput): Promise<void> {
    this.unload();
    this.loop = null;
    const gen = ++this.loadGeneration;
    this.setState('loading');
    this.preroll = true;
    this.prerollReason = 'load';

    const source = createByteSource(input);
    let demuxer: Demuxer | null = null;
    try {
      demuxer = await createDemuxer(source, this);
      if (gen !== this.loadGeneration) return;
      const tracks = await demuxer.open();
      if (gen !== this.loadGeneration) return demuxer.close();

      let video: VideoDecodePipe | null = null;
      if (tracks.video) {
        video = new VideoDecodePipe({
          onFatal: (e) => this.fatal(`Video decoder: ${e.message}`),
        });
        const { fps: _fps, ...videoConfig } = tracks.video;
        if (!(await video.configure(videoConfig))) {
          video.close();
          video = null;
          this.post({ type: 'error', message: `Video codec ${tracks.video.codec} is not supported on this device`, fatal: !tracks.audio });
        }
      }

      let audio: AudioDecodePipe | null = null;
      if (tracks.audio) {
        audio = new AudioDecodePipe({
          onFatal: (e) => this.dropAudio(`Audio decoder: ${e.message}`),
          onRingCreated: (ring) => this.onRingCreated(ring),
        });
        if (!(await audio.configure(tracks.audio))) {
          audio.close();
          audio = null;
          this.post({ type: 'error', message: `Audio codec ${tracks.audio.codec} is not supported; playing muted`, fatal: false });
        }
      }
      if (gen !== this.loadGeneration) return;
      if (!video && !audio) throw new Error('No playable tracks');

      const info: MediaInfo = {
        duration: tracks.duration,
        container: tracks.container,
        progressive: tracks.progressive,
        video: tracks.video && video
          ? { codec: tracks.video.codec, width: tracks.video.codedWidth!, height: tracks.video.codedHeight!, fps: tracks.video.fps, hardware: video.hardware }
          : null,
        audio: tracks.audio && audio
          ? { codec: tracks.audio.codec, sampleRate: tracks.audio.sampleRate, channels: tracks.audio.numberOfChannels }
          : null,
        subtitles: tracks.subtitles,
      };
      const previewConfig = video?.activeConfig;
      const aspect = tracks.video ? (tracks.video.displayAspectWidth ?? tracks.video.codedWidth!) / (tracks.video.displayAspectHeight ?? tracks.video.codedHeight!) : 16 / 9;
      this.media = {
        demuxer,
        preview: previewConfig ? new PreviewService(demuxer, previewConfig, aspect) : null,
        video,
        audio,
        clock: audio ? new AudioMasterClock(audio) : new WallClock(),
        info,
        demuxEnded: false,
      };
      this.applyLatency();
      this.post({ type: 'media-info', info });
      if (tracks.fonts.length) this.onFonts(tracks.fonts);
      demuxer.start();
      // Local files: pre-decode a sparse set of previews so hovering the seek
      // bar is instant everywhere. (Remote media only fetches on hover.)
      if (input.kind === 'file') this.scheduleWarmup(gen);
      this.setState(this.wantPlay ? 'buffering' : 'ready');
    } catch (e) {
      demuxer?.close();
      if (gen === this.loadGeneration) this.fatal(e instanceof Error ? e.message : String(e));
    }
  }

  play(): void {
    this.wantPlay = true;
    const m = this.media;
    if (!m) return;
    if (this.state === 'ended') this.seek(0);
    if (this.state !== 'playing') this.setState('buffering', 'start');
  }

  pause(): void {
    this.wantPlay = false;
    this.media?.clock.pause();
    if (this.media && this.state !== 'ended') this.setState('paused');
  }

  seek(time: number, seq?: number): void {
    this.seekSeq = seq;
    const m = this.media;
    if (!m) return;
    const target = Math.max(0, Math.min(time, m.info.duration || time));
    this.lastSeekTarget = target;
    m.clock.pause();
    m.video?.reset(target);
    m.audio?.reset(target);
    m.clock.seek(target);
    m.demuxEnded = false;
    this.resolveDemand(true);
    m.demuxer.seek(target);
    this.preroll = true;
    // Instant feedback: if the preview decoder already holds the keyframe this
    // seek starts from, show it now; the exact frame replaces it when decoded.
    this.prerollReason = 'seek';
    const quick = m.preview?.frameForSeek(target);
    if (quick) {
      this.present(quick, true);
      this.post({ type: 'first-frame', reason: 'seek-preview', seq: this.seekSeq });
    }
    this.writeTelemetry(target);
    this.setState(this.wantPlay ? 'buffering' : 'paused', 'seek');
  }

  resize(width: number, height: number): void {
    this.renderer?.resize(width, height);
    this.needsRedraw = true;
  }

  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    this.renderer?.setMode(mode);
    this.needsRedraw = true;
    this.post({ type: 'render-mode', mode });
  }

  setPicture(picture: PictureSettings): void {
    this.picture = picture;
    this.renderer?.setPicture(picture);
    this.needsRedraw = true;
  }

  setView(view: ViewSettings): void {
    this.view = view;
    this.renderer?.setView(view);
    this.needsRedraw = true;
  }

  setLoop(loop: LoopRange | null): void {
    this.loop = loop && loop.b > loop.a ? loop : null;
  }

  /**
   * Frame-accurate step. Implemented as an accurate seek (decode from the
   * keyframe, show the frame covering the target) so audio stays aligned
   * when playback resumes. The target lands a quarter-frame into the wanted
   * frame to be robust against timestamp rounding.
   */
  stepFrame(direction: 1 | -1): void {
    const m = this.media;
    if (!m?.video) return;
    if (this.wantPlay) this.pause();
    const frameDuration = 1 / (m.info.video?.fps || 30);
    // While a previous step is still decoding, continue from its target so
    // holding the key walks frame by frame instead of repeating one step.
    const now = this.preroll ? this.lastSeekTarget - frameDuration / 4 : this.current ? this.current.timestamp / 1e6 : m.clock.now();
    this.seek(Math.max(0, now + direction * frameDuration + frameDuration / 4));
  }

  preview(id: number, time: number): void {
    const service = this.media?.preview;
    if (!service) return this.post({ type: 'preview', id, time, bitmap: null });
    void service.request(time).then((r) => {
      if (r) this.post({ type: 'preview', id, time: r.time, bitmap: r.bitmap }, [r.bitmap]);
      else this.post({ type: 'preview', id, time, bitmap: null });
    });
  }

  private scheduleWarmup(gen: number, attempt = 0): void {
    setTimeout(() => {
      const m = this.media;
      if (gen !== this.loadGeneration || !m?.preview) return;
      // MKV Cues may still be loading in the background: retry a few times.
      if (m.demuxer.keyframeTimes().length) m.preview.warmup(24);
      else if (attempt < 5) this.scheduleWarmup(gen, attempt + 1);
    }, 800 * (attempt + 1));
  }

  snapshot(): void {
    const frame = this.current;
    if (!frame || !this.renderer) {
      this.post({ type: 'notice', message: 'Nothing to capture yet' });
      return;
    }
    const time = frame.timestamp / 1e6;
    // Keep the frame alive for the async encode even if playback moves on.
    const copy = frame.clone();
    this.renderer
      .snapshot(copy)
      .then((blob) => this.post({ type: 'snapshot', blob, time }))
      .catch((e) => this.post({ type: 'error', message: `Snapshot failed: ${e instanceof Error ? e.message : e}`, fatal: false }))
      .finally(() => copy.close());
  }

  setOutputLatency(seconds: number): void {
    this.outputLatency = seconds;
    this.applyLatency();
  }

  dispose(): void {
    this.disposed = true;
    this.unload();
    if (this.serviceTimer) clearInterval(this.serviceTimer);
    this.renderer?.destroy();
    this.renderer = null;
  }

  // ============================================================== DemuxSink

  onVideoChunk(chunk: EncodedVideoChunk): void {
    this.media?.video?.push(chunk);
  }

  onAudioChunk(chunk: EncodedAudioChunk): void {
    this.media?.audio?.push(chunk);
  }

  onEndOfStream(): void {
    const m = this.media;
    if (!m) return;
    m.demuxEnded = true;
    m.video?.markEndOfStream();
    m.audio?.markEndOfStream();
  }

  onError(error: Error): void {
    this.fatal(error.message);
  }

  onSubtitle(chunk: SubtitleChunk): void {
    this.pendingSubtitles.push(chunk);
  }

  onFonts(fonts: Uint8Array[]): void {
    this.post({ type: 'fonts', fonts }, fonts.map((f) => f.buffer));
  }

  private flushSubtitles(): void {
    if (!this.pendingSubtitles.length) return;
    this.post({ type: 'subtitle-chunks', chunks: this.pendingSubtitles });
    this.pendingSubtitles = [];
  }

  demand(): Promise<void> {
    if (this.readAhead() < READ_AHEAD_HIGH) return Promise.resolve();
    return new Promise((resolve) => this.demandWaiters.push(resolve));
  }

  // ================================================================ loops

  private startLoops(): void {
    const raf = self.requestAnimationFrame?.bind(self);
    const frame = (now: number) => {
      this.lastRaf = now;
      this.tick(true, now);
      schedule();
    };
    const schedule = () => (raf ? raf(frame) : setTimeout(() => frame(performance.now()), 1000 / 60));
    schedule();

    // rAF stops entirely in hidden tabs; keep audio flowing and decoders
    // drained so playback continues seamlessly (and resumes instantly).
    this.serviceTimer = setInterval(() => {
      if (performance.now() - this.lastRaf > SERVICE_INTERVAL_MS * 2) this.tick(false);
    }, SERVICE_INTERVAL_MS);
  }

  /** `rafTime` is the vsync timestamp when called from requestAnimationFrame. */
  private tick(visible: boolean, rafTime?: number): void {
    const m = this.media;
    if (!m) {
      if (visible && this.needsRedraw && this.current) this.redraw();
      return;
    }

    m.audio?.pump();
    m.video?.feed();
    this.updatePlaybackState(m);

    let t = m.clock.now();
    if (this.loop && this.state === 'playing' && t >= this.loop.b) {
      this.seek(this.loop.a);
      t = this.loop.a;
    }
    this.selectFrame(m, t, visible, rafTime);
    if (visible) this.checkAutoDegrade();
    this.resolveDemand(false);
    this.flushSubtitles();
    this.writeTelemetry(t);
  }

  private updatePlaybackState(m: LoadedMedia): void {
    if (!this.wantPlay) return;

    const videoDone = !m.video || (m.video.drained && m.video.frames.length === 0);
    const audioDone = !m.audio || m.audio.finished;
    if (m.demuxEnded && videoDone && audioDone) {
      m.clock.pause();
      this.wantPlay = false;
      this.setState('ended');
      return;
    }

    if (this.state === 'playing') {
      // Starvation -> rebuffer (with hysteresis via the start thresholds).
      const audioStarved = m.audio && !m.audio.drained && m.audio.bufferedSeconds === 0;
      const videoStarved = !m.audio && m.video && !m.video.drained && m.video.frames.length === 0;
      if (audioStarved || videoStarved) {
        m.clock.pause();
        this.setState('buffering', 'stall');
      }
      return;
    }

    if (this.state === 'buffering' || this.state === 'ready' || this.state === 'paused') {
      const eos = m.demuxEnded;
      const audioReady = !m.audio || eos || m.audio.drained || m.audio.bufferedSeconds >= START_AUDIO_SECONDS;
      const videoReady = !m.video || eos || m.video.drained || m.video.frames.length >= START_VIDEO_FRAMES || m.video.decodeQueueSize + m.video.frames.length >= 8;
      if (audioReady && videoReady) {
        m.clock.play();
        this.setState('playing');
      }
    }
  }

  private selectFrame(m: LoadedMedia, t: number, visible: boolean, rafTime?: number): void {
    const video = m.video;
    if (!video) return;

    if (this.preroll) {
      const first = video.shift();
      if (first) {
        this.present(first, visible);
        this.preroll = false;
        this.post({ type: 'first-frame', reason: this.prerollReason, seq: this.prerollReason === 'seek' ? this.seekSeq : undefined });
      }
    } else if (this.state === 'playing' || this.state === 'buffering' || this.state === 'ended') {
      let target: number;
      let displayAt: number | undefined;
      if (visible && rafTime !== undefined) {
        // Paced: smooth the bursty audio clock and aim at the vsync this
        // frame will actually appear on.
        this.vsync.tick(rafTime);
        const interval = this.vsync.interval;
        target = this.smoothClock.sample(t, rafTime, this.state === 'playing') + interval / 1000 + 0.001;
        displayAt = rafTime + interval;
      } else {
        // Hidden tab / no vsync: nothing is displayed, just keep the queue moving.
        target = t + 0.5 / (m.info.video?.fps || 30);
      }
      let chosen: VideoFrame | undefined;
      while (video.frames.length > 0 && video.frames[0].timestamp / 1e6 <= target) {
        if (chosen) {
          chosen.close();
          this.dropped++;
        }
        chosen = video.shift();
      }
      if (chosen) {
        if (displayAt !== undefined && this.state === 'playing') this.cadence.present(chosen.timestamp / 1e6, displayAt);
        this.present(chosen, visible);
      }
    }

    if (visible && this.needsRedraw && this.current) this.redraw();
  }

  private present(frame: VideoFrame, visible: boolean): void {
    if (this.current) this.releaseFrame(this.current);
    this.current = frame;
    if (!visible || !this.renderer) {
      this.needsRedraw = true;
      return;
    }
    if (!this.renderer.draw(frame)) {
      this.needsRedraw = true; // GPU lost: repaint once the renderer is rebuilt.
      return;
    }
    this.needsRedraw = false;
    this.presented++;
    this.fpsCount++;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.fpsCount * 1000) / (now - this.fpsWindowStart);
      this.fpsCount = 0;
      this.fpsWindowStart = now;
    }
  }

  /**
   * If the enhancement graph can't keep up on this device, drop back to the
   * zero-copy path instead of stuttering, and tell the user why.
   */
  private checkAutoDegrade(): void {
    const now = performance.now();
    const w = this.degradeWindow;
    if (this.renderMode !== 'enhanced' || this.state !== 'playing') {
      this.degradeWindow = { start: now, presented: this.presented, dropped: this.dropped };
      return;
    }
    if (now - w.start < AUTO_DEGRADE_WINDOW_MS) return;
    const presented = this.presented - w.presented;
    const dropped = this.dropped - w.dropped;
    this.degradeWindow = { start: now, presented: this.presented, dropped: this.dropped };
    if (presented + dropped > 10 && dropped / (presented + dropped) > AUTO_DEGRADE_DROP_RATIO) {
      this.setRenderMode('direct');
      this.post({ type: 'notice', message: 'Enhancement paused: this device dropped too many frames. Press E to try again.' });
    }
  }

  private releaseFrame(frame: VideoFrame): void {
    if (this.renderer) this.renderer.release(frame);
    else frame.close();
  }

  private redraw(): void {
    if (!this.renderer || !this.current) return;
    if (this.renderer.draw(this.current)) this.needsRedraw = false;
  }

  // ============================================================== helpers

  private readAhead(): number {
    const m = this.media;
    return m ? m.demuxer.demuxedUntil - m.clock.now() : 0;
  }

  private resolveDemand(force: boolean): void {
    if (this.demandWaiters.length === 0) return;
    if (!force && this.readAhead() > READ_AHEAD_LOW) return;
    const waiters = this.demandWaiters;
    this.demandWaiters = [];
    for (const w of waiters) w();
  }

  private onRingCreated(ring: AudioRing): void {
    this.post({ type: 'audio-ring', sab: ring.sab, sampleRate: ring.sampleRate, channels: ring.channels });
    if (this.state === 'playing') ring.setPlaying(true);
  }

  private applyLatency(): void {
    const clock = this.media?.clock;
    if (clock instanceof AudioMasterClock) clock.outputLatency = this.outputLatency;
  }

  /** Audio broke mid-stream: keep watching, muted, on a wall clock. */
  private dropAudio(message: string): void {
    const m = this.media;
    if (!m?.audio) return;
    const t = m.clock.now();
    m.audio.close();
    m.audio = null;
    const clock = new WallClock();
    clock.seek(t);
    if (this.state === 'playing') clock.play();
    m.clock = clock;
    this.post({ type: 'error', message: `${message}; continuing without sound`, fatal: false });
  }

  private writeTelemetry(t: number): void {
    const m = this.media;
    const tel = this.telemetry;
    if (!tel) return;
    tel.write((v) => {
      const duration = m?.info.duration ?? 0;
      v[T.CurrentTime] = duration > 0 ? Math.min(t, duration) : t;
      v[T.Duration] = duration;
      v[T.BufferedEnd] = m ? Math.min(m.demuxer.demuxedUntil, duration || Infinity) : 0;
      v[T.RenderFps] = this.fps;
      v[T.FramesPresented] = this.presented;
      v[T.FramesDropped] = this.dropped;
      v[T.DecodeQueue] = m?.video?.decodeQueueSize ?? 0;
      v[T.FrameQueue] = m?.video?.frames.length ?? 0;
      v[T.AudioBufferedMs] = (m?.audio?.bufferedSeconds ?? 0) * 1000;
      // On screen vs heard, at the moment the frame is actually displayed (next vsync).
      v[T.AvDriftMs] = this.current ? (this.current.timestamp / 1e6 - t - this.vsync.interval / 1000) * 1000 : 0;
      v[T.DisplayHz] = this.vsync.hz;
      v[T.PacingJitterMs] = this.cadence.jitterMs(this.vsync.interval);
      v[T.VideoWidth] = this.current?.displayWidth ?? 0;
      v[T.VideoHeight] = this.current?.displayHeight ?? 0;
      const out = this.current && this.renderer ? this.renderer.outputSize(this.current) : [0, 0];
      v[T.OutputWidth] = out[0];
      v[T.OutputHeight] = out[1];
      v[T.AudioUnderruns] = m?.audio?.ring?.underruns ?? 0;
    });
  }

  /**
   * (Re)create the WebGPU renderer. On device loss (driver reset, GPU process
   * crash, TDR) we rebuild transparently, keeping the previous renderer until
   * the replacement is ready, with backoff and a retry budget so a flapping
   * driver can never spin the worker.
   */
  private async createRenderer(): Promise<void> {
    if (!this.canvas || this.disposed) return;
    try {
      const renderer = await WebGpuRenderer.create(this.canvas, (reason) => this.onDeviceLost(reason));
      if (this.disposed) return renderer.destroy();
      renderer.setMode(this.renderMode);
      renderer.setPicture(this.picture);
      renderer.setView(this.view);
      const previous = this.renderer;
      this.renderer = renderer;
      previous?.destroy();
      this.needsRedraw = true;
      const info = renderer.adapterInfo;
      this.post({
        type: 'gpu-ready',
        adapter: [info.vendor, info.architecture, info.device || info.description].filter(Boolean).join(' ') || 'WebGPU',
        features: [...renderer.device.features],
      });
    } catch (e) {
      if (!this.renderer) this.fatal(e instanceof Error ? e.message : String(e));
    }
  }

  private onDeviceLost(reason: string): void {
    if (this.disposed) return;
    const now = performance.now();
    this.gpuRecoveries = this.gpuRecoveries.filter((t) => now - t < 30_000);
    if (this.gpuRecoveries.length >= MAX_GPU_RECOVERIES) {
      console.warn('[webgpu] device lost again; recovery budget exhausted:', reason);
      this.post({ type: 'error', message: 'The GPU keeps resetting; video output paused. Reload the page to retry.', fatal: false });
      return;
    }
    this.gpuRecoveries.push(now);
    console.warn('[webgpu] device lost, rebuilding renderer:', reason);
    setTimeout(() => void this.createRenderer(), 200 * this.gpuRecoveries.length);
  }

  private unload(): void {
    const m = this.media;
    this.media = null;
    this.pendingSubtitles = [];
    this.resolveDemand(true);
    if (m) {
      m.clock.pause();
      m.demuxer.close();
      m.preview?.dispose();
      m.video?.close();
      m.audio?.close();
    }
    if (this.current) this.releaseFrame(this.current);
    this.current = null;
    this.presented = 0;
    this.dropped = 0;
    this.writeTelemetry(0);
  }

  private setState(state: PlaybackState, cause?: 'seek' | 'start' | 'stall'): void {
    if (state === this.state) return;
    this.state = state;
    // Any discontinuity invalidates the smoothed clock and cadence history.
    this.smoothClock.reset();
    this.cadence.reset();
    this.post({ type: 'state', state, cause });
  }

  private fatal(message: string): void {
    this.wantPlay = false;
    this.media?.clock.pause();
    this.setState('error');
    this.post({ type: 'error', message, fatal: true });
  }
}
