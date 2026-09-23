import { describe, expect, it } from 'vitest';
import { isSubtitleFile, textChunk, textToAss, toAssScript } from '../../src/shared/subtitles';

describe('subtitle conversion', () => {
  it('converts SRT to a full ASS script with the default style', () => {
    const srt = '1\r\n00:00:01,500 --> 00:00:03,250\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,000\r\n{not a tag}\r\n';
    const ass = toAssScript(srt, 'ep01.srt');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('Dialogue: 0,0:00:01.50,0:00:03.25,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nworld');
    expect(ass).toContain('Dialogue: 0,0:01:02.00,0:01:04.00,Default,,0,0,0,,\\{not a tag}');
  });

  it('converts WebVTT cues (dot milliseconds, cue settings, voice spans)', () => {
    const vtt = 'WEBVTT\n\n00:05.000 --> 00:07.000 align:center\n<v Bob>Hi <b>there</b></v>\n';
    expect(toAssScript(vtt, 'a.vtt')).toContain('Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Hi {\\b1}there{\\b0}');
  });

  it('passes ASS through and builds Matroska text chunks', () => {
    const ass = '[Script Info]\nScriptType: v4.00+\n';
    expect(toAssScript(ass)).toBe(ass);
    expect(textChunk(7, '<font color="#ff8800">Warm</font>')).toBe('7,0,Default,,0,0,0,,{\\c&H0088ff&}Warm{\\r}');
    expect(textToAss('a\nb')).toBe('a\\Nb');
    expect(isSubtitleFile('Show - 01.ASS')).toBe(true);
    expect(isSubtitleFile('movie.mkv')).toBe(false);
  });
});
