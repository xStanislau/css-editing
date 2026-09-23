import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { editListOffset, Mp4Demuxer, webCodecsCodec } from '../../src/media/demux/Mp4Demuxer';
import type { DemuxSink } from '../../src/media/demux/Demuxer';
import type { ByteSource } from '../../src/media/source/ByteSource';

// Node has no WebCodecs: a minimal stand-in that keeps what the tests inspect.
class FakeChunk {
  type: string;
  timestamp: number;
  duration: number;
  byteLength: number;
  constructor(init: { type: string; timestamp: number; duration: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.byteLength = init.data.byteLength;
  }
}
beforeAll(() => {
  Object.assign(globalThis, { EncodedVideoChunk: FakeChunk, EncodedAudioChunk: FakeChunk });
});

/** In-memory source that streams in small pieces and records every (re)open. */
function memorySource(bytes: Uint8Array, piece = 32 * 1024) {
  const opens: number[] = [];
  const source: ByteSource = {
    size: bytes.byteLength,
    name: 'memory.mp4',
    async open(offset) {
      opens.push(offset);
      let pos = offset;
      return new ReadableStream<Uint8Array>({
        pull(c) {
          if (pos >= bytes.byteLength) return c.close();
          c.enqueue(bytes.slice(pos, pos + piece));
          pos += piece;
        },
      }).getReader();
    },
  };
  return { source, opens };
}

function collectingSink() {
  const video: FakeChunk[] = [];
  const audio: FakeChunk[] = [];
  let ended!: () => void;
  const done = new Promise<void>((r) => (ended = r));
  const sink: DemuxSink = {
    onVideoChunk: (c) => video.push(c as unknown as FakeChunk),
    onAudioChunk: (c) => audio.push(c as unknown as FakeChunk),
    onEndOfStream: () => ended(),
    onError: (e) => {
      throw e;
    },
    demand: () => Promise.resolve(),
  };
  return { sink, video, audio, done };
}

const load = (name: string) => new Uint8Array(readFileSync(new URL(`../../public/samples/${name}`, import.meta.url)));

async function demuxAll(name: string) {
  const { source, opens } = memorySource(load(name));
  const out = collectingSink();
  const demuxer = new Mp4Demuxer(source, out.sink);
  const tracks = await demuxer.open();
  demuxer.start();
  await out.done;
  return { ...out, tracks, opens, demuxer };
}

describe('Mp4Demuxer', () => {
  it('demuxes a fast-start VP9/Opus file completely, starting on a keyframe', async () => {
    const { tracks, video, audio } = await demuxAll('sample-vp9-opus.mp4');
    expect(tracks.video?.codec).toMatch(/^vp09/);
    expect(tracks.audio?.codec).toBe('opus');
    expect(tracks.duration).toBeCloseTo(12, 1);
    expect(video).toHaveLength(360);
    expect(video[0].type).toBe('key');
    expect(audio.length).toBeGreaterThan(500);
  });

  it('jumps to a trailing moov with a range reopen instead of reading linearly', async () => {
    const { tracks, video, opens } = await demuxAll('sample-h264-aac.mp4');
    expect(tracks.video?.codec).toMatch(/^avc1/);
    expect(tracks.video?.description).toBeInstanceOf(Uint8Array); // avcC
    expect(tracks.audio?.description).toBeInstanceOf(Uint8Array); // AudioSpecificConfig
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(video).toHaveLength(360);
  });

  it('applies edit lists: B-frame delay and AAC priming are removed', async () => {
    const { video, audio } = await demuxAll('sample-h264-aac.mp4');
    const firstVideoPts = Math.min(...video.map((c) => c.timestamp));
    expect(firstVideoPts).toBeCloseTo(0, 0); // was +66.7ms without the edit list
    expect(audio[0].timestamp).toBeCloseTo(-21333, -1); // 1024 priming samples @48k, dropped by the decoder
  });

  it('seeks to the preceding keyframe and resumes streaming from there', async () => {
    const { source } = memorySource(load('sample-vp9-opus.mp4'));
    const out = collectingSink();
    const demuxer = new Mp4Demuxer(source, out.sink);
    await demuxer.open();
    demuxer.start();
    await out.done;

    out.video.length = 0;
    const actual = demuxer.seek(6.5);
    await new Promise((r) => setTimeout(r, 50));
    expect(actual).toBeLessThanOrEqual(6.5);
    expect(out.video[0].type).toBe('key');
    expect(out.video[0].timestamp / 1e6).toBeCloseTo(actual, 1);
    expect(out.video.at(-1)!.timestamp / 1e6).toBeGreaterThan(11.5);
  });
});

describe('editListOffset', () => {
  it('maps sample entries to WebCodecs strings', () => {
    expect(webCodecsCodec('Opus')).toBe('opus');
    expect(webCodecsCodec('vp08.00.10.08')).toBe('vp8');
    expect(webCodecsCodec('mp4a.6B')).toBe('mp3');
    expect(webCodecsCodec('avc1.64001f')).toBe('avc1.64001f');
  });

  it('handles empty edits, media_time trims and missing lists', () => {
    const e = (segment_duration: number, media_time: number) => ({ segment_duration, media_time, media_rate_integer: 1, media_rate_fraction: 0 });
    expect(editListOffset({ timescale: 15360, edits: undefined }, 1000)).toBe(0);
    expect(editListOffset({ timescale: 15360, edits: [e(12000, 1024)] }, 1000)).toBeCloseTo(-1024 / 15360);
    expect(editListOffset({ timescale: 48000, edits: [e(500, -1), e(12000, 0)] }, 1000)).toBeCloseTo(0.5);
  });
});
