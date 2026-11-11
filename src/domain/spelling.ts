// Review › Proofing › Spelling (DeckCraft review.spellingChange / review.replaceWord): every word of
// the presentation's text in reading order, checked by the desktop app's spell checker (or the
// browser fallback), and changed in place. Text marked "do not check" (Review › Language) is skipped.
import type { Presentation, Slide } from './types';

export type SpellField = 'title' | 'text' | 'subtext' | 'notes' | 'el' | 'cell';
export interface SpellWord { slideId: string; field: SpellField; elementId?: string; cell?: [number, number]; word: string; start: number }

/** Words worth checking: letters only, two or more, not all capitals, not part of a link. */
export function wordsIn(text: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  // Links and e-mail addresses are blanked out (same length, so positions stay right).
  const plain = text.replace(/(?:https?:\/\/|www\.)\S+|\S+@\S+/g, (m) => ' '.repeat(m.length));
  const re = /[\p{L}\p{M}][\p{L}\p{M}'’]*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    const w = m[0].replace(/['’]+$/, '');
    if (w.length < 2 || (w === w.toUpperCase() && w !== w.toLowerCase())) continue;
    out.push({ word: w, start: m.index });
  }
  return out;
}

function sources(s: Slide): { field: SpellField; text: string; elementId?: string; cell?: [number, number] }[] {
  const out: { field: SpellField; text: string; elementId?: string; cell?: [number, number] }[] = [];
  if (!s.noProof) {
    if (s.title) out.push({ field: 'title', text: s.title });
    if (s.text) out.push({ field: 'text', text: s.text });
    if (s.subtext) out.push({ field: 'subtext', text: s.subtext });
  }
  for (const e of s.elements ?? []) {
    if (e.noProof || e.master) continue;
    if (e.text) out.push({ field: 'el', text: e.text, elementId: e.id });
    e.table?.rows.forEach((row, r) => row.forEach((c, ci) => { if (c.text) out.push({ field: 'cell', text: c.text, elementId: e.id, cell: [r, ci] }); }));
  }
  if (s.notes) out.push({ field: 'notes', text: s.notes });
  return out;
}

/** Misspelled words, in slide order, skipping ignored and dictionary words. */
export function misspellings(p: Presentation, isMisspelled: (w: string) => boolean, ignore: Set<string> = new Set()): SpellWord[] {
  const out: SpellWord[] = [];
  for (const s of p.slides) {
    for (const src of sources(s)) {
      for (const { word, start } of wordsIn(src.text)) {
        if (ignore.has(word.toLowerCase()) || !isMisspelled(word)) continue;
        out.push({ slideId: s.id, field: src.field, elementId: src.elementId, cell: src.cell, word, start });
      }
    }
  }
  return out;
}

const swap = (text: string, start: number, from: string, to: string) => (text.slice(start, start + from.length) === from ? text.slice(0, start) + to + text.slice(start + from.length) : text);

/** The slides with one occurrence changed (Change), or every occurrence of the word (Change All). */
export function changeWord(slides: Slide[], hit: SpellWord, to: string, all = false): Slide[] {
  if (all) {
    const re = new RegExp(`(?<![\\p{L}\\p{M}])${hit.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'gu');
    const fix = (t?: string) => (t ? t.replace(re, to) : t);
    return slides.map((s) => ({
      ...s, title: fix(s.title), text: fix(s.text) ?? '', subtext: fix(s.subtext), notes: fix(s.notes), textRuns: undefined,
      elements: s.elements?.map((e) => (e.master ? e : { ...e, text: fix(e.text), runs: e.text && re.test(e.text) ? undefined : e.runs, table: e.table ? { ...e.table, rows: e.table.rows.map((row) => row.map((c) => ({ ...c, text: fix(c.text) ?? '' }))) } : e.table })),
    }));
  }
  return slides.map((s) => {
    if (s.id !== hit.slideId) return s;
    if (hit.field === 'title' || hit.field === 'subtext' || hit.field === 'notes') return { ...s, [hit.field]: swap(s[hit.field] ?? '', hit.start, hit.word, to) };
    if (hit.field === 'text') return { ...s, text: swap(s.text, hit.start, hit.word, to), textRuns: undefined };
    return {
      ...s,
      elements: s.elements?.map((e) => {
        if (e.id !== hit.elementId) return e;
        if (hit.field === 'cell' && e.table && hit.cell) {
          const [r, c] = hit.cell;
          return { ...e, table: { ...e.table, rows: e.table.rows.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? { ...cell, text: swap(cell.text, hit.start, hit.word, to) } : cell))) } };
        }
        // The runs no longer spell the text after a change; the box keeps its own formatting.
        return { ...e, text: swap(e.text ?? '', hit.start, hit.word, to), runs: undefined, paragraphs: e.paragraphs ? swap(e.text ?? '', hit.start, hit.word, to).split('\n').map((t, i) => ({ ...e.paragraphs![Math.min(i, e.paragraphs!.length - 1)], text: t, runs: undefined })) : undefined };
      }),
    };
  });
}

/** The user's own dictionary (Add to Dictionary), kept on this computer. */
const KEY = 'fc.userDictionary';
export function userDictionary(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
export function addToDictionary(word: string) {
  const d = userDictionary();
  d.add(word.toLowerCase());
  try { localStorage.setItem(KEY, JSON.stringify([...d])); } catch { /* storage unavailable */ }
}
