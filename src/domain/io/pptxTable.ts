// A PowerPoint table (a:tbl in a p:graphicFrame) → LightCast's table object. Cell fills, text colour,
// bold and borders that come from the table's style (ppt/tableStyles.xml) are written onto the cells,
// so the table looks like PowerPoint's even where the engine has no such style; a built-in style that
// the file does not spell out maps to the engine's style of the same name.
import type { CellBorder, CellBorders, TableCell, TableData } from '../../engine';
import { colorOf, EMU_PER_PX, type DmlTheme } from './drawingml';
import { child, find, kids, local, path, textOf, type MNode } from './markup';

/** Built-in table styles by their GUID → the engine's style id. */
const BUILTIN: Record<string, string> = {
  '{2D5ABB26-0587-4C30-8999-92F81FD0307C}': 'none',
  '{5940675A-B579-460E-94D1-54222C63F5DA}': 'grid',
  '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'medium2-tx1',
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'medium2-accent1',
  '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'medium2-accent2',
  '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'medium2-accent3',
  '{00A15C55-8517-42AA-B614-E9B94910E393}': 'medium2-accent4',
  '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'medium2-accent5',
  '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'medium2-accent6',
};

const colorIn = (n: MNode | null | undefined, theme: DmlTheme) => (n ? colorOf(n.children.find((c) => /Clr$/.test(local(c))), theme) : null);

interface Look { fill?: string; color?: string; bold?: boolean; borders?: CellBorders }

function lineOf(ln: MNode | null, theme: DmlTheme): CellBorder | null | undefined {
  if (!ln) return undefined;
  if (child(ln, 'noFill')) return null;
  const c = colorIn(child(ln, 'solidFill'), theme);
  if (!c) return undefined;
  const dash = child(ln, 'prstDash')?.attrs.val;
  return { color: c.hex, width: Math.max(0.5, Math.round((Number(ln.attrs.w ?? 12700) / EMU_PER_PX) * 10) / 10), ...(dash && dash !== 'solid' ? { dash: /dot/i.test(dash) ? (/dash/i.test(dash) ? 'dashDot' : 'dot') : /lg/i.test(dash) ? 'longDash' : 'dash' } : {}) };
}

/** A part of a table style (wholeTbl, band1H, firstRow …) → the look it gives a cell. */
function styleLook(part: MNode | null, theme: DmlTheme): Look {
  if (!part) return {};
  const tc = child(part, 'tcStyle'), tx = child(part, 'tcTxStyle');
  const fill = colorIn(path(tc, 'fill', 'solidFill'), theme) ?? colorIn(child(tc, 'fillRef'), theme);
  const color = colorIn(tx, theme) ?? colorIn(child(tx, 'fontRef'), theme);
  const bdr = child(tc, 'tcBdr');
  const side = (k: string) => lineOf(path(bdr, k, 'ln'), theme);
  const borders: CellBorders = {};
  for (const [k, s] of [['left', 'l'], ['right', 'r'], ['top', 't'], ['bottom', 'b'], ['insideH', 'h'], ['insideV', 'v']] as const) {
    const v = side(k);
    if (v !== undefined) (borders as Record<string, CellBorder | null>)[s] = v;
  }
  return {
    ...(fill ? { fill: fill.hex } : child(path(tc, 'fill'), 'noFill') ? { fill: 'transparent' } : {}),
    ...(color ? { color: color.hex } : {}),
    ...(tx?.attrs.b === 'on' ? { bold: true } : tx?.attrs.b === 'off' ? { bold: false } : {}),
    ...(Object.keys(borders).length ? { borders } : {}),
  };
}

export interface TableResult { table: TableData; styled: 'file' | 'builtin' | 'unknown' }

/** a:tbl → the table, sized to `w` × `h` canvas px. `styles`: the deck's ppt/tableStyles.xml, parsed. */
export function readTable(tbl: MNode, w: number, h: number, theme: DmlTheme, styles: MNode | null): TableResult {
  const tblPr = child(tbl, 'tblPr');
  const flag = (k: string) => tblPr?.attrs[k] === '1' || tblPr?.attrs[k] === 'true';
  const styleId = child(tblPr, 'tableStyleId')?.children.map((c) => c.text ?? '').join('').trim() ?? '';
  const fileStyle = styleId && styles ? find(styles, 'tblStyle').find((s) => s.attrs.styleId === styleId) ?? null : null;
  const cols = kids(child(tbl, 'tblGrid'), 'gridCol').map((c) => Number(c.attrs.w) / EMU_PER_PX || 1);
  const trs = kids(tbl, 'tr');
  const heights = trs.map((r) => Number(r.attrs.h) / EMU_PER_PX || 1);
  // The frame's size wins over the grid's (PowerPoint grows rows to fit their text).
  const sw = w / (cols.reduce((a, b) => a + b, 0) || 1), sh = h / (heights.reduce((a, b) => a + b, 0) || 1);
  const R = trs.length, C = cols.length;
  const parts = (r: number, c: number): MNode[] => {
    if (!fileStyle) return [];
    const out: (MNode | null)[] = [child(fileStyle, 'wholeTbl')];
    const bodyRow = flag('firstRow') ? r - 1 : r, bodyCol = flag('firstCol') ? c - 1 : c;
    if (flag('bandRow') && bodyRow >= 0 && bodyRow % 2 === 0) out.push(child(fileStyle, 'band1H'));
    if (flag('bandRow') && bodyRow >= 0 && bodyRow % 2 === 1) out.push(child(fileStyle, 'band2H'));
    if (flag('bandCol') && bodyCol >= 0) out.push(child(fileStyle, bodyCol % 2 === 0 ? 'band1V' : 'band2V'));
    if (flag('firstCol') && c === 0) out.push(child(fileStyle, 'firstCol'));
    if (flag('lastCol') && c === C - 1) out.push(child(fileStyle, 'lastCol'));
    if (flag('lastRow') && r === R - 1) out.push(child(fileStyle, 'lastRow'));
    if (flag('firstRow') && r === 0) out.push(child(fileStyle, 'firstRow'));
    return out.filter((p): p is MNode => !!p);
  };
  const rows: TableCell[][] = trs.map((tr, r) => kids(tr, 'tc').slice(0, Math.max(C, 1)).map((tc, c) => {
    const look: Look = {};
    for (const p of parts(r, c)) {
      const l = styleLook(p, theme);
      Object.assign(look, { ...l, borders: { ...look.borders, ...l.borders } });
    }
    // Inside borders of the whole table become the cell's own sides.
    const b = look.borders as Record<string, CellBorder | null | undefined> | undefined;
    const borders: CellBorders = b ? {
      l: c === 0 ? b.l : b.v ?? b.l, r: c === C - 1 ? b.r : b.v ?? b.r, t: r === 0 ? b.t : b.h ?? b.t, b: r === R - 1 ? b.b : b.h ?? b.b,
    } : {};
    const tcPr = child(tc, 'tcPr');
    for (const [k, s] of [['lnL', 'l'], ['lnR', 'r'], ['lnT', 't'], ['lnB', 'b'], ['lnTlToBr', 'dd'], ['lnBlToTr', 'du']] as const) {
      const v = lineOf(child(tcPr, k), theme);
      if (v !== undefined) borders[s] = v;
    }
    for (const k of Object.keys(borders) as (keyof CellBorders)[]) if (borders[k] === undefined) delete borders[k];
    const ownFill = child(tcPr, 'solidFill') ? colorIn(child(tcPr, 'solidFill'), theme)?.hex : child(tcPr, 'noFill') ? 'transparent' : undefined;
    const paras = kids(child(tc, 'txBody'), 'p');
    const text = paras.map((p) => p.children.filter((n) => ['r', 'fld', 'br'].includes(local(n))).map((n) => (local(n) === 'br' ? '\v' : textOf(child(n, 't') ?? n))).join('')).join('\n');
    const rPr = find(child(tc, 'txBody') ?? { name: '', attrs: {}, children: [] }, 'rPr')[0] ?? null;
    const runColor = colorIn(child(rPr, 'solidFill'), theme)?.hex;
    const algn = child(paras[0] ?? null, 'pPr')?.attrs.algn;
    const anchor = tcPr?.attrs.anchor;
    const vert = tcPr?.attrs.vert;
    const cell: TableCell = {
      text,
      ...(Number(tc.attrs.gridSpan) > 1 ? { span: Number(tc.attrs.gridSpan) } : {}),
      ...(Number(tc.attrs.rowSpan) > 1 ? { rowSpan: Number(tc.attrs.rowSpan) } : {}),
      ...(tc.attrs.hMerge === '1' ? { hMerge: true } : {}), ...(tc.attrs.vMerge === '1' ? { vMerge: true } : {}),
      ...((ownFill ?? look.fill) ? { fill: ownFill ?? look.fill } : {}),
      ...((runColor ?? look.color) ? { color: runColor ?? look.color } : {}),
      ...(rPr?.attrs.b === '1' || (rPr?.attrs.b === undefined && look.bold) ? { bold: true } : {}),
      ...(algn === 'ctr' ? { align: 'center' } : algn === 'r' ? { align: 'right' } : algn === 'l' ? { align: 'left' } : {}),
      ...(anchor === 'ctr' ? { anchor: 'middle' as const } : anchor === 'b' ? { anchor: 'bottom' as const } : anchor === 't' ? { anchor: 'top' as const } : {}),
      ...(vert === 'vert' || vert === 'eaVert' ? { dir: 'vert' as const } : vert === 'vert270' ? { dir: 'vert270' as const } : vert === 'wordArtVert' ? { dir: 'stacked' as const } : {}),
      ...(Object.keys(borders).length ? { borders } : {}),
    };
    return cell;
  }));
  // Short rows are padded so every row has a cell per column.
  for (const row of rows) while (row.length < C) row.push({ text: '' });
  const builtin = BUILTIN[styleId];
  const styled: TableResult['styled'] = fileStyle ? 'file' : builtin || !styleId ? 'builtin' : 'unknown';
  const table: TableData = {
    rows, cols: cols.map((c) => Math.round(c * sw * 10) / 10), heights: heights.map((x) => Math.round(x * sh * 10) / 10),
    // A style the file spells out is already on the cells; keep the engine from drawing one over it.
    style: fileStyle ? 'none' : builtin ?? (styleId ? 'medium2-accent1' : 'none'),
    firstRow: !fileStyle && flag('firstRow'), firstCol: !fileStyle && flag('firstCol'), lastRow: !fileStyle && flag('lastRow'), lastCol: !fileStyle && flag('lastCol'),
    bandRow: !fileStyle && flag('bandRow'), bandCol: !fileStyle && flag('bandCol'),
  };
  return { table, styled };
}
