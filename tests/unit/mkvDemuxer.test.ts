import { beforeAll, describe, expect, it } from 'vitest';
import { MkvDemuxer, splitLaces } from '../../src/media/demux/MkvDemuxer';
import { aacCodecString, av1CodecString, avcCodecString, hevcCodecString, vp9CodecString } from '../../src/media/demux/codecStrings';
import { collectingSink, installFakeWebCodecs, loadFile, memorySource } from './helpers';

beforeAll(installFakeWebCodecs);

async function demuxAll(path: string, piece?: number) {
  const { source, opens } = memorySource(loadFile(path), piece);
  const out = collectingSink();
  const demuxer = new MkvDemuxer(source, out.sink);
  const tracks = await demuxer.open();
  demuxer.start();
  await out.done;
  return { ...out, tracks, opens, demuxer };
}

describe('MkvDemuxer', () => {
  it('demuxes VP9/Opus Matroska with codec strings, keyframes and Opus pre-skip', async () => {
    const { tracks, video, audio } = await demuxAll('public/samples/sample-vp9-opus.mkv');
    expect(tracks.video?.codec).toBe('vp09.00.51.08');
    expect(tracks.video?.codedWidth).toBe(1024);
    expect(tracks.audio?.codec).toBe('opus');
    expect(tracks.audio?.description).toBeInstanceOf(Uint8Array); // OpusHead
    expect(tracks.duration).toBeCloseTo(12, 1);
    expect(video).toHaveLength(360);
    expect(video[0].type).toBe('key');
    expect(audio[0].timestamp).toBeLessThan(0); // CodecDelay applied: pre-skip samples land before 0
  });

  it('builds H.264/AAC configs from CodecPrivate', async () => {
    const { tracks, video, audio } = await demuxAll('tests/fixtures/h264-aac.mkv');
    expect(tracks.video?.codec).toBe('avc1.64001f');
    expect(tracks.video?.description).toBeInstanceOf(Uint8Array);
    expect(tracks.audio?.codec).toBe('mp4a.40.2');
    expect(video).toHaveLength(360);
    expect(audio.length).toBeGreaterThan(500);
  });

  it('parses AV1 configuration', async () => {
    const { tracks, video } = await demuxAll('tests/fixtures/av1-opus.mkv');
    expect(tracks.video?.codec).toMatch(/^av01\.0\.\d\dM\.08$/);
    expect(video).toHaveLength(96);
  });

  it('handles live WebM with unknown-size segment and clusters', async () => {
    const { video, audio } = await demuxAll('tests/fixtures/live.webm');
    expect(video).toHaveLength(360);
    expect(audio.length).toBeGreaterThan(500);
  });

  it('gives identical output when bytes arrive in tiny pieces', async () => {
    const big = await demuxAll('public/samples/sample-vp9-opus.mkv');
    const tiny = await demuxAll('public/samples/sample-vp9-opus.mkv', 7);
    expect(tiny.video.map((c) => c.timestamp)).toEqual(big.video.map((c) => c.timestamp));
    expect(tiny.audio.length).toBe(big.audio.length);
    expect(tiny.video[100].data).toEqual(big.video[100].data);
  });

  it('seeks through Cues to the preceding keyframe', async () => {
    const { source } = memorySource(loadFile('public/samples/sample-vp9-opus.mkv'));
    const out = collectingSink();
    const demuxer = new MkvDemuxer(source, out.sink);
    await demuxer.open();
    demuxer.start();
    await out.done;
    out.video.length = 0;

    const actual = demuxer.seek(6.5);
    expect(actual).toBeGreaterThan(0); // came from the index, not a restart
    expect(actual).toBeLessThanOrEqual(6.5);
    await new Promise((r) => setTimeout(r, 50));
    expect(out.video[0].type).toBe('key');
    expect(out.video[0].timestamp / 1e6).toBeCloseTo(actual, 1);
    expect(out.video.at(-1)!.timestamp / 1e6).toBeGreaterThan(11.5);
  });
});

describe('splitLaces', () => {
  const frame = (n: number, fill: number) => new Uint8Array(n).fill(fill);
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) out.set(p, (o += p.length) - p.length);
    return out;
  };

  it('splits Xiph lacing (sizes >= 255 use continuation bytes)', () => {
    const block = concat(Uint8Array.of(2, 255, 45, 10), frame(300, 1), frame(10, 2), frame(5, 3));
    expect(splitLaces(block, 0, 1).map((f) => f.length)).toEqual([300, 10, 5]);
  });

  it('splits EBML lacing with signed size deltas', () => {
    // sizes 100, 90 (delta -10 as 1-byte signed vint: 63-10=53 | 0x80), last 7
    const block = concat(Uint8Array.of(2, 0x80 | 100, 0x80 | 53), frame(100, 1), frame(90, 2), frame(7, 3));
    expect(splitLaces(block, 0, 3).map((f) => f.length)).toEqual([100, 90, 7]);
  });

  it('splits fixed-size lacing', () => {
    const block = concat(Uint8Array.of(3), frame(40, 1));
    expect(splitLaces(block, 0, 2).map((f) => f.length)).toEqual([10, 10, 10, 10]);
  });
});

describe('codec strings', () => {
  it('derives registry strings from configuration records', () => {
    expect(avcCodecString(Uint8Array.of(1, 0x64, 0x00, 0x1f))).toBe('avc1.64001f');
    const hvcC = new Uint8Array(23);
    hvcC.set([1, 0x01, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 93]);
    expect(hevcCodecString(hvcC)).toBe('hvc1.1.6.L93.B0');
    expect(av1CodecString(Uint8Array.of(0x81, 0x08, 0x0c, 0))).toBe('av01.0.08M.08');
    expect(av1CodecString(Uint8Array.of(0x81, 0x0d, 0xcc, 0))).toBe('av01.0.13H.10');
    expect(aacCodecString(Uint8Array.of(0x12, 0x10))).toBe('mp4a.40.2');
    expect(aacCodecString(Uint8Array.of(0x2b, 0x92))).toBe('mp4a.40.5');
    // VP9 profile 2, 10-bit keyframe header
    expect(vp9CodecString(Uint8Array.of(0x92, 0x49, 0x83, 0x42, 0x00))).toBe('vp09.02.51.10');
  });
});

describe('MkvDemuxer pre-start buffering', () => {
  it('keeps frames parsed before start() intact while the buffer is reused', async () => {
    const bytes = loadFile('public/samples/sample-vp9-opus.mkv');
    const reference = await demuxAll('public/samples/sample-vp9-opus.mkv');
    const { source } = memorySource(bytes, 3000);
    const out = collectingSink();
    const demuxer = new MkvDemuxer(source, out.sink);
    await demuxer.open();
    await new Promise((r) => setTimeout(r, 20)); // let the pump buffer more before starting
    demuxer.start();
    await out.done;
    expect(out.video[0].data).toEqual(reference.video[0].data);
    expect(out.video).toHaveLength(360);
  });
});

describe('MkvDemuxer keyframe index', () => {
  it('exposes Cues as keyframes and reads one from its cluster', async () => {
    const { demuxer, video } = await demuxAll('public/samples/sample-vp9-opus.mkv');
    await new Promise((r) => setTimeout(r, 20)); // background Cues fetch
    const times = demuxer.keyframeTimes();
    expect(times.length).toBeGreaterThan(3);
    const i = times.findIndex((t) => t > 5);
    const chunk = (await demuxer.readKeyframe(i)) as unknown as { type: string; timestamp: number; data: Uint8Array };
    const same = video.find((c) => Math.abs(c.timestamp - chunk.timestamp) < 1)!;
    expect(chunk.type).toBe('key');
    expect(same.type).toBe('key');
    expect(chunk.data).toEqual(same.data);
  });
});
