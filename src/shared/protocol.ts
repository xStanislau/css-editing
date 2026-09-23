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
  | { type: 'error'; message: string; fatal: boolean };
