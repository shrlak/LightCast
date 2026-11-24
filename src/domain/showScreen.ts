/**
 * The slide show screen as PowerPoint draws it: ink written on slides during the show (펜 · 형광펜 · 지우개),
 * 검정 / 흰색 화면, the black "슬라이드 쇼 마지막입니다" screen after the last slide, and 슬라이드 확대.
 * The show's state lives on the live feed so the audience windows and the presenter view show the same thing.
 */
import { makeInk } from './editOps';
import type { Presentation, SlideElement } from './types';
import { sequence } from './arrangement';

/** One stroke written in the show, in slide canvas units. */
export interface ShowStroke {
  points: [number, number][];
  color: string;
  /** Canvas px. */
  width: number;
  highlighter?: boolean;
}

/** 슬라이드 확대: the slide drawn `scale` times larger around (x, y) (canvas units). */
export interface ShowZoom { x: number; y: number; scale: number }

/** What the show's pointer does: PowerPoint's 포인터 옵션. */
export type ShowPointer = 'arrow' | 'laser' | 'pen' | 'highlighter' | 'eraser';

/** PowerPoint's 잉크 색 in the slide show's pen menu. */
export const INK_COLORS = ['#000000', '#ffffff', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#7030a0', '#c00000', '#7f7f7f'];
/** Pen and highlighter widths (canvas px). */
export const PEN_WIDTH = 6;
export const HIGHLIGHTER_WIDTH = 28;

/** The text PowerPoint shows on the black screen after the last slide. */
export const END_OF_SHOW = '슬라이드 쇼 마지막입니다. 끝내려면 클릭하십시오.';

/** The key a slide's show ink is kept under: its presentation and place in the show (a slide shown twice keeps both). */
export const inkKey = (presentationId: string, seq: number) => `${presentationId}#${seq}`;

/** Show ink, by slide. */
export type ShowInk = Record<string, ShowStroke[]>;

export function addStroke(ink: ShowInk | undefined, key: string, stroke: ShowStroke): ShowInk {
  if (stroke.points.length < 2) return ink ?? {};
  return { ...(ink ?? {}), [key]: [...(ink?.[key] ?? []), stroke] };
}

/** The distance from (x, y) to the segment a–b. */
function segDist(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** 지우개: the strokes on a slide that pass within `r` of (x, y) are taken off (whole strokes, as PowerPoint's eraser). */
export function eraseAt(ink: ShowInk | undefined, key: string, x: number, y: number, r = 24): ShowInk {
  const list = ink?.[key];
  if (!list?.length) return ink ?? {};
  const keep = list.filter((s) => !s.points.some((p, i) => segDist(x, y, p, s.points[Math.max(0, i - 1)]) <= r + s.width / 2));
  if (keep.length === list.length) return ink!;
  const out = { ...ink };
  if (keep.length) out[key] = keep; else delete out[key];
  return out;
}

/** 슬라이드의 잉크 모두 지우기 (E). */
export function clearSlideInk(ink: ShowInk | undefined, key: string): ShowInk {
  if (!ink?.[key]) return ink ?? {};
  const out = { ...ink };
  delete out[key];
  return out;
}

export const hasInk = (ink: ShowInk | undefined) => !!ink && Object.values(ink).some((l) => l.length);

/** An SVG path through a stroke's points (smoothed with quadratic midpoints). */
export function strokePath(points: [number, number][]): string {
  if (!points.length) return '';
  if (points.length < 3) return `M${points.map(([x, y]) => `${x} ${y}`).join(' L')}`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i], [nx, ny] = points[i + 1];
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

/**
 * "잉크 주석을 유지하시겠습니까?" › 유지: each slide's show ink becomes ink objects on that slide, as PowerPoint keeps
 * annotations. Returns the slides that changed (by id); a slide shown twice gets the ink of both showings.
 */
export function keepShowInk(p: Presentation, ink: ShowInk | undefined): Map<string, SlideElement[]> {
  const out = new Map<string, SlideElement[]>();
  if (!ink) return out;
  const seq = sequence(p);
  for (const [key, strokes] of Object.entries(ink)) {
    const at = key.lastIndexOf('#');
    if (key.slice(0, at) !== p.id) continue;
    const slide = seq[Number(key.slice(at + 1))]?.slide;
    if (!slide) continue;
    const made = strokes.map((s) => makeInk(s.points, s.color, s.width, !!s.highlighter)).filter((e): e is SlideElement => !!e);
    if (made.length) out.set(slide.id, [...(out.get(slide.id) ?? []), ...made]);
  }
  return out;
}

/** 슬라이드 확대 (+ / −): the next zoom step from the current one, centred at (x, y); null is back to the whole slide. */
export function zoomStep(z: ShowZoom | null | undefined, dir: 1 | -1, x: number, y: number): ShowZoom | null {
  const steps = [1, 1.5, 2, 3, 4];
  const cur = z?.scale ?? 1;
  const i = steps.findIndex((s) => s >= cur - 1e-6);
  const next = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? 0 : i) + dir))];
  return next <= 1 ? null : { x: z?.x ?? x, y: z?.y ?? y, scale: next };
}

/** A typed slide number then Enter goes to that slide (PowerPoint's "번호 + Enter"). */
export function typedSlide(typed: string, count: number): number | null {
  const n = Number(typed);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}

/** PowerPoint's 슬라이드 쇼 도움말 (F1): the keys the show answers to. */
export const SHOW_KEYS: [string, string][] = [
  ['N, 클릭, Space, →, ↓, Enter, Page Down', '다음 애니메이션 실행 또는 다음 슬라이드로 이동'],
  ['P, Backspace, ←, ↑, Page Up', '이전 애니메이션 실행 또는 이전 슬라이드로 이동'],
  ['번호 + Enter', '해당 슬라이드로 이동'],
  ['Home / End', '첫 슬라이드 / 마지막 슬라이드로 이동'],
  ['B 또는 .', '검정 화면 표시 / 슬라이드 쇼로 돌아가기'],
  ['W 또는 ,', '흰색 화면 표시 / 슬라이드 쇼로 돌아가기'],
  ['G 또는 -', '모든 슬라이드 보기'],
  ['+ / −', '슬라이드 확대 / 축소'],
  ['Ctrl+L', '레이저 포인터'],
  ['Ctrl+P', '펜'],
  ['Ctrl+I', '형광펜'],
  ['Ctrl+E', '지우개'],
  ['Ctrl+A', '화살표 표시'],
  ['Ctrl+H', '화살표 숨기기'],
  ['E', '슬라이드의 잉크 모두 지우기'],
  ['Esc, Ctrl+Break', '슬라이드 쇼 마침'],
  ['F1', '도움말'],
];

/** What a key does in a running slide show (PowerPoint's keys), given the slide number typed so far. */
export type ShowKey =
  | { do: 'next' } | { do: 'prev' } | { do: 'go'; seq: number } | { do: 'first' } | { do: 'last' }
  | { do: 'black' } | { do: 'white' } | { do: 'clearInk' } | { do: 'end' } | { do: 'all' }
  | { do: 'zoom'; dir: 1 | -1 } | { do: 'unzoom' } | { do: 'type'; typed: string };

/**
 * A key in the slide show: digits build a slide number that Enter goes to; after the last slide any advance ends
 * the show; Esc zooms back out before it ends the show. Null for keys the show does not use.
 */
export function showKey(key: string, typed: string, s: { ended?: boolean; zoomed?: boolean; count: number }): ShowKey | null {
  if (/^[0-9]$/.test(key)) return { do: 'type', typed: (typed + key).slice(-4) };
  if (key === 'Enter' && typed) { const seq = typedSlide(typed, s.count); return seq === null ? { do: 'type', typed: '' } : { do: 'go', seq }; }
  const advance = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(key);
  if (advance) return s.ended ? { do: 'end' } : { do: 'next' };
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(key)) return { do: 'prev' };
  if (key === 'Home') return { do: 'first' };
  if (key === 'End') return { do: 'last' };
  if (key === 'b' || key === 'B' || key === '.') return { do: 'black' };
  if (key === 'w' || key === 'W' || key === ',') return { do: 'white' };
  if (key === 'e' || key === 'E') return { do: 'clearInk' };
  if (key === '+' || key === '=') return { do: 'zoom', dir: 1 };
  if (key === '-') return s.zoomed ? { do: 'zoom', dir: -1 } : { do: 'all' };
  if (key === 'g' || key === 'G') return { do: 'all' };
  if (key === 'Escape') return s.zoomed ? { do: 'unzoom' } : { do: 'end' };
  return null;
}

/** The window event that opens 모든 슬라이드 보기 in the presenter view. */
export const SHOW_ALL_EVENT = 'lightcast:show-all-slides';

/** A show-screen command sent by an audience window to the console (which owns the show). */
export type ScreenAction =
  | { kind: 'black' } | { kind: 'white' } | { kind: 'clearInk' }
  | { kind: 'ink'; stroke: ShowStroke } | { kind: 'erase'; x: number; y: number }
  | { kind: 'zoom'; zoom: ShowZoom | null };

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const COLOR = /^#[0-9a-f]{6}$/i;

/** The reducer action for a screen command from another window, checked first (it arrives over a channel). */
export function screenAction(a: unknown): import('./reducer').Action | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  switch (o.kind) {
    case 'black': return { type: 'live/toggleBlack' };
    case 'white': return { type: 'live/white' };
    case 'clearInk': return { type: 'live/ink', op: 'clear' };
    case 'erase': return num(o.x, -1e4, 1e4) && num(o.y, -1e4, 1e4) ? { type: 'live/ink', op: 'erase', x: o.x as number, y: o.y as number } : null;
    case 'zoom': {
      if (o.zoom === null) return { type: 'live/zoom', zoom: null };
      const z = o.zoom as Record<string, unknown> | undefined;
      return z && num(z.x, 0, 1e4) && num(z.y, 0, 1e4) && num(z.scale, 1, 8) ? { type: 'live/zoom', zoom: { x: z.x as number, y: z.y as number, scale: z.scale as number } } : null;
    }
    case 'ink': {
      const s = o.stroke as Record<string, unknown> | undefined;
      if (!s || !Array.isArray(s.points) || s.points.length < 2 || s.points.length > 5000 || typeof s.color !== 'string' || !COLOR.test(s.color) || !num(s.width, 0.5, 100)) return null;
      if (!s.points.every((p) => Array.isArray(p) && p.length === 2 && num(p[0], -1e4, 1e4) && num(p[1], -1e4, 1e4))) return null;
      return { type: 'live/ink', op: 'add', stroke: { points: s.points as [number, number][], color: s.color, width: s.width as number, ...(s.highlighter ? { highlighter: true } : {}) } };
    }
  }
  return null;
}

/** A point on the drawn slide (fractions 0–1 of the frame) in slide canvas units, undoing 슬라이드 확대. */
export function framePoint(fx: number, fy: number, z: ShowZoom | null | undefined, w: number, h: number): [number, number] {
  const ux = fx * w, uy = fy * h;
  if (!z || z.scale <= 1) return [ux, uy];
  const hw = w / (2 * z.scale), hh = h / (2 * z.scale);
  const cx = Math.max(hw, Math.min(w - hw, z.x)), cy = Math.max(hh, Math.min(h - hh, z.y));
  return [cx + (ux - w / 2) / z.scale, cy + (uy - h / 2) / z.scale];
}
