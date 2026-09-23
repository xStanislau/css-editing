import type JASSUB from 'jassub';
import type { SubtitleChunk, SubtitleTrack } from '../shared/protocol';
import { TEXT_SUBTITLE_HEADER, toAssScript } from '../shared/subtitles';

const TEXT_HEADER_MARK = TEXT_SUBTITLE_HEADER.slice(0, 64);

export type ActiveSubtitle = number | 'external' | null;

/**
 * ASS/SSA/SRT rendering with libass (via JASSUB, WebAssembly in its own
 * worker) onto a transparent canvas laid exactly over the letterboxed video.
 *
 * - One libass instance is reused across track switches.
 * - Events of every track are kept as they stream in, so switching tracks
 *   is instant and complete.
 * - Driven by the player's own clock (no <video> element), and only
 *   re-rendered when the media time or the layout changes.
 */
export class SubtitleRenderer {
  private readonly canvas: HTMLCanvasElement;
  private jassub: JASSUB | null = null;
  private ready: Promise<void> | null = null;
  private tracks: SubtitleTrack[] = [];
  private readonly chunks = new Map<number, SubtitleChunk[]>();
  private fonts: Uint8Array[] = [];
  private external: { name: string; script: string } | null = null;
  private active: ActiveSubtitle = null;
  private videoWidth = 1920;
  private videoHeight = 1080;
  private lastTime = -1;
  /** JASSUB's worker proxy only exists once `ready` resolves. */
  private isReady = false;
  private generation = 0;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pointer-events-none absolute';
    this.canvas.style.display = 'none';
    host.append(this.canvas);
  }

  get activeTrack(): ActiveSubtitle {
    return this.active;
  }

  get externalName(): string | null {
    return this.external?.name ?? null;
  }

  /** New media loaded: forget old events, pick the default track. */
  setMedia(tracks: SubtitleTrack[], videoWidth: number, videoHeight: number): ActiveSubtitle {
    this.tracks = tracks;
    this.chunks.clear();
    this.fonts = [];
    this.external = null;
    this.videoWidth = videoWidth || 1920;
    this.videoHeight = videoHeight || 1080;
    const preferred = tracks.find((t) => t.isDefault) ?? tracks[0];
    void this.select(preferred ? preferred.id : null);
    return this.active;
  }

  addChunks(chunks: SubtitleChunk[]): void {
    for (const c of chunks) {
      let list = this.chunks.get(c.track);
      if (!list) this.chunks.set(c.track, (list = []));
      list.push(c);
      if (c.track === this.active && this.isReady) this.feed(c);
    }
    this.lastTime = -1; // force a repaint: a new event may be visible now
  }

  addFonts(fonts: Uint8Array[]): void {
    this.fonts.push(...fonts);
    if (this.jassub) void this.ready?.then(() => this.jassub?.renderer.addFonts(fonts));
  }

  /** Load an external .ass/.ssa/.srt/.vtt file and show it. */
  loadExternal(name: string, content: string): void {
    this.external = { name, script: toAssScript(content, name) };
    void this.select('external');
  }

  async select(track: ActiveSubtitle): Promise<void> {
    const gen = ++this.generation;
    this.active = track;
    const script = this.scriptFor(track);
    if (!script) {
      this.canvas.style.display = 'none';
      if (this.jassub) void this.jassub.renderer.freeTrack();
      return;
    }
    this.canvas.style.display = 'block';
    if (!this.jassub) {
      // First use: libass (JS + ~2 MB WASM) loads only when subtitles exist.
      const { default: Jassub } = await import('jassub');
      if (gen !== this.generation || this.jassub) return;
      this.jassub = new Jassub({
        canvas: this.canvas,
        subContent: script,
        fonts: this.fonts,
        prescaleHeightLimit: 1440,
        queryFonts: 'local',
      });
      this.ready = this.jassub.ready.then(() => void (this.isReady = true));
      await this.ready;
    } else {
      await this.ready;
      await this.jassub.renderer.setTrack(script);
    }
    if (gen !== this.generation) return;
    if (typeof track === 'number') {
      for (const c of this.chunks.get(track) ?? []) this.feed(c);
    }
    this.lastTime = -1;
  }

  /** Call every display frame with the current media time. */
  render(time: number): void {
    if (!this.jassub || this.active === null || !this.isReady) return;
    if (Math.abs(time - this.lastTime) < 0.0005) return;
    this.lastTime = time;
    void this.jassub.manualRender({
      mediaTime: time,
      expectedDisplayTime: performance.now(),
      width: this.videoWidth,
      height: this.videoHeight,
    });
  }

  /**
   * Lift plain-text subtitles (SRT/WebVTT) above the player controls while
   * they're visible, like YouTube. ASS is left alone: typesetters position
   * every sign deliberately, and moving it would detach signs from the picture.
   */
  setBottomInset(px: number): void {
    const text =
      this.active === 'external'
        ? !!this.external?.script.startsWith(TEXT_HEADER_MARK) // converted from SRT/VTT
        : this.tracks.find((t) => t.id === this.active)?.format === 'text';
    this.canvas.style.transition = 'transform 200ms ease';
    this.canvas.style.transform = text && px > 0 ? `translateY(${-px}px)` : '';
  }

  /** Place the subtitle canvas over the displayed video rectangle (CSS px, relative to host). */
  layout(rect: { left: number; top: number; width: number; height: number }): void {
    const s = this.canvas.style;
    s.left = `${rect.left}px`;
    s.top = `${rect.top}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    this.lastTime = -1;
    if (this.isReady) void this.jassub?.resize(true);
  }

  /** libass `ass_process_chunk` works in milliseconds. */
  private feed(c: SubtitleChunk): void {
    void this.jassub?.renderer.processChunk(c.data, Math.round(c.start * 1000), Math.round(c.duration * 1000));
  }

  destroy(): void {
    this.generation++;
    void this.jassub?.destroy();
    this.jassub = null;
    this.canvas.remove();
  }

  private scriptFor(track: ActiveSubtitle): string | null {
    if (track === 'external') return this.external?.script ?? null;
    if (track === null) return null;
    return this.tracks.find((t) => t.id === track)?.header ?? null;
  }
}
