// AutoCorrect as you type, ported from DeckCraft (engine/src/cmd/text/autocorrect.rs and the smart
// quotes of editing.rs): after a space or punctuation the word just typed is checked against the
// replacement list (teh → the, (c) → ©, ... → …) and the case rules (TWo INitial CApitals, first
// letter of a sentence, names of days, cAPS LOCK), fractions and ordinals; a list lead such as
// "* " or "1. " typed at the start of a paragraph starts a bulleted or numbered list.
import type { ListStyle } from './types';

/** Built-in AutoCorrect replacements (common slips and symbols), as DeckCraft ships them. */
export const AUTOCORRECT: readonly (readonly [string, string])[] = [
  ['teh', 'the'], ['adn', 'and'], ['recieve', 'receive'], ['recieved', 'received'], ['seperate', 'separate'], ['occured', 'occurred'],
  ['occurence', 'occurrence'], ['thier', 'their'], ['wich', 'which'], ['acheive', 'achieve'], ['accross', 'across'], ['adress', 'address'],
  ['alot', 'a lot'], ['appearence', 'appearance'], ['arguement', 'argument'], ['basicly', 'basically'], ['beggining', 'beginning'],
  ['beleive', 'believe'], ['calender', 'calendar'], ['commitee', 'committee'], ['definately', 'definitely'], ['dont', "don't"],
  ['doesnt', "doesn't"], ['didnt', "didn't"], ['isnt', "isn't"], ['embarass', 'embarrass'], ['enviroment', 'environment'],
  ['existance', 'existence'], ['foward', 'forward'], ['freind', 'friend'], ['goverment', 'government'], ['happend', 'happened'],
  ['i', 'I'], ['ive', "I've"], ['immediatly', 'immediately'], ['independant', 'independent'], ['knowlege', 'knowledge'], ['libary', 'library'],
  ['neccessary', 'necessary'], ['necesary', 'necessary'], ['noticable', 'noticeable'], ['occassion', 'occasion'], ['posession', 'possession'],
  ['prefered', 'preferred'], ['publically', 'publicly'], ['realy', 'really'], ['recomend', 'recommend'], ['refered', 'referred'],
  ['relevent', 'relevant'], ['succesful', 'successful'], ['tommorow', 'tomorrow'], ['tomorow', 'tomorrow'], ['truely', 'truly'],
  ['untill', 'until'], ['wierd', 'weird'], ['youre', "you're"], ['(c)', '©'], ['(r)', '®'], ['(tm)', '™'], ['(e)', '€'], ['...', '…'],
  ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['--', '–'],
];

/** AutoCorrect Options (PowerPoint's 자동 고침 옵션). */
export interface AutoCorrectPrefs {
  /** 입력할 때 자동으로 바꾸기 (the replacement list and the case rules). */
  on: boolean;
  /** 곧은 따옴표를 둥근 따옴표로. */
  smartQuotes: boolean;
  twoInitials: boolean;
  sentenceCaps: boolean;
  days: boolean;
  capsLock: boolean;
  fractions: boolean;
  ordinals: boolean;
  /** 자동 글머리 기호 및 번호 매기기. */
  lists: boolean;
  /** Your own replacements (looked up before the built-in list). */
  entries: [string, string][];
  /** Built-in replacements you deleted. */
  removed: string[];
}

export const DEFAULT_AUTOCORRECT: AutoCorrectPrefs = {
  on: true, smartQuotes: true, twoInitials: true, sentenceCaps: true, days: true, capsLock: true, fractions: true, ordinals: true, lists: true, entries: [], removed: [],
};

const lower = (s: string) => s.toLowerCase();
const eqi = (a: string, b: string) => lower(a) === lower(b);
const UPPER = /^\p{Uppercase}$/u;
const LOWER = /^\p{Lowercase}$/u;
const ALPHA = /^\p{Alphabetic}$/u;
const isUpper = (c: string | undefined) => !!c && UPPER.test(c);
const isLower = (c: string | undefined) => !!c && LOWER.test(c);
const isWs = (c: string | undefined) => !!c && /\s/u.test(c);
const PUNCT_TRIGGER = '.,;:!?';

/** Sentence case: lower case, capitals at the start and after a sentence's end (not a decimal point). */
export function sentenceCase(s: string): string {
  const chars = [...s.toLowerCase()];
  let start = true;
  return chars.map((c, i) => {
    let out = c;
    if (start && ALPHA.test(c)) { out = c.toUpperCase(); start = false; }
    if ('.!?'.includes(c) && !(c === '.' && /\d/.test(chars[i - 1] ?? '') && /\d/.test(chars[i + 1] ?? ''))) start = true;
    return out;
  }).join('');
}

/** The replacement for `word` from your entries, then the built-in list. */
export function replacement(prefs: AutoCorrectPrefs, word: string): string | null {
  const own = prefs.entries.find(([k]) => k === word) ?? prefs.entries.find(([k]) => eqi(k, word));
  if (own) return own[1];
  const hit = AUTOCORRECT.find(([k]) => eqi(k, word));
  if (!hit) return null;
  const [k, to] = hit;
  if (prefs.removed.some((r) => eqi(r, k))) return null;
  // "i" only on its own, lower case.
  if (k === 'i' && word !== 'i') return null;
  return isUpper([...word][0]) ? sentenceCase(to) : to;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * What a just-typed `word` becomes (null: unchanged). `sentenceStart`: nothing but spaces or a
 * sentence's end (. ! ?) before it in the paragraph. `typing`: one character was typed (the case
 * rules apply only then).
 */
export function correctWord(prefs: AutoCorrectPrefs, word: string, sentenceStart: boolean, typing: boolean): string | null {
  let out = replacement(prefs, word);
  if (typing && out === null) {
    const chars = [...word];
    const letters = chars.every((c) => ALPHA.test(c));
    if (prefs.fractions) out = ({ '1/2': '½', '1/4': '¼', '3/4': '¾' } as Record<string, string>)[word] ?? null;
    if (out === null && letters && chars.length >= 3) {
      const restLower = chars.slice(2).every(isLower);
      const restUpper = chars.slice(1).every(isUpper);
      if (prefs.twoInitials && isUpper(chars[0]) && isUpper(chars[1]) && restLower) out = chars.map((c, i) => (i === 1 ? c.toLowerCase() : c)).join('');
      else if (prefs.capsLock && isLower(chars[0]) && restUpper) out = chars.map((c, i) => (i === 0 ? c.toUpperCase() : c.toLowerCase())).join('');
    }
    if (out === null && prefs.days && DAYS.includes(word)) out = sentenceCase(word);
  }
  if (typing && prefs.sentenceCaps && sentenceStart) {
    const w = out ?? word;
    const [f, ...rest] = [...w];
    if (f && isLower(f) && [...w].every((c) => ALPHA.test(c))) out = f.toUpperCase() + rest.join('');
  }
  return out !== null && out !== word ? out : null;
}

/** `word` is a number with the ordinal suffix it takes (1st, 22nd, 103rd, 11th). */
export function isOrdinal(word: string): boolean {
  const m = /^(\d+)([a-z]{2})$/.exec(word);
  if (!m) return false;
  const d = m[1];
  const teen = d.length >= 2 && d[d.length - 2] === '1';
  const last = d[d.length - 1];
  const want = teen ? 'th' : last === '1' ? 'st' : last === '2' ? 'nd' : last === '3' ? 'rd' : 'th';
  return m[2] === want;
}

/**
 * The list a paragraph that starts with `lead` and a space or tab becomes. DeckCraft's leads: `*` •,
 * `-` or `–` –, `--` or `—` ■, `>` ➢, `<>` ◆, and numbering `1.`, `1)`, `I.`, `i.`, `A.`, `a.`, `a)`.
 * LightCast's list styles are the closest of its own (it has no dash or diamond bullet).
 */
export function autoListStyle(lead: string): ListStyle | null {
  switch (lead) {
    case '*': case '-': case '–': case '<>': return 'bullet';
    case '--': case '—': return 'square';
    case '>': return 'arrow';
    case '1.': return 'number';
    case '1)': return 'number-paren';
    case 'I.': case 'i.': return 'roman';
    case 'A.': case 'a.': case 'a)': return 'alpha';
    default: return null;
  }
}

/** The quote a typed straight quote becomes: opening at the start, after a space or ( [ {. */
export function smartQuote(typed: string, prev: string | undefined): string {
  const opening = prev === undefined || isWs(prev) || '([{'.includes(prev);
  if (typed === '"') return opening ? '“' : '”';
  if (typed === "'") return opening ? '‘' : '’';
  return typed;
}

export type AutoCorrectAction =
  /** Replace [start, end) of the paragraph with `text`. */
  | { kind: 'replace'; start: number; end: number; text: string }
  /** Superscript [start, end) (an ordinal's suffix). */
  | { kind: 'ordinal'; start: number; end: number }
  /** Remove the lead [0, end) and make the paragraph a list. */
  | { kind: 'list'; list: ListStyle; end: number; typed: string };

/**
 * After a space or punctuation was typed at `end` of paragraph `line`, what AutoCorrect does.
 * `typing`: one character was typed (else only the replacement list applies). `range`: the
 * insertion replaced a selection (no list then).
 */
export function autoCorrectAt(prefs: AutoCorrectPrefs, line: string, end: number, typing: boolean, range = false): AutoCorrectAction | null {
  if (!prefs.on && !(typing && prefs.lists)) return null;
  const last = line[end - 1];
  if (end <= 0 || !(isWs(last) || PUNCT_TRIGGER.includes(last))) return null;
  if (typing && prefs.lists) {
    // A lead such as `i.` or `a.` is kept as typed, so the space after it starts its list.
    if (autoListStyle(line.slice(0, end))) return null;
    if (!range && (last === ' ' || last === '\t')) {
      const list = autoListStyle(line.slice(0, end - 1));
      if (list) return { kind: 'list', list, end, typed: line.slice(0, end) };
    }
  }
  if (!prefs.on) return null;
  let wordEnd = end - 1;
  let start = wordEnd;
  while (start > 0 && !isWs(line[start - 1])) start--;
  // "word," and "word." also count: the punctuation was typed before the space.
  let word = line.slice(start, wordEnd);
  if (replacement(prefs, word) === null) {
    const trimmed = word.replace(/[.,;:!?]+$/, '');
    if (trimmed && trimmed.length < word.length && !word.endsWith('...')) {
      wordEnd -= word.length - trimmed.length;
      word = trimmed;
    }
  }
  const before = [...line.slice(0, start)].reverse().find((c) => !isWs(c));
  const sentenceStart = before === undefined || '.!?'.includes(before);
  // "word..." becomes "word…", the word corrected too.
  let rep: string | null;
  if ([...word].length > 3 && word.endsWith('...') && replacement(prefs, '...') !== null) {
    const stem = word.replace(/\.+$/, '');
    rep = `${correctWord(prefs, stem, sentenceStart, typing) ?? stem}…`;
  } else rep = correctWord(prefs, word, sentenceStart, typing);
  if (rep === null) {
    if (typing && prefs.ordinals && isOrdinal(word)) return { kind: 'ordinal', start: wordEnd - 2, end: wordEnd };
    return null;
  }
  return { kind: 'replace', start, end: wordEnd, text: rep };
}

// ── The options, kept on this computer (PowerPoint keeps them per user, not per file) ──────────

const KEY = 'fc.autoCorrect';
let prefs: AutoCorrectPrefs = DEFAULT_AUTOCORRECT;
try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  if (raw) prefs = { ...DEFAULT_AUTOCORRECT, ...(JSON.parse(raw) as Partial<AutoCorrectPrefs>) };
} catch { /* storage unavailable or damaged: the defaults */ }

export const autoCorrectPrefs = () => prefs;
export function setAutoCorrectPrefs(next: AutoCorrectPrefs) {
  prefs = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

/**
 * Add your own replacement (DeckCraft's `text.autocorrect {add}`): `from` is one word of up to 64
 * characters, `to` up to 255; at most 2000 entries. Returns an error message, or the new options.
 */
export function addEntry(p: AutoCorrectPrefs, from: string, to: string): AutoCorrectPrefs | string {
  const k = from.trim();
  if (!k || /\s/u.test(k) || [...k].length > 64 || [...to].length > 255) return '‘입력’은 공백 없는 한 단어(64자 이내), ‘결과’는 255자 이내여야 합니다.';
  const entries = p.entries.filter(([e]) => e !== k);
  if (entries.length >= 2000) return '자동 고침 목록이 가득 찼습니다.';
  return { ...p, entries: [...entries, [k, to]], removed: p.removed.filter((r) => !eqi(r, k)) };
}

/** Delete a replacement: your own entry, else the built-in one (remembered as removed). */
export function removeEntry(p: AutoCorrectPrefs, from: string): AutoCorrectPrefs {
  const entries = p.entries.filter(([k]) => k !== from);
  if (entries.length !== p.entries.length) return { ...p, entries };
  if (AUTOCORRECT.some(([k]) => eqi(k, from)) && !p.removed.some((r) => eqi(r, from))) return { ...p, removed: [...p.removed, from] };
  return p;
}

/** The replacement list as the dialog shows it: your entries, then the built-in ones still in use. */
export function entryList(p: AutoCorrectPrefs): [string, string][] {
  return [
    ...p.entries,
    ...AUTOCORRECT.filter(([k]) => !p.removed.some((r) => eqi(r, k)) && !p.entries.some(([e]) => eqi(e, k))).map(([k, v]) => [k, v] as [string, string]),
  ];
}
