/**
 * Build WebCodecs codec strings from codec configuration records.
 * MP4 gets these from mp4box; Matroska only carries the raw CodecPrivate.
 */

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** avcC -> `avc1.PPCCLL` */
export function avcCodecString(avcC: Uint8Array): string {
  if (avcC.length < 4) return 'avc1.42e01e';
  return `avc1.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`;
}

/** hvcC -> `hvc1.<space><profile>.<compat>.<tier><level>.<constraints>` (ISO 14496-15 Annex E). */
export function hevcCodecString(hvcC: Uint8Array): string {
  if (hvcC.length < 13) return 'hvc1.1.6.L93.B0';
  const b1 = hvcC[1];
  const space = ['', 'A', 'B', 'C'][b1 >> 6];
  const tier = (b1 >> 5) & 1 ? 'H' : 'L';
  const profile = b1 & 0x1f;
  // Compatibility flags are written bit-reversed, as hex without leading zeros.
  const compat = (hvcC[2] << 24) | (hvcC[3] << 16) | (hvcC[4] << 8) | hvcC[5];
  let reversed = 0;
  for (let i = 0; i < 32; i++) if (compat & (1 << i)) reversed |= 1 << (31 - i);
  const level = hvcC[12];
  // Six constraint bytes, trailing zero bytes omitted.
  const constraints = Array.from(hvcC.subarray(6, 12));
  while (constraints.length > 1 && constraints[constraints.length - 1] === 0) constraints.pop();
  return `hvc1.${space}${profile}.${(reversed >>> 0).toString(16)}.${tier}${level}.${constraints.map((c) => c.toString(16).toUpperCase()).join('.')}`;
}

/** av1C -> `av01.P.LLT.DD` */
export function av1CodecString(av1C: Uint8Array): string {
  if (av1C.length < 3) return 'av01.0.08M.08';
  const profile = av1C[1] >> 5;
  const level = av1C[1] & 0x1f;
  const tier = av1C[2] >> 7 ? 'H' : 'M';
  const highBitDepth = (av1C[2] >> 6) & 1;
  const twelveBit = (av1C[2] >> 5) & 1;
  const depth = highBitDepth ? (twelveBit ? 12 : 10) : 8;
  return `av01.${profile}.${level.toString().padStart(2, '0')}${tier}.${depth.toString().padStart(2, '0')}`;
}

/** AudioSpecificConfig -> `mp4a.40.<audioObjectType>` */
export function aacCodecString(asc: Uint8Array | undefined): string {
  if (!asc || asc.length < 1) return 'mp4a.40.2';
  let aot = asc[0] >> 3;
  if (aot === 31 && asc.length >= 2) aot = 32 + (((asc[0] & 0x07) << 3) | (asc[1] >> 5));
  return `mp4a.40.${aot}`;
}

/**
 * VP9 codec string from the first keyframe's uncompressed header: profile and
 * bit depth matter for decoder selection (10-bit needs a different path).
 * Level is not signalled in the bitstream; 5.1 covers up to 4K60.
 */
export function vp9CodecString(keyframe: Uint8Array | undefined): string {
  if (!keyframe || keyframe.length < 2) return 'vp09.00.51.08';
  const b = keyframe[0];
  // frame_marker(2) profile_low_bit(1) profile_high_bit(1)
  const profile = ((b >> 5) & 1) | (((b >> 4) & 1) << 1);
  let depth = 8;
  if (profile >= 2) {
    // [reserved_zero if profile 3] show_existing_frame frame_type show_frame
    // error_resilient_mode, 24-bit sync code, then ten_or_twelve_bit.
    const bitPos = (profile === 3 ? 5 : 4) + 4 + 24;
    const bit = ((keyframe[bitPos >> 3] ?? 0) >> (7 - (bitPos & 7))) & 1;
    depth = bit ? 12 : 10;
  }
  return `vp09.${hex2(profile)}.51.${depth.toString().padStart(2, '0')}`;
}
