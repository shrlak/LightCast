// Design › Designer (디자인 아이디어): several laid-out variants of the current slide — the picture
// full-bleed with the title on a band, the picture on one half, a framed picture, text-only
// arrangements. Ported from DeckCraft's ideas.rs: an idea moves and resizes the slide's own
// objects (and crops the picture to its new box); it changes only that slide.
//
// What counts as the slide's content: its text boxes, its picture, and — because most LightCast
// slides keep their words in the slide's own title / text rather than in boxes — that own text, which
// an idea turns into text boxes so it can be placed.
import type { Slide, SlideElement, Theme } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { uid } from './lyrics';

export type IdeaId = 'fullBleed' | 'pictureLeft' | 'pictureRight' | 'framed' | 'titleColumn' | 'centred' | 'titleBottom';
export interface Idea { id: IdeaId; label: string }

const PICTURE_IDEAS: Idea[] = [
  { id: 'fullBleed', label: '그림을 가득 채우고 제목은 띠 위에' },
  { id: 'pictureLeft', label: '그림은 왼쪽, 글은 오른쪽' },
  { id: 'pictureRight', label: '그림은 오른쪽, 글은 왼쪽' },
  { id: 'framed', label: '제목 옆에 액자 그림' },
];
const TEXT_IDEAS: Idea[] = [
  { id: 'titleColumn', label: '제목은 옆 단, 글은 오른쪽' },
  { id: 'centred', label: '가운데 제목, 아래에 글' },
  { id: 'titleBottom', label: '글이 위, 제목은 아래' },
];
export const IDEA_LABEL: Record<IdeaId, string> = Object.fromEntries([...PICTURE_IDEAS, ...TEXT_IDEAS].map((i) => [i.id, i.label])) as Record<IdeaId, string>;

/** The title band of Full-bleed: a shape behind the title, removed again by every other idea. */
export const BAND_PREFIX = 'idea-band';
const BAND_DARK = 'rgba(0,0,0,0.6)';
const BAND_LIGHT = 'rgba(255,255,255,0.86)';
const isBand = (e: SlideElement) => e.id.startsWith(BAND_PREFIX);

/** A slide an idea must leave alone: lyrics laid out their own way, templates, imported pages. */
const locked = (s: Slide) => !!(s.lyricBody || s.preserveTextLayout || s.importSource);

const blank = (t?: string) => !t || !t.trim();
const isTitle = (e: SlideElement) => e.kind === 'text' && e.placeholder === 'title';
const isPicture = (e: SlideElement) => e.kind === 'image' || e.placeholder === 'picture';
/** Pictures, text boxes and (empty or text-less) placeholders are moved; any other graphic is laid out by its own geometry. */
const arrangeable = (e: SlideElement) => isPicture(e) || e.kind === 'text';

/** The objects an idea works with: not the master's copies, not the previous idea's band, not hidden ones. */
const live = (e: SlideElement) => !e.master && !e.hidden && !isBand(e);

interface Roles { title?: number; picture?: number; text: number[] }

/** Roles of the slide's own objects, by index. The largest picture leads; empty text boxes are left where they are. */
function roles(els: SlideElement[]): Roles {
  const r: Roles = { text: [] };
  els.forEach((e, i) => {
    if (!live(e)) return;
    if (isTitle(e) && !blank(e.text) && r.title === undefined) r.title = i;
    else if (isPicture(e)) {
      const area = (j: number) => els[j].w * els[j].h;
      if (r.picture === undefined || area(i) > area(r.picture)) r.picture = i;
    } else if (e.kind === 'text' && !blank(e.text)) r.text.push(i);
  });
  return r;
}

/** The slide's own title / text as text boxes (so they can be placed), and the slide without them. */
export function liftOwnText(slide: Slide, theme?: Pick<Theme, 'fontFamily' | 'fontSize' | 'fontWeight' | 'color' | 'align' | 'lineHeight' | 'shadow' | 'subScale' | 'subColor'>): { slide: Slide; lifted: SlideElement[] } {
  const t = { fontFamily: undefined as string | undefined, fontSize: 64, fontWeight: 600, color: '#ffffff', align: 'center' as const, lineHeight: 1.25, shadow: false, subScale: 0.62, subColor: undefined as string | undefined, ...theme, ...slide.style };
  const base = (text: string, over: Partial<SlideElement>): SlideElement => ({
    id: uid('el'), kind: 'text', x: 0, y: 0, w: CANVAS_W, h: 200, text, fontFamily: t.fontFamily, color: t.color, align: t.align, vAlign: 'middle',
    lineHeight: t.lineHeight, shadow: t.shadow || undefined, autoFit: false, ...over,
  });
  const lifted: SlideElement[] = [];
  const els = slide.elements ?? [];
  const hasTitleBox = els.some((e) => live(e) && isTitle(e) && !blank(e.text));
  if (!blank(slide.title) && !hasTitleBox) lifted.push(base(slide.title!, { placeholder: 'title', fontSize: Math.round(t.fontSize * 0.9), bold: true, name: '제목' }));
  if (!blank(slide.text)) lifted.push(base(slide.text, { fontSize: t.fontSize, bold: t.fontWeight >= 700 || undefined, name: '내용' }));
  if (!blank(slide.subtext)) lifted.push(base(slide.subtext!, { fontSize: Math.round(t.fontSize * t.subScale), color: t.subColor ?? t.color, name: '보조 글' }));
  return { slide: lifted.length ? { ...slide, title: undefined, text: '', subtext: undefined } : slide, lifted };
}

/** The ideas for a slide: none when it has nothing to arrange, or other content in the way. */
export function ideasFor(slide: Slide | null | undefined): Idea[] {
  if (!slide || locked(slide)) return [];
  const own = slide.elements ?? [];
  if (own.some((e) => live(e) && !arrangeable(e))) return [];
  // The ideas move one picture; a second would stay put, over the rearranged text.
  if (own.filter((e) => live(e) && isPicture(e)).length > 1) return [];
  const probe: SlideElement[] = [...own, ...liftOwnText(slide).lifted];
  const r = roles(probe);
  if (r.picture !== undefined) return PICTURE_IDEAS;
  if (r.title !== undefined && r.text.length) return TEXT_IDEAS;
  return [];
}

/** Crop (fractions cut from left, top, right, bottom) that fills a box of aspect `dst` from a picture of aspect `src`, centred. */
export function coverCrop(src: number, dst: number): [number, number, number, number] {
  if (!(Number.isFinite(src) && Number.isFinite(dst) && src > 0 && dst > 0)) return [0, 0, 0, 0];
  if (src > dst) { const cut = (1 - dst / src) / 2; return [cut, 0, cut, 0]; }
  const cut = (1 - src / dst) / 2;
  return [0, cut, 0, cut];
}

const cjk = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿＀-￯]/;
/** Rough height of `text` wrapped in `w` px at font size `fs` (Korean letters are a full em wide, Latin about 0.55). */
export function textHeight(text: string, fs: number, w: number, lineHeight = 1.25): number {
  const per = Math.max(1, w);
  let lines = 0;
  for (const para of text.split('\n')) {
    let width = 0;
    for (const ch of para) width += (cjk.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55) * fs;
    lines += Math.max(1, Math.ceil(width / per));
  }
  return lines * fs * lineHeight;
}

/** The font size at which `e`'s text fits its new box (never larger than it is now, never below 24). */
function fitFont(e: SlideElement, w: number, h: number): number {
  let fs = e.fontSize ?? 64;
  const text = e.text ?? '';
  while (fs > 24 && textHeight(text, fs, w, e.lineHeight ?? 1.25) > h) fs = Math.max(24, Math.floor(fs * 0.92));
  return fs;
}

interface Box { x: number; y: number; w: number; h: number }
export interface ApplyOptions {
  theme?: Parameters<typeof liftOwnText>[1];
  /** A picture's own width / height by media id; without it the aspect is taken from its current box and crop (as DeckCraft does). */
  aspects?: Record<string, number | undefined>;
}

/** The boxes of idea `id` for the given roles. */
function layout(id: IdeaId, r: Roles, sw: number, sh: number): { place: [number, Box][]; band: boolean } {
  const m = Math.min(sw, sh) * 0.06;
  const place: [number, Box][] = [];
  let band = false;
  // Text boxes stacked in a box.
  const stack = (b: Box) => {
    const n = Math.max(1, r.text.length), gap = m * 0.4;
    const h = Math.max(1, (b.h - gap * (n - 1)) / n);
    r.text.forEach((i, k) => place.push([i, { x: b.x, y: b.y + k * (h + gap), w: b.w, h }]));
  };
  switch (id) {
    case 'fullBleed':
      if (r.picture !== undefined) place.push([r.picture, { x: 0, y: 0, w: sw, h: sh }]);
      if (r.title !== undefined) { place.push([r.title, { x: m, y: sh * 0.68, w: sw - 2 * m, h: sh * 0.2 }]); band = true; }
      stack({ x: m, y: sh * 0.06, w: sw * 0.45, h: sh * 0.5 });
      break;
    case 'pictureLeft':
    case 'pictureRight': {
      const left = id === 'pictureLeft', half = sw * 0.5;
      const [px, tx] = left ? [0, half + m] : [half, m];
      if (r.picture !== undefined) place.push([r.picture, { x: px, y: 0, w: half, h: sh }]);
      const tw = half - 2 * m;
      if (r.title !== undefined) place.push([r.title, { x: tx, y: m, w: tw, h: sh * 0.24 }]);
      stack({ x: tx, y: m + sh * 0.28, w: tw, h: sh - 2 * m - sh * 0.28 });
      break;
    }
    case 'framed': {
      if (r.picture !== undefined) place.push([r.picture, { x: sw * 0.42, y: m * 1.5, w: sw * 0.58 - m * 1.5, h: sh - 3 * m }]);
      const tw = sw * 0.42 - 2 * m;
      if (r.title !== undefined) place.push([r.title, { x: m, y: m * 1.5, w: tw, h: sh * 0.3 }]);
      stack({ x: m, y: m * 1.5 + sh * 0.34, w: tw, h: sh - 3 * m - sh * 0.34 });
      break;
    }
    case 'titleColumn':
      if (r.title !== undefined) place.push([r.title, { x: m, y: m, w: sw * 0.32, h: sh - 2 * m }]);
      stack({ x: sw * 0.36, y: m, w: sw * 0.64 - m, h: sh - 2 * m });
      break;
    case 'centred':
      if (r.title !== undefined) place.push([r.title, { x: sw * 0.1, y: m, w: sw * 0.8, h: sh * 0.26 }]);
      stack({ x: sw * 0.18, y: m + sh * 0.3, w: sw * 0.64, h: sh - 2 * m - sh * 0.3 });
      break;
    case 'titleBottom':
      stack({ x: m, y: m, w: sw - 2 * m, h: sh * 0.62 });
      if (r.title !== undefined) place.push([r.title, { x: m, y: sh * 0.72, w: sw - 2 * m, h: sh * 0.2 }]);
      break;
  }
  return { place, band };
}

const lum = (hex: string | undefined) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** Apply idea `id` to a slide; null when the slide gets no such idea. Only this slide's objects change. */
export function applyIdea(slide: Slide, id: IdeaId, opts: ApplyOptions = {}): Slide | null {
  if (!ideasFor(slide).some((i) => i.id === id)) return null;
  const { slide: rest, lifted } = liftOwnText(slide, opts.theme);
  // The previous idea's band goes; the master's copies stay in front of nothing and behind everything.
  let els = [...(rest.elements ?? []).filter((e) => !isBand(e)), ...lifted];
  const r = roles(els);
  const { place, band } = layout(id, r, CANVAS_W, CANVAS_H);
  els = els.map((e, i) => {
    const hit = place.find(([k]) => k === i);
    if (!hit) return e;
    const [, b] = hit;
    const o: SlideElement = { ...e, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), rotation: undefined };
    if (isPicture(e)) {
      const c = e.crop ?? [0, 0, 0, 0];
      const fw = Math.max(0.01, 1 - c[0] - c[2]), fh = Math.max(0.01, 1 - c[1] - c[3]);
      const known = e.mediaId ? opts.aspects?.[e.mediaId] : undefined;
      const src = known && known > 0 ? known : (e.w / fw) / Math.max(1e-6, e.h / fh);
      const crop = coverCrop(src, o.w / Math.max(1e-6, o.h));
      o.crop = crop.some((v) => v > 1e-9) ? crop : undefined;
      o.fit = 'cover';
    } else if (e.kind === 'text') {
      o.fontSize = fitFont(e, o.w, o.h);
      if (e.paragraphs) o.paragraphs = e.paragraphs.map((p) => (p.fontSize ? { ...p, fontSize: Math.min(p.fontSize, o.fontSize!) } : p));
      // A column / row title reads from the top-left of its box on the text side, centred when it is the headline.
      if (id === 'titleColumn' && i === r.title) { o.align = 'left'; o.vAlign = 'top'; }
      if ((id === 'pictureLeft' || id === 'pictureRight' || id === 'framed') && i !== r.title) { o.align = 'left'; o.vAlign = 'top'; }
    }
    return o;
  });
  // The picture goes to the back (behind text, in front of the master's copies), so text over it stays readable.
  if (r.picture !== undefined) {
    const pic = els[r.picture];
    els = els.filter((_, i) => i !== r.picture);
    const at = els.findIndex((e) => !e.master);
    els.splice(at < 0 ? els.length : at, 0, pic);
  }
  if (band) {
    const t = els.find((e) => live(e) && isTitle(e) && !blank(e.text));
    if (t) {
      const b = els.indexOf(t);
      const light = lum(t.color) > 0.6;
      const shape: SlideElement = { id: uid(BAND_PREFIX), kind: 'shape', x: 0, y: t.y - Math.round(CANVAS_H * 0.02), w: CANVAS_W, h: t.h + Math.round(CANVAS_H * 0.04), fill: light ? BAND_DARK : BAND_LIGHT, name: '제목 띠' };
      els.splice(b, 0, shape);
    }
  }
  const out: Slide = { ...rest, elements: els };
  return out;
}

/** Whether the slide's objects sit inside the canvas (every idea keeps them there). */
export const insideCanvas = (els: SlideElement[]) => els.every((e) => e.x >= -0.5 && e.y >= -0.5 && e.x + e.w <= CANVAS_W + 0.5 && e.y + e.h <= CANVAS_H + 0.5 && e.w > 0 && e.h > 0);
