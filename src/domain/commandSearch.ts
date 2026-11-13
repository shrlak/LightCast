// "어떤 작업을 원하시나요?" (PowerPoint's Tell Me): finds ribbon commands by their Korean / English label.
// The entries come from the ribbon itself (see ui/ppt/commandIndex); this is only the matching.

/** One command of the ribbon. */
export interface CommandEntry {
  /** Stable id: tab, group and label. */
  id: string;
  label: string;
  /** The ribbon tab the command sits on. */
  tab: string;
  /** The ribbon group (홈 › 글꼴), when it has one. */
  group?: string;
  /** Other words that find it (English names, old names). */
  keywords?: string[];
  /** For a command inside a drop-down: the label of the ribbon button that opens that drop-down. */
  via?: string;
  disabled?: boolean;
}

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const isJamo = (c: string) => /[ㄱ-ㅎ]/.test(c);

/** The leading consonants of a Korean text ("글머리 기호" → "ㄱㅁㄹ ㄱㅎ"); other characters stay. */
export function choseong(s: string): string {
  let out = '';
  for (const c of s) {
    const n = c.codePointAt(0)! - 0xac00;
    out += n >= 0 && n < 11172 ? CHOSEONG[Math.floor(n / 588)] : c;
  }
  return out;
}

/** Lower case, no spaces / dots / dashes: what two spellings are compared by. */
export const normalizeQuery = (s: string) => s.toLowerCase().replace(/[\s.·\-_…‥,:;/]+/g, '');

/** Whether `needle` is found in `hay` letter by letter in order (not necessarily next to each other). */
function subsequence(hay: string, needle: string): boolean {
  let i = 0;
  for (const c of hay) if (c === needle[i] && ++i === needle.length) return true;
  return needle.length === 0;
}

/** How well one text answers a query: 0 = no, higher = better (start of text > a word start > inside > spread out). */
export function scoreText(text: string, query: string): number {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const t = normalizeQuery(text);
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90 - Math.min(20, t.length - q.length);
  const at = t.indexOf(q);
  if (at >= 0) return 70 - Math.min(20, at);
  // Typing Korean letter by letter ("글머" while "글머ㄹ" is half typed): compare without the half syllable.
  if (isJamo([...q].at(-1) ?? '') && q.length > 1) {
    const head = q.slice(0, -1);
    if (t.includes(head)) return 55;
  }
  // Only initials typed ("ㄱㅁㄹ"): match the leading consonants.
  if ([...q].every(isJamo)) {
    const ini = normalizeQuery(choseong(text));
    if (ini.startsWith(q)) return 60;
    if (ini.includes(q)) return 50;
    return subsequence(ini, q) ? 25 : 0;
  }
  return subsequence(t, q) && q.length >= 2 ? 20 : 0;
}

/** The score of an entry: its label counts most, then its keywords, then the group and tab it is in. */
export function scoreEntry(e: CommandEntry, query: string): number {
  const label = scoreText(e.label, query);
  const words = Math.max(0, ...(e.keywords ?? []).map((k) => scoreText(k, query) * 0.8));
  const where = Math.max(scoreText(e.group ?? '', query), scoreText(e.tab, query)) * 0.4;
  // "홈 글머리": the tab / group and the label, typed together.
  const combined = scoreText(`${e.tab}${e.group ?? ''}${e.label}`, query) * 0.5;
  return Math.max(label, words, where, combined) - (e.disabled ? 0.5 : 0);
}

/** The entries that answer a query, best first (ties keep the ribbon's order); none for an empty query. */
export function searchCommands(entries: CommandEntry[], query: string, limit = 8): CommandEntry[] {
  if (!normalizeQuery(query)) return [];
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

/** A button's name: its own text, else its tool tip; a tool tip's "(Ctrl+B)" shortcut and " — …" explanation are not part of it. */
export function commandLabel(text: string | null | undefined, title?: string | null): string {
  const raw = (text ?? '').replace(/[▾▼⌄⤡]/g, '').replace(/\s+/g, ' ').trim() || (title ?? '').trim();
  return raw.replace(/\s*[—–]\s.*$/, '').replace(/\s*\((?:Ctrl|Alt|Shift|F\d|Enter|Del)[^)]*\)\s*$/i, '').trim();
}

/** One entry per tab, group and label (a button that appears twice — a big and a small one — counts once). */
export function dedupeCommands(entries: CommandEntry[]): CommandEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (!e.label || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export const commandId = (tab: string, group: string | undefined, label: string) => `${tab}|${group ?? ''}|${label}`;

/**
 * Commands inside drop-downs, which the ribbon draws only when they are open. Each names the ribbon button
 * (`via`) that opens its menu; choosing it opens that menu. (Picture bullets: 홈 › 글머리 기호 › 그림 글머리 기호.)
 */
export const MENU_COMMANDS: CommandEntry[] = [
  { id: commandId('홈', '단락', '그림 글머리 기호'), label: '그림 글머리 기호', tab: '홈', group: '단락', via: '글머리 기호', keywords: ['picture bullet', 'bullet picture', '글머리 그림', '이미지 글머리 기호'] },
];

/** The ribbon's own entries first, then the drop-down commands it cannot list (not twice if the ribbon has them). */
export function withMenuCommands(entries: CommandEntry[]): CommandEntry[] {
  const have = new Set(entries.map((e) => normalizeQuery(e.label)));
  return [...entries, ...MENU_COMMANDS.filter((m) => !have.has(normalizeQuery(m.label)))];
}
