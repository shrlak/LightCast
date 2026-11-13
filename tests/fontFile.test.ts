import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { parseFontFile, weightFromClass, styleFromName, extractFace, cssWeightDescriptor, embeddingForbidden } from '../src/domain/fontFile';

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const tagBytes = (t: string) => [...t].map((c) => c.charCodeAt(0));

/** name table with Windows (platform 3) UTF-16BE records. */
function nameTable(rec: Record<number, string>): Uint8Array {
  const ids = Object.keys(rec).map(Number);
  const strings = ids.map((id) => { const b: number[] = []; for (const ch of rec[id]) b.push(...u16(ch.charCodeAt(0))); return b; });
  const head = [...u16(0), ...u16(ids.length), ...u16(6 + ids.length * 12)];
  let off = 0;
  const recs: number[] = [];
  ids.forEach((id, i) => { recs.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(strings[i].length), ...u16(off)); off += strings[i].length; });
  return Uint8Array.from([...head, ...recs, ...strings.flat()]);
}
function os2(weight: number, fsType: number, fsSelection: number): Uint8Array {
  const b = new Uint8Array(78);
  b.set(u16(4), 0); b.set(u16(weight), 4); b.set(u16(fsType), 8); b.set(u16(fsSelection), 62);
  return b;
}
function fvar(min: number, max: number): Uint8Array {
  const b = new Uint8Array(16 + 20);
  b.set(u16(1), 0); b.set(u16(0), 2); b.set(u16(16), 4); b.set(u16(2), 6); b.set(u16(1), 8); b.set(u16(20), 10);
  b.set(tagBytes('wght'), 16);
  b.set(u32(min * 65536), 20); b.set(u32(400 * 65536), 24); b.set(u32(max * 65536), 28);
  return b;
}
const pad4 = (n: number) => (n + 3) & ~3;
/** An sfnt with the given tables. */
function sfnt(tables: Record<string, Uint8Array>, tag = '\u0000\u0001\u0000\u0000'): Uint8Array {
  const tags = Object.keys(tables).sort();
  let off = 12 + tags.length * 16;
  const dir: number[] = [];
  const body: number[] = [];
  for (const t of tags) {
    dir.push(...tagBytes(t), ...u32(0), ...u32(off), ...u32(tables[t].length));
    const padded = [...tables[t], ...new Array(pad4(tables[t].length) - tables[t].length).fill(0)];
    body.push(...padded); off += padded.length;
  }
  return Uint8Array.from([...tagBytes(tag), ...u16(tags.length), ...u16(0), ...u16(0), ...u16(0), ...dir, ...body]);
}
const font = (names: Record<number, string>, weight = 400, fsSelection = 0, fsType = 0) => sfnt({ name: nameTable(names), 'OS/2': os2(weight, fsType, fsSelection) });

describe('font file parsing', () => {
  it('reads family, subfamily, weight, italic and fsType of a TrueType font', async () => {
    const r = await parseFontFile(font({ 1: 'Noto Sans KR Light', 2: 'Regular', 16: 'Noto Sans KR', 17: 'Light', 4: 'Noto Sans KR Light' }, 300, 0, 0x0004), 'x.ttf');
    expect(r.error).toBeUndefined();
    const f = r.faces[0];
    expect(f.family).toBe('Noto Sans KR'); // the typographic family groups the weights
    expect(f.subfamily).toBe('Light');
    expect(f.weight).toBe(300);
    expect(f.italic).toBe(false);
    expect(f.fsType).toBe(4);
    expect(f.format).toBe('truetype');
  });
  it('reads the italic flag from fsSelection and uses the family of the name table when there is no typographic one', async () => {
    const f = (await parseFontFile(font({ 1: 'My Face', 2: 'Bold Italic' }, 700, 1), 'a.otf')).faces[0];
    expect(f.family).toBe('My Face');
    expect(f.weight).toBe(700);
    expect(f.italic).toBe(true);
  });
  it('detects OpenType (OTTO) and the weight range of a variable font', async () => {
    const data = sfnt({ name: nameTable({ 1: 'Var Font' }), 'OS/2': os2(400, 0, 0), fvar: fvar(100, 900) }, 'OTTO');
    const f = (await parseFontFile(data, 'v.otf')).faces[0];
    expect(f.format).toBe('opentype');
    expect(f.weightRange).toEqual([100, 900]);
    expect(cssWeightDescriptor(f)).toBe('100 900');
  });
  it('falls back to the file name when the font has no name table', async () => {
    const f = (await parseFontFile(sfnt({ head: new Uint8Array(54) }), 'Pretendard-SemiBold.ttf')).faces[0];
    expect(f.family).toBe('Pretendard');
    expect(f.weight).toBe(600);
    expect(f.nameFromFile).toBe(true);
  });
  it('splits a collection (.ttc) into standalone faces', async () => {
    const a = font({ 1: 'Coll A' }, 400), b = font({ 1: 'Coll B' }, 700);
    const hdr = 12 + 8;
    const bases = [hdr, hdr + a.length];
    // sfnt table offsets are relative to the file start, so shift each face's offsets.
    const shift = (face: Uint8Array, by: number) => { const c = face.slice(); const dv = new DataView(c.buffer); const n = dv.getUint16(4); for (let i = 0; i < n; i++) dv.setUint32(12 + i * 16 + 8, dv.getUint32(12 + i * 16 + 8) + by); return c; };
    const file = Uint8Array.from([...tagBytes('ttcf'), ...u32(0x10000), ...u32(2), ...u32(bases[0]), ...u32(bases[1]), ...shift(a, bases[0]), ...shift(b, bases[1])]);
    const res = await parseFontFile(file, 'c.ttc');
    expect(res.faces.map((f) => f.family)).toEqual(['Coll A', 'Coll B']);
    expect(res.faces[1].weight).toBe(700);
    const again = await parseFontFile(res.faces[1].data, 'b.ttf');
    expect(again.faces[0].family).toBe('Coll B');
    expect(extractFace(file, bases[0])).not.toBeNull();
  });
  it('inflates WOFF tables to read the name table', async () => {
    // WOFF stores a table raw when deflate does not make it smaller (the 78-byte OS/2 here), compressed otherwise (the long name table).
    const tables: Record<string, Uint8Array> = { name: nameTable({ 1: 'Woff Fam', 2: 'Italic', 4: 'Woff Fam Italic Woff Fam Italic Woff Fam Italic Woff Fam Italic', 13: 'a'.repeat(300) }), 'OS/2': os2(500, 0, 1) };
    const sf = sfnt(tables);
    const entries = Object.keys(tables).sort().map((t) => ({ t, raw: tables[t], comp: (() => { const c = new Uint8Array(deflateSync(tables[t])); return c.length < tables[t].length ? c : tables[t]; })() }));
    let off = 44 + entries.length * 20;
    const dir: number[] = [], body: number[] = [];
    for (const e of entries) {
      dir.push(...tagBytes(e.t), ...u32(off), ...u32(e.comp.length), ...u32(e.raw.length), ...u32(0));
      const padded = [...e.comp, ...new Array(pad4(e.comp.length) - e.comp.length).fill(0)];
      body.push(...padded); off += padded.length;
    }
    const head = [...tagBytes('wOFF'), ...sf.slice(0, 4), ...u32(off), ...u16(entries.length), ...u16(0), ...u32(sf.length), ...new Array(44 - 20).fill(0)];
    const woff = Uint8Array.from([...head, ...dir, ...body]);
    const f = (await parseFontFile(woff, 'w.woff')).faces[0];
    expect(f.family).toBe('Woff Fam');
    expect(f.weight).toBe(500);
    expect(f.italic).toBe(true);
    expect(f.format).toBe('woff');
  });
  it('takes the name of a WOFF2 from the file name', async () => {
    const data = Uint8Array.from([...tagBytes('wOF2'), ...new Array(40).fill(0)]);
    const f = (await parseFontFile(data, 'Gothic-A1-Bold.woff2')).faces[0];
    expect(f.family).toBe('Gothic A1');
    expect(f.weight).toBe(700);
    expect(f.nameFromFile).toBe(true);
  });
  it('never throws on bad data and gives a Korean error', async () => {
    const bads = [new Uint8Array(0), new Uint8Array(5), Uint8Array.from({ length: 300 }, (_, i) => i), Uint8Array.from([0, 1, 0, 0, 0xff, 0xff, ...new Array(30).fill(0xff)]), Uint8Array.from([...tagBytes('ttcf'), ...new Array(20).fill(255)])];
    for (const bad of bads) {
      const r = await parseFontFile(bad, 'bad.ttf');
      expect(r.faces).toEqual([]);
      expect(typeof r.error).toBe('string');
    }
  });
  it('caps the size', async () => {
    expect((await parseFontFile(new Uint8Array(33 * 1024 * 1024), 'big.ttf')).error).toMatch(/큽니다/);
  });
  it('maps weight classes and style names', () => {
    expect([100, 250, 350, 450, 650, 1000, 0, 5].map(weightFromClass)).toEqual([100, 300, 400, 500, 700, 900, 400, 500]);
    expect(styleFromName('Extra Bold Italic')).toEqual({ weight: 800, italic: true });
    expect(styleFromName('Regular')).toEqual({ weight: 400, italic: false });
    expect(embeddingForbidden(0x0002)).toBe(true);
    expect(embeddingForbidden(0x0008)).toBe(false);
  });
});
