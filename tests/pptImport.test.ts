import { describe, expect, it } from 'vitest';
import { readCfb } from '../src/domain/io/cfb';
import { parsePpt } from '../src/domain/io/pptBinary';
import { importPpt } from '../src/domain/io/pptImport';
import { buildCfb, buildPpt, rec } from './fixtures/pptBuilder';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9];

const sample = () => buildPpt({
  staleSlide: '낡은 제목',
  pictures: [{ type: 'jpeg', bytes: JPEG }, { type: 'png', bytes: PNG }],
  slides: [
    {
      notes: '발표 메모입니다',
      shapes: [
        { text: '주일 예배', textType: 0, placeholder: 1, anchor: [576, 288, 5184, 1152] },
        { text: '첫째 줄\r둘째 줄\u000b셋째 줄', textType: 1, placeholder: 2, anchor: [576, 1440, 5184, 3600] },
        { picture: 1, anchor: [4000, 3600, 5600, 4200] },
      ],
    },
    { shapes: [{ text: 'Plain box', textType: 4, ascii: true, anchor: [100, 100, 2000, 800] }, { picture: 2, anchor: [0, 0, 100, 100] }, { picture: 7, anchor: [0, 0, 100, 100] }] },
  ],
});

describe('compound file reader', () => {
  it('reads small (mini stream) and large streams by name', () => {
    const big = new Uint8Array(9000).map((_, i) => i % 251);
    const small = new Uint8Array([1, 2, 3, 4, 5]);
    const cfb = readCfb(buildCfb([{ name: 'Big', data: big }, { name: 'Small', data: small }]))!;
    expect(cfb.stream('big')).toEqual(big);
    expect(cfb.stream('Small')).toEqual(small);
    expect(cfb.stream('missing')).toBeNull();
  });

  it('refuses what is not a compound file', () => {
    expect(readCfb(new Uint8Array(10))).toBeNull();
    expect(readCfb(new TextEncoder().encode('PK\u0003\u0004 not an ole file'.repeat(50)))).toBeNull();
  });

  it('survives a FAT loop and an out-of-range directory start', () => {
    const f = buildCfb([{ name: 'A', data: new Uint8Array(9000) }]);
    const dv = new DataView(f.buffer);
    dv.setUint32(0x30, 0x7ffffff0, true);
    expect(() => readCfb(f)).not.toThrow();
    const g = buildCfb([{ name: 'A', data: new Uint8Array(9000) }]);
    // FAT entry of the stream's first sector points back at itself.
    const dvg = new DataView(g.buffer);
    for (let i = 0; i < 128; i++) dvg.setUint32(512 + i * 4, 3, true);
    expect(readCfb(g)?.stream('A') ?? null).toSatisfy((x: Uint8Array | null) => x === null || x.length <= 9000);
  });
});

describe('legacy .ppt reader', () => {
  it('reads slide text, placeholders, geometry and notes in slide order, ignoring stale copies', () => {
    const doc = parsePpt(sample());
    expect(doc.slides).toHaveLength(2);
    const texts = doc.slides.flatMap((s) => s.shapes.map((x) => x.text));
    expect(texts).not.toContain('낡은 제목');
    const [a, b] = doc.slides;
    expect(a.shapes[0]).toMatchObject({ kind: 'text', text: '주일 예배', textType: 0, placeholder: 1, x: 576, y: 288, w: 4608, h: 864 });
    expect(a.shapes[1].text).toBe('첫째 줄\n둘째 줄\n셋째 줄');
    expect(a.notes).toBe('발표 메모입니다');
    expect(b.shapes[0].text).toBe('Plain box');
    expect(b.notes).toBeUndefined();
  });

  it('finds the pictures in the Pictures stream', () => {
    const doc = parsePpt(sample());
    expect(doc.pictures).toHaveLength(2);
    expect(doc.pictures[0]).toMatchObject({ mime: 'image/jpeg' });
    expect(Array.from(doc.pictures[0]!.bytes)).toEqual(JPEG);
    expect(doc.pictures[1]).toMatchObject({ mime: 'image/png' });
    expect(doc.slides[0].shapes[2]).toMatchObject({ kind: 'picture', picture: 1 });
    // An index past the picture list is kept as "unreadable picture" rather than throwing.
    expect(doc.slides[1].shapes[2]).toMatchObject({ kind: 'picture', picture: 0 });
  });

  it('falls back to reading the stream in order without a Current User stream', () => {
    const doc = parsePpt(buildPpt({ noCurrentUser: true, slides: [{ shapes: [{ text: 'A', textType: 0, placeholder: 1 }] }, { shapes: [{ text: 'B', textType: 4 }] }] }));
    expect(doc.slides.map((s) => s.shapes[0]?.text)).toEqual(['A', 'B']);
    expect(doc.warnings.length).toBe(0);
  });

  it('says so for an encrypted file', () => {
    const doc = parsePpt(buildPpt({ encrypted: true, slides: [{ shapes: [{ text: 'secret', textType: 0 }] }] }));
    expect(doc.slides).toHaveLength(0);
    expect(doc.warnings[0]).toContain('암호');
  });

  it('reads a document stream big enough for regular sectors', () => {
    const long = '가'.repeat(4000);
    const doc = parsePpt(buildPpt({ slides: [{ shapes: [{ text: long, textType: 1, placeholder: 2 }] }] }));
    expect(doc.slides[0].shapes[0].text).toBe(long);
  });

  it('never throws on garbage, truncation, bit flips or hostile record sizes', () => {
    const good = sample();
    expect(parsePpt(new Uint8Array(0)).slides).toEqual([]);
    expect(parsePpt(new Uint8Array(5000).fill(0xff)).slides).toEqual([]);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let cut = 0; cut < good.length; cut += 211) expect(() => parsePpt(good.subarray(0, cut))).not.toThrow();
    for (let n = 0; n < 150; n++) {
      const bad = good.slice();
      for (let k = 0; k < 20; k++) bad[512 + (rnd() % (bad.length - 512))] = rnd() & 0xff;
      const doc = parsePpt(bad);
      expect(Array.isArray(doc.slides)).toBe(true);
    }
  });

  it('caps recursion: a deeply nested container does not blow the stack', () => {
    let nested = rec(0, 0, 0x0fa0, [65, 0]);
    for (let i = 0; i < 20000; i++) nested = rec(0xf, 0, 0xf003, nested);
    const doc = parsePpt(buildPpt({ slides: [{ shapes: [] }] }));
    expect(doc.slides).toHaveLength(1);
    const hostile = buildCfb([{ name: 'PowerPoint Document', data: rec(0xf, 0, 0x03e8, nested) }]);
    expect(() => parsePpt(hostile)).not.toThrow();
  });
});

describe('.ppt → LightCast slides', () => {
  it('lays text and pictures out on the 4:3 canvas with notes and the import source', async () => {
    let n = 0;
    const stored: string[] = [];
    const r = await importPpt(sample(), '설교.ppt', {
      group: '설교',
      newId: (p) => `${p}${++n}`,
      store: async (pic, name) => { stored.push(`${pic.mime}:${name}`); return `m${stored.length}`; },
    });
    expect(r.slides).toHaveLength(2);
    const [s1, s2] = r.slides;
    expect(s1.importSource).toEqual({ format: 'ppt', name: '설교.ppt', page: 1 });
    expect(s1.notes).toBe('발표 메모입니다');
    const title = s1.elements!.find((e) => e.text === '주일 예배')!;
    // 576 / 5760 of a 1440 px canvas.
    expect(title).toMatchObject({ kind: 'text', x: 144, y: 72, w: 1152, h: 216, bold: true, align: 'center' });
    const pic = s1.elements!.find((e) => e.kind === 'image')!;
    expect(pic.mediaId).toBe('m1');
    expect(s2.elements!.some((e) => e.kind === 'image' && e.mediaId === 'm2')).toBe(true);
    // The unreadable picture index leaves no empty image object.
    expect(s2.elements!.filter((e) => e.kind === 'image')).toHaveLength(1);
    expect(stored).toHaveLength(2);
  });

  it('gives a warning and no slides for a file it cannot read', async () => {
    const r = await importPpt(new Uint8Array([1, 2, 3]), 'x.ppt', { group: 'g', newId: (p) => p, store: async () => null });
    expect(r.slides).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
