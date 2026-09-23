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

export type RenderMode = 'direct' | 'enhanced';

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

export interface MediaInfo {
  duration: number;
  video: { codec: string; width: number; height: number; fps: number; hardware: boolean } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
  container: string;
  progressive: boolean;
}

// ------------------------------------------------------------ UI -> worker

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; telemetry: SharedArrayBuffer; width: number; height: number }
  | { type: 'load'; source: MediaSourceInput }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'set-render-mode'; mode: RenderMode }
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
  | { type: 'state'; state: PlaybackState }
  | { type: 'render-mode'; mode: RenderMode }
  | { type: 'snapshot'; blob: Blob; time: number }
  /** Real decoded keyframe for the seek-bar tooltip (null if unavailable). */
  | { type: 'preview'; id: number; time: number; bitmap: ImageBitmap | null }
  /** Informational message (e.g. automatic quality change), not an error. */
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string; fatal: boolean };
