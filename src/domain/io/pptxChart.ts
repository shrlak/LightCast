// A PowerPoint chart part (c:chartSpace) → LightCast's editable chart: its type, categories, series
// with their cached values and colours, title, legend, data labels and gridlines. Everything the
// engine's chart cannot show (axis formats, trendlines, error bars, secondary styling) is listed in
// `approximated` for the import report.
import type { ChartData, ChartKind, ChartSeries, ChartSeriesKind } from '../../engine';
import { colorOf, type DmlTheme } from './drawingml';
import { child, find, kids, local, path, textOf, type MNode } from './markup';

const colorIn = (n: MNode | null | undefined, theme: DmlTheme) => (n ? colorOf(n.children.find((c) => /Clr$/.test(local(c))), theme) : null);

/** Points of a c:strCache / c:numCache, in index order (missing points are empty / 0). */
function cache(ref: MNode | null): string[] {
  const c = ref && (find(ref, 'strCache')[0] ?? find(ref, 'numCache')[0] ?? find(ref, 'strLit')[0] ?? find(ref, 'numLit')[0]);
  if (!c) return [];
  const n = Math.min(10000, Number(child(c, 'ptCount')?.attrs.val ?? 0));
  const pts = kids(c, 'pt');
  const out: string[] = Array.from({ length: Math.max(n, pts.length) }, () => '');
  for (const p of pts) {
    const i = Number(p.attrs.idx);
    if (Number.isInteger(i) && i >= 0 && i < 10000) out[i] = textOf(child(p, 'v') ?? p);
  }
  return out;
}
const nums = (ref: MNode | null) => cache(ref).map((v) => (v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v)));
/** Multi-level categories: c:multiLvlStrCache → the innermost level. */
function categories(cat: MNode | null): string[] {
  const multi = cat && find(cat, 'multiLvlStrCache')[0];
  if (multi) {
    const lvl = kids(multi, 'lvl')[0];
    return kids(lvl, 'pt').map((p) => textOf(child(p, 'v') ?? p));
  }
  return cache(cat);
}

function richText(tx: MNode | null): string | undefined {
  if (!tx) return undefined;
  const rich = child(tx, 'rich');
  if (rich) return kids(rich, 'p').map((p) => find(p, 't').map(textOf).join('')).join('\n') || undefined;
  return cache(child(tx, 'strRef'))[0] || undefined;
}

export interface ChartResult { chart: ChartData; approximated: string[] }

/** The chart of a c:chartSpace part; null when it holds no plot the engine can draw. */
export function readChart(xml: MNode, theme: DmlTheme): ChartResult | null {
  const chartEl = find(xml, 'chart')[0];
  const plot = child(chartEl, 'plotArea');
  if (!plot) return null;
  const plots = plot.children.filter((c) => /Chart$/.test(local(c)) && local(c) !== 'chart');
  if (!plots.length) return null;
  const approximated: string[] = [];
  const kindOf = (p: MNode): ChartKind | null => {
    const grouping = child(p, 'grouping')?.attrs.val ?? 'clustered';
    const stack = grouping === 'stacked' ? 'Stacked' : grouping === 'percentStacked' ? 'Percent' : '';
    switch (local(p)) {
      case 'barChart': case 'bar3DChart': {
        const bar = child(p, 'barDir')?.attrs.val === 'bar';
        return `${bar ? 'bar' : 'column'}${stack}` as ChartKind;
      }
      case 'lineChart': case 'line3DChart': {
        if (stack) return 'lineStacked';
        const markers = child(p, 'marker')?.attrs.val !== '0' && kids(p, 'ser').some((s) => path(s, 'marker', 'symbol')?.attrs.val !== 'none');
        return markers ? 'lineMarkers' : 'line';
      }
      case 'pieChart': case 'pie3DChart': case 'ofPieChart': return 'pie';
      case 'doughnutChart': return 'doughnut';
      case 'areaChart': case 'area3DChart': return stack ? 'areaStacked' : 'area';
      case 'scatterChart': return 'scatter';
      case 'bubbleChart': return 'bubble';
      case 'radarChart': return child(p, 'radarStyle')?.attrs.val === 'filled' ? 'radarFilled' : 'radar';
      case 'stockChart': return 'stock';
      case 'surfaceChart': case 'surface3DChart': return 'surface';
      default: return null;
    }
  };
  const kinds = plots.map(kindOf);
  if (kinds.every((k) => !k)) return null;
  if (plots.some((p) => /3D/.test(local(p)))) approximated.push('3차원 차트는 평면 차트로');
  if (plots.some((p) => local(p) === 'ofPieChart')) approximated.push('원형 대 원형 차트는 원형 차트로');
  const combo = new Set(kinds.filter(Boolean)).size > 1;
  let cats: string[] = [];
  const series: ChartSeries[] = [];
  for (const [pi, p] of plots.entries()) {
    const k = kinds[pi];
    if (!k) { approximated.push(`${local(p)} 계열 제외`); continue; }
    const secondary = pi > 0 && combo;
    for (const s of kids(p, 'ser')) {
      const name = cache(path(s, 'tx', 'strRef'))[0] ?? textOf(path(s, 'tx', 'v') ?? { name: '', attrs: {}, children: [] });
      const isXy = k === 'scatter' || k === 'bubble';
      const values = nums(child(s, isXy ? 'yVal' : 'val'));
      if (!cats.length) cats = isXy ? cache(child(s, 'xVal')) : categories(child(s, 'cat'));
      const color = colorIn(path(s, 'spPr', 'solidFill'), theme)?.hex ?? colorIn(path(s, 'spPr', 'ln', 'solidFill'), theme)?.hex;
      const ser: ChartSeries = { name: name || `계열 ${series.length + 1}`, values, ...(color ? { color } : {}) };
      if (isXy) ser.xValues = nums(child(s, 'xVal'));
      if (k === 'bubble') ser.sizes = nums(child(s, 'bubbleSize'));
      if (combo) {
        const sk: ChartSeriesKind = /^line/.test(k) ? (k === 'lineMarkers' ? 'lineMarkers' : 'line') : /^area/.test(k) ? 'area' : 'column';
        ser.kind = sk;
        if (secondary) ser.secondaryAxis = kids(plot, 'valAx').length > 1;
      }
      if (child(s, 'trendline')) approximated.push('추세선');
      if (child(s, 'errBars')) approximated.push('오차 막대');
      series.push(ser);
    }
  }
  if (!series.length) return null;
  // Series without a colour of their own take the theme's accents in turn, as PowerPoint's default chart style does.
  const pie = kinds.every((k) => k === 'pie' || k === 'doughnut');
  if (!pie) series.forEach((s, i) => { if (!s.color) s.color = theme.colors[`accent${(i % 6) + 1}`]; });
  const first = kinds.find(Boolean)!;
  const n = Math.max(cats.length, ...series.map((s) => s.values.length));
  while (cats.length < n) cats.push(String(cats.length + 1));
  const title = child(chartEl, 'title');
  const autoDeleted = child(chartEl, 'autoTitleDeleted')?.attrs.val === '1';
  const titleText = title ? richText(child(title, 'tx')) ?? (series.length === 1 ? series[0].name : undefined) : !autoDeleted && series.length === 1 && /pie|doughnut/.test(first) ? series[0].name : undefined;
  const dLbls = find(plot, 'dLbls').some((d) => ['showVal', 'showPercent', 'showCatName'].some((k) => child(d, k)?.attrs.val === '1'));
  const grid = find(plot, 'majorGridlines').length > 0;
  const txColor = colorIn(find(xml, 'txPr').map((t) => find(t, 'solidFill')[0]).find(Boolean), theme)?.hex;
  const chart: ChartData = {
    kind: combo ? 'combo' : first, categories: cats.slice(0, n), series,
    ...(titleText ? { title: titleText } : {}),
    legend: !!child(chartEl, 'legend'),
    ...(dLbls ? { dataLabels: true } : {}),
    gridlines: grid,
    textColor: txColor ?? theme.colors.tx1 ?? theme.colors.dk1,
    ...(child(plots[0], 'upDownBars') ? { upDownBars: true } : {}),
  };
  return { chart, approximated: [...new Set(approximated)] };
}

const EX_KIND: Record<string, ChartKind> = { waterfall: 'waterfall', funnel: 'funnel', treemap: 'treemap', sunburst: 'sunburst', boxWhisker: 'boxWhisker', clusteredColumn: 'histogram', paretoLine: 'pareto', regionMap: 'column' };
const NULL: MNode = { name: '#root', attrs: {}, children: [] };

/** A PowerPoint 2016 chart part (cx:chartSpace: waterfall, funnel, treemap, sunburst, box & whisker, histogram). */
export function readChartEx(xml: MNode, theme: DmlTheme): ChartResult | null {
  const approximated: string[] = [];
  const dataById = new Map(find(xml, 'data').map((d) => [d.attrs.id, d]));
  const series: ChartSeries[] = [];
  let kind: ChartKind | null = null;
  let cats: string[] = [];
  let levels: string[][] | undefined;
  for (const s of find(xml, 'series')) {
    const layout = s.attrs.layoutId ?? '';
    const k = EX_KIND[layout];
    if (!k) { approximated.push(`${layout} 계열`); continue; }
    if (layout === 'paretoLine') { kind = 'pareto'; continue; }
    if (layout === 'regionMap') approximated.push('지도 차트는 세로 막대로');
    kind = kind ?? k;
    const data = dataById.get(child(s, 'dataId')?.attrs.val ?? '') ?? find(xml, 'data')[0];
    const lvlPts = (dim: MNode | undefined) => kids(dim ? child(dim, 'lvl') : null, 'pt').map((p) => ({ i: Number(p.attrs.idx), v: textOf(p) }));
    const num = find(data ?? NULL, 'numDim').find((d) => (d.attrs.type ?? 'val') === 'val' || d.attrs.type === 'size');
    const str = find(data ?? NULL, 'strDim').find((d) => d.attrs.type === 'cat');
    const values: number[] = [];
    for (const p of lvlPts(num)) if (Number.isInteger(p.i) && p.i >= 0 && p.i < 10000) values[p.i] = Number(p.v) || 0;
    for (let i = 0; i < values.length; i++) values[i] = values[i] ?? 0;
    if (!cats.length && str) {
      const lv = kids(str, 'lvl').map((l) => kids(l, 'pt').map((p) => textOf(p)));
      cats = lv[0] ?? [];
      if (lv.length > 1) levels = lv.slice(1);
    }
    const name = find(child(s, 'tx') ?? NULL, 'v').map(textOf).join('') || `계열 ${series.length + 1}`;
    const color = colorIn(path(s, 'spPr', 'solidFill'), theme)?.hex;
    series.push({ name, values, ...(color ? { color } : {}) });
  }
  if (!kind || !series.length) return null;
  const n = Math.max(...series.map((s) => s.values.length));
  while (cats.length < n) cats.push(String(cats.length + 1));
  const titleNode = find(xml, 'title')[0] ?? NULL;
  const title = [...find(titleNode, 'v'), ...find(titleNode, 't')].map(textOf).join('') || undefined;
  const subtotals = find(xml, 'subtotals').flatMap((st) => kids(st, 'idx').map((i) => Number(i.attrs.val))).filter((v) => Number.isInteger(v));
  return {
    chart: { kind, categories: cats.slice(0, n), series, ...(title ? { title } : {}), legend: find(xml, 'legend').length > 0, gridlines: false, textColor: theme.colors.tx1 ?? theme.colors.dk1, ...(subtotals.length ? { subtotals } : {}), ...(levels ? { categoryLevels: levels } : {}) },
    approximated: [...new Set(approximated)],
  };
}
