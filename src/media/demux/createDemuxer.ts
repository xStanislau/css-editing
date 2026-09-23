import type { ByteSource } from '../source/ByteSource';
import type { Demuxer, DemuxSink } from './Demuxer';
import { Mp4Demuxer } from './Mp4Demuxer';
import { MkvDemuxer } from './MkvDemuxer';

/** Pick a demuxer by sniffing the first bytes (EBML magic → Matroska/WebM, else MP4). */
export async function createDemuxer(source: ByteSource, sink: DemuxSink): Promise<Demuxer> {
  const ac = new AbortController();
  let head: Uint8Array = new Uint8Array(0);
  try {
    const reader = await source.open(0, ac.signal);
    const { value } = await reader.read();
    head = value ?? head;
    reader.cancel().catch(() => {});
  } finally {
    ac.abort();
  }
  const isEbml = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  return isEbml ? new MkvDemuxer(source, sink) : new Mp4Demuxer(source, sink);
}
