// DeckCraft 5b7b22d..74591ab: tab stops (a hanging indent is the first tab stop, 87af3184 / fc253bdb; a stop past the
// right margin sits at it, 5a6add63 / 1add4c13; the two compared at the edge, a0f0ad57), an audio icon set to hide
// stays hidden while it plays (edb303d9), and chart legend keys (a line series' key is its line, 0175c6c2 / ca819f14;
// a pie's keys take the slices' own c:dPt colours, 6df9331b). The engine side is tested in freecast-engine/src/tests.rs.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { chartSvg, type ChartData } from '../src/engine';
import { DEFAULT_TAB, firstLineTabs, layoutTabLine, tabAdvance } from '../src/domain/tabStops';
import { hiddenDuringShow } from '../src/domain/mediaPlayback';
import { readChart } from '../src/domain/io/pptxChart';
import { parseMarkup } from '../src/domain/io/markup';
import type { DmlTheme } from '../src/domain/io/drawingml';
import { makeChart } from '../src/domain/editOps';
import { buildPptx } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Presentation, SlideElement } from '../src/domain/types';

const seg = (w: number, dec = w) => ({ w, dec });
// LightCast's canvas has 2 px per point: DeckCraft's 27 pt hanging indent is 54 px, its 72 pt default tab 144 px.

describe('a hanging indent is the first tab stop (87af3184, fc253bdb)', () => {
  it('the first tab of a hanging first line goes to the margin, later tabs to the default stops', () => {
    // "a\tb\tc" with marL 54, indent -54: the line starts at 0.
    const { x } = layoutTabLine(0, [seg(10), seg(10), seg(10), seg(10)], [], DEFAULT_TAB, { hang: 54 });
    expect(x).toEqual([0, 54, 144, 288]);
  });
  it('a wrapped (later) line, measured without the hang, keeps the default stop', () => {
    expect(layoutTabLine(54, [seg(40), seg(10)], [], DEFAULT_TAB).x).toEqual([54, 144]);
  });
  it('the nearer of the hang and an explicit stop wins; a stop at the hang keeps its alignment', () => {
    expect(tabAdvance(0, [{ pos: 30, align: 'left' }], DEFAULT_TAB, seg(10), { hang: 54 })).toBe(30);
    expect(tabAdvance(0, [{ pos: 100, align: 'left' }], DEFAULT_TAB, seg(10), { hang: 54 })).toBe(54);
    expect(tabAdvance(0, [{ pos: 54.5, align: 'right' }], DEFAULT_TAB, seg(20), { hang: 54 })).toBe(34.5);
    // Past the hang the stop does nothing.
    expect(tabAdvance(60, [], DEFAULT_TAB, seg(0), { hang: 54 })).toBe(84);
    // A hang beyond the next default stop loses to it.
    expect(tabAdvance(0, [], DEFAULT_TAB, seg(0), { hang: 200 })).toBe(144);
  });
  it('the first line of a paragraph knows its start, hang and right edge', () => {
    const box = (more: Partial<SlideElement>) => ({ w: 600, ...more }) as SlideElement;
    expect(firstLineTabs(box({ paragraphs: [{ text: '1.\tx', marginLeft: 54, firstIndent: -54 }] }), 0, false)).toEqual({ start: 0, hang: 54, right: 600 });
    // A bullet fills the hanging indent: the text starts at the margin, no implicit stop.
    expect(firstLineTabs(box({ paragraphs: [{ text: 'x\ty', marginLeft: 54, firstIndent: -54 }] }), 0, true)).toEqual({ start: 54, right: 600 });
    // Right to left: no implicit stop (DeckCraft keeps it to LTR lines).
    expect(firstLineTabs(box({ rtl: true, paragraphs: [{ text: 'x\ty', marginLeft: 54, firstIndent: -54 }] }), 0, false).hang).toBeUndefined();
    // No hanging first line: no stop. The box's margins narrow the right edge.
    expect(firstLineTabs(box({ margins: [10, 0, 20, 0], firstIndent: 30 }), 0, false)).toEqual({ start: 30, right: 570 });
  });
});

describe('a tab stop past the right margin sits at it (5a6add63, 1add4c13, a0f0ad57)', () => {
  it('right-aligned text after a stop past the edge ends at the edge', () => {
    expect(tabAdvance(0, [{ pos: 1400, align: 'right' }], DEFAULT_TAB, seg(200), { right: 1200 })).toBe(1000);
    expect(tabAdvance(0, [{ pos: 1400, align: 'right' }], DEFAULT_TAB, seg(200), { right: 1600 })).toBe(1200);
  });
  it('the edge is absolute: an indented line clamps to the same edge', () => {
    expect(tabAdvance(200, [{ pos: 1100, align: 'right' }], DEFAULT_TAB, seg(200), { right: 1200 })).toBe(700);
    expect(tabAdvance(200, [{ pos: 1400, align: 'right' }], DEFAULT_TAB, seg(200), { right: 1200 })).toBe(800);
  });
  it('a stop past the edge is compared with the hang where it takes effect, at the edge', () => {
    // DeckCraft's x 0, hang 80 pt, edge 60 pt, a right stop at 700 pt with 20 pt of text: 40 pt.
    expect(tabAdvance(0, [{ pos: 1400, align: 'right' }], DEFAULT_TAB, seg(40), { hang: 160, right: 120 })).toBe(80);
  });
});

describe('Hide During Show (edb303d9)', () => {
  it('keeps audio hidden while it plays; a video shows while it plays', () => {
    const hide = { hideDuringShow: true };
    expect(hiddenDuringShow('audio', hide, false)).toBe(true);
    expect(hiddenDuringShow('audio', hide, true)).toBe(true);
    expect(hiddenDuringShow('video', hide, false)).toBe(true);
    expect(hiddenDuringShow('video', hide, true)).toBe(false);
    for (const kind of ['audio', 'video'] as const) for (const playing of [false, true]) expect(hiddenDuringShow(kind, {}, playing)).toBe(false);
  });
});

describe('chart legend keys (0175c6c2, ca819f14, 6df9331b)', () => {
  const base: ChartData = { kind: 'line', categories: ['a', 'b'], series: [{ name: 'A', values: [1, 2], color: '#ff0000' }], legend: true };
  it('a line chart’s key is the series line; a column chart keeps its square', () => {
    const svg = chartSvg(base, 800, 500)!;
    expect(svg).toMatch(/<line [^>]*stroke="#ff0000"/);
    expect(svg).not.toContain('fill="#ff0000"/><text');
    expect(chartSvg({ ...base, kind: 'column' }, 800, 500)).toContain('fill="#ff0000"/><text');
  });

  const theme = { colors: { accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', tx1: '#000000', dk1: '#000000', lt1: '#ffffff' } } as unknown as DmlTheme;
  const pieXml = `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:pieChart><c:ser><c:tx><c:v>S</c:v></c:tx>
    <c:dPt><c:idx val="0"/><c:spPr><a:solidFill><a:srgbClr val="FF00FF"/></a:solidFill></c:spPr></c:dPt>
    <c:dPt><c:idx val="2"/><c:spPr><a:solidFill><a:srgbClr val="00FFFF"/></a:solidFill></c:spPr></c:dPt>
    <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>x</c:v></c:pt><c:pt idx="1"><c:v>y</c:v></c:pt><c:pt idx="2"><c:v>z</c:v></c:pt></c:strCache></c:strRef></c:cat>
    <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
    </c:ser></c:pieChart></c:plotArea><c:legend/></c:chart></c:chartSpace>`;

  it('reads a pie’s c:dPt colours and draws slice and legend key in them', () => {
    const res = readChart(parseMarkup(pieXml), theme)!;
    expect(res.chart.series[0].pointColors?.map((c) => c?.toLowerCase() ?? null)).toEqual(['#ff00ff', null, '#00ffff']);
    const svg = chartSvg(res.chart, 800, 500)!.toLowerCase();
    expect(svg.split('fill="#ff00ff"').length - 1).toBe(2);
    expect(svg.split('fill="#00ffff"').length - 1).toBe(2);
  });

  it('writes the slice colours back to PowerPoint', async () => {
    const el = { ...makeChart('pie'), id: 'c' } as SlideElement;
    el.chart = { ...el.chart!, series: [{ ...el.chart!.series[0], pointColors: ['#ff00ff'] }] };
    const p: Presentation = { id: 'd', title: 't', themeId: 'theme_classic', slides: [{ id: 's', group: 'Slide', text: '', elements: [el] }] };
    const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [p] }, { presentation: p });
    const z = await JSZip.loadAsync((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
    const xml = (await Promise.all(Object.keys(z.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).map((f) => z.file(f)!.async('string')))).join('');
    expect(xml.toUpperCase()).toContain('FF00FF');
  });
});
