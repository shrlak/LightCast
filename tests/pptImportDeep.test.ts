import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { inflateRaw, inflateZlib } from '../src/domain/io/inflate';
import { parsePpt } from '../src/domain/io/pptBinary';
import { importPpt, transitionOf } from '../src/domain/io/pptImport';
import { buildPpt, escherColor, type FixtureOptions, type FixtureShape } from './fixtures/pptBuilder';

const parse = (o: FixtureOptions) => parsePpt(buildPpt(o));
const run = async (o: FixtureOptions, store?: (mime: string) => void) => {
  let n = 0;
  return importPpt(buildPpt(o), '시험.ppt', { group: 'g', newId: (p) => `${p}${++n}`, store: async (pic, name) => { store?.(`${pic.mime}:${name}`); return `m${n++}`; } });
};

const SCHEME = [0xffffff, 0x000000, 0x808080, 0x336699, 0xeeeeee, 0x00ff00, 0x0000ff, 0xff00ff];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9];

/** A tiny placeable WMF with one rectangle. */
const WMF = (() => {
  const w = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const d = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const rect = [...d(8), ...w(0x041b), ...w(60), ...w(110), ...w(10), ...w(10)];
  const body = [...d(3 + 4), ...w(0x020c), ...w(100), ...w(200), ...rect];
  const total = 9 + 3 + body.length / 2;
  return [...d(0x9ac6cdd7), ...w(0), ...w(0), ...w(0), ...w(200), ...w(100), ...w(100), ...d(0), ...w(0), ...w(1), ...w(9), ...w(0x300), ...d(total), ...w(2), ...d(10), ...w(0), ...body, ...d(3), ...w(0)];
})();

describe('.ppt text styling', () => {
  const text = '굵게 기울임\r둘째';
  const sample = () => parse({
    fonts: ['Arial', '맑은 고딕'],
    slides: [{
      shapes: [{
        text, textType: 4, anchor: [100, 100, 3000, 900],
        style: {
          pf: [{ count: 7, level: 0, bullet: true, bulletChar: 0x2022, align: 1 }, { level: 1, bullet: false }],
          cf: [{ count: 2, bold: true, size: 30, color: [255, 0, 0, 0xfe], font: 1 }, { count: 4, italic: true, underline: true, size: 20 }, {}],
        },
      }],
    }],
  });

  it('reads paragraph and character runs: bold, italic, underline, size, colour, font, alignment, bullet, level', () => {
    const [p0, p1] = sample().slides[0].shapes[0].paras!;
    expect(p0).toMatchObject({ text: '굵게 기울임', level: 0, align: 'center', bullet: { char: 0x2022 } });
    expect(p0.runs).toEqual([
      { text: '굵게', bold: true, size: 30, color: '#ff0000', font: '맑은 고딕' },
      { text: ' 기울임', italic: true, underline: true, size: 20 },
    ]);
    expect(p1).toMatchObject({ text: '둘째', level: 1 });
    expect(p1.bullet).toBeUndefined();
    expect(sample().slides[0].shapes[0].text).toBe('굵게 기울임\n둘째');
  });

  it('maps them onto the LightCast text element (points → canvas px, runs only where they differ)', async () => {
    const r = await run({
      fonts: ['Arial', '맑은 고딕'],
      slides: [{ shapes: [{ text, textType: 4, anchor: [100, 100, 3000, 900], style: { pf: [{ count: 7, level: 0, bullet: true, bulletChar: 0x2022, align: 1 }, { level: 1 }], cf: [{ count: 2, bold: true, size: 30, color: [255, 0, 0, 0xfe], font: 1 }, { count: 4, italic: true, underline: true, size: 20 }, {}] } }] }],
    });
    const el = r.slides[0].elements![0];
    expect(el).toMatchObject({ kind: 'text', fontSize: 60, color: '#ff0000', fontFamily: '맑은 고딕', bold: true, align: 'center', text: '굵게 기울임\n둘째' });
    expect(el.paragraphs![0]).toMatchObject({ list: 'bullet' });
    expect(el.paragraphs![1]).toMatchObject({ list: 'none', level: 1 });
    expect(el.paragraphs![0].runs).toEqual([{ text: '굵게' }, { text: ' 기울임', fontSize: 40, color: '#111111', bold: false, italic: true, underline: true }]);
  });

  it('keeps line breaks inside a paragraph as continuation lines (no second bullet) and drops the final paragraph mark', () => {
    const doc = parse({ slides: [{ shapes: [{ text: 'a\u000bb\rc\r', textType: 1, placeholder: 2, style: { pf: [{ bullet: true, bulletChar: 0x2022 }] } }] }] });
    const paras = doc.slides[0].shapes[0].paras!;
    expect(paras.map((p) => p.text)).toEqual(['a', 'b', 'c']);
    expect(paras.map((p) => !!p.cont)).toEqual([false, true, false]);
  });

  it('turns Wingdings bullet codes into list styles and a spaced line into a line height', async () => {
    const r = await run({
      fonts: ['Wingdings'],
      slides: [{ shapes: [{ text: '항목', textType: 1, placeholder: 2, anchor: [0, 0, 2000, 500], style: { pf: [{ bullet: true, bulletChar: 0xfc, bulletFont: 0, lineSpacing: 150 }] } }] }],
    });
    expect(r.slides[0].elements![0]).toMatchObject({ list: 'check', lineHeight: 1.8 });
  });

  it('survives a style atom that is shorter than the text or cut off', () => {
    const doc = parse({ slides: [{ shapes: [{ text: '가나다라마바사', textType: 4, style: { pf: [{ count: 2 }], cf: [{ count: 1, bold: true }] } }] }] });
    expect(doc.slides[0].shapes[0].text).toBe('가나다라마바사');
  });
});

describe('.ppt master and title-master inheritance', () => {
  const masters = [{
    shapes: [
      { placeholder: 1, spType: 1, textType: 0, text: '마스터 제목', anchor: [576, 288, 5184, 1152] as [number, number, number, number] },
      { placeholder: 2, spType: 1, textType: 1, text: '마스터 본문', anchor: [576, 1440, 5184, 3600] as [number, number, number, number] },
      { spType: 1, anchor: [0, 4000, 5760, 4320] as [number, number, number, number], opt: { 0x180: 0, 0x181: escherColor(0xff0000) } },
    ],
    styles: [
      { type: 0, levels: [{ pf: { align: 1 }, cf: { size: 44, bold: true, color: [0, 0, 0, 3] as [number, number, number, number] } }] },
      { type: 1, levels: [{ pf: { bullet: true, bulletChar: 0x2022 }, cf: { size: 28 } }, { pf: { bullet: true, bulletChar: 0x2013 }, cf: { size: 24 } }] },
    ],
    scheme: SCHEME,
  }];

  it('takes position, size, text style and scheme colours from the master placeholder', () => {
    const doc = parse({ masters, slides: [{ shapes: [
      { placeholder: 0x0d, textType: 0, text: '제목' },
      { placeholder: 0x0e, textType: 1, text: 'a\rb', style: { pf: [{ count: 2, level: 0 }, { level: 1 }] } },
    ] }] });
    const shapes = doc.slides[0].shapes;
    const t = shapes.find((s) => s.text === '제목')!;
    expect(t).toMatchObject({ x: 576, y: 288, w: 4608, h: 864, inherited: true });
    expect(t.paras![0]).toMatchObject({ align: 'center' });
    expect(t.paras![0].runs[0]).toMatchObject({ size: 44, bold: true, color: '#336699' });
    const b = shapes.find((s) => s.textType === 1)!;
    expect(b).toMatchObject({ x: 576, y: 1440 });
    expect(b.paras![0]).toMatchObject({ level: 0, bullet: { char: 0x2022 } });
    expect(b.paras![0].runs[0].size).toBe(28);
    expect(b.paras![1]).toMatchObject({ level: 1, bullet: { char: 0x2013 } });
    expect(b.paras![1].runs[0].size).toBe(24);
    // The master's own decoration comes under the slide's shapes; its placeholders do not.
    expect(shapes.filter((s) => s.master)).toHaveLength(1);
    expect(shapes.find((s) => s.master)).toMatchObject({ kind: 'shape', shape: 'rect', fill: { color: '#ff0000' } });
    expect(shapes.some((s) => s.text === '마스터 제목')).toBe(false);
  });

  it('leaves the master objects out when the slide does not show them', () => {
    const doc = parse({ masters, slides: [{ flags: 0x6, shapes: [{ placeholder: 0x0d, textType: 0, text: '제목' }] }] });
    expect(doc.slides[0].shapes.some((s) => s.master)).toBe(false);
  });

  it('uses the title master a slide points at', () => {
    const titleMaster = { shapes: [{ placeholder: 3, spType: 1, textType: 6, text: 'x', anchor: [1000, 1000, 4000, 2000] as [number, number, number, number] }], styles: [{ type: 6, levels: [{ pf: {}, cf: { size: 60 } }] }], scheme: SCHEME };
    const doc = parse({ masters: [masters[0], titleMaster], slides: [{ master: 1, shapes: [{ placeholder: 0x10, textType: 6, text: '표지' }] }, { master: 0, shapes: [{ placeholder: 0x0d, textType: 0, text: '본문' }] }] });
    expect(doc.slides[0].shapes[0]).toMatchObject({ x: 1000, y: 1000, w: 3000, h: 1000 });
    expect(doc.slides[0].shapes[0].paras![0].runs[0].size).toBe(60);
    expect(doc.slides[1].shapes.find((s) => s.text === '본문')).toMatchObject({ x: 576 });
  });

  it('draws the import at the master position on the canvas', async () => {
    const r = await run({ masters, slides: [{ shapes: [{ placeholder: 0x0d, textType: 0, text: '제목' }] }] });
    const title = r.slides[0].elements!.find((e) => e.text === '제목')!;
    expect(title).toMatchObject({ x: 144, y: 72, w: 1152, h: 216, fontSize: 88, bold: true, color: '#336699' });
  });
});

describe('.ppt backgrounds and colour scheme', () => {
  it('reads solid (scheme), shaded and picture backgrounds, own or followed from the master', async () => {
    const r = await run({
      pictures: [{ type: 'jpeg', bytes: JPEG }],
      masters: [{ shapes: [], scheme: [0x112233, 0, 0, 0, 0, 0, 0, 0], background: { color: 0, scheme: true } }],
      slides: [
        { shapes: [] },
        { flags: 0x3, background: { color: 0xff8800 }, shapes: [] },
        { flags: 0x3, background: { color: 0x000000, to: 0xffffff, angle: -90 }, shapes: [] },
        { flags: 0x3, background: { picture: 1 }, shapes: [] },
      ],
    });
    expect(r.slides[0].background).toEqual({ kind: 'color', value: '#112233' });
    expect(r.slides[1].background).toEqual({ kind: 'color', value: '#ff8800' });
    expect(r.slides[2].background).toEqual({ kind: 'gradient', value: 'linear-gradient(180deg, #000000 0%, #ffffff 100%)' });
    expect(r.slides[3].background).toMatchObject({ kind: 'media', mediaType: 'image' });
  });

  it('falls back to the scheme background colour, and to white without any', async () => {
    const r = await run({ slides: [{ scheme: SCHEME, shapes: [] }, { shapes: [] }] });
    expect(r.slides[0].background).toEqual({ kind: 'color', value: '#ffffff' });
    expect(r.slides[1].background).toEqual({ kind: 'color', value: '#ffffff' });
    const dark = await run({ slides: [{ scheme: [0x101010, ...SCHEME.slice(1)], shapes: [] }] });
    expect(dark.slides[0].background).toEqual({ kind: 'color', value: '#101010' });
  });
});

describe('.ppt shapes', () => {
  const FILL = (rgb: number) => ({ 0x180: 0, 0x181: escherColor(rgb), 0x1bf: 0x00100010 });

  it('reads fill, outline, dash, rotation and flips of an autoshape', async () => {
    const shape: FixtureShape = { spType: 3, anchor: [100, 100, 1100, 700], rotation: 30, flipH: true, opt: { ...FILL(0x00ff00), 0x1c0: escherColor(0x0000ff), 0x1cb: 25400, 0x1ce: 6, 0x1ff: 0x00080008 } };
    const doc = parse({ slides: [{ shapes: [shape] }] });
    expect(doc.slides[0].shapes[0]).toMatchObject({ kind: 'shape', shape: 'ellipse', rotation: 30, flipH: true, fill: { color: '#00ff00' }, line: { color: '#0000ff', width: 25400, dash: 'dash' } });
    const r = await run({ slides: [{ shapes: [shape] }] });
    expect(r.slides[0].elements![0]).toMatchObject({ kind: 'shape', shape: 'ellipse', x: 25, y: 25, w: 250, h: 150, fill: '#00ff00', stroke: '#0000ff', strokeWidth: 4, dash: 'dash', rotation: 30, flipH: true });
  });

  it('maps the common autoshape types and draws a line with an arrow', async () => {
    const types = [[2, 'roundRect'], [4, 'diamond'], [13, 'rightArrow'], [66, 'leftArrow'], [67, 'downArrow'], [5, 'triangle'], [183, 'sun']] as const;
    const r = await run({ slides: [{ shapes: [
      ...types.map(([spType], i): FixtureShape => ({ spType, anchor: [100 * i, 0, 100 * i + 80, 80], opt: FILL(0xcccccc) })),
      { spType: 20, anchor: [0, 500, 1000, 500], flipV: true, opt: { 0x1c0: escherColor(0xff0000), 0x1d1: 1 } },
    ] }] });
    const els = r.slides[0].elements!;
    expect(els.filter((e) => e.kind === 'shape' && e.shape !== 'line').map((e) => e.shape)).toEqual(types.map((t) => t[1]));
    const line = els.find((e) => e.shape === 'line')!;
    expect(line).toMatchObject({ stroke: '#ff0000', arrowEnd: true, flipV: true, y: 125, w: 250 });
    expect(line.h).toBeGreaterThanOrEqual(1);
  });

  it('keeps a text box\'s fill and outline, gives a bordered autoshape its text, and drops invisible empty shapes', async () => {
    const r = await run({ slides: [{ shapes: [
      { spType: 202, anchor: [0, 0, 2000, 500], text: '상자', opt: { ...FILL(0xffffcc), 0x1c0: escherColor(0) } },
      { spType: 3, anchor: [0, 600, 2000, 1100], text: '타원', opt: FILL(0xffffff) },
      { spType: 1, anchor: [0, 1200, 500, 1500] },
    ] }] });
    const [box, ellipse] = r.slides[0].elements!;
    expect(r.slides[0].elements).toHaveLength(2);
    expect(box).toMatchObject({ kind: 'text', text: '상자', fill: '#ffffcc', stroke: '#000000' });
    expect(ellipse).toMatchObject({ kind: 'shape', shape: 'ellipse', text: '타원', fill: '#ffffff' });
  });

  it('applies the document default properties and warns about freeform shapes', () => {
    const doc = parse({ defaultProps: { 0x180: 0, 0x181: escherColor(0xcccccc) }, slides: [{ shapes: [{ spType: 1, anchor: [0, 0, 500, 500] }, { spType: 0, anchor: [0, 0, 500, 500], opt: { 0x180: 0, 0x181: escherColor(0xff0000) } }] }] });
    expect(doc.slides[0].shapes[0]).toMatchObject({ kind: 'shape', fill: { color: '#cccccc' } });
    expect(doc.warnings.some((w) => w.includes('자유형'))).toBe(true);
  });

  it('reads picture crop and picture fills', async () => {
    const r = await run({ pictures: [{ type: 'jpeg', bytes: JPEG }], slides: [{ shapes: [
      { picture: 1, anchor: [0, 0, 400, 400], opt: { 0x102: 0x4000, 0x103: 0x8000 } },
      { spType: 1, anchor: [500, 0, 900, 400], opt: { 0x180: 3, 0x186: 1, 0x1bf: 0x00100010 } },
    ] }] });
    const [pic, fillShape] = r.slides[0].elements!;
    expect(pic).toMatchObject({ kind: 'image', crop: [0.25, 0, 0.5, 0] });
    expect(fillShape).toMatchObject({ kind: 'shape', fillImage: pic.mediaId });
  });
});

describe('.ppt groups', () => {
  const member = (childAnchor: [number, number, number, number], extra: Partial<FixtureShape> = {}): FixtureShape => ({ spType: 1, childAnchor, opt: { 0x180: 0, 0x181: escherColor(0xff0000) }, ...extra });

  it('maps child coordinates into the group frame and keeps members grouped', async () => {
    const group: FixtureShape = { anchor: [1000, 1000, 3000, 2000], group: { spgr: [0, 0, 100, 100], members: [member([0, 0, 50, 50]), member([50, 50, 100, 100])] } };
    const doc = parse({ slides: [{ shapes: [group] }] });
    const [a, b] = doc.slides[0].shapes;
    expect(a).toMatchObject({ x: 1000, y: 1000, w: 1000, h: 500 });
    expect(b).toMatchObject({ x: 2000, y: 1500, w: 1000, h: 500 });
    expect(a.group).toBeDefined();
    expect(a.group).toBe(b.group);
    const r = await run({ slides: [{ shapes: [group] }] });
    const els = r.slides[0].elements!;
    expect(els[0].groupId).toBeDefined();
    expect(els[0].groupId).toBe(els[1].groupId);
  });

  it('turns members with a rotated group', () => {
    const doc = parse({ slides: [{ shapes: [{ anchor: [1000, 1000, 3000, 2000], rotation: 90, group: { spgr: [0, 0, 100, 100], members: [member([0, 0, 50, 50])] } }] }] });
    const a = doc.slides[0].shapes[0];
    expect(a.rotation).toBe(90);
    expect(a.x! + a.w! / 2).toBeCloseTo(2250, 3);
    expect(a.y! + a.h! / 2).toBeCloseTo(1000, 3);
  });

  it('mirrors members with a flipped group', () => {
    const doc = parse({ slides: [{ shapes: [{ anchor: [1000, 1000, 3000, 2000], flipH: true, group: { spgr: [0, 0, 100, 100], members: [member([0, 0, 50, 50])] } }] }] });
    const a = doc.slides[0].shapes[0];
    expect(a).toMatchObject({ x: 2000, y: 1000, w: 1000, h: 500, flipH: true });
  });

  it('composes nested groups', () => {
    const inner: FixtureShape = { childAnchor: [0, 0, 50, 100], group: { spgr: [0, 0, 10, 10], members: [member([0, 0, 10, 10])] } };
    const doc = parse({ slides: [{ shapes: [{ anchor: [0, 0, 2000, 1000], group: { spgr: [0, 0, 100, 100], members: [inner] } }] }] });
    expect(doc.slides[0].shapes).toHaveLength(1);
    expect(doc.slides[0].shapes[0]).toMatchObject({ x: 0, y: 0, w: 1000, h: 1000 });
  });
});

describe('.ppt metafile pictures', () => {
  it('reads compressed and plain WMF / EMF blips from the Pictures stream', () => {
    const doc = parse({ pictures: [{ type: 'wmf', bytes: WMF }, { type: 'emf', bytes: [1, 2, 3, 4, 5, 6, 7, 8], compress: false }, { type: 'jpeg', bytes: JPEG }], slides: [{ shapes: [{ picture: 1, anchor: [0, 0, 100, 100] }] }] });
    expect(doc.pictures[0]).toMatchObject({ mime: 'image/x-wmf' });
    expect(Array.from(doc.pictures[0]!.bytes)).toEqual(WMF);
    expect(doc.pictures[1]).toMatchObject({ mime: 'image/x-emf' });
    expect(Array.from(doc.pictures[1]!.bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(doc.pictures[2]).toMatchObject({ mime: 'image/jpeg' });
  });

  it('draws a WMF picture as an SVG image and warns about one it cannot draw', async () => {
    const stored: string[] = [];
    const r = await run({ pictures: [{ type: 'wmf', bytes: WMF }, { type: 'emf', bytes: [1, 2, 3, 4, 5, 6, 7, 8] }], slides: [{ shapes: [{ picture: 1, anchor: [0, 0, 400, 400] }, { picture: 2, anchor: [500, 0, 900, 400] }] }] }, (m) => stored.push(m));
    expect(r.slides[0].elements!.filter((e) => e.kind === 'image')).toHaveLength(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^image\/(svg\+xml|png):/);
    expect(r.warnings.some((w) => w.includes('WMF/EMF'))).toBe(true);
  });

  it('ignores a metafile blip with a damaged compressed body', () => {
    const f = buildPpt({ pictures: [{ type: 'wmf', bytes: WMF }], slides: [{ shapes: [] }] });
    for (let i = f.length - 200; i < f.length; i += 7) f[i] ^= 0xff;
    expect(() => parsePpt(f)).not.toThrow();
  });
});

describe('.ppt transitions and hidden slides', () => {
  it('reads the slide-show settings', async () => {
    const r = await run({ slides: [{ shapes: [], hidden: true, transition: { effect: 6, speed: 2, onClick: false, timeMs: 5000 } }, { shapes: [] }, { shapes: [], transition: { effect: 2, speed: 0 } }] });
    expect(r.slides[0].disabled).toBe(true);
    expect(r.slides[0].transition).toEqual({ kind: 'fade', duration: 500, advanceOnClick: false });
    expect(r.slides[0].autoAdvance).toBe(5);
    expect(r.slides[1].disabled).toBeUndefined();
    expect(r.slides[1].transition).toBeUndefined();
    expect(r.slides[2].transition).toEqual({ kind: 'fx:blinds', duration: 1500, option: 'vert' });
  });

  it('maps unknown effects to a fade and a cut to nothing', () => {
    expect(transitionOf({ effect: 99, speed: 1, onClick: true, afterMs: 0 }).transition?.kind).toBe('fade');
    expect(transitionOf({ effect: 0, speed: 1, onClick: true, afterMs: 0 }).transition).toBeUndefined();
  });
});

describe('.ppt notes', () => {
  it('keeps the notes of slides that also have masters and styles', () => {
    const doc = parse({ masters: [{ shapes: [], scheme: SCHEME }], slides: [{ notes: '메모 하나', shapes: [{ text: '가', textType: 4 }] }, { shapes: [] }] });
    expect(doc.slides[0].notes).toBe('메모 하나');
    expect(doc.slides[1].notes).toBeUndefined();
  });
});

describe('.ppt hostile input with the richer records', () => {
  const rich = () => buildPpt({
    fonts: ['Arial'],
    pictures: [{ type: 'wmf', bytes: WMF }, { type: 'jpeg', bytes: JPEG }],
    masters: [{ shapes: [{ placeholder: 1, text: 'M', textType: 0, anchor: [0, 0, 100, 100] }], styles: [{ type: 0, levels: [{ pf: { align: 1 }, cf: { size: 40 } }] }], scheme: SCHEME, background: { color: 1, scheme: true } }],
    slides: [{
      hidden: true, transition: { effect: 3 }, background: { picture: 2 }, notes: 'N',
      shapes: [
        { placeholder: 0x0d, textType: 0, text: 'T\rU', style: { pf: [{ count: 2, bullet: true }, {}], cf: [{ bold: true, size: 20 }] } },
        { anchor: [0, 0, 3000, 3000], group: { spgr: [0, 0, 10, 10], members: [{ spType: 3, childAnchor: [0, 0, 5, 5], opt: { 0x180: 0, 0x181: 5 } }] } },
      ],
    }],
  });

  it('never throws on truncation or bit flips', () => {
    const good = rich();
    expect(parsePpt(good).slides.length).toBe(1);
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let cut = 0; cut < good.length; cut += 97) expect(() => parsePpt(good.subarray(0, cut))).not.toThrow();
    for (let n = 0; n < 300; n++) {
      const bad = good.slice();
      for (let k = 0; k < 25; k++) bad[512 + (rnd() % (bad.length - 512))] = rnd() & 0xff;
      const doc = parsePpt(bad);
      expect(Array.isArray(doc.slides)).toBe(true);
    }
  });

  it('imports a damaged rich file without throwing', async () => {
    const good = rich();
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let n = 0; n < 40; n++) {
      const bad = good.slice();
      for (let k = 0; k < 15; k++) bad[512 + (rnd() % (bad.length - 512))] = rnd() & 0xff;
      const r = await importPpt(bad, 'x.ppt', { group: 'g', newId: (p) => p, store: async () => 'm' });
      expect(Array.isArray(r.slides)).toBe(true);
    }
  });

  it('caps group nesting', () => {
    let g: FixtureShape = { childAnchor: [0, 0, 10, 10], group: { spgr: [0, 0, 10, 10], members: [{ spType: 1, childAnchor: [0, 0, 10, 10], opt: { 0x180: 0, 0x181: 5 } }] } };
    for (let i = 0; i < 60; i++) g = { childAnchor: [0, 0, 10, 10], group: { spgr: [0, 0, 10, 10], members: [g] } };
    expect(() => parse({ slides: [{ shapes: [g] }] })).not.toThrow();
  });
});

describe('inflate', () => {
  const data = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + (i >> 3)) & 0xff);

  it('inflates zlib streams of every block kind', () => {
    for (const input of [data(0), data(10), data(5000), new Uint8Array(70000).fill(7), Uint8Array.from('가나다라마바사 '.repeat(500), (c) => c.charCodeAt(0) & 0xff)]) {
      for (const level of [0, 1, 9]) expect(inflateZlib(deflateSync(input, { level }), 1 << 20)).toEqual(input);
    }
  });
  it('refuses damaged streams and output past the cap', () => {
    const z = deflateSync(data(5000));
    expect(inflateZlib(z, 100)).toBeNull();
    expect(inflateZlib(z.subarray(0, 20), 1 << 20)).toBeNull();
    expect(inflateZlib(new Uint8Array([1, 2, 3, 4]), 1 << 20)).toBeNull();
    expect(inflateRaw(new Uint8Array([0xff, 0xff, 0xff]), 0, 1000)).toBeNull();
  });
});
