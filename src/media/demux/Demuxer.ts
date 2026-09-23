/**
 * Container-agnostic demuxer contract.
 *
 * `Mp4Demuxer` (mp4box.js) is the first implementation. A Rust/WASM demuxer
 * (MKV/WebM, MPEG-TS, fMP4 LL-HLS/DASH segments) can drop in behind the same
 * interface without the decoders, clock or renderer noticing.
 */

export interface DemuxedTracks {
  duration: number;
  container: string;
  progressive: boolean;
  video: (VideoDecoderConfig & { fps: number }) | null;
  audio: AudioDecoderConfig | null;
}

export interface DemuxSink {
  onVideoChunk(chunk: EncodedVideoChunk): void;
  onAudioChunk(chunk: EncodedAudioChunk): void;
  /** All samples up to end of file have been delivered. */
  onEndOfStream(): void;
  onError(error: Error): void;
  /**
   * Backpressure: the demuxer awaits this before pulling more bytes off the
   * network. Resolves immediately while buffers are below target.
   */
  demand(): Promise<void>;
}

export interface Demuxer {
  /** Start streaming; resolves once track metadata is known (moov parsed). */
  open(): Promise<DemuxedTracks>;
  /** Begin emitting samples to the sink (call once decoders are configured). */
  start(): void;
  /**
   * Reposition on the nearest preceding keyframe. Samples from the new
   * position start flowing to the sink immediately.
   * Returns the actual (keyframe) start time in seconds.
   */
  seek(time: number): number;
  /** Seconds of media demuxed ahead (end of the furthest delivered sample). */
  readonly demuxedUntil: number;
  /**
   * Video keyframe times (seconds, ascending) for seek-bar previews. May be
   * empty until the index is known (e.g. MKV Cues still loading).
   */
  keyframeTimes(): number[];
  /**
   * Fetch just the bytes of keyframe `index` with an independent request,
   * without disturbing playback streaming.
   */
  readKeyframe(index: number): Promise<EncodedVideoChunk | null>;
  close(): void;
}
