import type { ByteSource } from '../source/ByteSource';
import type { DemuxedTracks, Demuxer, DemuxSink } from './Demuxer';
import { ID, TOP_LEVEL, UNKNOWN_SIZE, children, readFloat, readHeader, readString, readUint, readVint } from './ebml';
import { aacCodecString, av1CodecString, avcCodecString, hevcCodecString, vp9CodecString } from './codecStrings';

/** Elements bigger than this are skipped instead of buffered (attachments, huge tags). */
const MAX_BUFFERED_ELEMENT = 16 * 1024 * 1024;

interface MkvTrack {
  number: number;
  type: number; // 1 video, 2 audio, 17 subtitle
  codecId: string;
  codecPrivate?: Uint8Array;
  /** Nanoseconds to subtract from timestamps (Opus pre-skip). */
  codecDelay: number;
  /** Nanoseconds per frame, if signalled. */
  defaultDuration?: number;
  isDefault: boolean;
  enabled: boolean;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  sampleRate?: number;
  channels?: number;
  /** Header-stripping compression prefix (ContentCompAlgo 3). */
  stripPrefix?: Uint8Array;
  unsupportedEncoding?: boolean;
}

interface CuePoint {
  time: number; // seconds
  position: number; // absolute byte offset of the cluster
}

interface OpenMaster {
  id: number;
  end: number; // absolute offset, Infinity for unknown size
}

/**
 * Streaming Matroska / WebM demuxer.
 *
 * Parses incrementally as bytes arrive, descending into Segment and Cluster
 * instead of buffering them, so a 4 GB episode never needs more than a few
 * hundred KB of parser memory. Handles SimpleBlock/BlockGroup, all three
 * lacing modes, unknown-size (live) segments and clusters, Opus CodecDelay,
 * and header-stripping compression.
 *
 * Seeking uses Cues (fetched in the background via their SeekHead position)
 * and falls back to a bitrate estimate plus Cluster resync when a file has no
 * index.
 */
export class MkvDemuxer implements Demuxer {
  private generation = 0;
  private abort: AbortController | null = null;
  private closed = false;
  private started = false;
  private startGate: (() => void) | null = null;
  private opened: { resolve: (t: DemuxedTracks) => void; reject: (e: Error) => void } | null = null;

  // --- parser state (absolute offsets) ---
  private store = new Uint8Array(0);
  private len = 0;
  private bufStart = 0;
  private pos = 0;
  private stack: OpenMaster[] = [];
  /** After a bitrate-estimated seek: scan for the next Cluster ID first. */
  private resync = false;

  // --- file state ---
  private segmentStart = -1;
  private timecodeScale = 1_000_000; // ns
  private durationSeconds = 0;
  private tracks = new Map<number, MkvTrack>();
  private video: MkvTrack | null = null;
  private audio: MkvTrack | null = null;
  private tracksParsed = false;
  private cuesPosition = -1;
  private cues: CuePoint[] = [];
  private cuesLoading = false;
  private clusterTime = 0;
  private firstVideoKeyframe: Uint8Array | undefined;
  private preStart: (() => void)[] = [];
  private _demuxedUntil = 0;

  constructor(
    private readonly source: ByteSource,
    private readonly sink: DemuxSink,
  ) {}

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
    for (const emit of this.preStart) emit();
    this.preStart = [];
    this.startGate?.();
    this.startGate = null;
  }

  seek(time: number): number {
    this.generation++;
    this.abort?.abort();
    const cue = this.findCue(time);
    let offset: number;
    let actual = time;
    if (cue) {
      offset = cue.position;
      actual = cue.time;
      this.resync = false;
    } else if (time <= 0 || !this.durationSeconds || this.source.size === undefined) {
      offset = this.firstClusterGuess();
      actual = 0;
      this.resync = offset !== this.segmentStart;
    } else {
      // No index: estimate from the average bitrate, a little early so we
      // land before the target, then resync on the next Cluster.
      const payload = this.source.size - this.segmentStart;
      const fraction = Math.max(0, (time - 5) / this.durationSeconds);
      offset = Math.floor(this.segmentStart + payload * fraction);
      this.resync = true;
    }
    this.resetParserAt(offset);
    this._demuxedUntil = actual;
    void this.pump(offset, this.generation);
    return actual;
  }

  close(): void {
    this.closed = true;
    this.generation++;
    this.abort?.abort();
    this.startGate?.();
  }

  // ================================================================ network

  private async pump(offset: number, gen: number): Promise<void> {
    const ac = new AbortController();
    this.abort = ac;
    try {
      const reader = await this.source.open(offset, ac.signal);
      try {
        for (;;) {
          if (this.opened === null && this.started) await this.sink.demand();
          if (gen !== this.generation) return;
          const { done, value } = await reader.read();
          if (gen !== this.generation) return;
          if (done) {
            if (this.opened) this.resolveOpen(true);
            if (!this.started) await new Promise<void>((r) => (this.startGate = r));
            if (gen === this.generation && !this.closed) this.sink.onEndOfStream();
            return;
          }
          this.append(value);
          this.parse();
          // Metadata known and the first frames buffered: wait for the decoders.
          if (!this.opened && !this.started) {
            await new Promise<void>((r) => (this.startGate = r));
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

  // ================================================================= parser

  /**
   * Append network bytes. The backing store grows geometrically and consumed
   * bytes are compacted lazily, so a large block arriving in many small
   * chunks costs O(n), not O(n²) copying.
   */
  private append(chunk: Uint8Array): void {
    const streamPos = this.bufEnd; // absolute offset of chunk[0]
    if (this.pos >= streamPos) {
      // Skipping an element that extends past what we had: discard bytes
      // until its end without buffering them.
      const drop = Math.min(this.pos - streamPos, chunk.length);
      this.bufStart = streamPos + drop;
      this.len = 0;
      chunk = chunk.subarray(drop);
      if (chunk.length === 0) return;
    }
    const consumed = this.pos - this.bufStart;
    const live = this.len - consumed;
    if (live + chunk.length > this.store.length) {
      const grown = new Uint8Array(Math.max(this.store.length * 2, live + chunk.length, 64 * 1024));
      grown.set(this.store.subarray(consumed, this.len));
      this.store = grown;
      this.bufStart = this.pos;
      this.len = live;
    } else if (consumed > 0 && this.len + chunk.length > this.store.length) {
      this.store.copyWithin(0, consumed, this.len);
      this.bufStart = this.pos;
      this.len = live;
    }
    this.store.set(chunk, this.len);
    this.len += chunk.length;
  }

  /** Buffered bytes [bufStart, bufEnd). */
  private get buf(): Uint8Array {
    return this.store.subarray(0, this.len);
  }

  private resetParserAt(offset: number): void {
    this.len = 0;
    this.bufStart = offset;
    this.pos = offset;
    // Positioned inside the Segment, at cluster level.
    this.stack = this.segmentStart >= 0 ? [{ id: ID.Segment, end: Infinity }] : [];
  }

  private get bufEnd(): number {
    return this.bufStart + this.len;
  }

  private parse(): void {
    for (;;) {
      if (this.pos >= this.bufEnd) return; // skipping past buffered data
      if (this.resync && !this.scanForCluster()) return;

      // Close finished masters.
      while (this.stack.length && this.pos >= this.stack[this.stack.length - 1].end) this.stack.pop();

      const local = this.pos - this.bufStart;
      let h;
      try {
        h = readHeader(this.buf, local);
      } catch {
        // Garbage (damaged file or a bad estimate): look for the next cluster.
        this.resync = true;
        continue;
      }
      if (!h) return;
      const dataStart = this.pos + h.headerLength;
      const parent = this.stack[this.stack.length - 1];

      // An unknown-size Cluster ends where the next top-level element begins.
      if (parent?.id === ID.Cluster && parent.end === Infinity && TOP_LEVEL.has(h.id)) {
        this.stack.pop();
        continue;
      }

      if (h.id === ID.Segment || h.id === ID.Cluster) {
        if (h.id === ID.Segment) this.segmentStart = dataStart;
        else if (!this.tracksParsed) throw new Error('Matroska file has clusters before track info');
        this.stack.push({ id: h.id, end: h.size === UNKNOWN_SIZE ? Infinity : dataStart + h.size });
        this.pos = dataStart;
        continue;
      }

      if (h.size === UNKNOWN_SIZE) {
        // Only Segment/Cluster may be unknown-size; anything else is corrupt.
        this.resync = true;
        continue;
      }

      const end = dataStart + h.size;
      if (!this.wantsElement(h.id, parent?.id) || h.size > MAX_BUFFERED_ELEMENT) {
        this.pos = end; // skip (possibly beyond the buffer; append() discards the rest)
        continue;
      }
      if (end > this.bufEnd) return; // need the whole element

      const data = this.buf.subarray(dataStart - this.bufStart, end - this.bufStart);
      this.handleElement(h.id, data);
      this.pos = end;
    }
  }

  private wantsElement(id: number, parent: number | undefined): boolean {
    if (id === ID.EBML) return true;
    if (parent === ID.Segment) return id === ID.SeekHead || id === ID.Info || id === ID.Tracks || id === ID.Cues;
    if (parent === ID.Cluster) return id === ID.Timecode || id === ID.SimpleBlock || id === ID.BlockGroup;
    return false;
  }

  private handleElement(id: number, data: Uint8Array): void {
    switch (id) {
      case ID.EBML: {
        for (const c of children(data)) {
          if (c.id === ID.DocType) {
            const docType = readString(data, c.data, c.size);
            if (docType !== 'matroska' && docType !== 'webm') throw new Error(`Unsupported EBML document: ${docType}`);
          }
        }
        break;
      }
      case ID.SeekHead:
        this.parseSeekHead(data);
        break;
      case ID.Info:
        this.parseInfo(data);
        break;
      case ID.Tracks:
        this.parseTracks(data);
        break;
      case ID.Cues:
        this.cues = this.parseCues(data);
        break;
      case ID.Timecode:
        this.clusterTime = readUint(data, 0, data.length);
        break;
      case ID.SimpleBlock:
        this.handleBlock(data, true, false, undefined);
        break;
      case ID.BlockGroup: {
        let block: Uint8Array | undefined;
        let hasReference = false;
        let duration: number | undefined;
        for (const c of children(data)) {
          if (c.id === ID.Block) block = data.subarray(c.data, c.data + c.size);
          else if (c.id === ID.ReferenceBlock) hasReference = true;
          else if (c.id === ID.BlockDuration) duration = readUint(data, c.data, c.size);
        }
        if (block) this.handleBlock(block, false, !hasReference, duration);
        break;
      }
    }
  }

  private parseSeekHead(data: Uint8Array): void {
    for (const seek of children(data)) {
      if (seek.id !== ID.Seek) continue;
      let target = 0;
      let position = -1;
      for (const c of children(data, seek.data, seek.data + seek.size)) {
        if (c.id === ID.SeekID) target = readUint(data, c.data, c.size);
        else if (c.id === ID.SeekPosition) position = readUint(data, c.data, c.size);
      }
      if (target === ID.Cues && position >= 0) this.cuesPosition = this.segmentStart + position;
    }
  }

  private parseInfo(data: Uint8Array): void {
    let duration = 0;
    for (const c of children(data)) {
      if (c.id === ID.TimecodeScale) this.timecodeScale = readUint(data, c.data, c.size);
      else if (c.id === ID.Duration) duration = readFloat(data, c.data, c.size);
    }
    this.durationSeconds = (duration * this.timecodeScale) / 1e9;
  }

  private parseTracks(data: Uint8Array): void {
    for (const entry of children(data)) {
      if (entry.id !== ID.TrackEntry) continue;
      const t: MkvTrack = { number: 0, type: 0, codecId: '', codecDelay: 0, isDefault: true, enabled: true };
      for (const c of children(data, entry.data, entry.data + entry.size)) {
        const u = () => readUint(data, c.data, c.size);
        switch (c.id) {
          case ID.TrackNumber: t.number = u(); break;
          case ID.TrackType: t.type = u(); break;
          case ID.CodecID: t.codecId = readString(data, c.data, c.size); break;
          case ID.CodecPrivate: t.codecPrivate = data.slice(c.data, c.data + c.size); break;
          case ID.CodecDelay: t.codecDelay = u(); break;
          case ID.DefaultDuration: t.defaultDuration = u(); break;
          case ID.FlagDefault: t.isDefault = u() === 1; break;
          case ID.FlagEnabled: t.enabled = u() === 1; break;
          case ID.Video:
            for (const v of children(data, c.data, c.data + c.size)) {
              const vu = readUint(data, v.data, v.size);
              if (v.id === ID.PixelWidth) t.width = vu;
              else if (v.id === ID.PixelHeight) t.height = vu;
              else if (v.id === ID.DisplayWidth) t.displayWidth = vu;
              else if (v.id === ID.DisplayHeight) t.displayHeight = vu;
            }
            break;
          case ID.Audio:
            for (const a of children(data, c.data, c.data + c.size)) {
              if (a.id === ID.SamplingFrequency) t.sampleRate ??= readFloat(data, a.data, a.size);
              else if (a.id === ID.OutputSamplingFrequency) t.sampleRate = readFloat(data, a.data, a.size);
              else if (a.id === ID.Channels) t.channels = readUint(data, a.data, a.size);
            }
            break;
          case ID.ContentEncodings:
            this.parseContentEncodings(data.subarray(c.data, c.data + c.size), t);
            break;
        }
      }
      this.tracks.set(t.number, t);
    }

    const pick = (type: number) => {
      const candidates = [...this.tracks.values()].filter((t) => t.type === type && t.enabled && !t.unsupportedEncoding);
      return candidates.find((t) => t.isDefault) ?? candidates[0] ?? null;
    };
    this.video = pick(1);
    this.audio = pick(2);
    this.tracksParsed = true;
    if (!this.video && !this.audio) throw new Error('No audio or video track found');
  }

  /** ContentEncoding → ContentCompression; only header stripping (algo 3) is supported. */
  private parseContentEncodings(data: Uint8Array, t: MkvTrack): void {
    const walk = (buf: Uint8Array) => {
      for (const c of children(buf)) {
        const payload = buf.subarray(c.data, c.data + c.size);
        if (c.id === 0x6240 /* ContentEncoding */ || c.id === 0x5034 /* ContentCompression */) walk(payload);
        else if (c.id === 0x5035 /* ContentEncryption */) t.unsupportedEncoding = true;
        else if (c.id === 0x4254 /* ContentCompAlgo */ && readUint(payload, 0, payload.length) !== 3) t.unsupportedEncoding = true;
        else if (c.id === 0x4255 /* ContentCompSettings */) t.stripPrefix = payload.slice();
      }
    };
    walk(data);
  }

  private parseCues(data: Uint8Array): CuePoint[] {
    const points: CuePoint[] = [];
    const wanted = this.video?.number ?? this.audio?.number;
    for (const cp of children(data)) {
      if (cp.id !== ID.CuePoint) continue;
      let time = 0;
      for (const c of children(data, cp.data, cp.data + cp.size)) {
        if (c.id === ID.CueTime) time = readUint(data, c.data, c.size);
        else if (c.id === ID.CueTrackPositions) {
          let track = 0;
          let position = -1;
          for (const p of children(data, c.data, c.data + c.size)) {
            if (p.id === ID.CueTrack) track = readUint(data, p.data, p.size);
            else if (p.id === ID.CueClusterPosition) position = readUint(data, p.data, p.size);
          }
          if (position >= 0 && (track === wanted || wanted === undefined)) {
            points.push({ time: (time * this.timecodeScale) / 1e9, position: this.segmentStart + position });
          }
        }
      }
    }
    return points.sort((a, b) => a.time - b.time);
  }

  // ================================================================= blocks

  private handleBlock(block: Uint8Array, simple: boolean, groupKey: boolean, blockDuration: number | undefined): void {
    const { value: trackNumber, length } = readVint(block, 0);
    const track = this.tracks.get(trackNumber);
    if (!track || (track !== this.video && track !== this.audio)) return;

    let p = length;
    const relative = (block[p] << 24) >> 16 | block[p + 1]; // signed int16
    const flags = block[p + 2];
    p += 3;
    const keyframe = simple ? (flags & 0x80) !== 0 : groupKey;
    const frames = splitLaces(block, p, (flags >> 1) & 3);

    const scale = this.timecodeScale;
    const baseNs = (this.clusterTime + relative) * scale - track.codecDelay;
    const frameNs =
      track.defaultDuration ??
      (blockDuration !== undefined ? (blockDuration * scale) / frames.length : codecFrameDurationNs(track));

    for (let i = 0; i < frames.length; i++) {
      let data = frames[i];
      if (track.stripPrefix) {
        const joined = new Uint8Array(track.stripPrefix.length + data.length);
        joined.set(track.stripPrefix);
        joined.set(data, track.stripPrefix.length);
        data = joined;
      }
      const tsNs = baseNs + i * (frameNs ?? 0);
      const init: EncodedVideoChunkInit = {
        type: keyframe || track.type === 2 ? 'key' : 'delta',
        timestamp: tsNs / 1000,
        duration: frameNs !== undefined ? frameNs / 1000 : undefined,
        data,
      };
      const end = (tsNs + (frameNs ?? 0)) / 1e9;
      const isVideo = track === this.video;
      if (isVideo && !this.firstVideoKeyframe && keyframe) this.firstVideoKeyframe = data.slice(0, 64);
      // Frames are views into the parser buffer, which is reused. WebCodecs
      // copies on construction, but queued pre-start frames must own their bytes.
      if (!this.started) init.data = data.slice();

      const emit = () => {
        if (isVideo) this.sink.onVideoChunk(new EncodedVideoChunk(init));
        else this.sink.onAudioChunk(new EncodedAudioChunk(init));
        if (end > this._demuxedUntil) this._demuxedUntil = end;
      };
      if (this.started) emit();
      else this.preStart.push(emit);
    }

    // Tracks resolve once we've seen the first video keyframe (VP9 profile /
    // bit depth come from it) or any block when there is no video.
    if (this.opened && (!this.video || this.firstVideoKeyframe)) this.resolveOpen(false);
  }

  // ================================================================ helpers

  private resolveOpen(atEof: boolean): void {
    if (!this.opened) return;
    if (!this.tracksParsed) {
      this.fail(new Error(atEof ? 'Not a playable Matroska file: no track info found' : 'Matroska track info missing'));
      return;
    }
    const v = this.video;
    const a = this.audio;
    const tracks: DemuxedTracks = {
      duration: this.durationSeconds,
      container: 'video/x-matroska',
      progressive: true,
      video: v ? this.videoConfig(v) : null,
      audio: a ? this.audioConfig(a) : null,
    };
    this.opened.resolve(tracks);
    this.opened = null;
    void this.loadCues();
  }

  private videoConfig(t: MkvTrack): VideoDecoderConfig & { fps: number } {
    const priv = t.codecPrivate;
    let codec: string;
    let description: Uint8Array | undefined;
    switch (t.codecId) {
      case 'V_MPEG4/ISO/AVC': codec = avcCodecString(priv!); description = priv; break;
      case 'V_MPEGH/ISO/HEVC': codec = hevcCodecString(priv!); description = priv; break;
      case 'V_AV1': codec = av1CodecString(priv!); description = priv && priv.length > 4 ? priv : undefined; break;
      case 'V_VP9': codec = vp9CodecString(this.firstVideoKeyframe); break;
      case 'V_VP8': codec = 'vp8'; break;
      default: codec = t.codecId;
    }
    const config: VideoDecoderConfig & { fps: number } = {
      codec,
      codedWidth: t.width,
      codedHeight: t.height,
      description,
      fps: t.defaultDuration ? 1e9 / t.defaultDuration : 24000 / 1001,
    };
    if (t.displayWidth && t.displayHeight && t.width && t.displayWidth * t.height! !== t.displayHeight * t.width) {
      config.displayAspectWidth = t.displayWidth;
      config.displayAspectHeight = t.displayHeight;
    }
    return config;
  }

  private audioConfig(t: MkvTrack): AudioDecoderConfig {
    const map: Record<string, string> = {
      A_OPUS: 'opus',
      A_VORBIS: 'vorbis',
      A_FLAC: 'flac',
      'A_MPEG/L3': 'mp3',
      A_AC3: 'ac-3',
      A_EAC3: 'ec-3',
    };
    const codec = t.codecId.startsWith('A_AAC') ? aacCodecString(t.codecPrivate) : (map[t.codecId] ?? t.codecId);
    return {
      codec,
      sampleRate: t.sampleRate ?? 48000,
      numberOfChannels: t.channels ?? 2,
      description: t.codecPrivate,
    };
  }

  private findCue(time: number): CuePoint | null {
    let best: CuePoint | null = null;
    for (const c of this.cues) {
      if (c.time > time) break;
      best = c;
    }
    return best;
  }

  private firstClusterGuess(): number {
    return this.cues[0]?.position ?? this.segmentStart;
  }

  /** Fetch the Cues element (usually at the end of the file) in the background. */
  private async loadCues(): Promise<void> {
    if (this.cues.length || this.cuesPosition < 0 || this.cuesLoading) return;
    this.cuesLoading = true;
    try {
      const reader = await this.source.open(this.cuesPosition, new AbortController().signal);
      let buf = new Uint8Array(0);
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          const next = new Uint8Array(buf.length + value.length);
          next.set(buf);
          next.set(value, buf.length);
          buf = next;
        }
        const h = readHeader(buf, 0);
        if (h && h.id !== ID.Cues) break;
        if (h && buf.length >= h.headerLength + h.size) {
          this.cues = this.parseCues(buf.subarray(h.headerLength, h.headerLength + h.size));
          break;
        }
        if (done || buf.length > MAX_BUFFERED_ELEMENT) break;
      }
      reader.cancel().catch(() => {});
    } catch {
      // No index: seeking falls back to bitrate estimation.
    } finally {
      this.cuesLoading = false;
    }
  }

  /** Advance to the next Cluster ID in the buffer. */
  private scanForCluster(): boolean {
    const b = this.buf;
    for (let i = this.pos - this.bufStart; i + 4 <= b.length; i++) {
      if (b[i] === 0x1f && b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75) {
        this.pos = this.bufStart + i;
        this.resync = false;
        this.stack = [{ id: ID.Segment, end: Infinity }];
        return true;
      }
    }
    this.pos = Math.max(this.pos, this.bufEnd - 3);
    return false;
  }

  private fail(error: Error): void {
    if (this.opened) {
      this.opened.reject(error);
      this.opened = null;
    } else {
      this.sink.onError(error);
    }
  }
}

/** Split a (possibly laced) Block payload into frames. */
export function splitLaces(block: Uint8Array, start: number, lacing: number): Uint8Array[] {
  if (lacing === 0) return [block.subarray(start)];
  const count = block[start] + 1;
  let p = start + 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    // Xiph: each size is a run of 255s plus a final byte.
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      let b: number;
      do {
        b = block[p++];
        size += b;
      } while (b === 255);
      sizes.push(size);
    }
  } else if (lacing === 3) {
    // EBML: first size as vint, then signed vint deltas.
    let { value, length } = readVint(block, p);
    p += length;
    sizes.push(value);
    for (let i = 1; i < count - 1; i++) {
      const d = readVint(block, p);
      p += d.length;
      value += d.value - (2 ** (7 * d.length - 1) - 1);
      sizes.push(value);
    }
  } else {
    // Fixed-size lacing.
    const each = (block.length - p) / count;
    for (let i = 0; i < count - 1; i++) sizes.push(each);
  }
  const frames: Uint8Array[] = [];
  for (const size of sizes) {
    frames.push(block.subarray(p, p + size));
    p += size;
  }
  frames.push(block.subarray(p));
  return frames;
}

/** Typical frame duration for laced audio without DefaultDuration. */
function codecFrameDurationNs(t: MkvTrack): number | undefined {
  const sr = t.sampleRate ?? 48000;
  const samples: Record<string, number> = { 'A_MPEG/L3': 1152, A_AC3: 1536, A_EAC3: 1536 };
  const n = t.codecId.startsWith('A_AAC') ? 1024 : samples[t.codecId];
  return n ? (n / sr) * 1e9 : undefined;
}
