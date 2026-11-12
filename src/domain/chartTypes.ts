// Insert › Chart: the chart types (PowerPoint's Korean names), the sample data each starts with, how
// the data editor treats each type's data shape, switching types without losing data, chart styles and
// colour palettes, and what each type becomes in an exported .pptx.
import type { ChartData, ChartKind, ChartSeries, ChartSeriesKind } from '../engine';

export const CHART_LABEL: Record<ChartKind, string> = {
  column: '묶은 세로 막대형', columnStacked: '누적 세로 막대형', columnPercent: '100% 기준 누적 세로 막대형',
  bar: '묶은 가로 막대형', barStacked: '누적 가로 막대형', barPercent: '100% 기준 누적 가로 막대형',
  line: '꺾은선형', lineMarkers: '표식이 있는 꺾은선형', lineStacked: '표식이 있는 누적 꺾은선형',
  pie: '원형', doughnut: '도넛형', area: '영역형', areaStacked: '누적 영역형', scatter: '분산형', bubble: '거품형',
  radar: '방사형', radarFilled: '채워진 방사형', stock: '주식형(시가-고가-저가-종가)', surface: '표면형(등고선)', combo: '콤보',
  waterfall: '폭포', histogram: '히스토그램', pareto: '파레토', boxWhisker: '상자 수염', treemap: '트리맵', sunburst: '선버스트', funnel: '깔때기',
};

/** The groups of Insert › Chart, in PowerPoint's order. */
export const CHART_GROUPS: { label: string; kinds: ChartKind[] }[] = [
  { label: '세로 막대형', kinds: ['column', 'columnStacked', 'columnPercent'] },
  { label: '가로 막대형', kinds: ['bar', 'barStacked', 'barPercent'] },
  { label: '꺾은선형', kinds: ['line', 'lineMarkers', 'lineStacked'] },
  { label: '원형', kinds: ['pie', 'doughnut'] },
  { label: '영역형', kinds: ['area', 'areaStacked'] },
  { label: '분산형 및 거품형', kinds: ['scatter', 'bubble'] },
  { label: '방사형', kinds: ['radar', 'radarFilled'] },
  { label: '주식형 및 표면형', kinds: ['stock', 'surface'] },
  { label: '콤보', kinds: ['combo'] },
  { label: '트리맵 및 선버스트', kinds: ['treemap', 'sunburst'] },
  { label: '히스토그램', kinds: ['histogram', 'pareto'] },
  { label: '상자 수염', kinds: ['boxWhisker'] },
  { label: '폭포 및 깔때기', kinds: ['waterfall', 'funnel'] },
];

export const ALL_CHART_KINDS: ChartKind[] = CHART_GROUPS.flatMap((g) => g.kinds);

export interface ChartTraits {
  /** Only the first series is drawn. */
  single: boolean;
  /** The rows are observations (histogram, Pareto, box): there is nothing to label except groups. */
  observations: boolean;
  /** The rows have no category label (histogram, Pareto). */
  noLabels: boolean;
  /** Treemap and sunburst: outer category levels. */
  hierarchy: boolean;
  /** Bubble: each series has x, y and size columns. */
  xy: boolean;
  /** Waterfall: rows can be totals. */
  totals: boolean;
  /** Combo: each series has its own type. */
  combo: boolean;
  /** The type has no gridlines to switch. */
  noGrid: boolean;
  /** Series the type needs at least. */
  minSeries: number;
}

export function chartTraits(kind: ChartKind): ChartTraits {
  const hierarchy = kind === 'treemap' || kind === 'sunburst';
  const histogram = kind === 'histogram' || kind === 'pareto';
  return {
    single: ['pie', 'doughnut', 'funnel', 'waterfall', 'treemap', 'sunburst', 'histogram', 'pareto'].includes(kind),
    observations: histogram || kind === 'boxWhisker',
    noLabels: histogram,
    hierarchy,
    xy: kind === 'bubble',
    totals: kind === 'waterfall',
    combo: kind === 'combo',
    noGrid: ['pie', 'doughnut', 'treemap', 'sunburst', 'funnel', 'surface'].includes(kind),
    minSeries: kind === 'stock' ? 3 : 1,
  };
}

/** One line under the data table saying what the rows mean for this type. */
export function chartHint(kind: ChartKind): string {
  switch (kind) {
    case 'waterfall': return '첫 계열만 그립니다. 값은 증감이고, “합계” 칸을 체크한 행은 누적이 아니라 그 값 자체를 막대로 세웁니다.';
    case 'histogram': return '각 행이 관측값 하나입니다. 같은 구간에 든 값을 세어 막대로 그립니다. 구간 개수나 너비를 지정하지 않으면 자동입니다.';
    case 'pareto': return '각 행이 관측값 하나입니다. 구간을 빈도순으로 늘어놓고 누적 비율 선을 오른쪽 0–100% 축에 그립니다.';
    case 'boxWhisker': return '각 행이 관측값 하나이고 “항목”이 그룹입니다. 같은 이름의 행끼리 한 상자가 됩니다.';
    case 'treemap': case 'sunburst': return '첫 계열만 그립니다. “수준” 열에 상위 묶음 이름을 쓰면 비어 있는 칸은 위 칸을 이어받습니다.';
    case 'funnel': return '첫 계열만 그리며, 값이 큰 행이 위에 오도록 입력하세요.';
    case 'stock': return '계열을 시가 · 고가 · 저가 · 종가 순서로 넣으면 시가-종가 상자를 그립니다. 고가 · 저가 · 종가 3개면 종가 표시만 그립니다.';
    case 'bubble': return '계열마다 X 값, Y 값, 크기를 입력합니다.';
    case 'surface': return '행이 계열, 열이 항목인 격자를 위에서 본 등고선 형태로 그립니다.';
    case 'combo': return '계열마다 종류를 고르고, 값 범위가 다르면 “보조 축”을 체크하세요.';
    case 'radar': case 'radarFilled': return '항목이 3개 이상일 때 그려집니다.';
    default: return '';
  }
}

const cats4 = ['항목 1', '항목 2', '항목 3', '항목 4'];
const base3: ChartSeries[] = [
  { name: '계열 1', values: [4.3, 2.5, 3.5, 4.5] }, { name: '계열 2', values: [2.4, 4.4, 1.8, 2.8] }, { name: '계열 3', values: [2, 2, 3, 5] },
];
const OBS = [12, 15, 17, 18, 21, 22, 22, 24, 25, 27, 28, 31, 33, 36, 41, 48];

/** The data a new chart of `kind` starts with (the app's own numbers; Korean labels). */
export function sampleChart(kind: ChartKind): ChartData {
  const common = { title: '', legend: true, dataLabels: false, gridlines: true };
  const single = chartTraits(kind).single;
  switch (kind) {
    case 'waterfall':
      return { ...common, kind, categories: ['시작', '수입', '지출', '기타', '합계'], series: [{ name: '금액', values: [100, 60, -35, -15, 110] }], subtotals: [0, 4], dataLabels: true };
    case 'funnel':
      return { ...common, kind, categories: ['방문', '가입', '체험', '등록'], series: [{ name: '인원', values: [1000, 640, 380, 120] }], legend: false };
    case 'histogram':
    case 'pareto':
      return { ...common, kind, categories: [], series: [{ name: '관측값', values: [...OBS] }] };
    case 'boxWhisker':
      return { ...common, kind, categories: OBS.map((_, i) => (i % 2 === 0 ? '그룹 A' : '그룹 B')), series: [{ name: '계열 1', values: [...OBS] }, { name: '계열 2', values: OBS.map((v) => v + 6) }] };
    case 'treemap':
    case 'sunburst':
      return { ...common, kind, categories: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월'], categoryLevels: [['1분기', '', '', '2분기', '', '', '3분기', '']],
        series: [{ name: '값', values: [4.2, 2.8, 3.6, 4.7, 2.6, 4.1, 1.9, 3] }], legend: kind === 'sunburst' };
    case 'stock':
      return { ...common, kind, categories: ['월', '화', '수', '목', '금'], upDownBars: true,
        series: [{ name: '시가', values: [30, 38, 42, 35, 40] }, { name: '고가', values: [55, 57, 57, 58, 58] }, { name: '저가', values: [11, 12, 13, 11, 25] }, { name: '종가', values: [38, 50, 35, 43, 55] }] };
    case 'surface':
      return { ...common, kind, categories: ['1', '2', '3', '4', '5'], gridlines: false,
        series: [[1, 3, 5, 3, 1], [3, 7, 9, 7, 3], [5, 9, 12, 9, 5], [3, 7, 9, 7, 3], [1, 3, 5, 3, 1]].map((values, i) => ({ name: `계열 ${i + 1}`, values })) };
    case 'bubble':
      return { ...common, kind, categories: [], series: [
        { name: '계열 1', values: [3, 5, 2, 4], xValues: [1, 2, 3, 4], sizes: [12, 30, 18, 24] },
        { name: '계열 2', values: [1, 3, 4, 2], xValues: [1.5, 2.5, 3.5, 4.5], sizes: [20, 10, 26, 14] }] };
    case 'radar':
    case 'radarFilled':
      return { ...common, kind, categories: ['예배', '교육', '봉사', '교제', '전도'], series: [{ name: '올해', values: [4, 3, 5, 4, 2] }, { name: '작년', values: [3, 4, 3, 2, 3] }] };
    case 'combo':
      return { ...common, kind, categories: cats4, series: base3.map((s, i) => ({ ...s, values: [...s.values], kind: (i === base3.length - 1 ? 'lineMarkers' : 'column') as ChartSeriesKind })) };
    default:
      return { ...common, kind, categories: [...cats4], series: (single ? base3.slice(0, 1) : base3).map((s) => ({ ...s, values: [...s.values] })) };
  }
}

/** How many rows the data editor shows: categories or the longest series. */
export const chartRows = (c: ChartData) => Math.max(c.categories.length, ...c.series.map((s) => Math.max(s.values.length, s.xValues?.length ?? 0, s.sizes?.length ?? 0)), 0);

/** Switch to `kind` keeping the data when it still makes sense, else start from that type's sample. */
export function convertChart(c: ChartData, kind: ChartKind): ChartData {
  if (c.kind === kind) return c;
  const t = chartTraits(kind);
  const rows = chartRows(c);
  const sample = sampleChart(kind);
  // Stock needs three series, radar three spokes, a histogram real observations: a few categories of
  // another chart would draw nothing useful.
  if (c.series.length < t.minSeries || ((kind === 'radar' || kind === 'radarFilled') && rows < 3) || (kind === 'surface' && (c.series.length < 2 || rows < 2))) {
    return { ...sample, title: c.title, legend: c.legend, dataLabels: c.dataLabels, textColor: c.textColor, palette: c.palette };
  }
  const out: ChartData = { ...c, kind, series: c.series.map((s) => ({ ...s })) };
  if (kind === 'combo' || c.kind === 'combo') {
    out.series = out.series.map((s, i) => {
      const { kind: sk, secondaryAxis, ...rest } = s;
      return kind === 'combo' ? { ...rest, kind: sk ?? (i === out.series.length - 1 && out.series.length > 1 ? 'lineMarkers' : 'column'), secondaryAxis } : rest;
    });
  }
  if (kind === 'bubble') {
    out.series = out.series.map((s) => ({ ...s, xValues: s.xValues ?? s.values.map((_, i) => i + 1), sizes: s.sizes ?? s.values.map((v) => Math.max(1, Math.abs(v) * 5)) }));
  }
  if (kind === 'stock') out.upDownBars = out.series.length >= 4;
  if (kind === 'waterfall') out.subtotals = (c.subtotals ?? []).filter((i) => i < rows);
  if (t.noLabels && c.categories.length) out.categories = [];
  if (kind === 'boxWhisker' && c.kind !== 'boxWhisker' && !out.categories.length) out.categories = Array.from({ length: rows }, () => '그룹 A');
  return out;
}

/** Row/column switch (Chart Design › 행/열 전환): series become categories and the other way round. */
export function switchRowColumn(c: ChartData): ChartData {
  const rows = chartRows(c);
  const cats = c.series.map((s) => s.name);
  const series: ChartSeries[] = Array.from({ length: rows }, (_, r) => ({
    name: c.categories[r] ?? `계열 ${r + 1}`, values: c.series.map((s) => s.values[r] ?? 0),
  }));
  return { ...c, categories: cats, series, subtotals: undefined, categoryLevels: undefined };
}

// ── The data editor's edits ────────────────────────────────────────────────────────────────────
const fill = (a: number[], n: number, v = 0) => Array.from({ length: n }, (_, i) => a[i] ?? v);

/** Make the chart exactly `rows` rows long (categories, every series' values, x values and sizes, levels). */
export function resizeChart(c: ChartData, rows: number): ChartData {
  const n = Math.max(1, Math.min(500, Math.round(rows)));
  return {
    ...c,
    categories: Array.from({ length: n }, (_, i) => c.categories[i] ?? ''),
    series: c.series.map((s) => ({ ...s, values: fill(s.values, n), ...(s.xValues ? { xValues: fill(s.xValues, n) } : {}), ...(s.sizes ? { sizes: fill(s.sizes, n, 1) } : {}) })),
    ...(c.categoryLevels ? { categoryLevels: c.categoryLevels.map((l) => Array.from({ length: n }, (_, i) => l[i] ?? '')) } : {}),
    ...(c.subtotals ? { subtotals: c.subtotals.filter((i) => i < n) } : {}),
  };
}

export function addRow(c: ChartData): ChartData {
  const rows = chartRows(c);
  const r = resizeChart(c, rows + 1);
  if (!chartTraits(c.kind).noLabels) r.categories[rows] = `항목 ${rows + 1}`;
  else r.categories = [];
  return r;
}

export function removeRow(c: ChartData, at: number): ChartData {
  const rows = chartRows(c);
  if (rows <= 1) return c;
  const drop = <T,>(a: T[]) => a.filter((_, i) => i !== at);
  return {
    ...c, categories: drop(c.categories),
    series: c.series.map((s) => ({ ...s, values: drop(s.values), ...(s.xValues ? { xValues: drop(s.xValues) } : {}), ...(s.sizes ? { sizes: drop(s.sizes) } : {}) })),
    ...(c.categoryLevels ? { categoryLevels: c.categoryLevels.map(drop) } : {}),
    ...(c.subtotals ? { subtotals: c.subtotals.filter((i) => i !== at).map((i) => (i > at ? i - 1 : i)) } : {}),
  };
}

export function addSeries(c: ChartData): ChartData {
  const rows = chartRows(c);
  const s: ChartSeries = { name: `계열 ${c.series.length + 1}`, values: Array(rows).fill(0) };
  if (chartTraits(c.kind).xy) { s.xValues = Array.from({ length: rows }, (_, i) => i + 1); s.sizes = Array(rows).fill(10); }
  if (c.kind === 'combo') s.kind = 'column';
  return { ...c, series: [...c.series, s] };
}

export const removeSeries = (c: ChartData, at: number): ChartData => (c.series.length <= 1 ? c : { ...c, series: c.series.filter((_, i) => i !== at) });

/** Outer category levels are stored innermost first; a new level goes outside the existing ones. */
export function addLevel(c: ChartData): ChartData {
  const rows = chartRows(c);
  return { ...c, categoryLevels: [...(c.categoryLevels ?? []), Array(rows).fill('')].slice(0, 16) };
}
export const removeLevel = (c: ChartData, at: number): ChartData => ({ ...c, categoryLevels: (c.categoryLevels ?? []).filter((_, i) => i !== at) });

export function toggleSubtotal(c: ChartData, row: number): ChartData {
  const cur = new Set(c.subtotals ?? []);
  if (cur.has(row)) cur.delete(row); else cur.add(row);
  return { ...c, subtotals: [...cur].sort((a, b) => a - b) };
}

/** Parse a cell: a number, or 0 for something that is not one (the sheet never holds NaN). */
export const cellNumber = (s: string) => { const v = Number(s); return Number.isFinite(v) ? v : 0; };

// ── Styles and colours ─────────────────────────────────────────────────────────────────────────
export interface ChartStyle { id: string; label: string; patch: Partial<ChartData> }
/** Chart Design › 차트 스타일: preset combinations of gridlines, data labels, legend and colours. */
export const CHART_STYLES: ChartStyle[] = [
  { id: 'style1', label: '스타일 1 (기본)', patch: { gridlines: true, dataLabels: false, legend: true, palette: 'colorful' } },
  { id: 'style2', label: '스타일 2 (데이터 레이블)', patch: { gridlines: false, dataLabels: true, legend: true, palette: 'colorful' } },
  { id: 'style3', label: '스타일 3 (단순)', patch: { gridlines: false, dataLabels: false, legend: true, palette: 'colorful' } },
  { id: 'style4', label: '스타일 4 (범례 없음, 레이블)', patch: { gridlines: false, dataLabels: true, legend: false, palette: 'colorful' } },
  { id: 'style5', label: '스타일 5 (단색, 레이블)', patch: { gridlines: true, dataLabels: true, legend: true, palette: 'monochrome1' } },
  { id: 'style6', label: '스타일 6 (단색, 단순)', patch: { gridlines: false, dataLabels: false, legend: true, palette: 'monochrome1' } },
];
export const applyChartStyle = (c: ChartData, id: string): ChartData => ({ ...c, ...(CHART_STYLES.find((s) => s.id === id)?.patch ?? {}) });

/** Chart Design › 색 변경: the accents in turn, or shades of one accent. */
export const CHART_PALETTES: { id: string; label: string }[] = [
  { id: 'colorful', label: '다채로운 색' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `monochrome${n}`, label: `단색형 ${n} (강조 ${n})` })),
];

// ── Export ─────────────────────────────────────────────────────────────────────────────────────
/** What a chart type becomes in an exported .pptx: a native chart of that PowerPoint type, a native chart
 *  of a close type (`near`), or the drawn chart as a picture (the Office 2016 types PptxGenJS cannot write). */
export type PptxChartPlan =
  | { mode: 'native'; type: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'bubble' | 'radar'; near?: string }
  | { mode: 'picture'; why: string };

export function pptxPlan(kind: ChartKind): PptxChartPlan {
  switch (kind) {
    case 'column': case 'columnStacked': case 'columnPercent': case 'bar': case 'barStacked': case 'barPercent': return { mode: 'native', type: 'bar' };
    case 'line': case 'lineMarkers': return { mode: 'native', type: 'line' };
    // PptxGenJS writes no stacked line grouping: the lines go as running totals, which look the same.
    case 'lineStacked': return { mode: 'native', type: 'line', near: 'cumulative' };
    case 'area': case 'areaStacked': return { mode: 'native', type: 'area' };
    case 'pie': case 'doughnut': case 'scatter': case 'bubble': case 'radar': return { mode: 'native', type: kind };
    case 'radarFilled': return { mode: 'native', type: 'radar', near: 'filled' };
    // Close chart types PowerPoint can open and edit, drawn from the same numbers.
    case 'combo': return { mode: 'native', type: 'bar', near: 'combo' };
    case 'histogram': return { mode: 'native', type: 'bar', near: 'bins' };
    case 'pareto': return { mode: 'native', type: 'bar', near: 'pareto' };
    // These need bars with no fill (an invisible base or spacer) that PptxGenJS cannot write.
    case 'waterfall': return { mode: 'picture', why: '폭포 차트는 PowerPoint 2016 차트(chartEx)라 그림으로 보냅니다' };
    case 'funnel': return { mode: 'picture', why: '깔때기 차트는 PowerPoint 2016 차트(chartEx)라 그림으로 보냅니다' };
    case 'stock': return { mode: 'picture', why: 'PowerPoint 주식형 차트는 거래 시가/고가/저가/종가 구조라 그림으로 보냅니다' };
    case 'surface': return { mode: 'picture', why: '등고선 표면형은 그림으로 보냅니다' };
    case 'boxWhisker': case 'treemap': case 'sunburst': return { mode: 'picture', why: 'Office 2016 차트(chartEx)는 그림으로 보냅니다' };
  }
}

/** Histogram bins as a chart's own columns (the counts PowerPoint's plain column chart can hold). */
export function histogramColumns(c: ChartData): { labels: string[]; counts: number[]; cumulative: number[] } {
  const obs = (c.series[0]?.values ?? []).filter(Number.isFinite);
  if (!obs.length) return { labels: [], counts: [], cumulative: [] };
  const sorted = [...obs].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[sorted.length - 1], span = hi - lo, n = sorted.length;
  const sd = Math.sqrt(sorted.reduce((a, v) => a + (v - sorted.reduce((x, y) => x + y, 0) / n) ** 2, 0) / Math.max(1, n - 1));
  const w0 = c.binSize && c.binSize > 0 ? c.binSize : c.binCount && c.binCount > 0 ? span / c.binCount : (3.49 * sd) / Math.cbrt(n);
  const fixed = c.binCount && c.binCount > 0 && !(c.binSize && c.binSize > 0) ? Math.min(1000, c.binCount) : 0;
  const bad = span <= 0 || !Number.isFinite(w0) || w0 <= 0;
  const count = bad ? 1 : fixed || Math.min(1000, Math.max(1, Math.ceil(span / w0)));
  const width = bad ? Math.max(span, 1) : Math.max(w0, span / 1000);
  const counts = Array(count).fill(0) as number[];
  for (const v of sorted) {
    let i = Math.max(0, Math.min(count - 1, Math.ceil((v - lo) / width) - 1));
    while (i > 0 && v <= lo + width * i) i--;
    while (i + 1 < count && v > lo + width * (i + 1)) i++;
    counts[i]++;
  }
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const labels = counts.map((_, i) => `${i === 0 ? '[' : '('}${f(lo + width * i)}, ${f(lo + width * (i + 1))}]`);
  if (c.kind === 'pareto') {
    const order = counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
    const sortedCounts = order.map((i) => counts[i]);
    let run = 0;
    return { labels: order.map((i) => labels[i]), counts: sortedCounts, cumulative: sortedCounts.map((v) => { run += v; return (run / n) * 100; }) };
  }
  return { labels, counts, cumulative: [] };
}
