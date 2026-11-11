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
import type { Presentation, Slide, SlideElement } from './types';

export type SpellField = 'title' | 'text' | 'subtext' | 'notes' | 'el' | 'cell';
export interface SpellWord {
  slideId: string; field: SpellField; elementId?: string; cell?: [number, number];
  /** The misspelt text: a word, or a Korean rule's span (which may hold a space: 몇 일). */
  word: string; start: number;
  /** The proofing language of the text it is in (element, else slide). */
  lang?: string;
  /** A Korean rule's hit, with the rule's fix. */
  kind?: 'ko'; suggestions?: string[];
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

/** The non-Hangul parts of a word ("FreeCast를" → "FreeCast"): Korean particles attach to English words. */
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
export function misspellings(p: Presentation, isMisspelled: (w: string, lang?: string) => boolean, ignore: Set<string> = new Set(), { korean = true } = {}): SpellWord[] {
  const out: SpellWord[] = [];
  for (const s of p.slides) {
    for (const src of sources(s)) {
      const at = { slideId: s.id, field: src.field, elementId: src.elementId, cell: src.cell, lang: src.lang };
      const found: SpellWord[] = [];
      if (korean) {
        for (const h of koMisspellings(src.text)) if (!ignore.has(h.word.toLowerCase())) found.push({ ...at, word: h.word, start: h.start, kind: 'ko', suggestions: h.suggestions });
      }
      for (const w of wordsIn(src.text)) {
        for (const { word, start } of foreignParts(w.word, w.start)) {
          if (ignore.has(word.toLowerCase()) || !isMisspelled(word, src.lang)) continue;
          found.push({ ...at, word, start });
        }
      }
      out.push(...found.sort((a, b) => a.start - b.start));
    }
  }
  return out;
}

const swap = (text: string, start: number, from: string, to: string) => (text.slice(start, start + from.length) === from ? text.slice(0, start) + to + text.slice(start + from.length) : text);

/** A text box with new text: its runs no longer spell it, so it keeps its own formatting. */
function withText(e: SlideElement, text: string): SlideElement {
  if (text === e.text) return e;
  return { ...e, text, runs: undefined, paragraphs: e.paragraphs ? text.split('\n').map((t, i) => ({ ...e.paragraphs![Math.min(i, e.paragraphs!.length - 1)], text: t, runs: undefined })) : undefined };
}

/** Every occurrence of the hit's word in `text` changed to `to`. */
function replaceAll(text: string, hit: SpellWord, to: string): string {
  if (hit.kind === 'ko') {
    // The rule decides where its form stands (몇일이 has it, 며칠 doesn't): change the spans it finds.
    return koMisspellings(text).filter((h) => h.word === hit.word).reverse().reduce((t, h) => swap(t, h.start, h.word, to), text);
  }
  const re = new RegExp(`(?<![\\p{L}\\p{M}])${hit.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'gu');
  return text.replace(re, to);
}

/** The slides with one occurrence changed (Change), or every occurrence of the word (Change All). */
export function changeWord(slides: Slide[], hit: SpellWord, to: string, all = false): Slide[] {
  if (all) {
    const fix = (t?: string) => (t ? replaceAll(t, hit, to) : t);
    return slides.map((s) => {
      const text = fix(s.text) ?? '';
      return {
        ...s, title: fix(s.title), text, subtext: fix(s.subtext), notes: fix(s.notes), textRuns: text === s.text ? s.textRuns : undefined,
        elements: s.elements?.map((e) => {
          if (e.master) return e;
          const t = e.text ? withText(e, replaceAll(e.text, hit, to)) : e;
          return e.table ? { ...t, table: { ...e.table, rows: e.table.rows.map((row) => row.map((c) => ({ ...c, text: fix(c.text) ?? '' }))) } } : t;
        }),
      };
    });
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
        return withText(e, swap(e.text ?? '', hit.start, hit.word, to));
      }),
    };
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
  // The engine's dictionaries learn it too (as typed, so "FreeCast" passes, and lower-case).
  for (const lang of installed) { spellAddWord(lang, word); spellAddWord(lang, word.toLowerCase()); }
  verdicts.clear();
}
