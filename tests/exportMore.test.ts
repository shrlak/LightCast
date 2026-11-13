import { describe, expect, it } from 'vitest';
import { encodeGif, lzwEncode } from '../src/domain/gifEncoder';
import { buildOutline, outlineToRtf, outlineToText, rtfEscape } from '../src/domain/outlineExport';
import { gifDelayCs, pickVideoType, slideDurations } from '../src/domain/videoExport';
import type { Presentation, Slide } from '../src/domain/types';

/** Reference LZW decoder, to check the encoder round-trips. */
function lzwDecode(data: Uint8Array, minCode: number): number[] {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, dict: number[][] = [], out: number[] = [], prev: number[] | null = null;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict.push([i]); dict.push([], []); size = minCode + 1; prev = null; };
  reset();
  let bits = 0, cur = 0, pos = 0;
  for (;;) {
    while (bits < size && pos < data.length) { cur |= data[pos++] << bits; bits += 8; }
    if (bits < size) break;
    const code = cur & ((1 << size) - 1); cur >>>= size; bits -= size;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else entry = [...prev!, prev![0]];
    out = out.concat(entry);
    if (prev) { dict.push([...prev, entry[0]]); if (dict.length === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  return out;
}

const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
};

describe('GIF encoder', () => {
  it('writes a GIF89a header, one frame per image with its delay, and a trailer', () => {
    const a = rgba(8, 6, () => [255, 0, 0]), b = rgba(8, 6, (x) => (x < 4 ? [0, 255, 0] : [0, 0, 255]));
    const gif = encodeGif([{ data: a, delayCs: 200 }, { data: b, delayCs: 50 }], { width: 8, height: 6 });
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
    expect(gif[6] | (gif[7] << 8)).toBe(8);
    expect(gif[8] | (gif[9] << 8)).toBe(6);
    expect(gif[gif.length - 1]).toBe(0x3b);
    const text = String.fromCharCode(...gif);
    expect(text).toContain('NETSCAPE2.0');
    // image descriptors (0x2C) and graphic-control delays
    const descriptors: number[] = [], delays: number[] = [];
    for (let i = 0; i < gif.length - 8; i++) {
      if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) delays.push(gif[i + 4] | (gif[i + 5] << 8));
      if (gif[i] === 0x2c && gif[i + 5] === 8 && gif[i + 7] === 6) descriptors.push(i);
    }
    expect(delays).toEqual([200, 50]);
    expect(descriptors.length).toBe(2);
  });

  it('rejects empty input and mismatched frames', () => {
    expect(() => encodeGif([], { width: 2, height: 2 })).toThrow();
    expect(() => encodeGif([{ data: new Uint8Array(4), delayCs: 10 }], { width: 2, height: 2 })).toThrow();
  });

  it('LZW round-trips, including past the 4096-code table limit', () => {
    let seed = 7;
    const noisy = Uint8Array.from({ length: 30000 }, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % 200; });
    expect(lzwDecode(lzwEncode(noisy, 8), 8)).toEqual(Array.from(noisy));
    const flat = new Uint8Array(5000).fill(3);
    expect(lzwDecode(lzwEncode(flat, 2), 2)).toEqual(Array.from(flat));
  });
});

const slide = (o: Partial<Slide>): Slide => ({ id: 's', text: '', ...o }) as Slide;
const deck = (slides: Slide[], extra: Partial<Presentation> = {}): Presentation => ({ id: 'p', title: '테스트', slides, ...extra }) as Presentation;

describe('RTF / text outline', () => {
  it('escapes Korean as \\uN? and control characters', () => {
    expect(rtfEscape('가')).toBe('\\u-21504?');
    expect(rtfEscape('한글 A')).toBe('\\u-10916?\\u-20992? A');
    expect(rtfEscape('a\\b{c}')).toBe('a\\\\b\\{c\\}');
    expect(rtfEscape('1\n2')).toBe('1\\line 2');
  });

  const p = deck([
    slide({ id: 'a', title: '환영', text: '첫째 줄\n둘째 줄', notes: '메모입니다' }),
    slide({ id: 'b', title: '숨김', text: 'x', disabled: true }),
    slide({ id: 'c', text: '', elements: [{ id: 'e', kind: 'text', text: '제목만', indent: 0 } as never, { id: 'f', kind: 'text', text: '깊은 줄', indent: 1 } as never] }),
  ]);

  it('builds titles and body levels, skipping hidden slides and notes unless asked', () => {
    const o = buildOutline(p, { notes: false, includeHidden: false });
    expect(o.map((s) => s.number)).toEqual([1, 3]);
    expect(o[0].lines.map((l) => l.text)).toEqual(['첫째 줄', '둘째 줄']);
    expect(o[1].title).toBe('제목만');
    expect(o[1].lines).toEqual([{ level: 2, text: '깊은 줄' }]);
    expect(buildOutline(p, { notes: true, includeHidden: true })[0].lines.at(-1)).toEqual({ level: 1, text: '메모입니다', note: true });
  });

  it('writes indented plain text and an RTF document', () => {
    const o = buildOutline(p, { notes: true, includeHidden: false });
    const txt = outlineToText(o);
    expect(txt).toContain('1. 환영\r\n    첫째 줄\r\n');
    expect(txt).toContain('        깊은 줄');
    expect(txt).toContain('[메모] 메모입니다');
    const rtf = outlineToRtf(o);
    expect(rtf.startsWith('{\\rtf1')).toBe(true);
    expect(rtf.endsWith('}')).toBe(true);
    expect(rtf).toContain(rtfEscape('1. 환영'));
    expect(rtf).toContain('\\li720');
    expect(/[^\x00-\x7f]/.test(rtf)).toBe(false);
  });
});

describe('video planning', () => {
  it('uses auto-advance, then recorded cues, then the default', () => {
    const slides = [slide({ id: 'a', autoAdvance: 8 }), slide({ id: 'b' }), slide({ id: 'c' })];
    const p = deck(slides, { timeline: { audioMediaId: null, cues: [{ t: 0, seq: 0 }, { t: 3, seq: 1 }, { t: 10, seq: 2 }] } });
    expect(slideDurations(p, slides, 5, true)).toEqual([8, 7, 5]);
    expect(slideDurations(p, slides, 4, false)).toEqual([4, 4, 4]);
  });
  it('picks MP4 when supported, else WebM, else nothing; GIF delay is in centiseconds', () => {
    expect(pickVideoType((m) => m.startsWith('video/mp4'))?.ext).toBe('mp4');
    expect(pickVideoType((m) => m.startsWith('video/webm'))?.ext).toBe('webm');
    expect(pickVideoType(() => false)).toBeNull();
    expect(gifDelayCs(2)).toBe(200);
    expect(gifDelayCs(0.001)).toBe(2);
  });
});
