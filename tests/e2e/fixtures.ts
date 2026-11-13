// Fixture files built on the fly (nothing binary is committed).
import { deflateSync } from 'node:zlib';
import PptxGenJS from 'pptxgenjs';
import { buildPpt } from '../fixtures/pptBuilder';
import { writeOdp } from '../../src/domain/io/odp';
import { saveNative } from '../../src/domain/io/lcastFile';
import type { Presentation, Slide } from '../../src/domain/types';

export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function makePptx(text = 'PPTX 안녕하세요'): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const s1 = pptx.addSlide();
  s1.addText(text, { x: 1, y: 1, w: 8, h: 1.5, fontSize: 32 });
  const s2 = pptx.addSlide();
  s2.addText('두 번째 슬라이드', { x: 1, y: 1, w: 8, h: 1.5, fontSize: 32 });
  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
}

export function makePpt(): Buffer {
  return Buffer.from(buildPpt({
    slides: [
      { shapes: [{ text: '레거시 PPT 제목', textType: 0, placeholder: 1, anchor: [576, 288, 5184, 1152] }] },
      { shapes: [{ text: 'Second legacy slide', textType: 4, ascii: true, anchor: [100, 100, 2000, 800] }] },
    ],
  }));
}

export const deck = (title: string, text: string): Pick<Presentation, 'title' | 'slides' | 'properties'> => ({
  title,
  properties: { title },
  slides: [
    { id: 's1', group: 'g', text: '', elements: [{ id: 'e1', kind: 'text', x: 144, y: 108, w: 1152, h: 216, text, fontSize: 60, color: '#006633' }] },
    { id: 's2', group: 'g', text: '둘째 쪽' },
  ] as Slide[],
});

export async function makeOdp(text = 'ODP 문서 본문'): Promise<Buffer> {
  return Buffer.from(await writeOdp(deck('ODP 시험', text), { loadMedia: () => null }));
}

export async function makeLcast(password: string, text = '비밀 본문'): Promise<Buffer> {
  const p = { id: 'p_secret', themeId: 'theme_classic', ...deck('비밀 설교', text) } as Presentation;
  return Buffer.from(await saveNative(p, [], password));
}

/** A solid-colour-by-pixel PNG (RGBA 8-bit), built with zlib. */
export function makePng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw.set(px(x, y), o); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const SVG =Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#c00"/><circle cx="60" cy="40" r="25" fill="#fff"/></svg>');

// ---- tiny metafiles (as built in tests/metafile.test.ts) ----
class B {
  a: number[] = [];
  u8(...v: number[]) { this.a.push(...v.map((x) => x & 255)); return this; }
  u16(...v: number[]) { for (const x of v) this.u8(x, x >> 8); return this; }
  u32(...v: number[]) { for (const x of v) this.u8(x, x >> 8, x >> 16, x >>> 24); return this; }
}
const RED = 0x0000ff;
const wmfRec = (fn: number, ...words: number[]) => new B().u32(3 + words.length).u16(fn).u16(...words.map((w) => w & 0xffff)).a;

export function makeWmf(): Buffer {
  const body = [
    wmfRec(0x020c, 100, 200), wmfRec(0x020b, 0, 0),
    wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0), wmfRec(0x012d, 0),
    wmfRec(0x041b, 60, 110, 10, 10), wmfRec(0x0324, 3, 20, 20, 90, 20, 55, 80),
  ].flat();
  const total = 9 + 3 + body.length / 2;
  const b = new B();
  b.u32(0x9ac6cdd7).u16(0).u16(0, 0, 200, 100).u16(100).u32(0).u16(0);
  b.u16(1, 9, 0x300).u32(total).u16(2).u32(10).u16(0);
  b.u8(...body);
  b.u32(3).u16(0);
  return Buffer.from(b.a);
}

const emfRec = (type: number, build: (b: B) => void) => { const b = new B(); b.u32(type, 0); build(b); while (b.a.length % 4) b.a.push(0); const a = b.a; a.splice(4, 4, ...new B().u32(a.length).a); return a; };
export function makeEmf(): Buffer {
  const h = new B();
  h.u32(1, 88).u32(0, 0, 200, 100).u32(0, 0, 5000, 2500).u32(0x464d4520, 0x10000, 0, 0).u16(1, 0).u32(0, 0, 0).u32(1000, 1000, 250, 250);
  const body = [emfRec(39, (b) => b.u32(1, 0, RED, 0)), emfRec(37, (b) => b.u32(1)), emfRec(43, (b) => b.u32(10, 10, 150, 90))].flat();
  const eof = emfRec(14, (b) => b.u32(0, 16, 20));
  const out = new Uint8Array([...h.a, ...body, ...eof]);
  new DataView(out.buffer).setUint32(48, out.length, true);
  return Buffer.from(out);
}
