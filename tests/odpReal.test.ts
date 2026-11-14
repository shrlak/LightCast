// .odp as real LibreOffice 24.2 writes it (tests/fixtures/real/odp): the reader against files from the real thing, and
// the writer's output re-read (LibreOffice itself opened every shape of it by hand when this was written).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseOdp, writeOdp, animationsXml, geometryXml } from '../src/domain/io/odp';
import { ODP_PRESETS } from '../src/domain/io/odpPresets';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/odp/${n}`, import.meta.url)));
const read = (n: string) => parseOdp(fixture(n), { storeImage: (b, m) => `img:${m}:${b.length}` });
const named = (s: Slide, name: string) => s.elements!.find((e) => e.name === name)!;

describe('real LibreOffice .odp: shapes, text and slides', () => {
  it('reads rotation (rotate-then-translate, counter-clockwise), preset shapes and the notes', async () => {
    const doc = await read('libreoffice-rich.odp');
    expect(doc.slides).toHaveLength(5);
    const s1 = doc.slides[0];
    const rect = named(s1, 'Rectangle 2');
    expect(rect).toMatchObject({ shape: 'rect', rotation: 30, x: 144, y: 360, w: 432, h: 216, fill: '#008000', stroke: '#000000' });
    expect(named(s1, 'Oval 3')).toMatchObject({ shape: 'ellipse', rotation: 300, x: 720, y: 360, w: 432, h: 288 });
    expect(named(s1, 'Isosceles Triangle 4')).toMatchObject({ shape: 'triangle', rotation: 90, x: 144, y: 720, w: 288 });
    expect(named(s1, 'Rounded Rectangle 5')).toMatchObject({ shape: 'roundRect', fill: '#00c8c8' });
    expect(s1.notes).toBe('Speaker notes line1\nline2');
    // A text box comes as a text box (LibreOffice writes it as a custom shape), with its runs.
    const title = named(s1, 'TextBox 1');
    expect(title.kind).toBe('text');
    expect(title.paragraphs?.map((p) => p.text)).toEqual(['Title Bold Red', 'italic underline']);
    expect(title.paragraphs![0]).toMatchObject({ bold: true, color: '#ff0000' });
    expect(title.paragraphs![1].bold).toBe(false);
    // The master page's bar lies under every slide.
    expect(s1.elements![0]).toMatchObject({ name: '마스터: MasterBar', fill: '#1e1e78', y: 1037 });
  });

  it('reads gradients: angles, multi-stop, radial roles and per-stop transparency', async () => {
    const s2 = (await read('libreoffice-rich.odp')).slides[1];
    const g = (n: number) => named(s2, `Rectangle ${n}`);
    expect([1, 2, 4, 7, 8].map((n) => g(n).gradientAngle)).toEqual([0, 90, 45, 135, 270]);
    expect(g(1).gradient).toEqual(['#ff0000', '#0000ff']);
    expect(g(3).gradientStops).toEqual([{ pos: 0, color: '#ff0000' }, { pos: 50, color: '#00ff00' }, { pos: 100, color: '#0000ff' }]);
    expect(g(4).gradientStops?.map((s) => s.pos)).toEqual([0, 30, 70, 100]);
    // LibreOffice's radial gradient starts at the outside; LightCast's first colour is the centre.
    expect(g(5)).toMatchObject({ gradientType: 'radial', gradient: ['#ffffff', '#000000'] });
    expect(g(6).gradientStops).toEqual([{ pos: 0, color: '#ffffff' }, { pos: 40, color: '#ff00ff' }, { pos: 100, color: '#000000' }]);
    expect(g(9).gradientStops).toEqual([{ pos: 0, color: '#ff0000' }, { pos: 100, color: '#0000ff', transparency: 0.8 }]);
    expect(s2.background).toEqual({ kind: 'gradient', value: 'linear-gradient(0deg, #ffffc8 0%, #c8c8ff 100%)' });
  });

  it('reads groups, tables (fills from default cell styles), pictures, connectors and shadows', async () => {
    const s3 = (await read('libreoffice-rich.odp')).slides[2];
    const members = s3.elements!.filter((e) => e.groupName === 'Group 1');
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ rotation: 20, x: 89, y: 50 });
    expect(new Set(members.map((e) => e.groupId)).size).toBe(1);
    const table = s3.elements!.find((e) => e.kind === 'table')!.table!;
    expect(table.rows[0][0].fill).toBe('#ffc800');
    expect(table.rows[0][1].fill).toBe('#4f81bd');
    expect(table.rows[1][1]).toMatchObject({ span: 2, rowSpan: 2 });
    // The rotated table is flattened into rotated rectangles, grouped.
    const cells = s3.elements!.filter((e) => e.name?.startsWith('표 '));
    expect(cells).toHaveLength(4);
    expect(cells.every((e) => e.rotation === 15 && e.groupId === cells[0].groupId)).toBe(true);
    expect(s3.elements!.find((e) => e.kind === 'image')).toMatchObject({ rotation: 10, mediaId: expect.stringContaining('image/png') });
    expect(named(s3, 'Connector 7')).toMatchObject({ shape: 'line', arrowEnd: true, arrowEndKind: 'triangle', flipV: true, strokeWidth: 4 });
    const box = named(s3, 'Rectangle 8');
    expect(box.dropShadow).toBe(true);
    expect(box.shadowOpts).toMatchObject({ color: '#000000', dir: 45 });
    expect(box.shadowOpts!.transparency).toBeCloseTo(0.6, 2);
  });

  it('reads lists, shrink-to-fit, dashes and arrowheads, transitions, automatic advance and hidden slides', async () => {
    const doc = await read('libreoffice-rich.odp');
    const s4 = doc.slides[3];
    expect(named(s4, 'TextBox 1')).toMatchObject({ list: 'bullet', autoFit: 'shrink' });
    expect(named(s4, 'TextBox 2').list).toBe('number');
    expect(named(s4, 'Connector 3')).toMatchObject({ dash: 'dash', arrowStart: true, arrowStartKind: 'oval', arrowEnd: true, arrowEndKind: 'arrow' });
    expect(named(s4, 'Connector 4').dash).toBe('sysDot');
    expect(s4.background).toEqual({ kind: 'color', value: '#f0e6c8' });
    expect(s4.transition?.kind).toBe('fade');
    expect(s4.autoAdvance).toBe(4);
    const s5 = doc.slides[4];
    expect(s5.disabled).toBe(true);
    expect(s5.transition?.kind).toBe('fx:push');
  });

  it('reads the animation tree: presets, click / with / after, delays, targets', async () => {
    const s = (await read('libreoffice-animations.odp')).slides[0];
    const a = s.animations!;
    expect(a.map((x) => [x.effect, x.class, x.start])).toEqual([
      ['appear', 'entrance', 'click'], ['fade', 'entrance', 'click'], ['fly', 'entrance', 'click'], ['wipe', 'entrance', 'with'], ['fadeOut', 'exit', 'after'],
    ]);
    expect(a[3].delayMs).toBe(250);
    expect(a[1].durationMs).toBe(500);
    expect(a.map((x) => s.elements!.findIndex((e) => e.id === x.elementId))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('writing for LibreOffice', () => {
  const noPics = { loadMedia: () => null };
  type Deck = Pick<Presentation, 'title' | 'slides' | 'properties' | 'master'>;
  const shape = (extra: Partial<SlideElement>): SlideElement => ({ id: `e${Math.random()}`, kind: 'shape', shape: 'rect', x: 100, y: 100, w: 400, h: 300, ...extra });
  const filesOf = async (deck: Deck) => {
    const zip = await JSZip.loadAsync(await writeOdp(deck, noPics));
    return { content: await zip.file('content.xml')!.async('string'), styles: await zip.file('styles.xml')!.async('string') };
  };

  it('carries a preset shape with LibreOffice\'s own geometry, adjust values and no auto-growing frame', async () => {
    const deck: Deck = { title: 't', properties: {}, slides: [{ id: 's', group: '', text: '', elements: [shape({ shape: 'roundRect', adj: [40000], text: 'x', rotation: 20 })] }] };
    const { content } = await filesOf(deck);
    expect(content).toContain('draw:type="ooxml-roundRect"');
    expect(content).toContain('draw:modifiers="40000"');
    expect(content).toContain('draw:equation');
    expect(content).toContain('draw:auto-grow-height="false"');
    expect(Object.keys(ODP_PRESETS).length).toBeGreaterThan(150);
    expect(geometryXml(ODP_PRESETS, 'nonexistent')).toContain('draw:type="rectangle"');
    const back = (await parseOdp(await writeOdp(deck, noPics), { storeImage: () => 'm' })).slides[0].elements![0];
    expect(back).toMatchObject({ shape: 'roundRect', rotation: 20 });
  });

  it('writes stop colours the way LibreOffice reads them, transparency, shadows, dashes, arrows, lists and shrink-to-fit', async () => {
    const stops = [{ pos: 0, color: '#ff0000' }, { pos: 40, color: '#00ff00', transparency: 0.5 }, { pos: 100, color: '#0000ff', transparency: 0.9 }];
    const elements: SlideElement[] = [
      shape({ gradient: ['#ff0000', '#0000ff'], gradientStops: stops, dropShadow: true, shadowOpts: { dist: 20, dir: 90, blur: 10, transparency: 0.4 } }),
      shape({ shape: 'line', stroke: '#dc2626', strokeWidth: 8, dash: 'sysDot', arrowStart: true, arrowStartKind: 'oval', arrowEnd: true, arrowEndKind: 'stealth', fill: 'transparent' }),
      { id: 't', kind: 'text', x: 0, y: 500, w: 400, h: 200, text: 'a\nb', list: 'number', autoFit: 'shrink', fontSize: 40 },
    ];
    const { content, styles } = await filesOf({ title: 't', properties: {}, slides: [{ id: 's', group: '', text: '', elements }] });
    expect(styles).toContain('loext:color-value="#00ff00"');
    expect(styles).toMatch(/<draw:opacity draw:name="Transparency1"[^>]*>.*<loext:opacity-stop svg:offset="0.4" svg:stop-opacity="0.5"/);
    expect(content).toContain('draw:opacity-name="Transparency1"');
    expect(content).toMatch(/draw:shadow="visible" draw:shadow-offset-x="0cm" draw:shadow-offset-y="[\d.]+cm"/);
    expect(styles).toContain('<draw:stroke-dash draw:name="Dash_sysDot"');
    expect(styles).toContain('<draw:marker draw:name="Arrow_oval"');
    expect(content).toContain('draw:marker-end="Arrow_stealth"');
    expect(content).toContain('<text:list-level-style-number');
    expect(content).toMatch(/<text:list text:style-name="L\d+"><text:list-item>/);
    expect(content).toContain('style:shrink-to-fit="true"');
    // …and back through the reader.
    const back = (await parseOdp(await writeOdp({ title: 't', properties: {}, slides: [{ id: 's', group: '', text: '', elements }] }, noPics), { storeImage: () => 'm' })).slides[0].elements!;
    expect(back[0].gradientStops).toEqual(stops);
    expect(back[0].shadowOpts).toMatchObject({ dir: 90 });
    expect(back[1]).toMatchObject({ dash: 'sysDot', arrowStartKind: 'oval', arrowEndKind: 'stealth' });
    expect(back[2]).toMatchObject({ list: 'number', autoFit: 'shrink' });
  });

  it('writes layouts as master pages (with their placeholders), notes LibreOffice imports, and animations', async () => {
    const layouts = [
      { id: 'L1', name: 'Title Slide', elements: [shape({ id: 'l1', shape: 'ellipse' }), { id: 'p', kind: 'text' as const, placeholder: 'title' as const, x: 0, y: 0, w: 500, h: 100, text: 'Title' }] },
      { id: 'L2', name: 'Body', elements: [] },
    ];
    const el1 = shape({ id: 'a' }), el2 = shape({ id: 'b' });
    const slides: Slide[] = [
      { id: 's1', group: '', text: '', layoutId: 'L2', notes: 'hello', elements: [el1, el2], animations: [
        { id: 'n1', elementId: 'a', effect: 'fade', class: 'entrance', start: 'click', durationMs: 700, delayMs: 0 },
        { id: 'n2', elementId: 'b', effect: 'wipeOut', class: 'exit', start: 'after', durationMs: 500, delayMs: 100 },
      ] },
      { id: 's2', group: '', text: '', layoutId: 'L1', elements: [] },
    ];
    const { content, styles } = await filesOf({ title: 't', properties: {}, slides, master: { elements: [], layouts } });
    expect(styles).toContain('style:name="Layout1" style:display-name="Title Slide"');
    expect(styles).toContain('presentation:class="title" presentation:placeholder="true"');
    expect(content).toContain('draw:master-page-name="Layout2"');
    expect(content).toContain('draw:master-page-name="Layout1"');
    expect(content).toContain('<draw:page-thumbnail');
    expect(content).toMatch(/presentation:style-name="[^"]+" presentation:class="notes"/);
    expect(content).toContain('presentation:preset-id="ooo-entrance-fade-in"');
    expect(content).toContain('presentation:preset-id="ooo-exit-wipe"');
    expect(content).toContain('presentation:node-type="after-previous"');
    const back = (await parseOdp(await writeOdp({ title: 't', properties: {}, slides, master: { elements: [], layouts } }, noPics), { storeImage: () => 'm' })).slides[0];
    expect(back.animations?.map((a) => [a.effect, a.start, a.durationMs])).toEqual([['fade', 'click', 700], ['wipeOut', 'after', 500]]);
    expect(back.animations?.map((a) => back.elements!.findIndex((e) => e.id === a.elementId))).toEqual([0, 1]);
    expect(back.notes).toBe('hello');
  });

  it('leaves out animations whose effect ODF cannot carry here, or whose object is not on the slide', () => {
    expect(animationsXml([{ id: 'x', elementId: 'a', effect: 'spin', class: 'emphasis', start: 'click', durationMs: 500, delayMs: 0 }], new Map([['a', 'id1']]))).toBe('');
    expect(animationsXml([{ id: 'x', elementId: 'zz', effect: 'fade', class: 'entrance', start: 'click', durationMs: 500, delayMs: 0 }], new Map())).toBe('');
  });
});
