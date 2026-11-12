// Shape Effects (도형 효과) as DeckCraft defines them (cmd/shape/appearance.rs shadow_preset,
// effects; cmd/three_d.rs BEVELS and CAMERAS), and how LightCast draws them with CSS.
import type { CSSProperties } from 'react';
import type { SlideElement } from './types';

export type ShadowKind = NonNullable<SlideElement['shadowKind']>;
export interface ShadowOpts { color: string; transparency: number; blur: number; dist: number; dir: number }

/** The shadow presets: DeckCraft's values (blur 4 pt, distance 3 pt, 45°, 60% transparent black), in canvas px. */
export const SHADOW_PRESETS: Record<ShadowKind, { label: string; opts: ShadowOpts }> = {
  outer: { label: '바깥쪽: 오프셋 오른쪽 아래', opts: { color: '#000000', transparency: 0.6, blur: 8, dist: 6, dir: 45 } },
  bottom: { label: '바깥쪽: 오프셋 아래쪽', opts: { color: '#000000', transparency: 0.6, blur: 8, dist: 6, dir: 90 } },
  center: { label: '바깥쪽: 가운데', opts: { color: '#000000', transparency: 0.6, blur: 16, dist: 0, dir: 0 } },
  inner: { label: '안쪽: 왼쪽 위', opts: { color: '#000000', transparency: 0.6, blur: 8, dist: 6, dir: 45 } },
  perspective: { label: '원근감: 아래', opts: { color: '#000000', transparency: 0.6, blur: 12, dist: 0, dir: 90 } },
};

/** The shadow an object draws: its preset with any options set in Format Shape. */
export function shadowOf(el: SlideElement): (ShadowOpts & { kind: ShadowKind }) | null {
  if (!el.dropShadow) return null;
  const kind = el.shadowKind ?? 'outer';
  return { kind, ...SHADOW_PRESETS[kind].opts, ...stripUndefined(el.shadowOpts ?? {}) };
}

/** `#rrggbb` with an opacity, as CSS. */
export function rgba(hex: string, alpha: number): string {
  const h = /^#?([0-9a-f]{6})/i.exec(hex)?.[1] ?? '000000';
  const n = parseInt(h, 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The CSS filter for an object's shadow and glow. */
export function effectFilter(el: SlideElement): string | undefined {
  const s = shadowOf(el);
  const parts: string[] = [];
  if (s) {
    const c = rgba(s.color, 1 - s.transparency);
    const a = (s.dir * Math.PI) / 180;
    if (s.kind === 'inner') parts.push(`drop-shadow(0 0 ${r1(s.blur / 4)}px ${c})`);
    // A shadow cast on the floor behind the object: further down and softer.
    else if (s.kind === 'perspective') parts.push(`drop-shadow(${r1(s.blur * 1.5)}px ${r1(s.blur * 1.8 + s.dist)}px ${r1(s.blur)}px ${c})`);
    else parts.push(`drop-shadow(${r1(Math.cos(a) * s.dist)}px ${r1(Math.sin(a) * s.dist)}px ${r1(s.blur)}px ${c})`);
  }
  if (el.glow) {
    const g = el.glowSize ?? 18;
    const c = rgba(el.glow, 1 - (el.glowAlpha ?? 0.6) * 0.5);
    parts.push(`drop-shadow(0 0 ${g}px ${c}) drop-shadow(0 0 ${g / 2}px ${c})`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

/** Reflection variations (반사): DeckCraft's tight / half / full end positions. */
export const REFLECTIONS: { id: string; label: string; size: number; dist: number }[] = [
  { id: 'tight', label: '근접 반사', size: 0.35, dist: 0 },
  { id: 'half', label: '1/2 반사', size: 0.55, dist: 8 },
  { id: 'full', label: '전체 반사', size: 0.9, dist: 8 },
];

/** -webkit-box-reflect for an object's reflection: how much shows, how transparent, how far below. */
export function reflectCss(el: SlideElement): string | undefined {
  if (!el.reflection) return undefined;
  const o = el.reflectionOpts ?? {};
  const size = Math.max(0, Math.min(1, o.size ?? 0.45));
  const alpha = 1 - Math.max(0, Math.min(1, o.transparency ?? 0.6));
  return `below ${Math.round(o.dist ?? 4)}px linear-gradient(transparent ${Math.round((1 - size) * 100)}%, rgba(255,255,255,${Math.round(alpha * 100) / 100}))`;
}

/** Bevel presets (입체 효과, three_d::BEVELS), each drawn as a lit edge of its own depth and softness. */
export const BEVELS: { id: string; label: string; depth: number; blur: number }[] = [
  { id: 'circle', label: '둥글게', depth: 4, blur: 8 },
  { id: 'relaxedInset', label: '완만하게', depth: 3, blur: 10 },
  { id: 'cross', label: '십자형', depth: 3, blur: 2 },
  { id: 'coolSlant', label: '비스듬하게', depth: 6, blur: 3 },
  { id: 'angle', label: '각지게', depth: 4, blur: 0 },
  { id: 'softRound', label: '부드럽게 둥글게', depth: 7, blur: 14 },
  { id: 'convex', label: '볼록하게', depth: 6, blur: 10 },
  { id: 'slope', label: '경사', depth: 8, blur: 4 },
  { id: 'divot', label: '오목하게', depth: 3, blur: 5 },
  { id: 'riblet', label: '리블렛', depth: 2, blur: 1 },
  { id: 'hardEdge', label: '딱딱한 가장자리', depth: 5, blur: 1 },
  { id: 'artDeco', label: '아트 데코', depth: 5, blur: 6 },
];

export function bevelCss(el: SlideElement): string | undefined {
  if (!el.bevel) return undefined;
  const b = BEVELS.find((x) => x.id === el.bevelKind) ?? BEVELS[0];
  const d = b.depth, bl = b.blur;
  // A dent (divot) is lit from below, a raised bevel from above.
  const [hi, lo] = b.id === 'divot' ? ['rgba(0,0,0,.35)', 'rgba(255,255,255,.45)'] : ['rgba(255,255,255,.45)', 'rgba(0,0,0,.35)'];
  return `inset ${d}px ${d}px ${bl}px ${hi}, inset -${d}px -${d}px ${bl}px ${lo}`;
}

/**
 * 3-D Rotation presets (three_d::CAMERAS) as PowerPoint's Korean gallery names them, with the tilt
 * LightCast draws for each (x: forward, y: sideways, z: in the slide; persp: perspective camera).
 */
export const CAMERAS: { id: string; label: string; group: '평행' | '원근감' | '오블리크'; x: number; y: number; z?: number; persp?: boolean }[] = [
  { id: 'isometricLeftDown', label: '등각: 왼쪽 아래', group: '평행', x: 35, y: 45 },
  { id: 'isometricRightUp', label: '등각: 오른쪽 위', group: '평행', x: -35, y: -45 },
  { id: 'isometricTopUp', label: '등각: 위쪽', group: '평행', x: 55, y: 0, z: -45 },
  { id: 'isometricBottomDown', label: '등각: 아래쪽', group: '평행', x: -55, y: 0, z: 45 },
  { id: 'isometricLeftUp', label: '등각: 왼쪽 위', group: '평행', x: -35, y: 45 },
  { id: 'isometricRightDown', label: '등각: 오른쪽 아래', group: '평행', x: 35, y: -45 },
  { id: 'isometricTopDown', label: '등각: 위로', group: '평행', x: 55, y: 0, z: 45 },
  { id: 'isometricBottomUp', label: '등각: 아래로', group: '평행', x: -55, y: 0, z: -45 },
  { id: 'perspectiveFront', label: '원근감: 앞', group: '원근감', x: 0, y: 0, persp: true },
  { id: 'perspectiveLeft', label: '원근감: 왼쪽', group: '원근감', x: 0, y: 20, persp: true },
  { id: 'perspectiveRight', label: '원근감: 오른쪽', group: '원근감', x: 0, y: -20, persp: true },
  { id: 'perspectiveAbove', label: '원근감: 위', group: '원근감', x: 30, y: 0, persp: true },
  { id: 'perspectiveBelow', label: '원근감: 아래', group: '원근감', x: -30, y: 0, persp: true },
  { id: 'perspectiveAboveLeftFacing', label: '원근감: 위, 왼쪽 방향', group: '원근감', x: 25, y: 25, persp: true },
  { id: 'perspectiveAboveRightFacing', label: '원근감: 위, 오른쪽 방향', group: '원근감', x: 25, y: -25, persp: true },
  { id: 'perspectiveContrastingLeftFacing', label: '원근감: 대비, 왼쪽 방향', group: '원근감', x: 10, y: 40, persp: true },
  { id: 'perspectiveContrastingRightFacing', label: '원근감: 대비, 오른쪽 방향', group: '원근감', x: 10, y: -40, persp: true },
  { id: 'perspectiveHeroicLeftFacing', label: '원근감: 강조, 왼쪽 방향', group: '원근감', x: -15, y: 35, persp: true },
  { id: 'perspectiveHeroicRightFacing', label: '원근감: 강조, 오른쪽 방향', group: '원근감', x: -15, y: -35, persp: true },
  { id: 'perspectiveRelaxed', label: '원근감: 완만하게', group: '원근감', x: 45, y: 0, persp: true },
  { id: 'perspectiveRelaxedModerately', label: '원근감: 약간 완만하게', group: '원근감', x: 30, y: 0, persp: true },
  { id: 'obliqueTopLeft', label: '오블리크: 왼쪽 위', group: '오블리크', x: 15, y: 15 },
  { id: 'obliqueTopRight', label: '오블리크: 오른쪽 위', group: '오블리크', x: 15, y: -15 },
  { id: 'obliqueBottomLeft', label: '오블리크: 왼쪽 아래', group: '오블리크', x: -15, y: 15 },
  { id: 'obliqueBottomRight', label: '오블리크: 오른쪽 아래', group: '오블리크', x: -15, y: -15 },
];

/** The CSS transform of an object: its 3-D tilt (perspective or nearly parallel), rotation and flips. */
export function transformOf(el: SlideElement): string | undefined {
  const r = el.rotate3d;
  const tilt = r && (r.x || r.y || r.z || r.persp)
    ? `perspective(${r.persp ? 900 : 4000}px) rotateX(${r.x}deg) rotateY(${r.y}deg)${r.z ? ` rotateZ(${r.z}deg)` : ''}`
    : '';
  return [tilt, el.rotation ? `rotate(${el.rotation}deg)` : '', el.flipH ? 'scaleX(-1)' : '', el.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ') || undefined;
}

/** Reflection, soft edges and bevel as CSS. */
export function effectStyle(el: SlideElement): CSSProperties {
  const css: CSSProperties = {};
  const refl = reflectCss(el);
  if (refl) css.WebkitBoxReflect = refl;
  if (el.softEdge) {
    const e = `${el.softEdge}px`;
    css.WebkitMaskImage = `linear-gradient(to right, transparent, #000 ${e}, #000 calc(100% - ${e}), transparent), linear-gradient(to bottom, transparent, #000 ${e}, #000 calc(100% - ${e}), transparent)`;
    css.WebkitMaskComposite = 'source-in';
    css.maskComposite = 'intersect';
  }
  const bevel = bevelCss(el);
  if (bevel) css.boxShadow = bevel;
  return css;
}

/** Every effect off (효과 모두 없애기). */
export const NO_EFFECTS: Partial<SlideElement> = {
  dropShadow: undefined, shadowKind: undefined, shadowOpts: undefined, glow: undefined, glowSize: undefined, glowAlpha: undefined,
  reflection: undefined, reflectionOpts: undefined, softEdge: undefined, bevel: undefined, bevelKind: undefined, rotate3d: undefined, camera3d: undefined,
};

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── Outline (shape.line) ────────────────────────────────────────────────────────────────────────

/** Dash presets DeckCraft's shape.line takes, with PowerPoint's Korean names. */
export const DASHES: { id: NonNullable<SlideElement['dash']>; label: string; pattern: (w: number) => string | undefined }[] = [
  { id: 'solid', label: '실선', pattern: () => undefined },
  { id: 'sysDot', label: '둥근 점선', pattern: (w) => `${w} ${w}` },
  { id: 'sysDash', label: '사각 점선', pattern: (w) => `${w * 3} ${w}` },
  { id: 'dash', label: '파선', pattern: (w) => `${w * 4} ${w * 3}` },
  { id: 'dashDot', label: '파선-점선', pattern: (w) => `${w * 4} ${w * 2} ${w} ${w * 2}` },
  { id: 'lgDash', label: '긴 파선', pattern: (w) => `${w * 8} ${w * 3}` },
  { id: 'dot', label: '점선', pattern: (w) => `${w} ${w * 2}` },
];
export const dashPattern = (dash: SlideElement['dash'], w: number) => (DASHES.find((d) => d.id === (dash ?? 'solid')) ?? DASHES[0]).pattern(w);

export const ARROW_KINDS: { id: NonNullable<SlideElement['arrowEndKind']>; label: string }[] = [
  { id: 'triangle', label: '삼각형 화살표' }, { id: 'arrow', label: '열린 화살표' }, { id: 'stealth', label: '날렵한 화살표' },
  { id: 'diamond', label: '다이아몬드 화살표' }, { id: 'oval', label: '타원 화살표' },
];

/** Marker outline (10×10 box, tip at the right) for an arrowhead kind. */
export function arrowPath(kind: SlideElement['arrowEndKind']): { d: string; filled: boolean } {
  switch (kind) {
    case 'stealth': return { d: 'M0 0 L10 5 L0 10 L3 5 Z', filled: true };
    case 'diamond': return { d: 'M0 5 L5 0 L10 5 L5 10 Z', filled: true };
    case 'oval': return { d: 'M5 0 A5 5 0 1 1 5 10 A5 5 0 1 1 5 0 Z', filled: true };
    case 'arrow': return { d: 'M0 0 L10 5 L0 10', filled: false };
    default: return { d: 'M0 0 L10 5 L0 10 Z', filled: true };
  }
}
export const ARROW_SCALE: Record<NonNullable<SlideElement['arrowSize']>, number> = { sm: 3.5, med: 5, lg: 7 };
