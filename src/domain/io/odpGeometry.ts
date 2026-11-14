// OpenDocument (.odp) helpers that need no XML: units, colours, draw:transform matrices, gradients and slide transitions.
import type { GradientStop, Transition } from '../types';

// ── Units & colours ─────────────────────────────────────────────────────────────────────────────
/** Length in an ODF unit → centimetres (undefined when it is not a length). */
export function lengthToCm(v: string | undefined): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?\s*$/i.exec(v ?? '');
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch ((m[2] ?? 'cm').toLowerCase()) {
    case 'mm': return n / 10;
    case 'in': return n * 2.54;
    case 'pt': return (n * 2.54) / 72;
    case 'pc': return (n * 2.54) / 6;
    case 'px': return (n * 2.54) / 96;
    default: return n;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Any CSS colour LightCast stores → #rrggbb, or undefined when transparent / unknown. */
export function hexColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const h = /^#([0-9a-f]{3})$/i.exec(c);
  if (h) return `#${[...h[1]].map((x) => x + x).join('')}`.toLowerCase();
  if (HEX.test(c)) return c.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : Number(rgb[4]);
    if (a === 0) return undefined;
    return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
  }
  if (c === 'white') return '#ffffff';
  if (c === 'black') return '#000000';
  return undefined;
}

/** An ODF angle ("30deg", "30°", "0.5rad", "40grad", or a bare number of degrees) → degrees. */
export function parseAngle(v: string | undefined): number {
  const m = /^\s*(-?[\d.]+)\s*(deg|°|rad|grad)?\s*$/i.exec(v ?? '');
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const u = (m[2] ?? 'deg').toLowerCase();
  return u === 'rad' ? (n * 180) / Math.PI : u === 'grad' ? n * 0.9 : n;
}

// ── draw:transform ──────────────────────────────────────────────────────────────────────────────
/** SVG-style affine matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. Lengths are centimetres. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m` after `n` (n is applied to a point first). */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * A draw:transform / svg:transform list. ODF angles are radians turning counter-clockwise, and the list is
 * applied in the order written (as LibreOffice writes "rotate (a) translate (x y)": the shape turns about its own
 * corner, then moves). Lengths without a unit are centimetres.
 */
export function parseTransform(s: string | undefined): Mat {
  let m: Mat = IDENTITY;
  for (const op of (s ?? '').matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const args = op[2].trim().split(/[\s,]+/).filter(Boolean);
    const len = (i: number) => lengthToCm(args[i]) ?? 0;
    const num = (i: number) => (Number.isFinite(Number(args[i])) ? Number(args[i]) : 0);
    let t: Mat | null = null;
    switch (op[1].toLowerCase()) {
      case 'translate': t = [1, 0, 0, 1, len(0), len(1)]; break;
      case 'scale': t = [num(0), 0, 0, args.length > 1 ? num(1) : num(0), 0, 0]; break;
      case 'rotate': { const a = num(0); t = [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a), 0, 0]; break; }
      case 'skewx': t = [1, 0, Math.tan(-num(0)), 1, 0, 0]; break;
      case 'skewy': t = [1, Math.tan(-num(0)), 0, 1, 0, 0]; break;
      case 'matrix': t = [num(0), num(1), num(2), num(3), len(4), len(5)]; break;
    }
    if (t) m = mul(t, m);
  }
  return m;
}

export const isIdentity = (m: Mat): boolean => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
export const applyPoint = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A box (cm) through a matrix: its centre, scaled size and clockwise rotation in degrees (0–360). */
export function transformBox(m: Mat, b: { x: number; y: number; w: number; h: number }): { cx: number; cy: number; w: number; h: number; rotation: number } {
  const [cx, cy] = applyPoint(m, b.x + b.w / 2, b.y + b.h / 2);
  let rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  rot = Math.round(((rot % 360) + 360) % 360 * 100) / 100;
  if (rot >= 359.995 || rot < 0.005) rot = 0;
  return { cx, cy, w: b.w * Math.hypot(m[0], m[1]), h: b.h * Math.hypot(m[2], m[3]), rotation: rot };
}

/** The draw:transform of a box of `wc × hc` cm centred on (cx, cy) and turned `rotation`° clockwise. */
export function rotationTransform(cx: number, cy: number, wc: number, hc: number, rotation: number): string {
  const th = (rotation * Math.PI) / 180;
  const tx = cx - (Math.cos(th) * wc / 2 - Math.sin(th) * hc / 2);
  const ty = cy - (Math.sin(th) * wc / 2 + Math.cos(th) * hc / 2);
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return `rotate (${r(-th)}) translate (${r(tx)}cm ${r(ty)}cm)`;
}

// ── Gradients ───────────────────────────────────────────────────────────────────────────────────
/** A draw:gradient as read from a file. `angle` is ODF's: degrees counter-clockwise, 0 = start colour on top. */
export interface OdfGradient { style: string; start: string; end: string; angle: number; stops?: GradientStop[] }
export interface LcGradient { fill: string; gradient: [string, string]; gradientAngle: number; gradientType?: 'radial'; gradientStops?: GradientStop[] }

const mod360 = (n: number) => ((Math.round(n * 100) / 100 % 360) + 360) % 360;

/** An ODF gradient as LightCast's gradient fields (0° = left to right, 90° = top to bottom; radial: first colour in the middle). */
export function gradientToLc(g: OdfGradient): LcGradient {
  const angle = mod360(90 - g.angle);
  const stops = g.stops && g.stops.length >= 2 ? [...g.stops].sort((a, b) => a.pos - b.pos) : undefined;
  if (g.style === 'radial' || g.style === 'ellipsoid' || g.style === 'square' || g.style === 'rectangular') {
    // ODF runs a radial gradient from the outer (start) colour to the centre (end); LightCast's first colour is the centre.
    const rs = stops && stops.length > 2 ? stops.map((s) => ({ ...s, pos: Math.round((100 - s.pos) * 10) / 10 })).reverse() : undefined;
    return { fill: g.end, gradient: [g.end, g.start], gradientAngle: angle, gradientType: 'radial', ...(rs ? { gradientStops: rs } : {}) };
  }
  if (g.style === 'axial') {
    return { fill: g.start, gradient: [g.start, g.start], gradientAngle: angle, gradientStops: [{ pos: 0, color: g.start }, { pos: 50, color: g.end }, { pos: 100, color: g.start }] };
  }
  const first = stops?.[0].color ?? g.start, last = stops?.[stops.length - 1].color ?? g.end;
  return { fill: first, gradient: [first, last], gradientAngle: angle, ...(stops && stops.length > 2 ? { gradientStops: stops } : {}) };
}

/** LightCast's gradient fields as an ODF gradient, with every stop of a multi-stop one (null when there is no usable gradient). */
export function lcToGradient(el: { gradient?: [string, string]; gradientStops?: GradientStop[]; gradientAngle?: number; gradientType?: 'linear' | 'radial' }): OdfGradient | null {
  let ok: GradientStop[] | undefined;
  if (el.gradientStops && el.gradientStops.length > 2) {
    const list = [...el.gradientStops].sort((x, y) => x.pos - y.pos).map((s) => ({ pos: Math.max(0, Math.min(100, Math.round(s.pos * 10) / 10)), color: hexColor(s.color) }));
    if (list.every((s) => s.color)) ok = list as GradientStop[];
  }
  const colors = ok ? [ok[0].color, ok[ok.length - 1].color] : el.gradient ?? (el.gradientStops && el.gradientStops.length >= 2 ? [el.gradientStops[0].color, el.gradientStops[el.gradientStops.length - 1].color] : null);
  const a = hexColor(colors?.[0]), b = hexColor(colors?.[1]);
  if (!a || !b) return null;
  if (el.gradientType === 'radial') {
    const rs = ok ? ok.map((s) => ({ ...s, pos: Math.round((100 - s.pos) * 10) / 10 })).reverse() : undefined;
    return { style: 'radial', start: b, end: a, angle: 0, ...(rs ? { stops: rs } : {}) };
  }
  return { style: 'linear', start: a, end: b, angle: mod360(90 - (el.gradientAngle ?? 0)), ...(ok ? { stops: ok } : {}) };
}

/** A gradient as a CSS background image with all its stops (PowerPoint's angle 0 points right, turning clockwise). */
export function stopsCss(g: { type: 'linear' | 'radial'; angle: number; stops: GradientStop[] }): string {
  const list = g.stops.map((s) => `${s.color} ${Math.round(s.pos * 10) / 10}%`).join(', ');
  const deg = (((Math.round(g.angle) % 360) + 360) % 360 + 90) % 360;
  return g.type === 'radial' ? `radial-gradient(circle at 50% 50%, ${list})` : `linear-gradient(${deg}deg, ${list})`;
}

/** A CSS gradient of any number of #rrggbb stops (as {@link stopsCss} writes it) back into its fields; null for any other CSS. */
export function parseStopsCss(css: string): { type: 'linear' | 'radial'; angle: number; stops: GradientStop[] } | null {
  const m = /^(linear|radial)-gradient\(\s*(?:(\d+(?:\.\d+)?)deg|circle at 50% 50%)\s*,\s*([^()]*)\)$/i.exec(css.trim());
  if (!m) return null;
  const raw = m[3].split(',').map((x) => /^\s*(#[0-9a-f]{6})(?:\s+(\d+(?:\.\d+)?)%)?\s*$/i.exec(x));
  if (raw.length < 2 || raw.some((x) => !x)) return null;
  const stops = raw.map((x, i) => ({ color: x![1].toLowerCase(), pos: x![2] !== undefined ? Number(x![2]) : Math.round((i / (raw.length - 1)) * 1000) / 10 }));
  return { type: m[1].toLowerCase() === 'radial' ? 'radial' : 'linear', angle: m[2] !== undefined ? (Number(m[2]) + 270) % 360 : 0, stops };
}

// ── Transitions & timing ────────────────────────────────────────────────────────────────────────
const SPEED_MS = { fast: 500, medium: 1000, slow: 1500 } as const;

/** "PT00H00M05S" / "PT5S" → seconds (undefined when it is not a duration). */
export function parseDuration(v: string | undefined): number | undefined {
  const m = /^P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec((v ?? '').trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `PT${String(Math.floor(s / 3600)).padStart(2, '0')}H${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}M${String(s % 60).padStart(2, '0')}S`;
}

const SMIL_TO_KIND: Record<string, string> = {
  fade: 'fade', pushWipe: 'fx:push', slideWipe: 'fx:cover', barWipe: 'fx:wipe', irisWipe: 'fx:shape', ellipseWipe: 'fx:shape', fourBoxWipe: 'fx:shape',
  barnDoorWipe: 'fx:split', blindsWipe: 'fx:blinds', checkerBoardWipe: 'fx:checker', clockWipe: 'fx:clock', pinWheelWipe: 'fx:clock',
  dissolve: 'fx:dissolve', randomBarWipe: 'fx:randomBar', spiralWipe: 'fx:vortex', snakeWipe: 'fx:vortex',
};
const STYLE_TO_KIND: [RegExp, string][] = [
  [/^none$/, 'cut'], [/^dissolve$/, 'fx:dissolve'], [/^random$/, 'fx:random'], [/^(fade-through-black|fade-from-center|fade-to-center)$/, 'fade'],
  [/^fade-/, 'fx:wipe'], [/^(move-from|stretch-from)-/, 'fx:cover'], [/^(roll-from|push)/, 'fx:push'], [/^uncover-/, 'fx:uncover'],
  [/^(open|close)-/, 'fx:split'], [/stripes$/, 'fx:blinds'], [/checkerboard$/, 'fx:checker'], [/-lines$/, 'fx:randomBar'],
  [/^(clockwise|counterclockwise)/, 'fx:clock'], [/^spiral-/, 'fx:vortex'],
];
/** kind → [ODF transition-style, smil:type, smil:subtype]. */
const KIND_TO_ODF: Record<string, [string, string?, string?]> = {
  fade: ['fade-through-black', 'fade', 'crossfade'], 'fx:wipe': ['fade-from-left', 'barWipe', 'leftToRight'], 'fx:cover': ['move-from-left', 'slideWipe', 'fromLeft'],
  'fx:push': ['roll-from-left', 'pushWipe', 'fromLeft'], 'fx:uncover': ['uncover-to-left'], 'fx:split': ['open-vertical', 'barnDoorWipe', 'vertical'],
  'fx:blinds': ['vertical-stripes', 'blindsWipe', 'vertical'], 'fx:checker': ['horizontal-checkerboard', 'checkerBoardWipe', 'across'],
  'fx:clock': ['clockwise', 'clockWipe', 'clockwiseTwelve'], 'fx:dissolve': ['dissolve', 'dissolve'], 'fx:random': ['random'],
  'fx:randomBar': ['horizontal-lines', 'randomBarWipe', 'horizontal'], 'fx:shape': ['fade-from-center', 'irisWipe', 'rectangle'], 'fx:vortex': ['spiral-in-left', 'spiralWipe', 'topLeftClockwise'],
};

export interface PageTiming { transition?: Transition; autoAdvance?: number }
/** A page's transition and automatic advance from its style properties (presentation:*, smil:*) and any anim:transitionFilter. */
export function readTransition(p: Record<string, string>): PageTiming {
  const type = p['presentation:transition-type'];
  const smil = p['smil:type'];
  const style = p['presentation:transition-style'];
  let kind = smil && SMIL_TO_KIND[smil] ? SMIL_TO_KIND[smil] : undefined;
  if (!kind && style) kind = STYLE_TO_KIND.find(([re]) => re.test(style))?.[1] ?? 'fade';
  const speed = p['presentation:transition-speed'] as keyof typeof SPEED_MS | undefined;
  const dur = lengthDuration(p['smil:dur']) ?? (speed && SPEED_MS[speed]) ?? 1000;
  const out: PageTiming = {};
  if (kind && kind !== 'cut') out.transition = { kind: kind as Transition['kind'], duration: dur };
  const seconds = parseDuration(p['presentation:duration']);
  if (seconds && (type === 'automatic' || type === 'semi-automatic')) {
    out.autoAdvance = seconds;
    if (type === 'automatic' && p['lc:advance-on-click'] !== 'true') out.transition = { ...(out.transition ?? { kind: 'cut', duration: 1 }), advanceOnClick: false };
  }
  return out;
}

/** "2s" / "500ms" → milliseconds. */
function lengthDuration(v: string | undefined): number | undefined {
  const m = /^\s*([\d.]+)\s*(ms|s)\s*$/i.exec(v ?? '');
  return m ? Math.round(Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1)) : undefined;
}

/** The drawing-page-properties attributes (a leading space each) for a slide's transition and automatic advance. */
export function transitionAttrs(t: Transition | undefined, autoAdvance: number | undefined): string {
  const a: string[] = [];
  const odf = t && t.kind !== 'cut' ? KIND_TO_ODF[t.kind] ?? KIND_TO_ODF.fade : undefined;
  if (odf) {
    a.push(`presentation:transition-style="${odf[0]}"`);
    if (odf[1]) a.push(`smil:type="${odf[1]}"`);
    if (odf[2]) a.push(`smil:subtype="${odf[2]}"`);
    a.push(`presentation:transition-speed="${t!.duration <= 600 ? 'fast' : t!.duration <= 1200 ? 'medium' : 'slow'}"`);
  }
  if (autoAdvance && autoAdvance > 0) {
    a.push('presentation:transition-type="automatic"', ...(t?.advanceOnClick === false ? [] : ['lc:advance-on-click="true"']), `presentation:duration="${formatDuration(autoAdvance)}"`);
  } else a.push('presentation:transition-type="manual"');
  return a.length ? ` ${a.join(' ')}` : '';
}

// ── Gradient transparency ───────────────────────────────────────────────────────────────────────
const lcStops = (g: LcGradient): GradientStop[] => g.gradientStops && g.gradientStops.length >= 2 ? g.gradientStops : [{ pos: 0, color: g.gradient[0] }, { pos: 100, color: g.gradient[1] }];
const stopOpacity = (list: GradientStop[], pos: number): number => {
  const v = (c: string) => parseInt(c.slice(1, 3), 16) / 255;
  if (pos <= list[0].pos) return v(list[0].color);
  for (let i = 1; i < list.length; i++) {
    if (pos <= list[i].pos) {
      const a = list[i - 1], b = list[i], t = b.pos === a.pos ? 1 : (pos - a.pos) / (b.pos - a.pos);
      return v(a.color) + (v(b.color) - v(a.color)) * t;
    }
  }
  return v(list[list.length - 1].color);
};

/**
 * A gradient with the per-stop transparency of an ODF opacity gradient (`opacity` is {@link gradientToLc} of a
 * draw:opacity whose colours are greys of the opacity). Stops are placed at the union of both gradients' stops.
 */
export function withOpacity(lc: LcGradient, opacity: LcGradient): LcGradient {
  const colors = lcStops(lc), ops = lcStops(opacity).slice().sort((a, b) => a.pos - b.pos);
  const colorAt = (pos: number): string => {
    const list = colors.slice().sort((a, b) => a.pos - b.pos);
    const ch = (c: string, k: number) => parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16);
    let a = list[0], b = list[list.length - 1];
    for (let i = 1; i < list.length; i++) if (pos <= list[i].pos) { a = list[i - 1]; b = list[i]; break; }
    const t = pos <= a.pos || b.pos === a.pos ? 0 : pos >= b.pos ? 1 : (pos - a.pos) / (b.pos - a.pos);
    return `#${[0, 1, 2].map((k) => Math.round(ch(a.color, k) + (ch(b.color, k) - ch(a.color, k)) * t).toString(16).padStart(2, '0')).join('')}`;
  };
  const positions = [...new Set([...colors.map((s) => s.pos), ...ops.map((s) => s.pos)])].sort((a, b) => a - b);
  const stops = positions.map((pos) => {
    const t = Math.round((1 - stopOpacity(ops, pos)) * 100) / 100;
    return { pos, color: colors.find((s) => s.pos === pos)?.color ?? colorAt(pos), ...(t > 0 ? { transparency: t } : {}) };
  });
  if (!stops.some((s) => s.transparency)) return lc;
  return { ...lc, gradient: [stops[0].color, stops[stops.length - 1].color], gradientStops: stops };
}

/** The per-stop transparency of a gradient as an ODF opacity gradient (null when no stop is transparent). */
export function opacityGradient(el: { gradient?: [string, string]; gradientStops?: GradientStop[]; gradientAngle?: number; gradientType?: 'linear' | 'radial' }, base: OdfGradient): OdfGradient | null {
  const stops = el.gradientStops;
  if (!stops || !stops.some((s) => s.transparency)) return null;
  const grey = (t: number | undefined) => `#${Math.round((1 - (t ?? 0)) * 255).toString(16).padStart(2, '0').repeat(3)}`;
  const list = [...stops].sort((a, b) => a.pos - b.pos).map((s) => ({ pos: s.pos, color: grey(s.transparency) }));
  const first = list[0].color, last = list[list.length - 1].color;
  if (base.style === 'radial') {
    const rs = list.map((s) => ({ ...s, pos: Math.round((100 - s.pos) * 10) / 10 })).reverse();
    return { style: 'radial', start: last, end: first, angle: 0, stops: rs };
  }
  return { style: 'linear', start: first, end: last, angle: base.angle, stops: list };
}
