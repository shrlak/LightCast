// Review › Proofing › Spelling (DeckCraft review.spellingChange / review.replaceWord): every word of
// the presentation's text in reading order, checked, and changed in place. Text marked "do not
// check" (Review › Language) is skipped.
//
// Who judges a word, in the browser and the desktop app alike:
// - Hangul: the list of common Korean misspellings (koSpelling.ts), found as spans (안되요 → 안 돼요).
//   Electron's Korean dictionary flags many valid words, so it is not asked.
// - Latin letters: the engine's Hunspell checker (DeckCraft's) with the bundled en_US dictionary
//   (public/dict), for text marked English or Korean (whose Latin words are English) or unmarked.
// - Other scripts, or Latin text marked as a language we ship no dictionary for: the desktop
//   app's checker when there is one; otherwise not checked.
import { engineReady, onEngineReady, spellAddWord, spellCheck, spellLoad, spellSuggest } from '../engine';
import { desktop } from './desktop';
import { koMisspellings } from './koSpelling';
import type { Presentation, Slide } from './types';
import { spliceAt, type FindKey } from './findReplace';

export type SpellField = 'title' | 'text' | 'subtext' | 'notes' | 'el' | 'cell';
export interface SpellWord {
  slideId: string; field: SpellField; elementId?: string; cell?: [number, number];
  /** The misspelt text: a word, or a Korean rule's span (which may hold a space: 몇 일). */
  word: string; start: number;
  /** The proofing language of the text it is in (element, else slide). */
  lang?: string;
  /**
   * A Korean rule's hit, with the rule's fix; or a repeated word (DeckCraft's `repeated`: "the the"),
   * where `word` / `start` cover the gap and the second word — what 삭제 takes out — and `shown`
   * is the word itself.
   */
  kind?: 'ko' | 'repeat'; suggestions?: string[]; shown?: string;
}

/**
 * Words that repeat the word just before them with only spaces between ("the the", "은혜 은혜"), as
 * PowerPoint and DeckCraft flag them; a line is a paragraph. Each covers the gap and the second word.
 */
export function repeatedWords(text: string): { word: string; start: number; shown: string }[] {
  const out: { word: string; start: number; shown: string }[] = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const words = [...line.matchAll(/[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’]*/gu)];
    for (let i = 1; i < words.length; i++) {
      const a = words[i - 1], b = words[i];
      const end = a.index! + a[0].length;
      const gap = line.slice(end, b.index!);
      if (gap && /^[  \t]+$/.test(gap) && a[0].toLowerCase() === b[0].toLowerCase()) {
        out.push({ word: gap + b[0], start: lineStart + end, shown: b[0] });
      }
    }
    lineStart += line.length + 1;
  }
  return out;
}

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

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const LATIN = /^[\p{Script=Latin}\p{M}'’]+$/u;

/** The non-Hangul parts of a word ("LightCast를" → "LightCast"): Korean particles attach to English words. */
function foreignParts(word: string, start: number): { word: string; start: number }[] {
  if (!HANGUL.test(word)) return [{ word, start }];
  const out: { word: string; start: number }[] = [];
  for (const m of word.matchAll(/[^ᄀ-ᇿ㄰-㆏가-힣]+/g)) {
    const w = m[0].replace(/^['’]+|['’]+$/g, '');
    if (w.length >= 2 && !(w === w.toUpperCase() && w !== w.toLowerCase())) out.push({ word: w, start: start + m.index! + m[0].indexOf(w) });
  }
  return out;
}

interface Source { field: SpellField; text: string; lang?: string; elementId?: string; cell?: [number, number] }
function sources(s: Slide): Source[] {
  const out: Source[] = [];
  if (!s.noProof) {
    if (s.title) out.push({ field: 'title', text: s.title, lang: s.lang });
    if (s.text) out.push({ field: 'text', text: s.text, lang: s.lang });
    if (s.subtext) out.push({ field: 'subtext', text: s.subtext, lang: s.lang });
  }
  for (const e of s.elements ?? []) {
    if (e.noProof || e.master) continue;
    const lang = e.lang ?? s.lang;
    if (e.text) out.push({ field: 'el', text: e.text, lang, elementId: e.id });
    e.table?.rows.forEach((row, r) => row.forEach((c, ci) => { if (c.text) out.push({ field: 'cell', text: c.text, lang, elementId: e.id, cell: [r, ci] }); }));
  }
  if (s.notes) out.push({ field: 'notes', text: s.notes, lang: s.lang });
  return out;
}

/**
 * Misspelled words, in slide order, skipping ignored and dictionary words. `isMisspelled` judges the
 * words outside Hangul (see `isMisspelled` below for the app's own); Korean text is checked with the
 * rule list unless `korean` is false.
 */
export function misspellings(p: Presentation, isMisspelled: (w: string, lang?: string) => boolean, ignore: Set<string> = new Set(), { korean = true, repeated = true } = {}): SpellWord[] {
  const out: SpellWord[] = [];
  for (const s of p.slides) {
    for (const src of sources(s)) {
      const at = { slideId: s.id, field: src.field, elementId: src.elementId, cell: src.cell, lang: src.lang };
      const found: SpellWord[] = [];
      if (korean) {
        for (const h of koMisspellings(src.text)) if (!ignore.has(h.word.toLowerCase())) found.push({ ...at, word: h.word, start: h.start, kind: 'ko', suggestions: h.suggestions });
      }
      // A repeated word is reported once, as repeated (not also as misspelt). Ignoring one
      // ("모두 건너뛰기") ignores that word repeated: its key is the word twice.
      const reps = repeated ? repeatedWords(src.text).filter((r) => !ignore.has(repeatKey(r.shown))) : [];
      const repAt = new Set(reps.map((r) => r.start + r.word.length - r.shown.length));
      for (const r of reps) found.push({ ...at, word: r.word, start: r.start, kind: 'repeat', shown: r.shown, suggestions: [] });
      for (const w of wordsIn(src.text)) {
        for (const { word, start } of foreignParts(w.word, w.start)) {
          if (repAt.has(start) || ignore.has(word.toLowerCase()) || !isMisspelled(word, src.lang)) continue;
          found.push({ ...at, word, start });
        }
      }
      out.push(...found.sort((a, b) => a.start - b.start));
    }
  }
  return out;
}

/** What "모두 건너뛰기" adds to the ignore list for a hit (a repeated word: the word twice). */
export const repeatKey = (word: string) => `${word.toLowerCase()} ${word.toLowerCase()}`;
export const ignoreKey = (hit: SpellWord) => (hit.kind === 'repeat' ? repeatKey(hit.shown ?? hit.word.trim()) : hit.word.toLowerCase());

/** Where every occurrence of the hit's word stands in `text` (Change All), as [start, end). */
function occurrences(text: string, hit: SpellWord): [number, number][] {
  if (hit.kind === 'ko') {
    // The rule decides where its form stands (몇일이 has it, 며칠 doesn't): change the spans it finds.
    return koMisspellings(text).filter((h) => h.word === hit.word).map((h) => [h.start, h.start + h.word.length]);
  }
  if (hit.kind === 'repeat') {
    const w = (hit.shown ?? '').toLowerCase();
    return repeatedWords(text).filter((r) => r.shown.toLowerCase() === w).map((r) => [r.start, r.start + r.word.length]);
  }
  const re = new RegExp(`(?<![\\p{L}\\p{M}])${hit.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'gu');
  return [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length]);
}

/** The texts of a slide a change looks at, with where each is. */
function slideTexts(s: Slide): { k: FindKey; text: string }[] {
  const out: { k: FindKey; text: string }[] = [];
  for (const field of ['title', 'text', 'subtext', 'notes'] as const) if (s[field]) out.push({ k: { slideId: s.id, field }, text: s[field]! });
  for (const e of s.elements ?? []) {
    if (e.master) continue;
    if (e.text) out.push({ k: { slideId: s.id, field: 'el', elementId: e.id }, text: e.text });
    e.table?.rows.forEach((row, r) => row.forEach((c, ci) => { if (c.text) out.push({ k: { slideId: s.id, field: 'cell', elementId: e.id, cell: [r, ci] }, text: c.text }); }));
  }
  return out;
}

const keyOfHit = (hit: SpellWord): FindKey => ({ slideId: hit.slideId, field: hit.field, elementId: hit.elementId, cell: hit.cell });
const textAt = (s: Slide, k: FindKey) => slideTexts(s).find((t) => t.k.field === k.field && t.k.elementId === k.elementId && t.k.cell?.join() === k.cell?.join())?.text;

/**
 * The slides with one occurrence changed (Change), or every occurrence of the word (Change All).
 * The character formatting stays: the new word takes the formatting of the one it replaces
 * (DeckCraft review.spellingChange). A repeated word is deleted with the space before it (to = '').
 */
export function changeWord(slides: Slide[], hit: SpellWord, to: string, all = false): Slide[] {
  if (all) {
    return slides.map((s) => {
      let next = s;
      for (const { k, text } of slideTexts(s)) {
        for (const [a, b] of occurrences(text, hit).reverse()) next = spliceAt(next, k, a, b, to);
      }
      return next;
    });
  }
  return slides.map((s) => {
    if (s.id !== hit.slideId) return s;
    const k = keyOfHit(hit);
    // Only while the word is still where it was found.
    if (textAt(s, k)?.slice(hit.start, hit.start + hit.word.length) !== hit.word) return s;
    return spliceAt(s, k, hit.start, hit.start + hit.word.length, to);
  });
}

// ── Dictionaries ──────────────────────────────────────────────────────────────────────────────
// Fetched once from public/dict next to the app (the same base the app's other files load from,
// so it works from the dev server, the desktop app's local server and a sub-path build).
const BASE: string = (import.meta.env && import.meta.env.BASE_URL) || '/';
const texts = new Map<string, { aff: string; dic: string }>();
const installed = new Set<string>();
const fetching = new Map<string, Promise<boolean>>();
/** Verdicts by `lang|word`: a pane of a long presentation asks about the same words again. */
const verdicts = new Map<string, boolean>();

function install(lang: string): boolean {
  const t = texts.get(lang);
  if (!t || !spellLoad(lang, t.aff, t.dic)) return false;
  for (const w of userDictionary()) spellAddWord(lang, w);
  installed.add(lang);
  verdicts.clear();
  return true;
}

// A reloaded engine has forgotten its dictionaries: give them back.
onEngineReady(() => {
  installed.clear();
  verdicts.clear();
  for (const lang of texts.keys()) install(lang);
});

/** Install a dictionary from its file texts (tests read them from public/dict). */
export function installDictionary(lang: string, aff: string, dic: string): boolean {
  texts.set(lang, { aff, dic });
  return install(lang);
}

export const dictionaryReady = (lang = 'en_US') => engineReady() && installed.has(lang);

const engineLoaded = () =>
  new Promise<boolean>((done) => {
    if (engineReady()) return done(true);
    const off = onEngineReady(() => { off(); done(true); });
    setTimeout(() => { off(); done(engineReady()); }, 20000);
  });

/** Load `lang`'s dictionary into the engine once (fetching its files the first time). */
export function ensureDictionary(lang = 'en_US'): Promise<boolean> {
  if (dictionaryReady(lang)) return Promise.resolve(true);
  if (texts.has(lang) && engineReady()) return Promise.resolve(install(lang));
  let p = fetching.get(lang);
  if (!p) {
    const get = async (ext: string) => {
      const r = await fetch(`${BASE}dict/${lang}.${ext}`);
      if (!r.ok) throw new Error(`${lang}.${ext}: ${r.status}`);
      return r.text();
    };
    p = Promise.all([get('aff'), get('dic')])
      .then(async ([aff, dic]) => { texts.set(lang, { aff, dic }); return (await engineLoaded()) && install(lang); })
      .catch((e) => { console.warn('spelling dictionary', e); fetching.delete(lang); return false; });
    fetching.set(lang, p);
  }
  return p;
}

/** The bundled dictionary for text marked `lang`: English for English, Korean or unmarked text. */
export function dictionaryFor(lang?: string): string | null {
  const l = (lang ?? '').toLowerCase();
  return !l || l.startsWith('en') || l.startsWith('ko') ? 'en_US' : null;
}

/** The desktop app's spell checker (Electron), when there is one. */
export interface HostSpeller { isMisspelled?(word: string): boolean; spellSuggestions?(word: string): string[] }

/** The app's judgement of one word outside Hangul (Korean is checked by the rule spans). */
export function isMisspelled(word: string, lang?: string, host: HostSpeller | undefined = desktop): boolean {
  if (HANGUL.test(word)) return false;
  const d = LATIN.test(word) ? dictionaryFor(lang) : null;
  if (d && dictionaryReady(d)) {
    const key = `${d}|${word}`;
    let v = verdicts.get(key);
    if (v === undefined) {
      v = (spellCheck(d, [word])?.length ?? 0) > 0;
      if (verdicts.size > 20000) verdicts.clear();
      verdicts.set(key, v);
    }
    return v;
  }
  return host?.isMisspelled?.(word) ?? false;
}

/** Corrections for a hit: the Korean rule's fix, the engine's for Latin words, else the desktop's. */
export function suggestionsFor(hit: SpellWord, host: HostSpeller | undefined = desktop, n = 8): string[] {
  if (hit.suggestions) return hit.suggestions;
  const d = LATIN.test(hit.word) ? dictionaryFor(hit.lang) : null;
  if (d && dictionaryReady(d)) return spellSuggest(d, hit.word, n);
  return host?.spellSuggestions?.(hit.word).slice(0, n) ?? [];
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
  // The engine's dictionaries learn it too (as typed, so "LightCast" passes, and lower-case).
  for (const lang of installed) { spellAddWord(lang, word); spellAddWord(lang, word.toLowerCase()); }
  verdicts.clear();
}
