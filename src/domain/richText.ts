// Formatting inside a text box: a line is a list of runs, each with its own size, weight, slant,
// underline and colour (PowerPoint's character formatting). The plain text stays in `text` /
// `paragraph.text`, so everything that reads a box's words (find, lyrics, export, fitting) is
// unchanged; runs that no longer spell that text (it was retyped somewhere else) are ignored.
import type { ElementParagraph, SlideElement, TextRun } from './types';

const FORMAT_KEYS = ['fontSize', 'bold', 'italic', 'underline', 'color'] as const;
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
