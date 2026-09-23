/**
 * Minimal EBML (Matroska / WebM) primitives.
 *
 * Element IDs are kept in their raw encoded form (marker bits included),
 * which is how the Matroska spec lists them. Sizes have the marker stripped;
 * an all-ones size means "unknown" (live WebM streams, unfinished files).
 */

export const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  FlagEnabled: 0xb9,
  FlagDefault: 0x88,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  DefaultDuration: 0x23e383,
  Language: 0x22b59c,
  Name: 0x536e,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  DisplayWidth: 0x54b0,
  DisplayHeight: 0x54ba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  OutputSamplingFrequency: 0x78b5,
  Channels: 0x9f,
  ContentEncodings: 0x6d80,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  ReferenceBlock: 0xfb,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Attachments: 0x1941a469,
  Void: 0xec,
  CRC32: 0xbf,
} as const;

/** Level-1 children of Segment: seeing one of these ends an unknown-size Cluster. */
export const TOP_LEVEL = new Set<number>([
  ID.SeekHead,
  ID.Info,
  ID.Tracks,
  ID.Cues,
  ID.Cluster,
  ID.Chapters,
  ID.Tags,
  ID.Attachments,
]);

export const UNKNOWN_SIZE = -1;

export interface ElementHeader {
  id: number;
  /** Payload size in bytes, or UNKNOWN_SIZE. */
  size: number;
  /** Header length (ID + size field). */
  headerLength: number;
}

/**
 * Parse an element header at `pos`. Returns null if more bytes are needed.
 * Throws on bytes that can't be EBML (lets the caller resync).
 */
export function readHeader(buf: Uint8Array, pos: number): ElementHeader | null {
  if (pos >= buf.length) return null;
  const idLen = vintLength(buf[pos]);
  if (idLen > 4) throw new Error('Invalid EBML ID');
  if (pos + idLen >= buf.length) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[pos + i];

  const sizePos = pos + idLen;
  const sizeLen = vintLength(buf[sizePos]);
  if (sizeLen > 8) throw new Error('Invalid EBML size');
  if (sizePos + sizeLen > buf.length) return null;
  let size = buf[sizePos] & (0xff >> sizeLen);
  let allOnes = size === 0xff >> sizeLen;
  for (let i = 1; i < sizeLen; i++) {
    const b = buf[sizePos + i];
    if (b !== 0xff) allOnes = false;
    size = size * 256 + b;
  }
  return { id, size: allOnes ? UNKNOWN_SIZE : size, headerLength: idLen + sizeLen };
}

/** Length of a variable-size integer from its first byte (1..8, 9 = invalid). */
export function vintLength(first: number): number {
  if (first === 0) return 9;
  return Math.clz32(first) - 23;
}

/** Read an EBML vint *value* (marker stripped), used inside Block headers and lacing. */
export function readVint(buf: Uint8Array, pos: number): { value: number; length: number } {
  const length = vintLength(buf[pos]);
  let value = buf[pos] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + buf[pos + i];
  return { value, length };
}

export function readUint(buf: Uint8Array, pos: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + buf[pos + i];
  return v;
}

export function readFloat(buf: Uint8Array, pos: number, size: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + pos, size);
  return size === 4 ? view.getFloat32(0) : size === 8 ? view.getFloat64(0) : 0;
}

export function readString(buf: Uint8Array, pos: number, size: number): string {
  let end = pos + size;
  while (end > pos && buf[end - 1] === 0) end--; // strings may be zero-padded
  return new TextDecoder().decode(buf.subarray(pos, end));
}

/** A fully buffered element: iterate its children. */
export function* children(buf: Uint8Array, start = 0, end = buf.length): Generator<ElementHeader & { offset: number; data: number }> {
  let pos = start;
  while (pos < end) {
    const h = readHeader(buf, pos);
    if (!h) return;
    const data = pos + h.headerLength;
    const size = h.size === UNKNOWN_SIZE ? end - data : h.size;
    yield { ...h, size, offset: pos, data };
    pos = data + size;
  }
}
