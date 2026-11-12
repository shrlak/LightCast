// File › Print / Info / Export, ported from DeckCraft's file.export / file.info (crates/engine/src/cmd/file.rs):
// the Slides box ("1-3, 5"), hidden slides, handouts per page, colour modes, and the document statistics.
import type { Presentation, Slide } from './types';
import { sequence } from './arrangement';

export type PrintWhat = 'slides' | 'handout' | 'notes' | 'outline';
/** 컬러 / 회색조 / 흑백 (DeckCraft's grayscale view, PowerPoint's print colour). */
export type ColorMode = 'color' | 'gray' | 'bw';
export type HandoutPerPage = 1 | 2 | 3 | 4 | 6 | 9;

export interface PrintOptions {
  what: PrintWhat;
  /** The Slides box, as typed ("1-3, 5"); empty = all. */
  range: string;
  includeHidden: boolean;
  frame: boolean;
  color: ColorMode;
  /** 용지에 맞게 크기 조정: the slide fills the page; otherwise it is printed smaller inside the margins. */
  fit: boolean;
  perPage: HandoutPerPage;
  landscape: boolean;
}

export const DEFAULT_PRINT: PrintOptions = { what: 'slides', range: '', includeHidden: false, frame: true, color: 'color', fit: true, perPage: 6, landscape: false };

export type RangeResult = { ok: true; indices: number[] } | { ok: false; error: string };

/**
 * A slide range as typed in the Print page's Slides box ("1-3, 5"; 1-based, `,` or `;` between parts,
 * ranges either way round) → 0-based indices in order, without repeats (DeckCraft parse_slide_range).
 * A number past the last slide, or text that is not numbers, is an error, as in PowerPoint.
 */
export function parseSlideRange(text: string, count: number): RangeResult {
  const bad: RangeResult = { ok: false, error: `“${text}”은(는) 올바른 슬라이드 범위가 아닙니다. 1-3, 5 처럼 숫자와 범위를 쓰세요.` };
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of text.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const dash = raw.indexOf('-');
    const a = (dash < 0 ? raw : raw.slice(0, dash)).trim();
    const b = (dash < 0 ? raw : raw.slice(dash + 1)).trim();
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return bad;
    const lo = Math.min(Number(a), Number(b)), hi = Math.max(Number(a), Number(b));
    if (lo === 0 || hi > count) return { ok: false, error: `프레젠테이션에는 슬라이드가 ${count}장 있습니다. “${raw}”은(는) 범위를 벗어났습니다.` };
    for (let i = lo - 1; i < hi; i++) if (!seen.has(i)) { seen.add(i); out.push(i); }
  }
  return out.length ? { ok: true, indices: out } : bad;
}

export interface PrintPage { slide: Slide; /** The slide's number in the deck (1-based, as the slide pane shows it). */ number: number }

/** The slides a print job covers: the range, then hidden slides only when asked for. */
export function printPages(p: Presentation, o: Pick<PrintOptions, 'range' | 'includeHidden'>): { pages: PrintPage[]; error?: string } {
  const all = sequence(p).map((x, i) => ({ slide: x.slide, number: i + 1 }));
  let picked = all;
  if (o.range.trim()) {
    const r = parseSlideRange(o.range, all.length);
    if (!r.ok) return { pages: [], error: r.error };
    picked = r.indices.map((i) => all[i]);
  }
  return { pages: o.includeHidden ? picked : picked.filter((x) => !x.slide.disabled) };
}

/** The CSS filter that shows a slide in grayscale or pure black and white. */
export const colorFilter = (c: ColorMode): string | undefined => (c === 'gray' ? 'grayscale(1)' : c === 'bw' ? 'grayscale(1) contrast(1000%)' : undefined);

export const COLOR_LABEL: Record<ColorMode, string> = { color: '컬러', gray: '회색조', bw: '흑백' };

/** Words in a piece of text (Korean words are the blocks between spaces, as Word counts them). */
export const countWords = (t: string | undefined): number => (t ? t.split(/\s+/).filter(Boolean).length : 0);

function slideTexts(s: Slide): string[] {
  const out: (string | undefined)[] = [s.title, s.text, s.subtext];
  for (const e of s.elements ?? []) {
    if (e.master) continue;
    out.push(e.text);
    for (const row of e.table?.rows ?? []) for (const c of row) out.push((c as { text?: string }).text);
  }
  return out.filter((x): x is string => !!x);
}

/** Every media id a presentation uses (pictures, videos, audio, backgrounds). */
export function mediaIdsOf(p: Presentation): string[] {
  const ids = new Set<string>();
  const bg = (b: Slide['background'] | Presentation['background']) => { if (b && b.kind === 'media') ids.add(b.mediaId); };
  bg(p.background);
  for (const s of p.slides) {
    bg(s.background);
    for (const e of s.elements ?? []) {
      if (e.mediaId) ids.add(e.mediaId);
      if (e.fillImage) ids.add(e.fillImage);
    }
  }
  return [...ids];
}

export interface DocStats {
  slides: number; hidden: number; sections: number; words: number; noteWords: number;
  comments: number; animations: number; transitions: number; pictures: number; videos: number; audios: number; media: number;
}

/** File › Info: what DeckCraft's file.info reports (slides, hidden slides, sections) plus words and objects. */
export function docStats(p: Presentation): DocStats {
  let sections = 0, prev: string | undefined;
  p.slides.forEach((s, i) => { if (i === 0 || s.group !== prev) sections++; prev = s.group; });
  const count = (kind: string) => p.slides.reduce((n, s) => n + (s.elements ?? []).filter((e) => e.kind === kind).length, 0);
  return {
    slides: p.slides.length,
    hidden: p.slides.filter((s) => s.disabled).length,
    sections,
    words: p.slides.reduce((n, s) => n + slideTexts(s).reduce((m, t) => m + countWords(t), 0), 0),
    noteWords: p.slides.reduce((n, s) => n + countWords(s.notes), 0),
    comments: p.slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0),
    animations: p.slides.reduce((n, s) => n + (s.animations?.length ?? 0), 0),
    transitions: p.slides.filter((s) => s.transition && s.transition.kind !== 'none').length,
    pictures: count('image'), videos: count('video'), audios: count('audio'),
    media: mediaIdsOf(p).length,
  };
}

export const formatBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

// ── Export ──
export type ExportFormat = 'png' | 'jpeg';
/** 내보내기 크기: the width in pixels (the height follows the 4:3 slide). */
export const EXPORT_SIZES: { id: string; label: string; width: number }[] = [
  { id: 'small', label: '작게 (960 × 720)', width: 960 },
  { id: 'medium', label: '보통 (1440 × 1080)', width: 1440 },
  { id: 'large', label: '크게 (1920 × 1440)', width: 1920 },
  { id: 'xl', label: '아주 크게 (2880 × 2160)', width: 2880 },
];
export const exportHeight = (width: number): number => Math.round((width * 3) / 4);

/** File names for a numbered slide export: 제목-01.png (zero padded to the deck's size, characters a file name cannot hold removed). */
export function exportFileName(title: string, number: number, total: number, ext: string): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, ' ').trim() || 'slides';
  return `${safe}-${String(number).padStart(Math.max(2, String(total).length), '0')}.${ext}`;
}
