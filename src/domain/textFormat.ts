// PowerPoint's text commands (홈 → 글꼴 / 단락) as plain functions: bullets and numbering,
// 대/소문자 바꾸기, font size steps and line spacing.
import type { CSSProperties } from 'react';
import type { HAlign, ListStyle, TextDirection } from './types';

/** One indent level (단락 → 들여쓰기 늘리기), in canvas pixels. */
export const INDENT_PX = 60;

/** PowerPoint's single line spacing (1.0) as a CSS line-height multiple (Arial ≈ 1.2 em). */
export const SINGLE_SPACING = 1.2;
/** The 줄 간격 menu: 1.0, 1.5, 2.0 … times single spacing. */
export const LINE_SPACINGS = [1.0, 1.15, 1.5, 2.0, 2.5, 3.0];

/**
 * Font sizes the size box lists and 글꼴 크기 크게 / 작게 step through: PowerPoint's list
 * (8 … 96 pt) in canvas pixels (a 1440-wide slide is 2 px per point).
 */
export const FONT_SIZES = [16, 18, 20, 21, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176, 192];

/** The next size up (or down) from `size`, as PowerPoint's A↑ / A↓ buttons do. */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir > 0) return FONT_SIZES.find((n) => n > size + 0.01) ?? Math.round(size * 1.1);
  const down = [...FONT_SIZES].reverse().find((n) => n < size - 0.01);
  return down ?? Math.max(2, Math.round(size / 1.1));
}

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n: number) => ROMAN.reduce((out, [v, r]) => {
  let s = out;
  while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}, '');
const HANGUL = '가나다라마바사아자차카타파하';

/** The marker in front of the n-th (1-based) item of a list. */
export function listMarker(list: ListStyle, n: number): string {
  switch (list) {
    case 'bullet': return '•';
    case 'circle': return '○';
    case 'square': return '■';
    case 'check': return '✓';
    case 'arrow': return '➢';
    case 'number': return `${n}.`;
    case 'number-paren': return `${n})`;
    case 'roman': return `${roman(n)}.`;
    case 'alpha': return `${String.fromCharCode(64 + (((n - 1) % 26) + 1))}.`;
    case 'hangul': return `${HANGUL[(n - 1) % HANGUL.length]}.`;
  }
}

/** Markers for each line of `text` (blank lines get none and don't count). */
export function listMarkers(lines: string[], list: ListStyle | undefined): (string | null)[] {
  let n = 0;
  return lines.map((l) => (list && l.trim() ? listMarker(list, ++n) : null));
}

export type CaseKind = 'sentence' | 'lower' | 'upper' | 'title' | 'toggle';

/** 대/소문자 바꾸기: 문장의 첫 글자를 대문자로 · 모두 소문자로 · 모두 대문자로 · 각 단어를 대문자로 · 대/소문자 전환. */
export function changeCase(text: string, kind: CaseKind): string {
  switch (kind) {
    case 'lower': return text.toLowerCase();
    case 'upper': return text.toUpperCase();
    case 'title': return text.toLowerCase().replace(/(^|[\s(“"'‘-])(\p{L})/gu, (_, pre: string, c: string) => pre + c.toUpperCase());
    case 'toggle': return [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
    case 'sentence': return text.toLowerCase().replace(/(^|[.!?]\s+|\n)(\p{L})/gu, (_, pre: string, c: string) => pre + c.toUpperCase());
  }
}

/** The menu 텍스트 방향, in PowerPoint's Korean names; `vert` is the attribute value the pptx file uses. */
export const TEXT_DIRECTIONS = [
  { id: 'horz', label: '가로', vert: 'horz' },
  { id: 'rotate90', label: '모든 텍스트를 90° 회전', vert: 'vert' },
  { id: 'rotate270', label: '모든 텍스트를 270° 회전', vert: 'vert270' },
  { id: 'stacked', label: '세로 (스택형)', vert: 'wordArtVert' },
  { id: 'eaVert', label: '세로 쓰기 (한글)', vert: 'eaVert' },
] as const;
export type DirectionId = (typeof TEXT_DIRECTIONS)[number]['id'];

/** Which menu entry a box's `vertical` / `direction` stand for. */
export const directionId = (f: { vertical?: boolean; direction?: TextDirection }): DirectionId => f.direction ?? (f.vertical ? 'eaVert' : 'horz');
/** The box fields for a menu entry (the other one is cleared). */
export const directionPatch = (id: DirectionId): { vertical: boolean | undefined; direction: TextDirection | undefined } => ({
  vertical: id === 'eaVert' ? true : undefined, direction: id === 'rotate90' || id === 'rotate270' || id === 'stacked' ? id : undefined,
});
export const isVerticalText = (f: { vertical?: boolean; direction?: TextDirection }) => directionId(f) !== 'horz';
/** The pptx `bodyPr vert` value (undefined: horizontal). */
export const pptxVert = (f: { vertical?: boolean; direction?: TextDirection }) => TEXT_DIRECTIONS.find((d) => d.id === directionId(f) && d.id !== 'horz')?.vert;
/** pptx `vert` → the fields it stands for (mongolianVert / wordArtVertRtl are the nearest of ours). */
export function fromPptxVert(vert: string | undefined): { vertical?: true; direction?: TextDirection } {
  switch (vert) {
    case 'eaVert': return { vertical: true };
    case 'vert': case 'mongolianVert': return { direction: 'rotate90' };
    case 'vert270': return { direction: 'rotate270' };
    case 'wordArtVert': case 'wordArtVertRtl': return { direction: 'stacked' };
    default: return {};
  }
}
/** CSS for 텍스트 방향: 90° is vertical-rl with every glyph turned, 270° its mirror (sideways-lr), stacked keeps glyphs upright. */
export function writingCss(f: { vertical?: boolean; direction?: TextDirection }): CSSProperties {
  switch (directionId(f)) {
    case 'rotate90': return { writingMode: 'vertical-rl', textOrientation: 'sideways' };
    case 'rotate270': return { writingMode: 'sideways-lr' as CSSProperties['writingMode'] };
    case 'stacked': return { writingMode: 'vertical-rl', textOrientation: 'upright' };
    case 'eaVert': return { writingMode: 'vertical-rl' };
    default: return {};
  }
}

/** 줄 간격 고정 / 최소: the line-height CSS of a box. `size` is the box's own font size (canvas px). */
export function lineHeightCss(f: { lineHeight?: number; lineExact?: { mode: 'exact' | 'min'; px: number } }, size: number, fallback: number): CSSProperties['lineHeight'] {
  const x = f.lineExact;
  if (!x) return f.lineHeight ?? fallback;
  // 최소: never tighter than single spacing of the text itself (CSS has no min line-height).
  return x.mode === 'exact' ? `${x.px}px` : `${Math.max(x.px, size * SINGLE_SPACING)}px`;
}

/** CSS for 맞춤: 균등 분할 spreads the last line too, 양쪽 맞춤 (낮음) is justify with the last line left. */
export function alignCss(align: HAlign | undefined): Pick<CSSProperties, 'textAlign' | 'textAlignLast'> {
  if (align === 'distributed') return { textAlign: 'justify', textAlignLast: 'justify' };
  if (align === 'justLow') return { textAlign: 'justify' };
  return { textAlign: align };
}

/** What a soft line break (Shift+Enter, \v) draws as inside a pre-wrap box: a line break within the paragraph. */
export const softToNewline = (text: string) => (text.includes('\u000b') ? text.replace(/\u000b/g, '\n') : text);
