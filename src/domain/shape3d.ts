// Format Shape › 3-D Format (DeckCraft cmd/three_d.rs): depth, contour, material, lighting and bevel
// sizes. Every value is kept on the object (`format3d`, `bevelKind`, `rotate3d`, `camera3d`) and written
// to a .pptx as a:scene3d / a:sp3d. The screen is HTML/SVG, not a 3-D renderer, so what it draws is an
// approximation: depth is a stack of copies pushed back along z (visible once the shape is tilted, as in
// PowerPoint's front view where depth hides behind the face), contour a ring around the face and the
// extrusion, lighting and material a gradient over the face. Bevel sizes scale the lit-edge drawing.
import type { Format3d, SlideElement } from './types';

export const MATERIALS: { id: string; label: string }[] = [
  { id: 'warmMatte', label: '따뜻한 무광택' }, { id: 'matte', label: '무광택' }, { id: 'plastic', label: '플라스틱' },
  { id: 'metal', label: '금속' }, { id: 'dkEdge', label: '어두운 가장자리' }, { id: 'softEdge', label: '부드러운 가장자리' },
  { id: 'flat', label: '평면' }, { id: 'legacyWireframe', label: '와이어프레임' }, { id: 'powder', label: '분말' },
  { id: 'translucentPowder', label: '반투명 분말' }, { id: 'clear', label: '투명' }, { id: 'softmetal', label: '부드러운 금속' },
];

export const LIGHTINGS: { id: string; label: string }[] = [
  { id: 'threePt', label: '3점' }, { id: 'balanced', label: '균형' }, { id: 'soft', label: '부드럽게' }, { id: 'harsh', label: '강하게' },
  { id: 'flood', label: '투광' }, { id: 'contrasting', label: '대비' }, { id: 'morning', label: '아침' }, { id: 'sunrise', label: '일출' },
  { id: 'sunset', label: '일몰' }, { id: 'chilly', label: '차가움' }, { id: 'freezing', label: '얼음' }, { id: 'flat', label: '평면' }, { id: 'twoPt', label: '2점' },
];

export const LIGHT_DIRS: { id: string; label: string }[] = [
  { id: 'tl', label: '왼쪽 위' }, { id: 't', label: '위' }, { id: 'tr', label: '오른쪽 위' }, { id: 'l', label: '왼쪽' },
  { id: 'r', label: '오른쪽' }, { id: 'bl', label: '왼쪽 아래' }, { id: 'b', label: '아래' }, { id: 'br', label: '오른쪽 아래' },
];

/** The defaults PowerPoint shows (and DeckCraft's Shape3d::default): warm matte, three-point light from the top, 6 pt bevels. */
export const BEVEL_DEFAULT_PT = 6;
export const MAX_3D_PT = 1584;

/** Points (the file's unit) and canvas pixels (2 per point). */
export const ptToPx = (pt: number) => pt * 2;

const clampPt = (v: number | undefined, lo = 0) => (v == null || !Number.isFinite(v) ? 0 : Math.max(lo, Math.min(MAX_3D_PT, v)));

/** A change to the 3-D format: unset fields stay; an empty result (nothing left) clears it. */
export function patch3d(cur: Format3d | undefined, patch: Partial<Format3d>): Format3d | undefined {
  const next: Record<string, unknown> = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || (next[k] === 0 && (k === 'depth' || k === 'contour'))) delete next[k];
  return Object.keys(next).length ? (next as Format3d) : undefined;
}

/** Whether the object has any 3-D format at all (a bevel, depth, contour, a non-default material or light, or a tilt). */
export function has3d(el: SlideElement): boolean {
  const f = el.format3d;
  return !!(el.bevel || el.rotate3d || el.camera3d || (f && (f.depth || f.contour || f.material || f.lighting || f.bevelBottom)));
}

/** `#rrggbb` shifted toward black (negative) or white (positive) by `amt` (−1…1). */
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const n = parseInt(m?.[1] ?? '808080', 16);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}

export interface Extrusion {
  /** Colour of the sides and the contour ring (px). */
  color: string;
  contour: number;
  contourColor: string;
  /** z positions (px, negative = behind the face) of the copies that make the extruded side. */
  zs: number[];
  /** Stroke width that keeps neighbouring copies from showing gaps when tilted. */
  gap: number;
}

/** Most copies the extrusion is built from (each is a whole shape, so this keeps big depths cheap). */
const MAX_LAYERS = 36;

/** What to draw behind the face for depth and contour, or null for neither. */
export function extrusionOf(el: SlideElement): Extrusion | null {
  const f = el.format3d;
  if (!f) return null;
  const depth = ptToPx(clampPt(f.depth)), contour = ptToPx(clampPt(f.contour));
  if (!depth && !contour) return null;
  const base = el.fill && el.fill.startsWith('#') ? el.fill : el.gradient?.[0] ?? '#808080';
  const n = depth ? Math.min(MAX_LAYERS, Math.max(2, Math.ceil(depth / 3))) : 0;
  const step = n ? depth / n : 0;
  return {
    // "Automatic" in PowerPoint is the shape's own colour; a little darker reads as a side.
    color: f.depthColor ?? shade(base, -0.3),
    contour, contourColor: f.contourColor ?? shade(base, -0.5),
    zs: Array.from({ length: n }, (_, i) => -(i + 1) * step),
    gap: Math.max(1, step * 1.4),
  };
}

/** The top bevel's size in canvas px (PowerPoint's default 6 pt when none is set). */
export function bevelSizePx(el: SlideElement): { w: number; h: number } {
  const f = el.format3d;
  return { w: ptToPx(f?.bevelW ?? BEVEL_DEFAULT_PT), h: ptToPx(f?.bevelH ?? BEVEL_DEFAULT_PT) };
}

export interface FaceShading {
  /** Gradient axis in 0–1 box units, from the lit side to the far side. */
  x1: number; y1: number; x2: number; y2: number;
  radial?: boolean;
  stops: { offset: number; color: string; opacity: number }[];
}

const DIR: Record<string, [number, number]> = { tl: [-1, -1], t: [0, -1], tr: [1, -1], l: [-1, 0], r: [1, 0], bl: [-1, 1], b: [0, 1], br: [1, 1] };
/** Light strength (highlight, shadow) and an optional tint of each rig. */
const RIGS: Record<string, { hi: number; lo: number; tint?: string }> = {
  threePt: { hi: 0.18, lo: 0.18 }, balanced: { hi: 0.12, lo: 0.12 }, soft: { hi: 0.1, lo: 0.14 }, harsh: { hi: 0.34, lo: 0.4 },
  flood: { hi: 0.3, lo: 0.06 }, contrasting: { hi: 0.3, lo: 0.36 }, morning: { hi: 0.2, lo: 0.14, tint: '#ffd9a0' }, sunrise: { hi: 0.22, lo: 0.16, tint: '#ffb27a' },
  sunset: { hi: 0.2, lo: 0.24, tint: '#ff8a5c' }, chilly: { hi: 0.18, lo: 0.16, tint: '#bcd8ff' }, freezing: { hi: 0.22, lo: 0.2, tint: '#9ec9ff' },
  flat: { hi: 0, lo: 0 }, twoPt: { hi: 0.2, lo: 0.2 },
};

/**
 * Lighting and material as a gradient laid over the face (null for the flat default look): the rig
 * sets how much the lit side brightens and the far side darkens, its direction where the light comes
 * from; plastic adds a spot highlight, metal bands of sheen, powder / softmetal a soft wash.
 */
export function faceShading(el: SlideElement): FaceShading | null {
  const f = el.format3d;
  if (!f || (!f.lighting && !f.material && !f.lightDir)) return null;
  const rig = RIGS[f.lighting ?? 'threePt'] ?? RIGS.threePt;
  const [dx, dy] = DIR[f.lightDir ?? 't'] ?? DIR.t;
  const mat = f.material ?? 'warmMatte';
  const x1 = 0.5 + dx * 0.5, y1 = 0.5 + dy * 0.5, x2 = 0.5 - dx * 0.5, y2 = 0.5 - dy * 0.5;
  const hiColor = rig.tint ?? '#ffffff';
  if (mat === 'plastic' || mat === 'clear') {
    const s = mat === 'clear' ? 0.5 : 1;
    return { x1: 0.5 + dx * 0.25, y1: 0.5 + dy * 0.25, x2: 0.5, y2: 0.5, radial: true, stops: [{ offset: 0, color: '#ffffff', opacity: Math.min(0.7, (0.25 + rig.hi) * s) }, { offset: 1, color: '#000000', opacity: rig.lo * 0.8 }] };
  }
  if (mat === 'metal' || mat === 'softmetal') {
    const k = mat === 'metal' ? 1 : 0.5;
    return { x1, y1, x2, y2, stops: [
      { offset: 0, color: '#ffffff', opacity: (0.35 + rig.hi) * k }, { offset: 0.35, color: '#000000', opacity: (0.18 + rig.lo) * k },
      { offset: 0.6, color: '#ffffff', opacity: (0.25 + rig.hi) * k }, { offset: 1, color: '#000000', opacity: (0.3 + rig.lo) * k },
    ] };
  }
  if (!rig.hi && !rig.lo) return null;
  const scale = mat === 'flat' || mat === 'legacyWireframe' ? 0 : mat === 'matte' ? 0.8 : mat === 'powder' || mat === 'translucentPowder' ? 0.5 : mat === 'dkEdge' || mat === 'softEdge' ? 1.1 : 1;
  if (!scale) return null;
  return { x1, y1, x2, y2, stops: [{ offset: 0, color: hiColor, opacity: rig.hi * scale }, { offset: 1, color: '#000000', opacity: rig.lo * scale }] };
}

// ── .pptx: a:scene3d / a:sp3d (DeckCraft Shape3d::to_xml) ───────────────────────────────────────

const EMU = 12700;
const ANGLE = 60000;
const emu = (pt: number) => Math.round(pt * EMU);
const ang = (d: number) => Math.round(((d % 360) + 360) % 360 * ANGLE) % 21_600_000;
const clr = (hex: string | undefined) => (hex && /^#?[0-9a-f]{6}$/i.test(hex) ? hex.replace('#', '').toUpperCase() : undefined);

/** The shape's `a:scene3d` + `a:sp3d`, or null when it is flat (as DeckCraft writes them). */
export function scene3dXml(el: SlideElement): string | null {
  const f = el.format3d ?? {};
  const r = el.rotate3d;
  const tilted = !!(r && (r.x || r.y || r.z));
  const camera = el.camera3d ?? (r?.persp ? 'perspectiveFront' : 'orthographicFront');
  const depth = clampPt(f.depth), contour = clampPt(f.contour);
  const top = el.bevel ? { prst: el.bevelKind ?? 'circle', w: f.bevelW ?? BEVEL_DEFAULT_PT, h: f.bevelH ?? BEVEL_DEFAULT_PT } : null;
  const bottom = f.bevelBottom ? { prst: f.bevelBottom, w: f.bevelBottomW ?? BEVEL_DEFAULT_PT, h: f.bevelBottomH ?? BEVEL_DEFAULT_PT } : null;
  const material = f.material ?? 'warmMatte';
  const lit = f.lighting ?? 'threePt', dir = f.lightDir ?? 't';
  if (camera === 'orthographicFront' && !tilted && !top && !bottom && !depth && !contour && material === 'warmMatte' && lit === 'threePt' && dir === 't') return null;
  // A preset camera brings its own angles; only a hand-set tilt is written as a:rot (lat = Y, lon = X, rev = Z, as DeckCraft).
  const rot = tilted && !el.camera3d ? `<a:rot lat="${ang(r!.y)}" lon="${ang(r!.x)}" rev="${ang(r!.z ?? 0)}"/>` : '';
  let x = `<a:scene3d><a:camera prst="${camera}"${rot ? `>${rot}</a:camera>` : '/>'}<a:lightRig rig="${lit}" dir="${dir}"/></a:scene3d><a:sp3d`;
  if (depth > 0) x += ` extrusionH="${emu(depth)}"`;
  if (contour > 0) x += ` contourW="${emu(contour)}"`;
  if (material !== 'warmMatte') x += ` prstMaterial="${material}"`;
  x += '>';
  for (const [tag, b] of [['bevelT', top], ['bevelB', bottom]] as const) if (b) x += `<a:${tag} w="${emu(b.w)}" h="${emu(b.h)}" prst="${b.prst}"/>`;
  const dc = clr(f.depthColor), cc = clr(f.contourColor);
  if (dc) x += `<a:extrusionClr><a:srgbClr val="${dc}"/></a:extrusionClr>`;
  if (cc) x += `<a:contourClr><a:srgbClr val="${cc}"/></a:contourClr>`;
  return `${x}</a:sp3d>`;
}
