// Home › Editing › Find / Replace and Review › Spelling's Change, as DeckCraft's text.find /
// text.replace / review.spellingChange do them: every text of the presentation (slide text, title,
// second line, objects, table cells, notes), and a replacement that keeps the character formatting —
// the new text takes the formatting of the first run it replaces (DeckCraft's `splice`), the rest of
// the box keeps its own.
import type { Presentation, Slide, SlideElement, TextRun } from './types';
import { elementLines, insertLines, slideLineRuns, slideTextPatch, withRichLines } from './richText';

export type FindField = 'text' | 'title' | 'subtext' | 'notes' | 'el' | 'cell';
export interface FindKey { slideId: string; field: FindField; elementId?: string; cell?: [number, number] }
export interface FindItem { key: string; text: string }
export interface FindMatch { key: string; start: number; end: number }

export const findKey = (k: FindKey) => [k.slideId, k.field, k.elementId ?? '', k.cell ? k.cell.join(',') : ''].join('|');
export function parseFindKey(s: string): FindKey {
  const [slideId, field, elementId, cell] = s.split('|');
  const rc = cell ? cell.split(',').map(Number) : null;
  return { slideId, field: field as FindField, elementId: elementId || undefined, cell: rc && rc.length === 2 ? [rc[0], rc[1]] : undefined };
}

/** Every text of the presentation in reading order: the slide's own text, objects (and table cells), notes. */
export function findItems(p: Presentation): FindItem[] {
  const out: FindItem[] = [];
  for (const s of p.slides) {
    if (s.title) out.push({ key: findKey({ slideId: s.id, field: 'title' }), text: s.title });
    if (s.text) out.push({ key: findKey({ slideId: s.id, field: 'text' }), text: s.text });
    if (s.subtext) out.push({ key: findKey({ slideId: s.id, field: 'subtext' }), text: s.subtext });
    for (const el of s.elements ?? []) {
      if (el.master) continue;
      if (el.text) out.push({ key: findKey({ slideId: s.id, field: 'el', elementId: el.id }), text: el.text });
      el.table?.rows.forEach((row, r) => row.forEach((c, ci) => {
        if (c.text && !c.hMerge && !c.vMerge) out.push({ key: findKey({ slideId: s.id, field: 'cell', elementId: el.id, cell: [r, ci] }), text: c.text });
      }));
    }
    if (s.notes) out.push({ key: findKey({ slideId: s.id, field: 'notes' }), text: s.notes });
  }
  return out;
}

/** The formatting of the first run [a, b) touches (or the run at `a` for an insertion). */
function formatAt(lines: TextRun[][], a: number, b: number): Omit<TextRun, 'text'> {
  let at = 0;
  let found: TextRun | undefined;
  for (const line of lines) {
    for (const r of line) {
      const rs = at, re = at + r.text.length;
      if (!found && ((re > a && rs < Math.max(b, a + 1)) || (a === b && rs <= a && a <= re))) found = r;
      at = re;
    }
    at += 1;
  }
  const { text: _t, ...fmt } = found ?? { text: '' };
  return fmt;
}

/** Lines with the characters [a, b) (offsets in the text, lines joined by \n) replaced by `to`. */
export function spliceLines(lines: TextRun[][], a: number, b: number, to: string): TextRun[][] {
  const fmt = formatAt(lines, a, b);
  const ins = to.split('\n').map((t) => (t ? [{ ...fmt, text: t }] : []));
  return insertLines(lines, a, b, ins).lines;
}

/** A text object with [a, b) of its text replaced, its formatting kept. */
export function spliceElement(el: SlideElement, a: number, b: number, to: string): SlideElement {
  return { ...el, ...withRichLines(el, spliceLines(elementLines(el), a, b, to)) };
}

/** The slide's own text with [a, b) replaced, its character formatting kept. */
export function spliceSlideText(s: Slide, a: number, b: number, to: string): Pick<Slide, 'text' | 'textRuns'> {
  const rich = slideLineRuns(s);
  const lines = s.text.split('\n').map((t, i) => rich[i] ?? (t ? [{ text: t }] : []));
  return slideTextPatch(spliceLines(lines, a, b, to));
}

const splicePlain = (t: string, a: number, b: number, to: string) => t.slice(0, a) + to + t.slice(b);

/** The slide with [a, b) of one of its texts replaced. */
export function spliceAt(s: Slide, k: FindKey, a: number, b: number, to: string): Slide {
  switch (k.field) {
    case 'title': case 'subtext': case 'notes': return { ...s, [k.field]: splicePlain(s[k.field] ?? '', a, b, to) };
    case 'text': return { ...s, ...spliceSlideText(s, a, b, to) };
    case 'el': return { ...s, elements: s.elements?.map((e) => (e.id === k.elementId ? spliceElement(e, a, b, to) : e)) };
    case 'cell': return {
      ...s,
      elements: s.elements?.map((e) => (e.id === k.elementId && e.table && k.cell
        ? { ...e, table: { ...e.table, rows: e.table.rows.map((row, r) => row.map((c, ci) => (r === k.cell![0] && ci === k.cell![1] ? { ...c, text: splicePlain(c.text, a, b, to) } : c))) } }
        : e)),
    };
  }
}

/**
 * The slides with each match replaced by `to` (Replace: one match; Replace All: all of them). Later
 * matches of a text go first, so the offsets of earlier ones stay right.
 */
export function replaceMatches(slides: Slide[], matches: FindMatch[], to: string): Slide[] {
  const byKey = new Map<string, FindMatch[]>();
  for (const m of matches) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  return slides.map((s) => {
    let next = s;
    for (const [key, list] of byKey) {
      const k = parseFindKey(key);
      if (k.slideId !== s.id) continue;
      for (const m of [...list].sort((x, y) => y.start - x.start)) next = spliceAt(next, k, m.start, m.end, to);
    }
    return next;
  });
}
