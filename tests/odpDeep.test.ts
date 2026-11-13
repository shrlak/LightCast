// .odp: multi-stop gradients (write and read), master-page objects written back, rotated tables and the import source.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseOdp, writeOdp, ODP_MIME } from '../src/domain/io/odp';
import { gradientToLc, lcToGradient, parseStopsCss, stopsCss } from '../src/domain/io/odpGeometry';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';

const store = () => ({ storeImage: () => 'm1' });
const noPics = { loadMedia: () => null };
type Deck = Pick<Presentation, 'title' | 'slides' | 'properties' | 'master'>;
const roundTrip = async (deck: Deck) => parseOdp(await writeOdp(deck, noPics), store());
const filesOf = async (deck: Deck) => {
  const zip = await JSZip.loadAsync(await writeOdp(deck, noPics));
  return { content: await zip.file('content.xml')!.async('string'), styles: await zip.file('styles.xml')!.async('string') };
};
const slideOf = (elements: SlideElement[], extra: Partial<Slide> = {}): Slide => ({ id: 's', group: 'g', text: '', elements, ...extra });
const shape = (extra: Partial<SlideElement>): SlideElement => ({ id: 'e', kind: 'shape', shape: 'rect', x: 100, y: 100, w: 400, h: 300, ...extra });

describe('odp multi-stop gradients', () => {
  const stops = [{ pos: 0, color: '#ff0000' }, { pos: 30, color: '#00ff00' }, { pos: 70.5, color: '#0000ff' }, { pos: 100, color: '#ffff00' }];

  it('writes every stop of a linear gradient as loext:gradient-stop and reads them back', async () => {
    const deck: Deck = { title: 't', properties: {}, slides: [slideOf([shape({ fill: '#ff0000', gradient: ['#ff0000', '#ffff00'], gradientStops: stops, gradientAngle: 45 })])] };
    const { styles } = await filesOf(deck);
    expect(styles.match(/<loext:gradient-stop /g)).toHaveLength(4);
    expect(styles).toContain('svg:offset="0.705"');
    expect(styles).toContain('xmlns:loext=');
    const el = (await roundTrip(deck)).slides[0].elements![0];
    expect(el.gradientStops).toEqual(stops);
    expect(el.gradientAngle).toBeCloseTo(45, 1);
    expect(el.gradient).toEqual(['#ff0000', '#ffff00']);
  });

  it('writes and reads the stops of a radial gradient with the centre colour first', async () => {
    const radial = [{ pos: 0, color: '#ffffff' }, { pos: 40, color: '#ff00ff' }, { pos: 100, color: '#000000' }];
    const deck: Deck = { title: 't', properties: {}, slides: [slideOf([shape({ gradient: ['#ffffff', '#000000'], gradientStops: radial, gradientType: 'radial' })])] };
    const el = (await roundTrip(deck)).slides[0].elements![0];
    expect(el.gradientType).toBe('radial');
    expect(el.gradientStops).toEqual(radial);
    expect(el.gradient).toEqual(['#ffffff', '#000000']);
  });

  it('keeps a plain two-colour gradient free of stop lists, and falls back when a stop colour is not a hex colour', () => {
    expect(lcToGradient({ gradient: ['#ff0000', '#0000ff'], gradientAngle: 0 })).toEqual({ style: 'linear', start: '#ff0000', end: '#0000ff', angle: 90 });
    const odd = lcToGradient({ gradient: ['#111111', '#222222'], gradientStops: [{ pos: 0, color: 'red' }, { pos: 50, color: '#00ff00' }, { pos: 100, color: '#0000ff' }] });
    expect(odd?.stops).toBeUndefined();
    expect(odd).toMatchObject({ start: '#111111', end: '#222222' });
  });

  it('turns ODF stops and LightCast stops into each other without loss, radial included', () => {
    for (const el of [{ gradient: ['#ff0000', '#ffff00'] as [string, string], gradientStops: stops, gradientAngle: 120 }, { gradient: ['#ffffff', '#000000'] as [string, string], gradientStops: [{ pos: 0, color: '#ffffff' }, { pos: 25, color: '#123456' }, { pos: 100, color: '#000000' }], gradientType: 'radial' as const }]) {
      const odf = lcToGradient(el)!;
      const back = gradientToLc(odf);
      expect(back.gradientStops).toEqual(el.gradientStops);
      expect(back.gradient).toEqual(el.gradient);
    }
  });

  it('keeps all stops of a gradient page background', async () => {
    const value = 'linear-gradient(135deg, #ff0000 0%, #00ff00 40%, #0000ff 100%)';
    const deck: Deck = { title: 't', properties: {}, slides: [slideOf([], { background: { kind: 'gradient', value } })] };
    const { styles } = await filesOf(deck);
    expect(styles.match(/<loext:gradient-stop /g)).toHaveLength(3);
    expect((await roundTrip(deck)).slides[0].background).toEqual({ kind: 'gradient', value });
  });

  it('reads and writes the CSS of multi-stop gradients', () => {
    expect(parseStopsCss(stopsCss({ type: 'linear', angle: 45, stops }))).toEqual({ type: 'linear', angle: 45, stops });
    expect(parseStopsCss('radial-gradient(circle at 50% 50%, #ffffff, #888888, #000000)')?.stops.map((s) => s.pos)).toEqual([0, 50, 100]);
    expect(parseStopsCss('linear-gradient(red, blue)')).toBeNull();
    expect(parseStopsCss('url(x)')).toBeNull();
  });
});

describe('odp master page objects', () => {
  const master: Presentation['master'] = {
    background: { kind: 'color', value: '#112233' },
    elements: [
      shape({ id: 'm1', name: '띠', y: 900, w: 1440, h: 180, fill: '#cc0000' }),
      { id: 'm2', kind: 'text', x: 20, y: 20, w: 300, h: 60, text: '교회 이름', fontSize: 30 },
      { id: 'm3', kind: 'text', x: 100, y: 100, w: 800, h: 200, text: '제목을 입력하십시오', placeholder: 'title' },
    ],
  };
  const deck = (): Deck => ({
    title: 't', properties: {}, master,
    slides: [
      slideOf([{ id: 'a', kind: 'text', x: 200, y: 300, w: 600, h: 100, text: '본문' }, { ...master.elements[0], id: 'copy', master: true }]),
      slideOf([{ id: 'b', kind: 'text', x: 200, y: 300, w: 600, h: 100, text: '둘째' }], { hideMaster: true }),
    ],
  });

  it('writes the master objects into the master page, not into every slide', async () => {
    const { content, styles } = await filesOf(deck());
    const page = /<style:master-page[^>]*>([\s\S]*?)<\/style:master-page>/.exec(styles)![1];
    expect(page).toContain('draw:custom-shape');
    expect(page).toContain('교회 이름');
    expect(page).not.toContain('제목을 입력하십시오'); // a placeholder is a prompt, not a drawing
    expect(styles).toContain('#cc0000');
    expect(content).not.toContain('#cc0000');
    expect(content).toContain('presentation:background-objects-visible="false"');
  });

  it('reads them back as the slides\' background objects once, and not on a slide that hides them', async () => {
    const doc = await roundTrip(deck());
    const [s1, s2] = doc.slides;
    expect(s1.elements!.filter((e) => e.fill === '#cc0000')).toHaveLength(1);
    expect(s1.elements!.filter((e) => e.name?.startsWith('마스터: '))).toHaveLength(2);
    expect(s1.elements!.some((e) => e.text === '본문')).toBe(true);
    expect(s2.elements!.map((e) => e.text)).toEqual(['둘째']);
    // The master's background is inherited by a slide with none of its own.
    expect(s1.background).toEqual({ kind: 'color', value: '#112233' });
  });

  it('leaves a deck without a master as it was: slide copies stay on the slides', async () => {
    const d = deck();
    delete d.master;
    const { content, styles } = await filesOf(d);
    expect(content).toContain('#cc0000');
    expect(/<style:master-page[^>]*><\/style:master-page>/.test(styles)).toBe(true);
  });

  it('keeps the slide style names and the master style names apart', async () => {
    const { content, styles } = await filesOf(deck());
    const used = (xml: string) => [...xml.matchAll(/style:name="([^"]+)"/g)].map((m) => m[1]);
    const inContent = new Set(used(content));
    expect(used(styles).filter((n) => inContent.has(n) && /^(m?gr|m?dp)\d/.test(n) && n.startsWith('m'))).toEqual([]);
  });
});

describe('odp import source', () => {
  const deck = (): Deck => ({ title: 't', properties: {}, slides: [slideOf([]), slideOf([])] });

  it('marks opened slides as .odp with the file name and page', async () => {
    const bytes = await writeOdp(deck(), noPics);
    const named = await parseOdp(bytes, { ...store(), name: '찬양.odp' });
    expect(named.slides.map((s) => s.importSource)).toEqual([{ format: 'odp', name: '찬양.odp', page: 1 }, { format: 'odp', name: '찬양.odp', page: 2 }]);
    const file = await parseOdp(new File([bytes as BlobPart], '예배.odp'), store());
    expect(file.slides[1].importSource).toEqual({ format: 'odp', name: '예배.odp', page: 2 });
    // Bytes alone have no name.
    expect((await parseOdp(bytes, store())).slides[0].importSource).toMatchObject({ format: 'odp', name: '' });
  });
});

describe('odp rotated tables', () => {
  const NS = 'xmlns:office="o" xmlns:style="s" xmlns:fo="f" xmlns:draw="d" xmlns:text="t" xmlns:svg="v" xmlns:presentation="p" xmlns:table="tb"';
  async function odpOf(frame: string): Promise<Uint8Array> {
    const z = new JSZip();
    z.file('mimetype', ODP_MIME, { compression: 'STORE' });
    z.file('styles.xml', `<office:document-styles ${NS}><office:automatic-styles><style:page-layout style:name="PM0"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM0"/></office:master-styles></office:document-styles>`);
    z.file('content.xml', `<office:document-content ${NS}><office:automatic-styles>
      <style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="5cm"/></style:style>
      <style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="2cm"/></style:style>
      <style:style style:name="ce1" style:family="table-cell"><style:table-cell-properties fo:background-color="#ffcc00"/></style:style>
      </office:automatic-styles><office:body><office:presentation><draw:page draw:master-page-name="Default">${frame}</draw:page></office:presentation></office:body></office:document-content>`);
    return z.generateAsync({ type: 'uint8array' });
  }
  const table = `<table:table><table:table-column table:style-name="co1" table:number-columns-repeated="2"/>
      <table:table-row table:style-name="ro1"><table:table-cell table:style-name="ce1" table:number-columns-spanned="2"><text:p>제목 칸</text:p></table:table-cell><table:covered-table-cell/></table:table-row>
      <table:table-row table:style-name="ro1"><table:table-cell><text:p>C</text:p></table:table-cell><table:table-cell><text:p>D</text:p></table:table-cell></table:table-row></table:table>`;

  it('keeps an upright table a table', async () => {
    const doc = await parseOdp(await odpOf(`<draw:frame svg:x="2cm" svg:y="2cm" svg:width="10cm" svg:height="4cm">${table}</draw:frame>`), store());
    expect(doc.slides[0].elements).toHaveLength(1);
    expect(doc.slides[0].elements![0].kind).toBe('table');
  });

  it('flattens a turned table into grouped cell rectangles laid out about the table centre', async () => {
    // 10 x 4 cm, turned a quarter turn clockwise about its corner, then moved: centre (12 cm, 9 cm).
    const els = (await parseOdp(await odpOf(`<draw:frame svg:width="10cm" svg:height="4cm" draw:transform="rotate (-1.5707963267949) translate (14cm 4cm)">${table}</draw:frame>`), store())).slides[0].elements!;
    expect(els).toHaveLength(3); // the merged title cell, C and D
    expect(new Set(els.map((e) => e.groupId)).size).toBe(1);
    expect(els[0].groupId).toBeTruthy();
    expect(els.every((e) => e.kind === 'shape' && e.shape === 'rect' && e.rotation === 90)).toBe(true);
    const k = 1440 / 28;
    const centre = (e: SlideElement) => [e.x + e.w / 2, e.y + e.h / 2];
    const [title, c, d] = els;
    expect(title).toMatchObject({ text: '제목 칸', fill: '#ffcc00' });
    // The merged cell spans the whole 10 cm width (the table's long side) before turning.
    expect(title.w).toBeCloseTo(10 * k, 0);
    expect(title.h).toBeCloseTo(2 * k, 0);
    // Turned a quarter turn clockwise the top row ends up on the right of the centre and the bottom row on the left.
    expect(centre(title)[0]).toBeGreaterThan(12 * k);
    expect(centre(c)[0]).toBeLessThan(12 * k);
    expect(Math.abs(centre(title)[1] - 9 * k)).toBeLessThan(2);
    // C is the left cell of the bottom row: a quarter turn clockwise sends the left to the top, so C ends up above D.
    expect(centre(c)[1]).toBeLessThan(centre(d)[1]);
    expect(Math.abs(centre(c)[0] - centre(d)[0])).toBeLessThan(2);
  });

  it('does not throw on a table with no rows or columns that is turned', async () => {
    const doc = await parseOdp(await odpOf('<draw:frame svg:width="10cm" svg:height="4cm" draw:transform="rotate (0.5)"><table:table/></draw:frame>'), store());
    expect(Array.isArray(doc.slides[0].elements)).toBe(true);
  });
});
