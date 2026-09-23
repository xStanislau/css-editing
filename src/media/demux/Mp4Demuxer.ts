import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
  type VisualSampleEntry,
  type AudioSampleEntry,
} from 'mp4box';
import type { ByteSource } from '../source/ByteSource';
import type { DemuxedTracks, Demuxer, DemuxSink } from './Demuxer';

/** Samples per onSamples batch: small batches keep latency and memory low. */
const EXTRACT_BATCH = 32;

/**
 * Streaming MP4 demuxer on top of mp4box.js.
 *
 * - Parses progressively while bytes arrive (first frame before download ends).
 * - Follows mp4box's "next wanted file position", so `moov`-at-end files jump
 *   straight to the index with an HTTP Range request instead of downloading
 *   the whole mdat first.
 * - Seeking aborts the in-flight request and reopens at the keyframe offset.
 */
export class Mp4Demuxer implements Demuxer {
  private file: ISOFile;
  private generation = 0;
  private abort: AbortController | null = null;
  private videoTrack: Track | null = null;
  private audioTrack: Track | null = null;
  /** Video sync samples: presentation time (s), byte range and duration. */
  private keyframes: { time: number; offset: number; size: number; duration: number }[] = [];
  /** Per-track presentation offset in seconds, from the edit list (elst). */
  private readonly trackOffset = new Map<number, number>();
  private opened: { resolve: (t: DemuxedTracks) => void; reject: (e: Error) => void } | null = null;
  private _demuxedUntil = 0;
  private closed = false;
  private started = false;

  constructor(
    private readonly source: ByteSource,
    private readonly sink: DemuxSink,
  ) {
    this.file = createFile();
    this.file.onError = (module, message) => this.fail(new Error(`mp4box ${module}: ${message}`));
    this.file.onReady = (info) => this.handleReady(info);
    this.file.onSamples = (id, _user, samples) => this.handleSamples(id, samples);
  }

  get demuxedUntil(): number {
    return this._demuxedUntil;
  }

  open(): Promise<DemuxedTracks> {
    const p = new Promise<DemuxedTracks>((resolve, reject) => (this.opened = { resolve, reject }));
    void this.pump(0, this.generation);
    return p;
  }

  start(): void {
    this.started = true;
    this.file.start();
    // Position every track on its first sample and continue streaming from
    // the first byte mp4box doesn't already hold. For `moov`-at-end files this
    // jumps back into the mdat; for fast-start files it just resumes.
    const { offset } = this.file.seek(0, true);
    if (this.source.size !== undefined && offset >= this.source.size) {
      this.finish();
    } else {
      this.restart(offset);
    }
  }

  seek(time: number): number {
    // mp4box seeks in media time; edit offsets are a few ms, and the engine
    // discards pre-roll by presentation time, so landing stays frame-accurate.
    const { offset, time: mediaTime } = this.file.seek(time, true);
    const actual = mediaTime + this.minOffset();
    this._demuxedUntil = actual;
    if (this.source.size !== undefined && offset >= this.source.size) {
      // Everything needed is already buffered inside mp4box.
      this.generation++;
      this.abort?.abort();
      this.finish();
    } else {
      this.restart(offset);
    }
    return actual;
  }

  keyframeTimes(): number[] {
    return this.keyframes.map((k) => k.time);
  }

  async readKeyframe(index: number): Promise<EncodedVideoChunk | null> {
    const k = this.keyframes[index];
    if (!k) return null;
    const data = await readRange(this.source, k.offset, k.size);
    return data && new EncodedVideoChunk({ type: 'key', timestamp: k.time * 1e6, duration: k.duration * 1e6, data });
  }

  close(): void {
    this.closed = true;
    this.generation++;
    this.abort?.abort();
    this.file.stop();
  }

  // ---------------------------------------------------------------- network

  private restart(offset: number): void {
    this.generation++;
    this.abort?.abort();
    void this.pump(offset, this.generation);
  }

  private async pump(offset: number, gen: number): Promise<void> {
    let pos = offset;
    const ac = new AbortController();
    this.abort = ac;
    try {
      const reader = await this.source.open(pos, ac.signal);
      try {
        for (;;) {
          // Metadata parsed but decoders not ready yet: start() resumes streaming.
          if (!this.started && !this.opened) return;
          // Only gate on backpressure after metadata is known; before that we
          // want the moov ASAP.
          if (!this.opened) await this.sink.demand();
          if (gen !== this.generation) return;

          const { done, value } = await reader.read();
          if (gen !== this.generation) return;
          if (done) {
            if (this.opened) throw new Error('Not a playable MP4: no movie header (moov) found');
            if (this.started) this.finish();
            return;
          }

          const buf = MP4BoxBuffer.fromArrayBuffer(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), pos);
          pos += value.byteLength;
          const next = this.file.appendBuffer(buf);

          // mp4box wants bytes from somewhere else (moov at end, or jumping
          // back into mdat after reading a trailing moov): reopen there.
          if (next !== undefined && next !== pos && (this.source.size === undefined || next < this.source.size)) {
            if (gen === this.generation) this.restart(next);
            return;
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    } catch (e) {
      if (gen !== this.generation || ac.signal.aborted || this.closed) return;
      this.fail(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ------------------------------------------------------------------ mp4box

  private handleReady(info: Movie): void {
    this.videoTrack = info.videoTracks[0] ?? null;
    this.audioTrack = info.audioTracks[0] ?? null;
    if (!this.videoTrack && !this.audioTrack) return this.fail(new Error('No audio or video track found'));

    const tracks: DemuxedTracks = {
      duration: info.duration / info.timescale,
      container: info.mime,
      progressive: info.isProgressive,
      video: this.videoTrack ? this.videoConfig(this.videoTrack) : null,
      audio: this.audioTrack ? this.audioConfig(this.audioTrack) : null,
    };

    for (const t of [this.videoTrack, this.audioTrack]) {
      if (t) this.trackOffset.set(t.id, editListOffset(t, info.timescale));
    }
    if (this.videoTrack) {
      const shift = this.trackOffset.get(this.videoTrack.id) ?? 0;
      this.keyframes = this.file
        .getTrackSamplesInfo(this.videoTrack.id)
        .filter((s) => s.is_sync)
        .map((s) => ({ time: s.cts / s.timescale + shift, offset: s.offset, size: s.size, duration: s.duration / s.timescale }))
        .sort((a, b) => a.time - b.time);
    }
    for (const t of [this.videoTrack, this.audioTrack]) {
      if (t) this.file.setExtractionOptions(t.id, null, { nbSamples: EXTRACT_BATCH });
    }
    // Extraction starts in start(), once the decoders are configured, so no
    // sample (in particular the first keyframe) is emitted into the void.
    this.opened?.resolve(tracks);
    this.opened = null;
  }

  private handleSamples(trackId: number, samples: Sample[]): void {
    const isVideo = trackId === this.videoTrack?.id;
    const shift = this.trackOffset.get(trackId) ?? 0;
    for (const s of samples) {
      if (!s.data) continue;
      const init = {
        type: s.is_sync ? 'key' : 'delta',
        timestamp: (s.cts / s.timescale + shift) * 1e6,
        duration: (s.duration * 1e6) / s.timescale,
        data: s.data,
      } as const;
      if (isVideo) this.sink.onVideoChunk(new EncodedVideoChunk(init));
      else this.sink.onAudioChunk(new EncodedAudioChunk(init));
      const end = (s.cts + s.duration) / s.timescale + shift;
      if (end > this._demuxedUntil) this._demuxedUntil = end;
    }
    // Let mp4box free the sample payloads we just handed to WebCodecs.
    const last = samples[samples.length - 1];
    if (last) this.file.releaseUsedSamples(trackId, last.number + 1);
  }

  private minOffset(): number {
    return this.trackOffset.size ? Math.min(...this.trackOffset.values()) : 0;
  }

  private finish(): void {
    this.file.flush();
    this.sink.onEndOfStream();
  }

  private fail(error: Error): void {
    if (this.opened) {
      this.opened.reject(error);
      this.opened = null;
    } else {
      this.sink.onError(error);
    }
  }

  // --------------------------------------------------------- codec configs

  private sampleEntry<T>(track: Track): T {
    return this.file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0] as T;
  }

  private videoConfig(track: Track): VideoDecoderConfig & { fps: number } {
    const entry = this.sampleEntry<VisualSampleEntry>(track);
    const seconds = track.samples_duration / track.timescale || track.duration / track.timescale;
    return {
      codec: webCodecsCodec(track.codec),
      codedWidth: track.video?.width ?? track.track_width,
      codedHeight: track.video?.height ?? track.track_height,
      description: videoDescription(entry),
      hardwareAcceleration: 'prefer-hardware',
      fps: seconds > 0 ? track.nb_samples / seconds : 30,
    };
  }

  private audioConfig(track: Track): AudioDecoderConfig {
    const entry = this.sampleEntry<AudioSampleEntry>(track);
    return {
      codec: webCodecsCodec(track.codec),
      sampleRate: track.audio?.sample_rate ?? 48000,
      numberOfChannels: track.audio?.channel_count ?? 2,
      description: audioDescription(entry),
    };
  }
}

/** avcC / hvcC / av1C payload (box body without the 8-byte header). */
function videoDescription(entry: VisualSampleEntry): Uint8Array | undefined {
  // VP9 needs no description in WebCodecs.
  const box = entry.avcC ?? entry.hvcC ?? entry.av1C;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  // mp4box types some box writers as MultiBufferStream-only; DataStream is what they use at runtime.
  (box.write as (s: DataStream) => void).call(box, stream);
  return new Uint8Array(stream.buffer, 8);
}

/** AAC AudioSpecificConfig from esds (DecoderConfig tag 0x04 -> DecSpecificInfo tag 0x05). */
function audioDescription(entry: AudioSampleEntry): Uint8Array | undefined {
  const esds = (entry as AudioSampleEntry & { esds?: { esd: { findDescriptor(tag: number): { findDescriptor(tag: number): { data: Uint8Array } | undefined } | undefined } } }).esds;
  return esds?.esd.findDescriptor(0x04)?.findDescriptor(0x05)?.data;
}

/**
 * mp4box reports sample-entry names; WebCodecs wants registry codec strings
 * (case-sensitive): `Opus` -> `opus`, `fLaC` -> `flac`, `vp08.*` -> `vp8`,
 * MPEG-1/2 audio object types -> `mp3`.
 */
export function webCodecsCodec(codec: string): string {
  if (codec === 'Opus') return 'opus';
  if (codec === 'fLaC') return 'flac';
  if (codec.startsWith('vp08')) return 'vp8';
  if (/^mp4a\.(6b|69)$/i.test(codec)) return 'mp3';
  return codec;
}

/**
 * Presentation offset (seconds) implied by a track's edit list:
 *   - leading empty edits (media_time = -1) delay the track;
 *   - the first real edit's media_time trims the start (B-frame composition
 *     delay on video, encoder priming on AAC, Opus pre-skip).
 * Samples then land at `cts / timescale + offset`, so tracks line up exactly
 * and priming samples get negative timestamps (dropped by the decoders).
 */
export function editListOffset(track: Pick<Track, 'edits' | 'timescale'>, movieTimescale: number): number {
  let delay = 0;
  for (const e of track.edits ?? []) {
    if (e.media_time === -1) {
      delay += e.segment_duration / movieTimescale;
      continue;
    }
    return delay - e.media_time / track.timescale;
  }
  return delay;
}

/** Read exactly `size` bytes at `offset` with an independent request. */
export async function readRange(source: ByteSource, offset: number, size: number): Promise<Uint8Array | null> {
  const ac = new AbortController();
  const out = new Uint8Array(size);
  let filled = 0;
  try {
    const reader = await source.open(offset, ac.signal);
    while (filled < size) {
      const { done, value } = await reader.read();
      if (done) break;
      const n = Math.min(value.length, size - filled);
      out.set(value.subarray(0, n), filled);
      filled += n;
    }
    reader.cancel().catch(() => {});
  } finally {
    ac.abort();
  }
  return filled === size ? out : null;
}
