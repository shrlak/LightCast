// How a song's lyrics become slides — ported from the shrlak/ppt program (src/lib/utils/slidePlanner.ts)
// so LightCast lays songs out exactly as the church's PPT does (see 1018.pptx):
//
//   · a title slide, then each part exactly ONCE, in the order the 진행 (progression) first names it —
//     repeats are not expanded; the operator jumps back live;
//   · a blank line inside a part is a deliberate break: the lines before and after never share a slide;
//   · each run of lines is split into slides of at most `linesPerSlide` lines, as evenly as possible
//     (6 lines at 4 → 3 + 3).
import type { SongSection } from './songs';
import { expandCode } from '../arrangement';

export const DEFAULT_LINES_PER_SLIDE = 4;

const upper = (s: string) => s.trim().toUpperCase();
/** A label or order token in one comparable form: codes and names alike ("V1" = "Verse 1", "C" = "Chorus" = "후렴"). */
const canon = (s: string) => upper(expandCode(s.trim())).replace(/\s+/g, '');

/**
 * The section an order token stands for: exact label first, then V → V1 for a token without a
 * number, then V2 → V when the numbered label is absent.
 */
export function findSection(sections: SongSection[], token: string): SongSection | undefined {
  const want = canon(token);
  const byLabel = (label: string) => sections.find((s) => canon(s.label) === label);
  const exact = byLabel(want);
  if (exact) return exact;
  if (!/\d/.test(want)) return byLabel(`${want}1`);
  return byLabel(want.replace(/\d+$/, ''));
}

/**
 * The section each order token stands for, in order. A token without a number that comes again
 * (`V` in `I-V-C-V-C`) means the next part of that kind when the song has one the order never names
 * itself. A sung intro (`I` with words) is its own part; an instrumental `I` stands for none.
 */
export function sectionsInOrder(sections: SongSection[], order: string[]): (SongSection | undefined)[] {
  const named = new Set(order.map(canon));
  const seen = new Map<string, number>();
  const byLabel = (label: string) => sections.find((s) => canon(s.label) === label);
  const intro = canon('I');
  return order.map((raw) => {
    const token = canon(raw);
    if (token === intro) return sections.find((s) => canon(s.label) === intro && s.lines.some((l) => l.trim()));
    const count = (seen.get(token) ?? 0) + 1;
    seen.set(token, count);
    if (count > 1 && !/\d/.test(token) && !named.has(`${token}${count}`)) {
      const next = byLabel(`${token}${count}`);
      if (next) return next;
    }
    return findSection(sections, token);
  });
}

/** A section's lines grouped into blocks separated by blank lines. */
export function lineBlocks(section: SongSection | undefined): string[][] {
  if (!section) return [];
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of section.lines) {
    const line = raw.trim();
    if (!line) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** ceil(n / size) groups, none larger than `size`, sizes as equal as possible. */
export function chunkBalanced<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const groups = Math.ceil(items.length / Math.max(1, size));
  const base = Math.floor(items.length / groups);
  const remainder = items.length % groups;
  const out: T[][] = [];
  let i = 0;
  for (let g = 0; g < groups; g++) {
    const len = base + (g < remainder ? 1 : 0);
    out.push(items.slice(i, i + len));
    i += len;
  }
  return out;
}

/**
 * Repeated labels numbered (two "V" parts → "V1", "V2"), as the church library writes them, so a
 * song typed with two "Verse" headings keeps both verses.
 */
export function numberRepeatedLabels(sections: SongSection[]): SongSection[] {
  const counts = new Map<string, number>();
  for (const s of sections) counts.set(upper(s.label), (counts.get(upper(s.label)) ?? 0) + 1);
  const taken = new Set(sections.map((s) => upper(s.label)));
  const seen = new Map<string, number>();
  return sections.map((s) => {
    const label = upper(s.label);
    if ((counts.get(label) ?? 0) < 2 || /\d$/.test(label)) return s;
    let n = (seen.get(label) ?? 0) + 1;
    while (taken.has(`${label}${n}`)) n++;
    seen.set(label, n);
    return { ...s, label: `${s.label.trim()}${n}` };
  });
}

/** The parts a song's lyric slides come from, each once, in slide order, with the slides each is split into. */
export function planSectionSlides(all: SongSection[], order: string[] | undefined, linesPerSlide = DEFAULT_LINES_PER_SLIDE): { section: SongSection; slides: string[][] }[] {
  const sections = numberRepeatedLabels(all);
  const per = linesPerSlide >= 1 ? linesPerSlide : DEFAULT_LINES_PER_SLIDE;
  const tokens = order?.length ? order : sections.map((s) => s.label);
  const parts: { section: SongSection; slides: string[][] }[] = [];
  const seen = new Set<SongSection>();
  for (const section of sectionsInOrder(sections, tokens)) {
    if (!section || seen.has(section)) continue;
    seen.add(section);
    const slides = lineBlocks(section).flatMap((block) => chunkBalanced(block, per));
    if (slides.length) parts.push({ section, slides });
  }
  return parts;
}
