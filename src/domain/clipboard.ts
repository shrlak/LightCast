// Home › Clipboard with PowerPoint's fidelity. Copied LightCast objects go on the system clipboard as
// a payload inside the HTML (and a private type), so they paste back — in this window, another
// LightCast window or after a restart — at the same place with every property. The same HTML carries
// the text with its fonts, sizes and colours, so Word / PowerPoint / a browser get formatted text.
// Pasting from elsewhere reads the HTML the other program wrote: positioned boxes (PowerPoint)
// become text boxes where they were; formatted text keeps its font, size, colour and emphasis.
import type { HAlign, SlideElement, TextRun } from './types';
import { uid } from './lyrics';
import { normalizeRuns } from './richText';
import { officeFont } from './fonts';
import { splitWeightedFace, weightPatch } from './fontWeight';
import { textFields } from './io/drawingml';
import { decodeEntities, parseMarkup, textOf, type MNode } from './io/markup';

export const CLIP_TYPE = 'application/x-freecast-objects';
const ATTR = 'data-freecast-objects';

/** A picture's bytes travel with the objects (for a LightCast that does not have it yet). */
export interface ClipMedia { name: string; type: string; data: string }
export interface ClipPayload { v: 1; elements: SlideElement[]; media?: Record<string, ClipMedia> }

const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export const encodePayload = (p: ClipPayload) => toB64(JSON.stringify(p));
export function decodePayload(s: string | null | undefined): ClipPayload | null {
  if (!s) return null;
  for (const raw of [s.trim(), (() => { try { return fromB64(s.trim()); } catch { return ''; } })()]) {
    try {
      const v = JSON.parse(raw) as ClipPayload | SlideElement[];
      if (Array.isArray(v)) return v.length ? { v: 1, elements: v } : null;
      if (v && Array.isArray(v.elements) && v.elements.length) return v;
    } catch { /* try the next form */ }
  }
  return null;
}

/** The LightCast objects carried by a clipboard's HTML, if it came from LightCast. */
export function payloadFromHtml(html: string | null | undefined): ClipPayload | null {
  if (!html || !html.includes(ATTR)) return null;
  const m = new RegExp(`${ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(html);
  return m ? decodePayload(decodeEntities(m[1] ?? m[2] ?? '')) : null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pt = (canvasPx: number) => `${Math.round(canvasPx * 5) / 10}pt`;

function runCss(r: Partial<TextRun>, el: SlideElement): string {
  const css: string[] = [];
  const family = r.fontFamily ?? el.fontFamily;
  if (family) css.push(`font-family:${family.replace(/"/g, "'")}`);
  const size = r.fontSize ?? el.fontSize;
  if (size) css.push(`font-size:${pt(size)}`);
  const color = r.color ?? el.color;
  if (color) css.push(`color:${color}`);
  const weight = r.weight ?? (r.bold === undefined ? el.weight : undefined);
  if (weight !== undefined) css.push(`font-weight:${weight}`);
  else if (r.bold ?? el.bold) css.push('font-weight:bold');
  if (r.italic ?? el.italic) css.push('font-style:italic');
  const deco = [(r.underline ?? el.underline) && 'underline', (r.strike ?? el.strike) && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  if (r.baseline) css.push(`vertical-align:${r.baseline}`);
  if (r.highlight ?? el.highlight) css.push(`background:${r.highlight ?? el.highlight}`);
  return css.join(';');
}

/** A soft line break (Shift+Enter, \v) inside a line, as the <br> other programs read it as. */
const softBr = (html: string) => html.replace(/\u000b/g, '<br>');

/** The lines of a text object with their runs (formatting of the box filled in on each run). */
function linesOf(el: SlideElement): { runs: TextRun[]; align?: HAlign }[] {
  const lines = (el.text ?? '').split('\n');
  return lines.map((line, i) => {
    const p = el.paragraphs?.[i];
    const runs = p?.runs ?? el.runs?.[i];
    const ok = runs && runs.map((r) => r.text).join('') === line;
    return { runs: ok ? runs! : [{ text: line, ...(p?.fontSize ? { fontSize: p.fontSize } : {}), ...(p?.color ? { color: p.color } : {}), ...(p?.bold !== undefined ? { bold: p.bold } : {}) }], align: p?.align ?? el.align };
  });
}

/** HTML for the clipboard: the objects' payload, and their text as formatted paragraphs. */
export function objectsHtml(els: SlideElement[], media?: Record<string, ClipMedia>): string {
  const payload = encodePayload({ v: 1, elements: els, ...(media && Object.keys(media).length ? { media } : {}) });
  const body = els.filter((e) => e.text || e.table).map((el) => {
    if (el.table) {
      return `<table style="border-collapse:collapse">${el.table.rows.map((row) => `<tr>${row.map((c) => `<td style="border:1px solid #999;padding:4px;${runCss({}, el)}">${esc(c.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    }
    return linesOf(el).map((l) => `<p style="margin:0;text-align:${l.align ?? 'left'}">${l.runs.map((r) => `<span style="${esc(runCss(r, el))}">${softBr(esc(r.text))}</span>`).join('') || '<br>'}</p>`).join('');
  }).join('<br>');
  return `<meta charset="utf-8"><div ${ATTR}="${payload}">${body || '&#8203;'}</div>`;
}

export const objectsText = (els: SlideElement[]) => els.map((e) => e.text ?? e.table?.rows.map((r) => r.map((c) => c.text).join('\t')).join('\n') ?? '').filter(Boolean).join('\n');

// ── HTML from other programs ─────────────────────────────────────────────────────────────────────

/** Canvas pixels for a CSS length (the slide is 1440 px = 10 in; 1 pt = 2 px). `of` is what 100% is. */
export function cssLength(v: string | undefined, of = 0, em = 36): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(pt|px|in|cm|mm|em|rem|%)?\s*$/i.exec(v ?? '');
  if (!m) return undefined;
  const n = Number(m[1]);
  switch ((m[2] ?? 'px').toLowerCase()) {
    case 'pt': return n * 2;
    case 'in': return n * 144;
    case 'cm': return (n / 2.54) * 144;
    case 'mm': return (n / 25.4) * 144;
    case 'em': case 'rem': return n * em;
    case '%': return (n / 100) * of;
    default: return n * 1.5;
  }
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080', purple: '#800080', teal: '#008080', olive: '#808000', orange: '#ffa500', windowtext: '#000000' };
export function cssColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${[...m[1]].map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})/.exec(s);
  if (m) return `#${m[1]}`;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return undefined;
    return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`;
  }
  return undefined;
}

export const parseStyle = (s: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (s ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
};

/** Class rules of a <style> block (Word / PowerPoint put paragraph formats there). */
function styleRules(doc: MNode): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  const visit = (n: MNode) => {
    if (n.name === 'style') {
      const css = textOf(n).replace(/<!--|-->|\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const decl = parseStyle(m[2]);
        for (const sel of m[1].split(',')) {
          const cls = /\.([\w-]+)\s*$/.exec(sel.trim())?.[1];
          if (cls) rules.set(cls.toLowerCase(), { ...rules.get(cls.toLowerCase()), ...decl });
        }
      }
    }
    n.children.forEach(visit);
  };
  visit(doc);
  return rules;
}

const BLOCKS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'blockquote', 'pre', 'table', 'ul', 'ol', 'section', 'article', 'header', 'footer']);
const HEADING_PT: Record<string, number> = { h1: 24, h2: 18, h3: 14, h4: 12, h5: 10, h6: 8 };
const ALIGNS: Record<string, HAlign> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' };

export interface HtmlLine { runs: TextRun[]; align?: HAlign }

/** Formatted lines of an HTML fragment (inline styles, class rules and b / i / u / font tags). */
export function htmlLines(root: MNode, rules = new Map<string, Record<string, string>>()): HtmlLine[] {
  type Line = HtmlLine & { held?: boolean };
  const lines: Line[] = [{ runs: [] }];
  const cur = () => lines[lines.length - 1];
  const used = () => cur().runs.length > 0 || !!cur().held;
  const isBlock = (n: MNode) => BLOCKS.has(n.name) || n.name === 'td' || n.name === 'th';
  const walk = (n: MNode, fmt: Omit<TextRun, 'text'>, size: number, align: HAlign | undefined, pre: boolean) => {
    const meaningful = n.children.filter((c) => c.name !== '#text' || (c.text ?? '').trim());
    for (const c of n.children) {
      if (c.name === '#text') {
        let t = (c.text ?? '').replace(/\r/g, '');
        if (!pre) t = t.replace(/[\n\t ]+/g, ' ');
        if (!t || (t === ' ' && !cur().runs.length)) continue;
        if (pre && t.includes('\n')) t.split('\n').forEach((part, i) => { if (i) lines.push({ runs: [], align }); if (part) cur().runs.push({ text: part, ...fmt }); });
        else cur().runs.push({ text: t, ...fmt });
        continue;
      }
      const tag = c.name;
      if (tag === 'style' || tag === 'script' || tag === 'head' || tag === 'title' || tag === 'xml' || tag.startsWith('o:') || tag.startsWith('v:') || tag.startsWith('w:')) continue;
      if (tag === 'br') {
        // A <br> that ends a block only holds an empty line open (as browsers write it).
        if (isBlock(n) && meaningful[meaningful.length - 1] === c) cur().held = true;
        else lines.push({ runs: [], align });
        continue;
      }
      const css = { ...(c.attrs.class ? c.attrs.class.split(/\s+/).reduce((a, k) => ({ ...a, ...rules.get(k.toLowerCase()) }), {} as Record<string, string>) : {}), ...parseStyle(c.attrs.style) };
      if (css.display === 'none' || css['mso-hide'] === 'all') continue;
      const f: Omit<TextRun, 'text'> = { ...fmt };
      let s = size;
      const fs = tag === 'font' && c.attrs.size ? `${[0, 10, 13, 16, 18, 24, 32, 48][Math.max(1, Math.min(7, Number(c.attrs.size)))] ?? 16}px` : css['font-size'];
      const fsPx = fs ? cssLength(fs, s, s) : HEADING_PT[tag] ? HEADING_PT[tag] * 2 * 1.333 : undefined;
      if (fsPx && fsPx > 0) { s = Math.round(fsPx * 10) / 10; f.fontSize = s; }
      const fam = css['font-family'] ?? (tag === 'font' ? c.attrs.face : undefined);
      if (fam) { const first = fam.split(',')[0].trim().replace(/^['"]|['"]$/g, ''); if (first && !/^(inherit|initial)$/i.test(first)) { const sp = splitWeightedFace(first); f.fontFamily = officeFont(sp.family); if (sp.weight !== undefined) Object.assign(f, weightPatch(sp.weight)); } }
      const col = cssColor(css.color ?? (tag === 'font' ? c.attrs.color : undefined));
      if (col) f.color = col;
      const w = css['font-weight'];
      if (tag === 'b' || tag === 'strong' || /^h\d$/.test(tag) || w === 'bold' || w === 'bolder' || (w && Number(w) >= 600)) f.bold = true;
      if (w === 'normal' || (w && Number(w) > 0 && Number(w) < 600)) f.bold = undefined;
      // A numeric weight other than Regular / Bold is kept as the weight (Light 300 … Black 900).
      const wn = Number(w);
      if (w && wn >= 100 && wn <= 900 && wn !== 400 && wn !== 700) Object.assign(f, weightPatch(wn));
      else if (w === 'normal' || w === 'bold' || tag === 'b' || tag === 'strong') f.weight = undefined;
      if (tag === 'i' || tag === 'em' || css['font-style'] === 'italic' || css['font-style'] === 'oblique') f.italic = true;
      if (css['font-style'] === 'normal') f.italic = undefined;
      const deco = `${css['text-decoration'] ?? ''} ${css['text-decoration-line'] ?? ''} ${css['text-underline'] ? 'underline' : ''}`;
      if (tag === 'u' || tag === 'ins' || /underline/.test(deco)) f.underline = true;
      if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(deco)) f.strike = true;
      const va = css['vertical-align'];
      if (tag === 'sup' || va === 'super') f.baseline = 'super';
      if (tag === 'sub' || va === 'sub') f.baseline = 'sub';
      const hl = cssColor(css['background-color'] ?? css.background ?? css['mso-highlight']);
      if (hl && !isBlock(c)) f.highlight = hl;
      if (tag === 'mark') f.highlight = hl ?? '#ffff00';
      const a = ALIGNS[(css['text-align'] ?? c.attrs.align ?? '').toLowerCase()] ?? align;
      if (tag === 'td' || tag === 'th') {
        if (cur().runs.length) cur().runs.push({ text: '\t', ...fmt });
        walk(c, f, s, a, pre);
        continue;
      }
      const block = BLOCKS.has(tag);
      if (block) { if (used()) lines.push({ runs: [], align: a }); else cur().align = a; }
      walk(c, f, s, a, pre || tag === 'pre' || /pre/.test(css['white-space'] ?? ''));
      if (block && used()) lines.push({ runs: [], align });
    }
  };
  walk(root, {}, 36, undefined, false);
  const blank = (l: HtmlLine) => !l.runs.some((r) => r.text.replace(/[\s\u00a0\u200b]/g, ''));
  const out = lines.map((l): HtmlLine => {
    if (blank(l)) return { runs: [], align: l.align };
    const runs = normalizeRuns(l.runs.map((r) => ({ ...r, text: r.text.replace(/\u00a0/g, ' ') })));
    runs[0].text = runs[0].text.replace(/^ +/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, '');
    return { runs: normalizeRuns(runs), align: l.align };
  });
  while (out.length && blank(out[0])) out.shift();
  while (out.length && blank(out[out.length - 1])) out.pop();
  return out;
}

const bodyOf = (doc: MNode): MNode => {
  const find = (n: MNode): MNode | null => (n.name === 'body' ? n : n.children.reduce<MNode | null>((a, c) => a ?? find(c), null));
  return find(doc) ?? doc;
};

/** The fragment between <!--StartFragment--> and <!--EndFragment--> (Windows HTML clipboard), if marked. */
const fragment = (html: string) => {
  const s = html.indexOf('<!--StartFragment-->'), e = html.indexOf('<!--EndFragment-->');
  return s >= 0 && e > s ? html.slice(s + 20, e) : null;
};

/** DeckCraft richclip's caps: a hostile fragment is cut off, never executed. */
export const MAX_HTML = 1 << 20;
export const MAX_PARAS = 2000;
export const MAX_RUNS = 10000;

/** Pasted HTML → lines of formatted text (for a text box being typed in). */
export function htmlToLines(html: string): HtmlLine[] {
  if (html.length > MAX_HTML) return [];
  const doc = parseMarkup(html, true);
  const rules = styleRules(doc);
  const frag = fragment(html);
  return htmlLines(frag ? parseMarkup(frag, true) : bodyOf(doc), rules);
}

/** Did the HTML come from an Office program (PowerPoint, Word …)? */
export const isOfficeHtml = (html: string) => /urn:schemas-microsoft-com:office|ProgId content=(?:"?)(PowerPoint|Word)|Generator" content="Microsoft|name=Generator content="Microsoft/i.test(html);

const textBox = (lines: HtmlLine[], box: { x: number; y: number; w: number; h: number }, autoFit: boolean): SlideElement | null => {
  if (!lines.length) return null;
  const fields = textFields(lines.map((l) => ({ runs: l.runs, align: l.align, empty: { text: '' } })), 'left');
  return { id: uid('el'), kind: 'text', ...box, ...fields, vAlign: 'top', autoFit, ...(fields.color ? {} : { color: undefined }) } as SlideElement;
};

/**
 * Pasted HTML → objects: each absolutely placed box (as PowerPoint writes copied shapes) where it
 * was on its slide, with its text formatted as it was; otherwise one text box with all the text.
 * Pictures given inline (data: URLs) are returned for the caller to store.
 */
export function htmlToElements(html: string, slideW = 1440, slideH = 1080): { elements: SlideElement[]; images: { src: string; box: { x: number; y: number; w: number; h: number } }[] } {
  const doc = parseMarkup(html, true);
  const rules = styleRules(doc);
  const root = (() => { const f = fragment(html); return f ? parseMarkup(f, true) : bodyOf(doc); })();
  const placed: { node: MNode; box: { x: number; y: number; w: number; h: number } }[] = [];
  const images: { src: string; box: { x: number; y: number; w: number; h: number } }[] = [];
  const boxOf = (css: Record<string, string>) => {
    const x = cssLength(css.left, slideW), y = cssLength(css.top, slideH), w = cssLength(css.width, slideW), h = cssLength(css.height, slideH);
    return x !== undefined && y !== undefined && w ? { x, y, w, h: h ?? 0 } : null;
  };
  const visit = (n: MNode, inBox: boolean) => {
    for (const c of n.children) {
      if (c.name === '#text') continue;
      const css = parseStyle(c.attrs.style);
      const box = css.position === 'absolute' ? boxOf(css) : null;
      if (c.name === 'img' && /^data:image\//.test(c.attrs.src ?? '')) {
        const w = cssLength(css.width ?? (c.attrs.width ? `${c.attrs.width}px` : undefined)) ?? 480, h = cssLength(css.height ?? (c.attrs.height ? `${c.attrs.height}px` : undefined)) ?? 360;
        images.push({ src: c.attrs.src, box: box ?? { x: (slideW - w) / 2, y: (slideH - h) / 2, w, h } });
        continue;
      }
      if (box && !inBox) { placed.push({ node: c, box }); visit(c, true); continue; }
      visit(c, inBox);
    }
  };
  visit(root, false);
  const elements: SlideElement[] = [];
  for (const p of placed) {
    const lines = htmlLines(p.node, rules);
    const css = parseStyle(p.node.attrs.style);
    const el = textBox(lines, { ...p.box, h: p.box.h || 80 }, !p.box.h);
    if (!el) continue;
    const fill = cssColor(css['background-color'] ?? css.background);
    if (fill) Object.assign(el, { kind: 'shape', shape: 'rect', fill, vAlign: 'middle' });
    const rot = /rotate\(\s*(-?[\d.]+)deg/.exec(css.transform ?? '')?.[1] ?? css['mso-rotate'];
    if (rot && Number(rot)) el.rotation = Number(rot);
    elements.push(el);
  }
  if (!placed.length) {
    const lines = htmlLines(root, rules);
    const el = textBox(lines, { x: 120, y: 120, w: 1200, h: 200 }, true);
    if (el) elements.push(el);
  }
  return { elements, images };
}

// ── Text copied out of a text box ─────────────────────────────────────────────────────────────────

const RUNS_ATTR = 'data-freecast-runs';

/** HTML for characters copied from a text box: exact runs for LightCast, formatted text for others. */
export function runsHtml(lines: TextRun[][], align?: HAlign): string {
  const payload = toB64(JSON.stringify(lines));
  const body = lines.map((l) => `<p style="margin:0;text-align:${align ?? 'left'}">${l.map((r) => `<span style="${esc(runCss(r, {} as SlideElement))}">${softBr(esc(r.text))}</span>`).join('') || '<br>'}</p>`).join('');
  return `<meta charset="utf-8"><div ${RUNS_ATTR}="${payload}">${body}</div>`;
}

/** Pasted HTML → formatted lines: LightCast's own copied runs exactly, a LightCast text object's text, else the HTML's formatting. */
export function pastedLines(html: string | null | undefined, custom?: string | null): TextRun[][] | null {
  if (html?.includes(RUNS_ATTR)) {
    const m = new RegExp(`${RUNS_ATTR}\\s*=\\s*"([^"]*)"`).exec(html);
    try { const v = m && (JSON.parse(fromB64(decodeEntities(m[1]))) as TextRun[][]); if (Array.isArray(v)) return v; } catch { /* fall through */ }
  }
  const objs = decodePayload(custom) ?? payloadFromHtml(html);
  const box = objs?.elements.find((e) => e.text);
  if (box) {
    const fmt = { fontSize: box.fontSize, bold: box.bold, italic: box.italic, underline: box.underline, color: box.color, strike: box.strike, fontFamily: box.fontFamily, highlight: box.highlight };
    return linesOf(box).map((l) => l.runs.map((r) => {
      const q: TextRun = { ...r };
      for (const [k, v] of Object.entries(fmt)) if (v !== undefined && (q as unknown as Record<string, unknown>)[k] === undefined) (q as unknown as Record<string, unknown>)[k] = v;
      return q;
    }));
  }
  if (!html) return null;
  const lines = htmlToLines(html).slice(0, MAX_PARAS);
  return lines.length ? capRuns(lines.map((l) => l.runs)) : null;
}

/** At most MAX_RUNS runs in all (DeckCraft richclip). */
function capRuns(lines: TextRun[][]): TextRun[][] {
  let left = MAX_RUNS;
  return lines.map((l) => { const keep = l.slice(0, Math.max(0, left)); left -= keep.length; return keep; });
}

const fold = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u200b]/g, '').trim();
const plainOf = (lines: { runs: TextRun[] }[]) => lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n');

/**
 * Does foreign HTML say the same words as the clipboard's plain text? (DeckCraft same_words: stale
 * HTML left on the clipboard by another copy is ignored, and the plain text pastes.) Blank lines
 * are not compared.
 */
export function htmlMatchesText(html: string | null | undefined, text: string | null | undefined): boolean {
  if (!html || !text) return true;
  const squash = (t: string) => fold(t).split('\n').map((x) => x.trim()).filter(Boolean).join('\n');
  return squash(plainOf(htmlToLines(html))) === squash(text);
}
