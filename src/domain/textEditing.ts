// Word boundaries and caret moves inside a text box, ported from DeckCraft (model/src/words.rs and
// edit.rs), which traced them in PowerPoint for Windows: Ctrl+←/→, Ctrl+↑/↓, Ctrl+Backspace /
// Ctrl+Delete, double-click (word) and triple-click (paragraph).
//
// A paragraph splits into tokens. Each token is a run of one class of grapheme clusters plus the
// spaces that follow it:
// - word: letters, digits and combining marks. An apostrophe joins a word when a letter or digit
//   follows it (it's, 'tis, but dogs' ends before it); a hyphen joins when a letter or digit comes
//   before it (a-b, a-); . , : join between digits (3.14, 1,000, 3:45).
// - punctuation: everything else that is not a symbol; a run of it is one token (..., ?!).
// - symbol: emoji and pictographs (a run of them is one token), ©, ®, ™.
// - ideograph: each CJK ideograph, kana or Hangul syllable is a token of its own.
// - tab and line break: a token each; spaces after one form their own token.
// - space: joins the token before it; spaces at the start of a paragraph are a token of their own.
//
// Offsets are UTF-16 indices into the paragraph (what the editor's DOM selection uses); a stop
// never splits a grapheme cluster.

type Class = 'space' | 'tab' | 'break' | 'word' | 'ideo' | 'punct' | 'symbol';

/** [paragraph, offset in the paragraph]. */
export type Pos = [number, number];

const inRanges = (cp: number, ranges: readonly (readonly [number, number])[]) => ranges.some(([a, b]) => cp >= a && cp <= b);

/** A space for word movement: absorbed into the token before it. */
export function isSpace(c: string | undefined): boolean {
  if (!c) return false;
  const cp = c.codePointAt(0)!;
  return cp === 0x20 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

const IDEO: [number, number][] = [
  [0x1100, 0x11ff], [0x2e80, 0x2fdf], [0x3005, 0x3007], [0x3021, 0x3029], [0x3031, 0x3035], [0x3038, 0x303c],
  [0x3040, 0x309f], [0x30a0, 0x30ff], [0x3100, 0x318f], [0x31a0, 0x31ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa960, 0xa97f], [0xac00, 0xd7ff], [0xf900, 0xfaff], [0xff66, 0xffdc], [0x20000, 0x3134f],
];
const SYMBOL: [number, number][] = [[0xa9, 0xa9], [0xae, 0xae], [0x2122, 0x2122], [0x2190, 0x21ff], [0x2300, 0x23ff], [0x25a0, 0x27bf], [0x2b00, 0x2bff], [0x1f000, 0x1faff]];
const COMBINING: [number, number][] = [[0x300, 0x36f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x20d0, 0x20ff], [0xfe20, 0xfe2f]];
const ALNUM = /^[\p{Alphabetic}\p{N}]/u;
const NUMERIC = /^\p{N}/u;
const isAlnum = (c: string | undefined) => !!c && ALNUM.test(c);

function baseClass(c: string): Class {
  if (c === '\v' || c === '\n' || c === '\r' || c === ' ' || c === ' ') return 'break';
  if (c === '\t') return 'tab';
  if (isSpace(c)) return 'space';
  const cp = c.codePointAt(0)!;
  if (inRanges(cp, IDEO)) return 'ideo';
  if (isAlnum(c)) return 'word';
  if (inRanges(cp, SYMBOL)) return 'symbol';
  // A combining mark with no base stays with letters.
  if (inRanges(cp, COMBINING)) return 'word';
  return 'punct';
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Grapheme clusters: their start offset and first character. */
function graphemes(text: string): { start: number; first: string }[] {
  if (segmenter) return [...segmenter.segment(text)].map((s) => ({ start: s.index, first: String.fromCodePoint(s.segment.codePointAt(0)!) }));
  const out: { start: number; first: string }[] = [];
  let i = 0;
  for (const ch of text) { out.push({ start: i, first: ch }); i += ch.length; }
  return out;
}

interface Cluster { start: number; cls: Class }

function clusters(text: string): Cluster[] {
  const gs = graphemes(text);
  const base = gs.map((g) => baseClass(g.first));
  return gs.map((g, i) => {
    const prev = gs[i - 1]?.first, next = gs[i + 1]?.first;
    let joins = false;
    if (g.first === "'" || g.first === '’') joins = isAlnum(next);
    else if (g.first === '-') joins = isAlnum(prev);
    else if (g.first === '.' || g.first === ',' || g.first === ':') joins = !!prev && NUMERIC.test(prev) && !!next && NUMERIC.test(next);
    return { start: g.start, cls: joins && base[i] === 'punct' ? 'word' : base[i] };
  });
}

/** Does a token start at cluster `cur` (after `prev`)? */
function startsToken(prev: Class, cur: Class): boolean {
  // Spaces join the token before them, except after a tab or a line break.
  if (cur === 'space') return prev === 'tab' || prev === 'break';
  return prev === 'space' || prev !== cur || cur === 'ideo' || cur === 'tab' || cur === 'break';
}

/** The word stops of a paragraph in ascending order: 0, the start of every token and the end. Ctrl+→ goes to the next one. */
export function stops(text: string): number[] {
  const cs = clusters(text);
  const out = [0];
  for (let i = 1; i < cs.length; i++) if (startsToken(cs[i - 1].cls, cs[i].cls)) out.push(cs[i].start);
  if (out[out.length - 1] !== text.length) out.push(text.length);
  return out;
}

/**
 * The stops Ctrl+← uses. PowerPoint's backward scan differs in two observed details: a no-break or
 * other non-ASCII space is a stop of its own (unless an ASCII space follows it), and a symbol
 * followed by punctuation (👍?) is one token.
 */
export function backStops(text: string): number[] {
  const cs = clusters(text);
  const set = new Set([0]);
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1].cls, b = cs[i].cls;
    const symbolPunct = (a === 'symbol' && b === 'punct') || (a === 'punct' && b === 'symbol');
    if (startsToken(a, b) && !symbolPunct) set.add(cs[i].start);
  }
  for (let i = 1; i < text.length; i++) if (text[i] !== ' ' && isSpace(text[i]) && text[i + 1] !== ' ') set.add(i);
  const out = [...set].sort((x, y) => x - y);
  if (out[out.length - 1] !== text.length) out.push(text.length);
  return out;
}

/** The next stop after `ch` (Ctrl+→), or null at the end of the text. */
export const nextStop = (text: string, ch: number): number | null => stops(text).find((s) => s > ch) ?? null;
/** The previous stop before `ch` (Ctrl+←), or null at the start. */
export const prevStop = (text: string, ch: number): number | null => [...backStops(text)].reverse().find((s) => s < ch) ?? null;

/** The end of the token's text (before its trailing spaces) for the token containing `ch`. */
function contentEnd(text: string, ch: number): number {
  const next = nextStop(text, ch) ?? text.length;
  let e = ch;
  while (e < next && !isSpace(text[e])) e++;
  // A token made only of spaces (leading spaces) ends at the next stop.
  return e === ch && isSpace(text[ch]) ? next : e;
}

/**
 * The word a double-click at `ch` selects: the token under the caret without its trailing spaces;
 * on a space just after a token, that token; in a run of spaces, the spaces.
 */
export function wordAt(text: string, ch: number): [number, number] {
  const n = text.length;
  if (!n) return [0, 0];
  ch = Math.max(0, Math.min(ch, n));
  const onSpace = ch >= n || isSpace(text[ch]);
  const afterToken = ch > 0 && !isSpace(text[ch - 1]);
  const at = onSpace && afterToken ? ch - 1 : Math.min(ch, n - 1);
  if (isSpace(text[at])) {
    let s = at, e = at;
    while (s > 0 && isSpace(text[s - 1])) s--;
    while (e < n && isSpace(text[e])) e++;
    return [s, e];
  }
  const s = [...stops(text)].reverse().find((x) => x <= at) ?? 0;
  return [s, Math.min(n, Math.max(contentEnd(text, s), at + 1))];
}

/**
 * What Ctrl+Delete removes from `ch` (before smart spacing): inside a token, the rest of its text;
 * on spaces right after a token, those spaces and the next token's text; anywhere else up to the
 * next stop. null at the end of the text.
 */
export function deleteForwardEnd(text: string, ch: number): number | null {
  const n = text.length;
  if (ch >= n) return null;
  const st = stops(text);
  if (!st.includes(ch) && !isSpace(text[ch])) return contentEnd(text, ch);
  const prevIsText = ch > 0 && !isSpace(text[ch - 1]) && baseClass(text[ch - 1]) !== 'tab' && baseClass(text[ch - 1]) !== 'break';
  if (isSpace(text[ch]) && prevIsText) {
    let j = ch;
    while (j < n && isSpace(text[j])) j++;
    return j >= n ? n : contentEnd(text, j);
  }
  return st.find((s) => s > ch) ?? null;
}

/** Closing punctuation that a smart delete pulls its word's spaces up to. */
export const isClosingPunct = (c: string) => '.,;:!?)]}%…”’»'.includes(c);
/** Punctuation that a smart delete keeps a space after when a word follows. */
export const isSentencePunct = (c: string) => '.,;:!?…'.includes(c);

// ── Positions in a box's paragraphs ──────────────────────────────────────────────────────────────

const clamp = (paras: string[], [p, c]: Pos): Pos => {
  const pi = Math.max(0, Math.min(p, paras.length - 1));
  return [pi, Math.max(0, Math.min(c, paras[pi]?.length ?? 0))];
};

/** The editor's flat offset (paragraphs joined by \n) of a position. */
export function toOffset(paras: string[], pos: Pos): number {
  const [p, c] = clamp(paras, pos);
  let at = 0;
  for (let i = 0; i < p; i++) at += paras[i].length + 1;
  return at + c;
}

/** The position of a flat offset (paragraphs joined by \n). */
export function toPos(paras: string[], offset: number): Pos {
  let n = Math.max(0, offset);
  for (let i = 0; i < paras.length; i++) {
    if (n <= paras[i].length) return [i, n];
    n -= paras[i].length + 1;
  }
  const last = Math.max(0, paras.length - 1);
  return [last, paras[last]?.length ?? 0];
}

/**
 * Next / previous word stop (Ctrl+→ / Ctrl+←). At the end of a paragraph Ctrl+→ goes to the start
 * of the next one; at its start Ctrl+← goes to the end of the previous one.
 */
export function wordMove(paras: string[], pos: Pos, forward: boolean): Pos {
  const [pi, ch] = clamp(paras, pos);
  const t = paras[pi] ?? '';
  if (forward) {
    const s = nextStop(t, ch);
    if (s !== null) return [pi, s];
    return pi + 1 < paras.length ? [pi + 1, 0] : [pi, ch];
  }
  const s = prevStop(t, ch);
  if (s !== null) return [pi, s];
  return pi > 0 ? [pi - 1, paras[pi - 1].length] : [pi, 0];
}

/** Ctrl+↑: the start of the paragraph, or of the previous one when already there. */
export function paraUp(paras: string[], pos: Pos): Pos {
  const [pi, ch] = clamp(paras, pos);
  return ch > 0 ? [pi, 0] : [Math.max(0, pi - 1), 0];
}

/** Ctrl+↓: the start of the next paragraph, or the end of the last one. */
export function paraDown(paras: string[], pos: Pos): Pos {
  const [pi] = clamp(paras, pos);
  return pi + 1 < paras.length ? [pi + 1, 0] : [pi, paras[pi]?.length ?? 0];
}

/** One grapheme left / right across paragraph boundaries. */
export function charMove(paras: string[], pos: Pos, forward: boolean): Pos {
  const [pi, ch] = clamp(paras, pos);
  const t = paras[pi] ?? '';
  const starts = graphemes(t).map((g) => g.start);
  if (forward) {
    if (ch < t.length) return [pi, starts.find((s) => s > ch) ?? t.length];
    return pi + 1 < paras.length ? [pi + 1, 0] : [pi, ch];
  }
  if (ch > 0) return [pi, [...starts].reverse().find((s) => s < ch) ?? 0];
  return pi > 0 ? [pi - 1, paras[pi - 1].length] : [0, 0];
}

/** The word a double-click selects around `pos`. */
export function wordRange(paras: string[], pos: Pos): [Pos, Pos] {
  const [pi, ch] = clamp(paras, pos);
  const [s, e] = wordAt(paras[pi] ?? '', ch);
  return [[pi, s], [pi, e]];
}

/** What a triple-click selects: the paragraph with its paragraph mark (the last one has none). */
export function paragraphRange(paras: string[], para: number): [Pos, Pos] {
  const pi = Math.max(0, Math.min(para, paras.length - 1));
  return [[pi, 0], pi + 1 < paras.length ? [pi + 1, 0] : [pi, paras[pi]?.length ?? 0]];
}

/** One change to a box's text: [from, to) replaced by `text` (positions in the text as it is then). */
export interface TextEdit { from: Pos; to: Pos; text: string }

/** Apply edits in order (each against the text the previous ones left). */
export function applyEdits(paras: string[], edits: TextEdit[]): string[] {
  let flat = paras.join('\n');
  let cur = paras;
  for (const e of edits) {
    const a = toOffset(cur, e.from), b = toOffset(cur, e.to);
    flat = flat.slice(0, Math.min(a, b)) + e.text + flat.slice(Math.max(a, b));
    cur = flat.split('\n');
  }
  return cur;
}

/**
 * Ctrl+Backspace (`forward` false) / Ctrl+Delete as PowerPoint does them, from `pos` (the start of
 * a selection: the rest of it stays). Ctrl+Backspace deletes back to the previous word stop (at a
 * paragraph's start it joins the paragraph to the one before). Ctrl+Delete deletes the rest of the
 * word, or the spaces after a word and the next word, then tidies the spacing as PowerPoint's
 * smart cut does: spaces left before closing punctuation or at the end of the paragraph after a
 * word go, and sentence punctuation left against a word gets a space. At a paragraph's end it
 * joins the next paragraph.
 */
export function deleteWord(paras: string[], pos: Pos, forward: boolean): { edits: TextEdit[]; caret: Pos } {
  const [pi, ch] = clamp(paras, pos);
  const t = paras[pi] ?? '';
  if (!forward) {
    const s = prevStop(t, ch);
    const to: Pos = s !== null ? [pi, s] : charMove(paras, [pi, ch], false);
    return { edits: [{ from: to, to: [pi, ch], text: '' }], caret: to };
  }
  const e = deleteForwardEnd(t, ch);
  if (e === null) {
    const to = charMove(paras, [pi, ch], true);
    return { edits: [{ from: [pi, ch], to, text: '' }], caret: [pi, ch] };
  }
  const edits: TextEdit[] = [{ from: [pi, ch], to: [pi, e], text: '' }];
  const after = applyEdits(paras, edits)[pi];
  const s = ch;
  const next = after[s], before = after[s - 1];
  if ((next === undefined || isClosingPunct(next)) && before === ' ') {
    let w = s;
    while (w > 0 && after[w - 1] === ' ') w--;
    if (w > 0 && isAlnum(after[w - 1])) {
      edits.push({ from: [pi, w], to: [pi, s], text: '' });
      return { edits, caret: [pi, w] };
    }
    return { edits, caret: [pi, s] };
  }
  if (before !== undefined && next !== undefined && isSentencePunct(before) && isAlnum(next)) {
    const digits = s >= 2 && NUMERIC.test(after[s - 2]) && NUMERIC.test(next);
    if (!digits) {
      edits.push({ from: [pi, s], to: [pi, s], text: ' ' });
      return { edits, caret: [pi, s + 1] };
    }
  }
  return { edits, caret: [pi, s] };
}
