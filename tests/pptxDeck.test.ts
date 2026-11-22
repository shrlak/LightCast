// The full PPTX reader (domain/io/pptxDeck.ts) on the decks in tests/fixtures/real/pptx (see its README):
// what each kind of component becomes and what the import report says about it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PPTX_LIMITS, readPptxDeck } from '../src/domain/io/pptxDeck';
import { reportLines, reportSummary, type ImportReport } from '../src/domain/io/importReport';
import { custGeomPath, drawingToElements, OFFICE_THEME } from '../src/domain/io/drawingml';
import { parseMarkup } from '../src/domain/io/markup';
import type { Slide, SlideElement } from '../src/domain/types';

const fixture = (name: string) => readFileSync(`tests/fixtures/real/pptx/${name}`);
async function read(name: string | Uint8Array) {
  const stored: { name: string; type: string; size: number }[] = [];
  const r = await readPptxDeck(typeof name === 'string' ? fixture(name) : name, {
    file: typeof name === 'string' ? name : 'deck.pptx', group: 'Deck',
    store: async (blob, n, type) => { stored.push({ name: n, type, size: blob.size }); return `${type}-${stored.length}`; },
  });
  return { ...r, stored };
}
const item = (r: ImportReport, label: string) => r.items.filter((i) => i.label === label);
const els = (s: Slide, kind?: SlideElement['kind']) => (s.elements ?? []).filter((e) => !kind || e.kind === kind);
const byText = (s: Slide, t: string) => els(s).find((e) => e.text?.startsWith(t))!;

describe('PPTX deck reader: text', () => {
  it('keeps run formatting, links, bullets, numbering, spacing, columns and vertical text', async () => {
    const { slides } = await read('text.pptx');
    const runs = byText(slides[0], 'Run properties').runs![0];
    const run = (t: string) => runs.find((r) => r.text.startsWith(t))!;
    expect(run('bold')).toMatchObject({ bold: true });
    expect(run('italic')).toMatchObject({ italic: true });
    expect(run('under')).toMatchObject({ underline: true });
    expect(run('strike')).toMatchObject({ strike: true });
    expect(run('red')).toMatchObject({ color: '#cc0000' });
    expect(run('x')).toMatchObject({ baseline: 'super' });
    expect(run('2')).toMatchObject({ baseline: 'sub' });
    expect(run(' spaced')).toMatchObject({ letterSpacing: 6 });
    expect(run('highlight')).toMatchObject({ highlight: '#ffff00' });
    expect(run(' link')).toMatchObject({ link: 'https://example.com' });
    const list = byText(slides[0], 'Level 0');
    expect(list.paragraphs!.map((p) => [p.list, p.level ?? 0])).toEqual([['bullet', 0], ['bullet', 1], ['bullet', 2], ['number', 0], ['number', 0], ['alpha-lower-paren', 1]]);
    const spaced = byText(slides[0], 'Left aligned');
    expect(spaced.paragraphs!.map((p) => p.align)).toEqual(['left', 'center', 'right', 'justify']);
    expect(spaced.paragraphs![0].lineHeight).toBeCloseTo(1.8);
    expect(spaced.paragraphs![1].spaceBefore).toBe(24);
    expect(byText(slides[0], 'Two columns').columns).toBe(2);
    expect(byText(slides[0], 'Vertical').vertical).toBe(true);
    expect(byText(slides[0], 'Rotated').rotation).toBe(15);
    expect(byText(slides[0], 'Anchor bottom')).toMatchObject({ kind: 'shape', fill: '#ddeeff', vAlign: 'bottom' });
    // Shrink on overflow: the 70 % font scale PowerPoint saved.
    expect(byText(slides[0], 'No wrap').fontSize).toBe(28);
  });

  it('placeholders take their place and text style from the layout and master', async () => {
    const { slides } = await read('text.pptx');
    const title = byText(slides[1], 'Title placeholder');
    expect(title).toMatchObject({ kind: 'text', x: 108, w: 1224, fontSize: 88, align: 'center' });
    // tx1 with a 75 % tint, mixed in linear light as PowerPoint does (#404040 would be the sRGB mix).
    expect(byText(slides[1], 'Subtitle').color).toBe('#898989');
    const body = byText(slides[2], 'First bullet');
    expect(body.list).toBe('bullet');
    expect(body.paragraphs!.map((p) => p.level ?? 0)).toEqual([0, 1, 2, 0]);
    expect(body.paragraphs!.map((p) => p.list)).toEqual(['bullet', 'dash', 'bullet', 'bullet']);
  });
});

describe('PPTX deck reader: shapes, pictures and backgrounds', () => {
  it('reads preset shapes, fills, lines, effects, freeforms, groups and pictures; scales 16:9 into the 4:3 canvas', async () => {
    const { slides, report, stored } = await read('shapes-16x9.pptx');
    const s = slides[0];
    const shapes = els(s, 'shape');
    expect(shapes.map((e) => e.shape).slice(0, 16)).toEqual(['roundRect', 'ellipse', 'triangle', 'rightArrow', 'star5', 'heart', 'cloud', 'chevron', 'donut', 'blockArc', 'rightBrace', 'flowChartDecision', 'wave', 'lightningBolt', 'moon', 'wedgeRectCallout']);
    expect(shapes[3].adj).toEqual([30000, 80000]);
    // 13.33 in wide → 1440 px: every slide coordinate × 0.75, centred vertically.
    expect(shapes[0]).toMatchObject({ x: 43.2, y: 178.2, w: 140.4, h: 129.6 });
    expect(byText(s, 'grad 3-stop').gradientStops!.map((g) => g.color)).toEqual(['#ff0000', '#ffff00', '#0000ff']);
    expect(byText(s, 'radial').gradientType).toBe('radial');
    expect(byText(s, 'pattern').pattern).toEqual({ kind: 'dkUpDiag', fg: '#0000aa', bg: '#ffffff' });
    expect(byText(s, 'alpha').fillTransparency).toBe(0.6);
    expect(byText(s, 'shadow+glow')).toMatchObject({ dropShadow: true, glow: '#ff0000', shadowOpts: { dist: 9, dir: 45, transparency: 0.5 } });
    const lines = shapes.filter((e) => e.shape === 'line');
    expect(lines.map((l) => l.dash)).toEqual(['dash', 'sysDot', 'lgDashDot']);
    expect(lines[1]).toMatchObject({ arrowStart: true, arrowStartKind: 'oval', arrowEnd: true, arrowEndKind: 'arrow' });
    expect(shapes.find((e) => e.shape === 'bentConnector3')!.compound).toBe('double');
    const free = shapes.find((e) => e.path)!;
    expect(free.path).toMatch(/^M274320 0 L1188720 0 .* Z$/);
    const group = shapes.filter((e) => e.groupId);
    expect(group).toHaveLength(2);
    expect(new Set(group.map((e) => e.groupId)).size).toBe(1);
    const [cropped, round] = els(s, 'image');
    expect(cropped).toMatchObject({ crop: [0.2, 0.1, 0.1, 0], stroke: '#006400' });
    expect(round.maskShape).toBe('ellipse');
    expect(stored.filter((m) => m.type === 'image')).toHaveLength(2);
    expect(slides[1].background).toEqual({ kind: 'gradient', value: 'linear-gradient(0deg, #0a1e50 0%, #5096dc 100%)' });
    expect(byText(slides[1], '3-D rotation')).toMatchObject({ rotate3d: { x: 30, y: 20 }, bevel: true, bevelKind: 'circle' });
    expect(item(report, '슬라이드 크기')[0].status).toBe('approximated');
    // a:grayscl is drawn (a CSS filter on the picture), so nothing is reported.
    expect(round.pictureFilter).toBe('grayscale(1)');
    expect(item(report, '그림 색 변경')).toHaveLength(0);
  });

  it('master and layout art comes behind the slide, locked; the master background and title style apply', async () => {
    const { slides, report } = await read('master-16x9.pptx');
    for (const s of slides) {
      expect(s.background).toEqual({ kind: 'gradient', value: 'linear-gradient(180deg, #fff4d6 0%, #f5c26b 100%)' });
      expect(els(s)[0]).toMatchObject({ name: 'Logo', locked: true, shape: 'ellipse', fill: '#7a1f1f' });
    }
    expect(byText(slides[0], 'Master styled')).toMatchObject({ color: '#7a1f1f', bold: true, fontSize: 60, align: 'left' });
    expect(byText(slides[0], 'Body text')).toMatchObject({ color: '#1f3a7a', fontSize: 36 });
    expect(item(report, '마스터·레이아웃 배경 개체')[0]).toMatchObject({ status: 'converted', count: 3 });
  });
});

describe('PPTX deck reader: tables, charts, SmartArt', () => {
  it('tables keep merges, fills, borders and their built-in style', async () => {
    const { slides } = await read('tables-16x9.pptx');
    const [a, b] = els(slides[0], 'table');
    const t = a.table!;
    expect(t.rows[0][0]).toMatchObject({ text: 'Merged header', span: 2 });
    expect(t.rows[0][1].hMerge).toBe(true);
    expect(t.rows[1][0]).toMatchObject({ rowSpan: 2 });
    expect(t.rows[2][0].vMerge).toBe(true);
    expect(t.rows[3][3].fill).toBe('#ffdc64');
    expect(t.rows[3][2]).toMatchObject({ bold: true, color: '#c80000' });
    expect(t.rows[3][1].align).toBe('right');
    expect(t.rows[2][3].borders?.l).toMatchObject({ color: '#ff0000', width: 6 });
    expect(t).toMatchObject({ style: 'medium2-accent1', firstRow: true, bandRow: true });
    expect(b.table!.style).toBe('medium2-accent4');
  });

  it('charts become editable charts with their data', async () => {
    const { slides, report } = await read('charts-16x9.pptx');
    const charts = slides.flatMap((s) => els(s, 'chart')).map((e) => e.chart!);
    expect(charts.map((c) => c.kind)).toEqual(['column', 'lineMarkers', 'barStacked', 'area', 'pie', 'doughnut', 'scatter', 'radar']);
    expect(charts[0]).toMatchObject({ title: 'Clustered columns', categories: ['Q1', 'Q2', 'Q3', 'Q4'], dataLabels: true, legend: true });
    expect(charts[0].series).toEqual([
      { name: 'East', values: [20.4, 27.4, 90, 20.4], color: '#4f81bd' },
      { name: 'West', values: [30.6, 38.6, 34.6, 31.6], color: '#c0504d' },
    ]);
    expect(charts[6].series[0]).toMatchObject({ xValues: [1, 2, 3, 4], values: [2, 4, 3, 7] });
    expect(item(report, '차트')[0]).toMatchObject({ status: 'converted', count: 8, detail: '편집 가능한 차트로' });
  });

  it('SmartArt comes from its saved drawing as grouped shapes; an Office 2016 waterfall becomes a waterfall chart', async () => {
    const { slides, report } = await read('smartart-chartex.pptx');
    const s = slides[0];
    const diagram = els(s, 'shape').filter((e) => e.groupName === 'Diagram 1');
    expect(diagram.map((e) => e.text ?? e.shape)).toEqual(['계획', 'rightArrow', 'Build', 'rightArrow', 'Ship']);
    expect(new Set(diagram.map((e) => e.groupId)).size).toBe(1);
    expect(diagram[0]).toMatchObject({ shape: 'roundRect', fill: '#4472c4', color: '#ffffff', x: 119.2 });
    const chart = els(s, 'chart')[0].chart!;
    expect(chart).toMatchObject({ kind: 'waterfall', title: 'Waterfall', categories: ['Start', 'Up', 'Down', 'End'], subtotals: [0, 3] });
    expect(chart.series[0].values).toEqual([100, 30, -20, 110]);
    // The "not available" fallback text is not shown in its place.
    expect(els(s).some((e) => e.text?.includes('not available'))).toBe(false);
    expect(item(report, 'SmartArt')[0]).toMatchObject({ status: 'converted', detail: '그룹으로 묶인 도형으로' });
  });
});

describe('PPTX deck reader: notes, comments, sections, hidden slides, links, media, timing', () => {
  it('reads everything around the slides', async () => {
    const { slides, report, stored } = await read('features.pptx');
    expect(slides.map((s) => s.group)).toEqual(['Intro', 'Intro', 'Body', 'Body', 'Deck']);
    expect(slides[0].notes).toBe('These are the speaker notes.\nSecond line of notes.');
    expect(slides[0].comments).toEqual([expect.objectContaining({ author: 'Tester', text: 'Please check this slide.', at: Date.parse('2026-01-02T03:04:05.000') })]);
    expect(slides[1].disabled).toBe(true);
    expect(slides[0].transition).toMatchObject({ kind: 'fx:fade', option: 'smoothly' });
    expect(slides[2]).toMatchObject({ transition: { kind: 'fx:push', option: 'u' }, autoAdvance: 3 });
    expect(slides[3].transition).toMatchObject({ kind: 'fx:wipe', option: 'l', advanceOnClick: false });
    const anims = slides[2].animations!;
    expect(anims.map((a) => [a.effect, a.start])).toEqual([['fade', 'click'], ['fly', 'with'], ['appear', 'click']]);
    expect(anims.map((a) => els(slides[2]).find((e) => e.id === a.elementId)!.text)).toEqual(['Animated: fade on click', 'Fly in with previous', 'Appear after previous']);
    expect(byText(slides[3], 'Link to slide').runs![0][0].link).toBe('https://example.org/page');
    expect(byText(slides[3], 'Go to slide 1').action).toEqual({ kind: 'slide', slideId: slides[0].id });
    const video = els(slides[4], 'video')[0];
    const poster = els(slides[4], 'image')[0];
    expect(video.mediaId).toMatch(/^video-/);
    expect(poster).toMatchObject({ name: '포스터 프레임', groupId: video.groupId, x: video.x, w: video.w });
    expect(stored.find((m) => m.type === 'video')?.name).toBe('media1.mp4');
    expect(item(report, '구역')[0]).toMatchObject({ status: 'converted', count: 2 });
    expect(item(report, '숨긴 슬라이드')[0].slides).toEqual([2]);
    expect(item(report, '애니메이션')[0].count).toBe(3);
  });

  it('LibreOffice-written decks open with their tables, transitions and hidden slide', async () => {
    const { slides, report } = await read('libreoffice-rich.pptx');
    expect(slides).toHaveLength(5);
    expect(slides[4].disabled).toBe(true);
    expect(slides.flatMap((s) => els(s, 'table'))).toHaveLength(2);
    expect(slides.filter((s) => s.transition).length).toBe(2);
    expect(reportLines(report).every((l) => /[가-힣]/.test(l))).toBe(true);
  });
});

describe('PPTX deck reader: report and safety', () => {
  async function deck(edit: (z: JSZip) => void | Promise<void>) {
    const z = await JSZip.loadAsync(fixture('features.pptx'));
    await edit(z);
    return new Uint8Array(await z.generateAsync({ type: 'uint8array' }));
  }

  it('a damaged slide becomes an empty slide with a warning; the others still open', async () => {
    const { slides, report } = await read(await deck((z) => { z.file('ppt/slides/slide3.xml', '<p:sld><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="NaN"'); }));
    expect(slides).toHaveLength(5);
    expect(slides[0].elements?.length).toBeGreaterThan(0);
    expect(report.slideCount).toBe(5);
  });

  it('macros are reported as left out, never run; too-large media is left out and reported', async () => {
    const was = PPTX_LIMITS.mediaBytes;
    PPTX_LIMITS.mediaBytes = 100;
    try {
      const { report, slides } = await read(await deck((z) => { z.file('ppt/vbaProject.bin', new Uint8Array(10)); }));
      expect(item(report, '매크로')[0]).toMatchObject({ status: 'dropped', detail: '실행하지 않고' });
      expect(report.items.some((i) => i.status === 'dropped' && i.detail === '너무 커서')).toBe(true);
      expect(els(slides[4], 'video')).toHaveLength(0);
      expect(reportSummary(report)).toMatch(/^deck\.pptx: 슬라이드 5개를 가져왔습니다\. .*매크로 1개 제외/);
    } finally { PPTX_LIMITS.mediaBytes = was; }
  });

  it('a package with too many parts is refused', async () => {
    const was = PPTX_LIMITS.parts;
    PPTX_LIMITS.parts = 10;
    try { await expect(read('features.pptx')).rejects.toThrow(/너무 많습니다/); } finally { PPTX_LIMITS.parts = was; }
  });

  it('a chart, SmartArt or object it cannot read is reported, not silently dropped', async () => {
    const xml = await (await JSZip.loadAsync(fixture('features.pptx'))).file('ppt/slides/slide1.xml')!.async('string');
    const frame = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="40" name="Model"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2017/model3d"/></a:graphic></p:graphicFrame>';
    const { report } = await read(await deck((z) => { z.file('ppt/slides/slide1.xml', xml.replace('</p:spTree>', `${frame}</p:spTree>`)); }));
    expect(item(report, '3D 모델')[0]).toMatchObject({ status: 'dropped', slides: [1] });
  });
});

describe('DrawingML pieces', () => {
  it('a freeform with arcs and curves becomes one SVG path', () => {
    const geom = parseMarkup('<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="50"/></a:moveTo><a:arcTo wR="50" hR="50" stAng="10800000" swAng="10800000"/><a:cubicBezTo><a:pt x="100" y="80"/><a:pt x="50" y="100"/><a:pt x="0" y="50"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>').children[0];
    expect(custGeomPath(geom)).toEqual({ path: 'M0 50 A50 50 0 0 1 100 50 C100 80 50 100 0 50 Z', w: 100, h: 100 });
    // Guides it cannot evaluate: no path (drawn as a rectangle and reported).
    expect(custGeomPath(parseMarkup('<a:custGeom><a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="g1" y="0"/></a:moveTo></a:path></a:pathLst></a:custGeom>').children[0])).toBeNull();
  });

  it('a pasted shape keeps the theme fill and line its style points at', () => {
    const theme = { ...OFFICE_THEME, fills: parseMarkup('<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></a:fillStyleLst>').children[0].children };
    const [el] = drawingToElements('<p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="A"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr><p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="2"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"/></p:style></p:sp></p:spTree>', { theme });
    expect(el).toMatchObject({ gradient: [expect.any(String), '#ed7d31'], gradientAngle: 90 });
  });
});
