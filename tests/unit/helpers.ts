import { readFileSync } from 'node:fs';
import type { DemuxSink } from '../../src/media/demux/Demuxer';
import type { ByteSource } from '../../src/media/source/ByteSource';

/** Node has no WebCodecs: a minimal stand-in that keeps what the tests inspect. */
export class FakeChunk {
  type: string;
  timestamp: number;
  duration?: number;
  data: Uint8Array;
  constructor(init: { type: string; timestamp: number; duration?: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.data = init.data.slice();
  }
}

export function installFakeWebCodecs(): void {
  Object.assign(globalThis, { EncodedVideoChunk: FakeChunk, EncodedAudioChunk: FakeChunk });
}

/** In-memory source that streams in small pieces and records every (re)open. */
export function memorySource(bytes: Uint8Array, piece = 32 * 1024) {
  const opens: number[] = [];
  const source: ByteSource = {
    size: bytes.byteLength,
    name: 'memory',
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

export function collectingSink() {
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

export function loadFile(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../${path}`, import.meta.url)));
}
