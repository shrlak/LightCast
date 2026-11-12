import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { chartSvg, type ChartData, type ChartKind } from '../src/engine';
import {
  addLevel, addRow, addSeries, ALL_CHART_KINDS, applyChartStyle, CHART_GROUPS, CHART_LABEL, CHART_STYLES, chartRows, chartTraits, convertChart, histogramColumns,
  pptxPlan, removeLevel, removeRow, removeSeries, resizeChart, sampleChart, switchRowColumn, toggleSubtotal,
} from '../src/domain/chartTypes';
import { makeChart } from '../src/domain/editOps';
import { buildPptx } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Presentation } from '../src/domain/types';

const svgOf = (c: ChartData, w = 800, h = 500) => chartSvg({ ...c, textColor: '#ffffff' }, w, h)!;
const count = (s: string, pat: string) => s.split(pat).length - 1;

describe('chart type gallery', () => {
  it('lists every type once, with PowerPoint\'s Korean names', () => {
    expect(new Set(ALL_CHART_KINDS).size).toBe(ALL_CHART_KINDS.length);
    expect(ALL_CHART_KINDS.length).toBe(27);
    for (const k of ALL_CHART_KINDS) expect(CHART_LABEL[k], k).toBeTruthy();
    const label = (k: ChartKind) => CHART_LABEL[k];
    expect(['waterfall', 'histogram', 'pareto', 'boxWhisker', 'treemap', 'sunburst', 'funnel', 'radar', 'radarFilled', 'stock', 'surface', 'combo', 'bubble'].map((k) => label(k as ChartKind)))
      .toEqual(['폭포', '히스토그램', '파레토', '상자 수염', '트리맵', '선버스트', '깔때기', '방사형', '채워진 방사형', '주식형(시가-고가-저가-종가)', '표면형(등고선)', '콤보', '거품형']);
    expect(CHART_GROUPS.flatMap((g) => g.kinds)).toEqual(ALL_CHART_KINDS);
  });

  it('every type\'s sample is a valid chart the engine draws with its own marks', () => {
    for (const k of ALL_CHART_KINDS) {
      const c = sampleChart(k);
      expect(c.kind).toBe(k);
      const svg = svgOf(c);
      expect(svg.startsWith('<svg'), k).toBe(true);
      expect(svg, k).not.toContain('NaN');
      expect(makeChart(k).chart!.kind).toBe(k);
    }
  });

  it('the data shapes match the types', () => {
    expect(sampleChart('waterfall').subtotals).toEqual([0, 4]);
    expect(sampleChart('histogram').series[0].values.length).toBeGreaterThan(10);
    expect(sampleChart('histogram').categories).toEqual([]);
    expect(new Set(sampleChart('boxWhisker').categories)).toEqual(new Set(['그룹 A', '그룹 B']));
    expect(sampleChart('treemap').categoryLevels?.[0]).toHaveLength(8);
    expect(sampleChart('stock').series.map((s) => s.name)).toEqual(['시가', '고가', '저가', '종가']);
    expect(sampleChart('bubble').series[0].sizes).toHaveLength(4);
    expect(sampleChart('combo').series.map((s) => s.kind)).toEqual(['column', 'column', 'lineMarkers']);
    expect(sampleChart('pie').series).toHaveLength(1);
    expect(chartTraits('pie').single && chartTraits('funnel').single && !chartTraits('column').single).toBe(true);
  });
});

describe('what the engine draws for each type', () => {
  it('waterfall: running bars, totals standing, the three legend roles', () => {
    const svg = svgOf(sampleChart('waterfall'));
    for (const t of ['증가', '감소', '합계']) expect(svg).toContain(t);
    expect(count(svg, 'stroke-opacity="0.5"')).toBe(4); // four connectors between five bars
    expect(svgOf({ ...sampleChart('waterfall'), subtotals: [] })).not.toBe(svg);
  });

  it('histogram bins follow the count and the width; a Pareto sorts them and adds a cumulative %', () => {
    const c: ChartData = { ...sampleChart('histogram'), series: [{ name: 'v', values: [1, 2, 2, 3, 4, 5, 9] }], binCount: 4, legend: false };
    const svg = svgOf(c);
    expect(svg).toContain('[1, 3]');
    expect(svg).toContain('(3, 5]');
    expect(count(svgOf({ ...c, binCount: undefined, binSize: 5 }), 'stroke-opacity="0.7"')).toBe(2);
    const p = svgOf({ ...c, kind: 'pareto', legend: true });
    expect(p).toContain('100%');
    expect(p).toContain('누적 %');
  });

  it('the browser-side bins agree with the engine\'s (they feed the exported chart)', () => {
    for (const bins of [{}, { binCount: 5 }, { binSize: 7 }]) {
      const c: ChartData = { ...sampleChart('histogram'), ...bins };
      const h = histogramColumns(c);
      const svg = svgOf(c);
      expect(h.counts.reduce((a, b) => a + b, 0)).toBe(c.series[0].values.length);
      // One bar per bin (an empty bin is a zero-height bar) and the first bin's label, as the engine writes it.
      expect(count(svg, 'stroke-opacity="0.7"')).toBe(h.labels.length);
      expect(svg).toContain(h.labels[0]);
    }
    const par = histogramColumns({ ...sampleChart('pareto'), binCount: 4 });
    expect(par.counts).toEqual([...par.counts].sort((a, b) => b - a));
    expect(par.cumulative[par.cumulative.length - 1]).toBeCloseTo(100);
  });

  it('box and whisker: a box per group and series, with outliers; the quartile method matters', () => {
    const c: ChartData = { kind: 'boxWhisker', categories: ['A', 'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'B'], series: [{ name: 's', values: [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 90] }], legend: false };
    const svg = svgOf(c);
    expect(count(svg, 'fill-opacity="0.85"')).toBe(2);
    expect(svg).toContain('<circle');
    expect(svgOf({ ...c, inclusiveQuartiles: true })).not.toBe(svg);
  });

  it('treemap and sunburst read the outer levels', () => {
    const tm = svgOf({ ...sampleChart('treemap'), legend: false });
    expect(tm).toContain('1분기');
    expect(count(tm, '<rect')).toBe(3 + 8); // three groups, eight leaves
    expect(count(svgOf({ ...sampleChart('sunburst'), legend: false }), '<path')).toBe(11);
    // Without levels: a flat treemap.
    expect(count(svgOf({ ...sampleChart('treemap'), categoryLevels: [], legend: false }), '<rect')).toBe(8);
  });

  it('funnel, radar, stock, surface, bubble and combo', () => {
    expect(count(svgOf(sampleChart('funnel')), '<rect')).toBe(4);
    expect(count(svgOf({ ...sampleChart('radar'), legend: false }), '<circle')).toBe(10);
    expect(svgOf(sampleChart('radarFilled'))).toContain('fill-opacity="0.55"');
    const stock = svgOf(sampleChart('stock'));
    expect(stock).toContain('fill="#404040"');
    expect(svgOf({ ...sampleChart('stock'), upDownBars: false, series: sampleChart('stock').series.slice(1) })).not.toContain('fill="#404040"');
    expect(count(svgOf(sampleChart('surface')), '<rect')).toBeGreaterThanOrEqual(25);
    expect(count(svgOf(sampleChart('bubble')), 'fill-opacity="0.6"')).toBe(8);
    expect(count(svgOf({ ...sampleChart('combo'), legend: false }), '<circle')).toBe(4); // the line's markers
  });

  it('100 % and stacked forms', () => {
    const base = sampleChart('column');
    expect(svgOf({ ...base, kind: 'columnPercent' })).toContain('>100%<');
    expect(svgOf({ ...base, kind: 'barPercent' })).toContain('>100%<');
    expect(svgOf({ ...base, kind: 'lineStacked' })).not.toBe(svgOf({ ...base, kind: 'lineMarkers' }));
    expect(svgOf({ ...base, kind: 'areaStacked' })).not.toBe(svgOf({ ...base, kind: 'area' }));
    // A plain line has no markers; with markers it has them.
    expect(svgOf({ ...base, kind: 'line' })).not.toContain('<circle');
    expect(svgOf({ ...base, kind: 'lineMarkers' })).toContain('<circle');
  });

  it('title, legend, data labels, gridlines, palette and text colour work on the new types', () => {
    for (const k of ['waterfall', 'histogram', 'pareto', 'boxWhisker', 'treemap', 'sunburst', 'funnel', 'radar', 'stock', 'surface', 'combo', 'bubble'] as ChartKind[]) {
      const c = sampleChart(k);
      expect(svgOf({ ...c, title: '제목입니다' }), k).toContain('제목입니다');
      expect(svgOf({ ...c, palette: 'monochrome2' }), k).not.toBe(svgOf({ ...c, palette: 'colorful' }));
      const white = svgOf(c);
      expect(chartSvg({ ...c, textColor: '#112233' }, 800, 500), k).toContain('#112233');
      expect(white, k).toContain('#ffffff');
    }
    // Legend off removes the legend row; data labels add text.
    const c = sampleChart('combo');
    expect(svgOf({ ...c, legend: false }).length).toBeLessThan(svgOf({ ...c, legend: true }).length);
    expect(svgOf({ ...c, dataLabels: true }).length).toBeGreaterThan(svgOf({ ...c, dataLabels: false }).length);
    for (const k of ['column', 'waterfall'] as ChartKind[]) {
      expect(count(svgOf({ ...sampleChart(k), gridlines: false }), 'stroke-opacity="0.25"')).toBe(0);
      expect(count(svgOf({ ...sampleChart(k), gridlines: true }), 'stroke-opacity="0.25"')).toBeGreaterThan(0);
    }
  });
});

describe('the data editor\'s edits', () => {
  it('rows, series and levels grow and shrink together', () => {
    let c = sampleChart('column');
    c = addRow(c);
    expect(chartRows(c)).toBe(5);
    expect(c.categories[4]).toBe('항목 5');
    expect(c.series.every((s) => s.values.length === 5)).toBe(true);
    c = removeRow(c, 0);
    expect(c.categories[0]).toBe('항목 2');
    c = addSeries(c);
    expect(c.series[3].values).toHaveLength(4);
    c = removeSeries(c, 3);
    expect(c.series).toHaveLength(3);
    expect(removeSeries({ ...c, series: [c.series[0]] }, 0).series).toHaveLength(1);

    let t = sampleChart('treemap');
    t = addLevel(t);
    expect(t.categoryLevels).toHaveLength(2);
    expect(t.categoryLevels![1]).toHaveLength(8);
    t = removeRow(t, 0);
    expect(t.categoryLevels!.every((l) => l.length === 7)).toBe(true);
    expect(removeLevel(t, 1).categoryLevels).toHaveLength(1);
  });

  it('waterfall totals follow their rows', () => {
    let c = sampleChart('waterfall');
    expect(c.subtotals).toEqual([0, 4]);
    c = toggleSubtotal(c, 2);
    expect(c.subtotals).toEqual([0, 2, 4]);
    c = toggleSubtotal(c, 0);
    expect(c.subtotals).toEqual([2, 4]);
    c = removeRow(c, 1);
    expect(c.subtotals).toEqual([1, 3]);
    expect(resizeChart(c, 2).subtotals).toEqual([1]);
  });

  it('histogram rows are observations without labels; bubble rows keep x and size', () => {
    const h = addRow(sampleChart('histogram'));
    expect(h.categories).toEqual([]);
    expect(h.series[0].values).toHaveLength(17);
    let b = sampleChart('bubble');
    b = addRow(b);
    expect(b.series[0].xValues).toHaveLength(5);
    expect(b.series[0].sizes).toHaveLength(5);
    expect(addSeries(b).series[2].sizes).toHaveLength(5);
  });

  it('row/column switch swaps series and categories', () => {
    const c = switchRowColumn(sampleChart('column'));
    expect(c.categories).toEqual(['계열 1', '계열 2', '계열 3']);
    expect(c.series.map((s) => s.name)).toEqual(['항목 1', '항목 2', '항목 3', '항목 4']);
    expect(c.series[0].values).toEqual([4.3, 2.4, 2]);
  });
});

describe('changing the type keeps the data', () => {
  it('keeps categories and series between plain types and shapes the rest', () => {
    const col = sampleChart('column');
    expect(convertChart(col, 'line').series).toEqual(col.series);
    const combo = convertChart(col, 'combo');
    expect(combo.series.map((s) => s.kind)).toEqual(['column', 'column', 'lineMarkers']);
    expect(convertChart(combo, 'column').series.some((s) => s.kind)).toBe(false);
    const bubble = convertChart(col, 'bubble');
    expect(bubble.series[0].xValues).toEqual([1, 2, 3, 4]);
    expect(bubble.series[0].sizes).toHaveLength(4);
    expect(convertChart(col, 'histogram').categories).toEqual(col.categories);
    // Going through a type without row labels and back keeps them (and names unnamed rows).
    expect(convertChart(convertChart(col, 'histogram'), 'column').categories).toEqual(col.categories);
    expect(convertChart({ ...col, categories: [] }, 'treemap').categories).toEqual(['항목 1', '항목 2', '항목 3', '항목 4']);
    expect(convertChart(col, 'boxWhisker').categories).toHaveLength(4);
  });

  it('a type that cannot use the data starts from its own sample but keeps the look', () => {
    const one = { ...sampleChart('pie'), title: '제목', palette: 'monochrome2', dataLabels: true };
    const stock = convertChart(one, 'stock');
    expect(stock.series).toHaveLength(4);
    expect(stock.title).toBe('제목');
    expect(stock.palette).toBe('monochrome2');
    expect(convertChart({ ...sampleChart('column'), categories: ['a', 'b'], series: [{ name: 'x', values: [1, 2] }] }, 'radar').categories).toHaveLength(5);
  });

  it('chart styles set layout and colours', () => {
    expect(CHART_STYLES.length).toBeGreaterThanOrEqual(6);
    const c = applyChartStyle(sampleChart('column'), 'style5');
    expect(c).toMatchObject({ dataLabels: true, gridlines: true, palette: 'monochrome1' });
    expect(applyChartStyle(c, 'nope')).toEqual(c);
  });
});

describe('PowerPoint export of the new types', () => {
  const plan = (k: ChartKind) => pptxPlan(k);

  it('says which types become a native chart, a close type or a picture', () => {
    for (const k of ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'bubble', 'radar', 'radarFilled', 'columnPercent', 'lineStacked', 'areaStacked'] as ChartKind[]) expect(plan(k).mode, k).toBe('native');
    for (const k of ['histogram', 'pareto', 'combo'] as ChartKind[]) expect(plan(k), k).toMatchObject({ mode: 'native', near: expect.any(String) });
    for (const k of ['waterfall', 'funnel', 'boxWhisker', 'treemap', 'sunburst', 'stock', 'surface'] as ChartKind[]) expect(plan(k).mode, k).toBe('picture');
  });

  async function exported(kind: ChartKind) {
    const p: Presentation = { id: 'd', title: 't', themeId: 'theme_classic', slides: [{ id: 's', group: 'Slide', text: '', elements: [{ ...makeChart(kind), id: 'c' }] }] };
    const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [p] }, { presentation: p });
    return JSZip.loadAsync((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
  }
  const chartXml = async (z: JSZip) => Promise.all(Object.keys(z.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).map((f) => z.file(f)!.async('string')));

  it('native types write a chart part of the right family', async () => {
    const want: Record<string, string[]> = {
      radar: ['c:radarChart', 'c:radarStyle val="marker"'], radarFilled: ['c:radarChart', 'c:radarStyle val="filled"'], bubble: ['c:bubbleChart'],
      columnPercent: ['c:barChart', 'c:grouping val="percentStacked"'], lineStacked: ['c:lineChart'], areaStacked: ['c:areaChart', 'c:grouping val="stacked"'],
      histogram: ['c:barChart', 'c:gapWidth val="0"'], pareto: ['c:barChart', 'c:lineChart'], combo: ['c:barChart', 'c:lineChart'],
    };
    for (const [k, parts] of Object.entries(want)) {
      const xml = (await chartXml(await exported(k as ChartKind))).join('\n');
      for (const part of parts) expect(xml, `${k} ${part}`).toContain(part);
    }
  });

  it('the Office 2016 types go as a picture, not as a wrong chart', async () => {
    for (const k of ['waterfall', 'funnel', 'boxWhisker', 'treemap', 'sunburst', 'stock', 'surface'] as ChartKind[]) {
      const z = await exported(k);
      expect((await chartXml(z)).length, k).toBe(0);
      expect(Object.keys(z.files).some((f) => /^ppt\/media\/.*\.(svg|png)$/.test(f)), k).toBe(true);
    }
  });

  it('a stacked line goes as the running totals of a plain line chart', async () => {
    const xml = (await chartXml(await exported('lineStacked'))).join('\n');
    // Series 1 is 4.3 2.5 3.5 4.5 and series 2 2.4 4.4 1.8 2.8: the second line is their sum.
    expect(xml).toContain('<c:v>6.7</c:v>');
    expect(pptxPlan('lineStacked')).toMatchObject({ near: 'cumulative' });
  });

  it('every combo series keeps its own type in the file', async () => {
    const xml = (await chartXml(await exported('combo'))).join('\n');
    expect(xml).toContain('<c:barChart>');
    expect(xml.match(/<c:ser>/g)).toHaveLength(3);
  });
});
