/**
 * Typed message protocol between the UI thread and the media worker.
 *
 * Only low-frequency control traffic goes through postMessage. Everything that
 * changes every frame (playhead, buffer level, stats) flows through the
 * telemetry SharedArrayBuffer, and PCM flows worker -> AudioWorklet directly
 * through the audio ring SharedArrayBuffer, never touching the UI thread.
 */

export type MediaSourceInput =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File };

export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

/** Anime4K presets, cheapest first. */
export type EnhancePreset = 'fast' | 'balanced' | 'quality' | 'restore' | 'denoise';
export type RenderMode = 'direct' | EnhancePreset;

export interface EnhanceStatus {
  mode: RenderMode;
  /** Chain actually running, e.g. "balanced:up" (null = zero-copy). */
  active: string | null;
  passes: number;
  upscaling: boolean;
}

export const ENHANCE_PRESETS: { id: EnhancePreset; label: string; detail: string }[] = [
  { id: 'fast', label: 'Fast', detail: 'Upscale CNN S · laptops & iGPUs' },
  { id: 'balanced', label: 'Balanced', detail: 'Upscale CNN M' },
  { id: 'quality', label: 'Quality', detail: 'Upscale CNN VL · desktop GPUs' },
  { id: 'restore', label: 'Restore', detail: 'Restore M + Upscale M · blurry / old sources' },
  { id: 'denoise', label: 'Denoise', detail: 'Upscale + Denoise M · noisy sources' },
];

/** Colour controls applied in the present shader (WYSIWYG, also in snapshots). */
export interface PictureSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
}

export const DEFAULT_PICTURE: PictureSettings = { brightness: 0, contrast: 1, saturation: 1, sharpness: 0 };

/** GPU zoom/pan. pan is in uv units, clamped so the view stays inside the frame. */
export interface ViewSettings {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEW: ViewSettings = { zoom: 1, panX: 0, panY: 0 };

/** A-B loop range in seconds. */
export interface LoopRange {
  a: number;
  b: number;
}

/** A text subtitle track (ASS, or SRT/WebVTT converted to ASS). */
export interface SubtitleTrack {
  id: number;
  format: 'ass' | 'text';
  language?: string;
  name?: string;
  isDefault: boolean;
  /** Full ASS header ([Script Info], styles, [Events] format line). */
  header: string;
}

/** One subtitle event in Matroska ASS chunk form, for libass `processChunk`. */
export interface SubtitleChunk {
  track: number;
  data: string;
  start: number; // seconds
  duration: number; // seconds
}

export interface MediaInfo {
  duration: number;
  video: { codec: string; width: number; height: number; fps: number; hardware: boolean } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
  container: string;
  progressive: boolean;
  subtitles: SubtitleTrack[];
}

// ------------------------------------------------------------ UI -> worker

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; telemetry: SharedArrayBuffer; width: number; height: number }
  | { type: 'load'; source: MediaSourceInput }
  | { type: 'play' }
  | { type: 'pause' }
  /** `seq` lets QoE match the resulting first frame to this exact request. */
  | { type: 'seek'; time: number; seq?: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'set-render-mode'; mode: RenderMode }
  /** A/B compare divider (0..1 across the picture), null = off. */
  | { type: 'set-compare'; split: number | null }
  /** Compile an Anime4K preset in the background so enabling it is instant. */
  | { type: 'prewarm-enhance'; preset: EnhancePreset }
  | { type: 'set-picture'; picture: PictureSettings }
  | { type: 'set-view'; view: ViewSettings }
  | { type: 'set-loop'; loop: LoopRange | null }
  /** Frame-accurate step while paused: +1 next frame, -1 previous frame. */
  | { type: 'step-frame'; direction: 1 | -1 }
  /** Render the current frame (with enhancement + picture settings) to PNG. */
  | { type: 'snapshot' }
  /** Seek-bar preview at `time`; answered with a `preview` message carrying the same id. */
  | { type: 'preview'; id: number; time: number }
  /** Output latency reported by the AudioContext, so A/V sync matches what the user hears. */
  | { type: 'audio-latency'; seconds: number }
  | { type: 'dispose' };

// ------------------------------------------------------------ worker -> UI

export type FromWorker =
  | { type: 'gpu-ready'; adapter: string; features: string[] }
  | { type: 'media-info'; info: MediaInfo }
  /** Worker allocated the PCM ring; UI must spin up AudioContext + worklet on it. */
  | { type: 'audio-ring'; sab: SharedArrayBuffer; sampleRate: number; channels: number }
  /** `cause` separates real stalls (rebuffering) from seek/start buffering. */
  | { type: 'state'; state: PlaybackState; cause?: 'seek' | 'start' | 'stall' }
  | { type: 'render-mode'; mode: RenderMode }
  /** What the GPU is actually running (a new Anime4K chain may still be compiling). */
  | { type: 'enhance-status'; status: EnhanceStatus }
  | { type: 'snapshot'; blob: Blob; time: number }
  /** Real decoded keyframe for the seek-bar tooltip (null if unavailable). */
  | { type: 'preview'; id: number; time: number; bitmap: ImageBitmap | null }
  | { type: 'subtitle-chunks'; chunks: SubtitleChunk[] }
  /**
   * QoE: a frame just reached the screen after a load or seek.
   * `seek-preview` = the instant preview keyframe, `seek` = the exact target frame.
   */
  | { type: 'first-frame'; reason: 'load' | 'seek' | 'seek-preview'; seq?: number }
  /** Embedded fonts (MKV attachments) for ASS typesetting. */
  | { type: 'fonts'; fonts: Uint8Array[] }
  /** Informational message (e.g. automatic quality change), not an error. */
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string; fatal: boolean };
