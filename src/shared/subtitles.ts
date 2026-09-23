/**
 * Subtitle helpers shared by the media worker (MKV text tracks) and the UI
 * (external .ass/.ssa/.srt/.vtt files). Everything ends up as ASS for libass.
 */

/** ASS header used for SRT/WebVTT (text-only) subtitles: clean, readable defaults. */
export const TEXT_SUBTITLE_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Liberation Sans,68,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3.6,1.8,2,120,120,64,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

/** SRT/WebVTT cue text -> ASS override-tag text. */
export function textToAss(text: string): string {
  return text
    .replace(/\r/g, '')
    .trim()
    .replace(/\{/g, '\\{') // literal braces must not start override blocks
    .replace(/<\s*i\s*>/gi, '{\\i1}')
    .replace(/<\s*\/\s*i\s*>/gi, '{\\i0}')
    .replace(/<\s*b\s*>/gi, '{\\b1}')
    .replace(/<\s*\/\s*b\s*>/gi, '{\\b0}')
    .replace(/<\s*u\s*>/gi, '{\\u1}')
    .replace(/<\s*\/\s*u\s*>/gi, '{\\u0}')
    .replace(/<font\s+color\s*=\s*["']?#?([0-9a-f]{6})["']?\s*>/gi, (_, hex: string) => `{\\c&H${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&}`)
    .replace(/<\s*\/\s*font\s*>/gi, '{\\r}')
    .replace(/<[^>]+>/g, '') // drop other tags (WebVTT voice/class spans)
    .replace(/\n/g, '\\N');
}

/** Matroska ASS block payload: "ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text". */
export function textChunk(readOrder: number, text: string): string {
  return `${readOrder},0,Default,,0,0,0,,${textToAss(text)}`;
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Parse "00:01:02,345" / "01:02.345" style timestamps. */
function parseTimestamp(ts: string): number {
  const parts = ts.trim().replace(',', '.').split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

/**
 * Convert an external subtitle file to a full ASS script.
 * ASS/SSA pass through untouched; SRT and WebVTT get the default style.
 */
export function toAssScript(content: string, fileName = ''): string {
  const text = content.replace(/^﻿/, '');
  if (/^\s*\[Script Info\]/i.test(text) || /\.(ass|ssa)$/i.test(fileName)) return text;

  const lines: string[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const rows = block.split('\n');
    const timing = rows.findIndex((r) => r.includes('-->'));
    if (timing < 0) continue;
    const [start, end] = rows[timing].split('-->').map((s) => parseTimestamp(s.trim().split(/\s+/)[0]));
    const body = rows.slice(timing + 1).join('\n');
    if (!body.trim() || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${textToAss(body)}`);
  }
  return TEXT_SUBTITLE_HEADER + lines.join('\n') + '\n';
}

export function isSubtitleFile(name: string): boolean {
  return /\.(ass|ssa|srt|vtt)$/i.test(name);
}
