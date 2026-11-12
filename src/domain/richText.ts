// Formatting inside a text box: a line is a list of runs, each with its own size, weight, slant,
// underline and colour (PowerPoint's character formatting). The plain text stays in `text` /
// `paragraph.text`, so everything that reads a box's words (find, lyrics, export, fitting) is
// unchanged; runs that no longer spell that text (it was retyped somewhere else) are ignored.
import type { ElementParagraph, Slide, SlideElement, TextRun } from './types';

const FORMAT_KEYS = ['fontSize', 'bold', 'italic', 'underline', 'color', 'strike', 'baseline', 'fontFamily', 'highlight', 'link'] as const;
export type RunFormat = Pick<TextRun, (typeof FORMAT_KEYS)[number]>;

const sameFormat = (a: TextRun, b: TextRun) => FORMAT_KEYS.every((k) => a[k] === b[k]);
export const runHasFormat = (r: TextRun) => FORMAT_KEYS.some((k) => r[k] !== undefined);

/** Adjacent runs with the same formatting joined, empty ones dropped. */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameFormat(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text };
    else out.push({ ...r });
  }
  return out;
}

const spells = (runs: TextRun[] | undefined, text: string): runs is TextRun[] => !!runs && runs.map((r) => r.text).join('') === text;

/** The runs of each drawn line of a text box (null: the line is drawn plainly). */
export function lineRuns(el: SlideElement): (TextRun[] | null)[] {
  if (el.paragraphs) return el.paragraphs.map((p) => (spells(p.runs, p.text) && p.runs.some(runHasFormat) ? p.runs : null));
  const lines = (el.text ?? '').split('\n');
  if (!el.runs || el.runs.length !== lines.length) return lines.map(() => null);
  return lines.map((line, i) => (spells(el.runs![i], line) && el.runs![i].some(runHasFormat) ? el.runs![i] : null));
}

export const hasRichText = (el: SlideElement) => lineRuns(el).some(Boolean);

/**
 * What an edit in the text box leaves on the element: the plain text, and the runs — on the
 * paragraphs of a box that has per-line formatting, else on the element — only when some run is
 * actually formatted.
 */
export function withRichLines(el: SlideElement, lines: TextRun[][]): Partial<SlideElement> {
  const clean = lines.map(normalizeRuns);
  const texts = clean.map((l) => l.map((r) => r.text).join(''));
  const text = texts.join('\n');
  const rich = clean.some((l) => l.some(runHasFormat));
  if (el.paragraphs?.length) {
    const styles = el.paragraphs;
    const paragraphs: ElementParagraph[] = texts.map((t, i) => {
      const { runs: _old, ...style } = styles[Math.min(i, styles.length - 1)];
      return { ...style, text: t, ...(clean[i].some(runHasFormat) ? { runs: clean[i] } : {}) };
    });
    return { text, paragraphs, runs: undefined };
  }
  return { text, runs: rich ? clean : undefined };
}

/** Formatting set on the whole box replaces the same formatting on its runs. */
export function clearRunFormat(el: SlideElement, keys: readonly (keyof RunFormat)[]): SlideElement {
  if (!keys.length) return el;
  const strip = (runs: TextRun[]) => normalizeRuns(runs.map((r) => { const q = { ...r }; for (const k of keys) delete q[k]; return q; }));
  const next: SlideElement = { ...el };
  if (el.runs) {
    const runs = el.runs.map(strip);
    next.runs = runs.some((l) => l.some(runHasFormat)) ? runs : undefined;
  }
  if (el.paragraphs) next.paragraphs = el.paragraphs.map((p) => (p.runs ? { ...p, runs: strip(p.runs).some(runHasFormat) ? strip(p.runs) : undefined } : p));
  return next;
}

/** The box's lines as runs (its own runs, or one plain run per line). */
export function elementLines(el: SlideElement): TextRun[][] {
  const runs = lineRuns(el);
  const texts = el.paragraphs ? el.paragraphs.map((p) => p.text) : (el.text ?? '').split('\n');
  return texts.map((t, i) => runs[i] ?? (t ? [{ text: t }] : []));
}

/** Character formatting given to every character of a box (Font dialog with no text selected). */
export function formatAllRuns(el: SlideElement, patch: RunFormat): Partial<SlideElement> {
  const lines = elementLines(el).map((l) => l.map((r) => {
    const q: TextRun = { ...r, ...patch };
    for (const k of Object.keys(q) as (keyof TextRun)[]) if (q[k] === undefined) delete q[k];
    return q;
  }));
  return withRichLines(el, lines);
}

/** The runs of each line of the slide's own text (null: the line is drawn plainly). */
export function slideLineRuns(slide: Pick<Slide, 'text' | 'textRuns'>): (TextRun[] | null)[] {
  const lines = slide.text.split('\n');
  const runs = slide.textRuns;
  if (!runs || runs.length !== lines.length) return lines.map(() => null);
  return lines.map((line, i) => (spells(runs[i], line) && runs[i].some(runHasFormat) && !/^\*\*.+\*\*$/.test(line) ? runs[i] : null));
}

/** What typing in the slide's own text leaves on the slide: the text, and runs only when formatted. */
export function slideTextPatch(lines: TextRun[][]): Pick<Slide, 'text' | 'textRuns'> {
  const clean = lines.map(normalizeRuns);
  return { text: clean.map((l) => l.map((r) => r.text).join('')).join('\n'), textRuns: clean.some((l) => l.some(runHasFormat)) ? clean : undefined };
}

/** The characters [a, b) of the lines (lines joined by \n), with their runs. */
export function sliceLines(lines: TextRun[][], a: number, b: number): TextRun[][] {
  const out: TextRun[][] = [];
  let at = 0;
  lines.forEach((line) => {
    const len = line.reduce((n, r) => n + r.text.length, 0);
    const s = at, e = at + len;
    at = e + 1;
    // A line is in the slice when the range touches it (a range ending at a line's start took the
    // line break before it, so the slice ends with an empty line).
    if (e < a || s > b) return;
    const part: TextRun[] = [];
    let pos = s;
    for (const r of line) {
      const rs = pos, re = pos + r.text.length;
      pos = re;
      const from = Math.max(rs, a), to = Math.min(re, b);
      if (to > from) part.push({ ...r, text: r.text.slice(from - rs, to - rs) });
    }
    out.push(normalizeRuns(part));
  });
  return out.length ? out : [[]];
}

/** The lines with [a, b) replaced by `ins` (itself lines); also where the caret goes after it. */
export function insertLines(lines: TextRun[][], a: number, b: number, ins: TextRun[][]): { lines: TextRun[][]; caret: number } {
  const total = lines.reduce((n, l) => n + l.reduce((m, r) => m + r.text.length, 0), 0) + Math.max(0, lines.length - 1);
  const before = sliceLines(lines, 0, a), after = sliceLines(lines, b, total);
  const add = ins.length ? ins : [[]];
  const joined: TextRun[][] = [
    ...before.slice(0, -1),
    normalizeRuns([...(before[before.length - 1] ?? []), ...add[0]]),
    ...add.slice(1),
  ];
  const caretLine = joined.length - 1;
  const caret = joined.reduce((n, l, i) => n + l.reduce((m, r) => m + r.text.length, 0) + (i < caretLine ? 1 : 0), 0);
  joined[caretLine] = normalizeRuns([...joined[caretLine], ...(after[0] ?? [])]);
  return { lines: [...joined, ...after.slice(1)], caret };
}

/** Every run given the box's own formatting where it has none of its own (for copying it out). */
export function withBoxFormat(lines: TextRun[][], box: RunFormat): TextRun[][] {
  return lines.map((l) => l.map((r) => {
    const q: TextRun = { ...r };
    for (const k of FORMAT_KEYS) if (q[k] === undefined && box[k] !== undefined) (q as unknown as Record<string, unknown>)[k] = box[k];
    return q;
  }));
}
