// Picture Format (그림 서식) rules ported from DeckCraft (crates/engine/src/cmd/{background,
// compress,recolor,picture_style,shape/picture}.rs, MIT OR Apache-2.0): Remove Background levels,
// the Color menu's saturation steps, Compress Pictures' sizing, Reset Picture, the 24 Picture
// Styles and where a click lands in a picture (Set Transparent Color).
import type { SlideElement } from './types';

/** Remove Background's menu: DeckCraft's three tolerances (how far a colour may drift from the edge's). */
export const REMOVE_BACKGROUND_LEVELS: [label: string, tolerance: number][] = [['배경 제거', 20], ['더 많이 제거', 35], ['덜 제거', 10]];

/** Color › Saturation, as multipliers (PowerPoint's 0 %–400 %); the engine takes multiplier − 1. */
export const SATURATION_STEPS = [0, 0.33, 0.66, 1, 1.33, 1.66, 2, 3, 4];

/** Transparency presets (DeckCraft's Picture Format › Transparency). */
export const TRANSPARENCY_STEPS = [0, 15, 30, 50, 65, 80, 95];

/** The Recolor preset's Korean name (PowerPoint's 다시 칠하기 gallery). */
export function recolorLabel(id: string): string {
  const fixed: Record<string, string> = { none: '다시 칠하기 없음', grayscale: '회색조', sepia: '세피아', washout: '희미하게', bw25: '흑백: 25%', bw50: '흑백: 50%', bw75: '흑백: 75%' };
  if (fixed[id]) return fixed[id];
  const m = /^(tx2|accent(\d))(Dark|Light)$/.exec(id);
  if (!m) return id;
  const colour = m[1] === 'tx2' ? '텍스트 색 2' : `강조 ${m[2]}`;
  return `${colour} ${m[3] === 'Dark' ? '어둡게' : '밝게'}`;
}

/**
 * Reset Picture (DeckCraft picture.reset): the original picture without corrections, colour,
 * artistic effect, crop, transparency, outline or effects. Size and position stay.
 */
export const RESET_PICTURE: Partial<SlideElement> = {
  picture: undefined, crop: undefined, opacity: undefined, pictureStyle: undefined, maskShape: undefined,
  stroke: undefined, strokeWidth: undefined, dash: undefined,
  dropShadow: undefined, shadowKind: undefined, glow: undefined, glowSize: undefined, reflection: undefined, softEdge: undefined, bevel: undefined, rotate3d: undefined,
};

/** Reset Picture & Size: also back to the picture's own proportions, at most the slide, centred on where it was. */
export function naturalSize(el: Pick<SlideElement, 'x' | 'y' | 'w' | 'h'>, imgW: number, imgH: number, maxW: number, maxH: number): { x: number; y: number; w: number; h: number } {
  if (!(imgW > 0 && imgH > 0)) return { x: el.x, y: el.y, w: el.w, h: el.h };
  // Pictures are placed at 96 dpi as PowerPoint does (one pixel is 0.75 pt, 1.5 canvas px), shrunk to fit the slide.
  let w = imgW * 1.5, h = imgH * 1.5;
  const k = Math.min(1, maxW / w, maxH / h);
  w = Math.round(w * k);
  h = Math.round(h * k);
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  return { x: Math.round(Math.min(Math.max(0, cx - w / 2), maxW - w)), y: Math.round(Math.min(Math.max(0, cy - h / 2), maxH - h)), w, h };
}

// ── Compress Pictures ───────────────────────────────────────────────────────────────────────

/** Compress Pictures › Resolution: ppi and PowerPoint's Korean labels. */
export const COMPRESS_RESOLUTIONS: [ppi: number, label: string][] = [
  [330, 'HD (330ppi): 고화질 디스플레이에 적합한 품질'],
  [220, '인쇄 (220ppi): 대부분의 프린터와 화면에서 뛰어난 품질'],
  [150, '웹 (150ppi): 웹 페이지와 프로젝터에 적합'],
  [96, '전자 메일 (96ppi): 공유할 문서 크기 최소화'],
];

/** Whether a crop cuts something away (negative values pad the picture and are kept). */
export function realCrop(c: readonly number[] | undefined): c is [number, number, number, number] {
  return !!c && c.length === 4 && c.every((v) => v >= 0 && v < 1) && c.some((v) => v > 0) && c[0] + c[2] < 1 && c[1] + c[3] < 1;
}

export interface CompressPlan {
  /** The part of the picture to keep, in its pixels (Delete cropped areas). */
  cut?: { x: number; y: number; w: number; h: number };
  /** The size to encode at. */
  w: number;
  h: number;
  /** The crop the picture needs afterwards. */
  crop: [number, number, number, number] | undefined;
}

/**
 * DeckCraft's `pack` sizing: the pixels a picture needs to be shown `boxW`×`boxH` canvas pixels
 * (2 per point) at `ppi`, after cutting away the cropped part when asked. Null when nothing would
 * change (already small enough and nothing to cut).
 */
export function compressPlan(imgW: number, imgH: number, crop: readonly number[] | undefined, boxW: number, boxH: number, ppi: number, deleteCropped: boolean): CompressPlan | null {
  if (!(imgW >= 1 && imgH >= 1) || !(ppi >= 36 && ppi <= 1200)) return null;
  const c = crop && crop.length === 4 ? (crop as [number, number, number, number]) : undefined;
  const cutting = deleteCropped && realCrop(c);
  let fx = c ? Math.max(0.01, 1 - c[0] - c[2]) : 1, fy = c ? Math.max(0.01, 1 - c[1] - c[3]) : 1;
  let w = imgW, h = imgH, cut: CompressPlan['cut'];
  let after: CompressPlan['crop'] = c && c.some((v) => v) ? c : undefined;
  if (cutting) {
    const x = Math.floor(c![0] * imgW), y = Math.floor(c![1] * imgH);
    w = Math.min(Math.max(1, Math.round(fx * imgW)), imgW - Math.min(x, imgW - 1));
    h = Math.min(Math.max(1, Math.round(fy * imgH)), imgH - Math.min(y, imgH - 1));
    cut = { x, y, w, h };
    after = undefined;
    fx = fy = 1;
  } else if (c && !c.every(Number.isFinite)) return null;
  const ptW = Math.abs(boxW) / 2, ptH = Math.abs(boxH) / 2;
  const needW = Math.max(1, Math.ceil((ptW / 72) * ppi / fx)), needH = Math.max(1, Math.ceil((ptH / 72) * ppi / fy));
  const k = Math.max(needW / w, needH / h);
  const resized = k < 1;
  if (!resized && !cutting) return null;
  if (resized) { w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
  return { cut, w, h, crop: after };
}

// ── Set Transparent Color: where a click lands in the picture ───────────────────────────────

/**
 * The picture's own coordinates (0–1) under a point of its box (`fx`, `fy` 0–1), for an uncropped
 * picture drawn with `fit` ('contain' letterboxes, 'cover' cuts the long side, 'fill' stretches).
 * Null in the letterbox, off the picture.
 */
export function fitUv(fx: number, fy: number, boxW: number, boxH: number, imgW: number, imgH: number, fit: 'contain' | 'cover' | 'fill' | undefined): [number, number] | null {
  if (!(boxW > 0 && boxH > 0 && imgW > 0 && imgH > 0)) return null;
  let u = fx, v = fy;
  if (fit !== 'fill') {
    const s = fit === 'cover' ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH);
    const dw = imgW * s, dh = imgH * s;
    u = (fx * boxW - (boxW - dw) / 2) / dw;
    v = (fy * boxH - (boxH - dh) / 2) / dh;
  }
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
}

// ── Picture Styles ──────────────────────────────────────────────────────────────────────────

export interface PictureLook {
  /** rect | roundRect | ellipse | round2DiagRect | snip2DiagRect */
  shape: string;
  /** Outline colour and width in points. */
  frame?: [string, number];
  /** Double (two-line) frame. */
  double?: boolean;
  shadow?: 'soft' | 'drop' | 'center' | 'perspective';
  /** Soft edge radius, points. */
  softEdge?: number;
  reflection?: boolean;
  bevel?: 'circle' | 'angle' | 'relaxedInset';
  /** Rotation the style sets, degrees. */
  rot?: number;
}

const W = '#ffffff', K = '#000000', S = '#c0c0c0';

/** PowerPoint's 24 Picture Styles in gallery order (DeckCraft picture_style.rs), Korean names. */
export const PICTURE_STYLES: { id: string; label: string; look: PictureLook }[] = [
  { id: 'simpleFrameWhite', label: '단순형 프레임, 흰색', look: { shape: 'rect', frame: [W, 7], shadow: 'soft' } },
  { id: 'beveledMatteWhite', label: '입체 매트, 흰색', look: { shape: 'rect', frame: [W, 6], shadow: 'soft', bevel: 'circle' } },
  { id: 'metalFrame', label: '금속 프레임', look: { shape: 'rect', frame: [S, 7], shadow: 'soft', bevel: 'angle' } },
  { id: 'dropShadowRectangle', label: '그림자 사각형', look: { shape: 'rect', shadow: 'drop' } },
  { id: 'roundedDiagonalCornerWhite', label: '둥근 대각선 모서리, 흰색', look: { shape: 'round2DiagRect', frame: [W, 6], shadow: 'soft' } },
  { id: 'snipDiagonalCornerWhite', label: '잘린 대각선 모서리, 흰색', look: { shape: 'snip2DiagRect', frame: [W, 6], shadow: 'soft' } },
  { id: 'moderateFrameWhite', label: '중간 프레임, 흰색', look: { shape: 'rect', frame: [W, 4.5], shadow: 'soft' } },
  { id: 'rotatedWhite', label: '회전, 흰색', look: { shape: 'rect', frame: [W, 6], shadow: 'soft', rot: 356 } },
  { id: 'perspectiveShadowWhite', label: '원근감 있는 그림자, 흰색', look: { shape: 'rect', frame: [W, 4], shadow: 'perspective' } },
  { id: 'softEdgeRectangle', label: '부드러운 가장자리 사각형', look: { shape: 'rect', softEdge: 10 } },
  { id: 'doubleFrameBlack', label: '이중 프레임, 검정', look: { shape: 'rect', frame: [K, 6], double: true } },
  { id: 'thickMatteBlack', label: '두꺼운 매트, 검정', look: { shape: 'rect', frame: [K, 10], shadow: 'soft' } },
  { id: 'simpleFrameBlack', label: '단순형 프레임, 검정', look: { shape: 'rect', frame: [K, 5] } },
  { id: 'beveledOvalBlack', label: '입체 타원, 검정', look: { shape: 'ellipse', frame: [K, 4], shadow: 'soft', bevel: 'circle' } },
  { id: 'compoundFrameBlack', label: '복합 프레임, 검정', look: { shape: 'rect', frame: [K, 4.5], double: true } },
  { id: 'centerShadowRectangle', label: '가운데 그림자 사각형', look: { shape: 'rect', shadow: 'center' } },
  { id: 'softEdgeOval', label: '부드러운 가장자리 타원', look: { shape: 'ellipse', softEdge: 12 } },
  { id: 'reflectedRoundedRectangle', label: '반사된 둥근 사각형', look: { shape: 'roundRect', reflection: true } },
  { id: 'reflectedBevelWhite', label: '반사된 입체, 흰색', look: { shape: 'rect', frame: [W, 4], reflection: true, bevel: 'circle' } },
  { id: 'metalRoundedRectangle', label: '금속 둥근 사각형', look: { shape: 'roundRect', frame: [S, 6], shadow: 'soft', bevel: 'angle' } },
  { id: 'moderateFrameBlack', label: '중간 프레임, 검정', look: { shape: 'rect', frame: [K, 4.5], shadow: 'soft' } },
  { id: 'bevelRectangle', label: '입체 사각형', look: { shape: 'rect', shadow: 'soft', bevel: 'angle' } },
  { id: 'bevelPerspective', label: '입체 원근감', look: { shape: 'rect', shadow: 'perspective', bevel: 'relaxedInset' } },
  { id: 'metalOval', label: '금속 타원', look: { shape: 'ellipse', frame: [S, 6], shadow: 'soft', bevel: 'angle' } },
];

export const pictureLook = (id: string | undefined): PictureLook | undefined => PICTURE_STYLES.find((s) => s.id === id)?.look;

/**
 * Applying a Picture Style (DeckCraft picture.style): one step that replaces the earlier style's
 * frame, shape and effects; the style's rotation is set too. `none` clears the style.
 */
export function pictureStylePatch(id: string): Partial<SlideElement> | null {
  const clear: Partial<SlideElement> = {
    stroke: undefined, strokeWidth: undefined, dash: undefined, maskShape: undefined,
    dropShadow: undefined, shadowKind: undefined, glow: undefined, glowSize: undefined, reflection: undefined, softEdge: undefined, bevel: undefined, rotate3d: undefined,
  };
  if (id === 'none') return { ...clear, pictureStyle: undefined };
  const look = pictureLook(id);
  if (!look) return null;
  return { ...clear, pictureStyle: id, ...(look.rot !== undefined ? { rotation: look.rot } : {}) };
}
