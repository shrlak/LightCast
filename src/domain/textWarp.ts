// WordArt › Text Effects › Transform: lays a box's glyphs on DeckCraft's warp guides. A fill band
// stretches its lines between a top and a bottom guide (each glyph mapped by the guides at its
// place along the line); a follow band sets lines at their natural size along one guide.
import type { WarpBand } from '../engine';

type P = [number, number];

/** Older LightCast warp names → DeckCraft / PowerPoint presets. */
export const LEGACY_WARP: Record<string, string> = { archUp: 'textArchUp', archDown: 'textArchDown', wave: 'textWave1', slantUp: 'textSlantUp', slantDown: 'textSlantDown' };
export const warpPreset = (w: string) => LEGACY_WARP[w] ?? w;

/** A point at fraction u along a polyline sampled at equal arc lengths. */
export function at(poly: P[], u: number): P {
  if (!poly.length) return [0, 0];
  const f = Math.max(0, Math.min(1, u)) * (poly.length - 1);
  const i = Math.min(poly.length - 2, Math.floor(f));
  if (i < 0) return poly[0];
  const t = f - i, a = poly[i], b = poly[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Which band a line belongs to (DeckCraft: the first ⌈n/k⌉ lines to the first band, …). */
export function bandOfLine(line: number, lines: number, bands: number): number {
  if (bands <= 1 || lines <= 1) return 0;
  const per = Math.ceil(lines / bands);
  return Math.min(bands - 1, Math.floor(line / per));
}

export interface WarpGlyph { ch: string; matrix: [number, number, number, number, number, number] }

/**
 * Glyph placements for fill bands: each glyph of advance `widths[i]` and height `gh` gets the
 * affine map from its box onto the warped quad between the guides.
 */
export function fillGlyphs(band: Extract<WarpBand, { kind: 'fill' }>, lines: { chars: string[]; widths: number[] }[], gh: number): WarpGlyph[] {
  const widest = Math.max(1e-6, ...lines.map((l) => l.widths.reduce((a, b) => a + b, 0)));
  const out: WarpGlyph[] = [];
  const m = Math.max(1, lines.length);
  lines.forEach((l, j) => {
    const total = l.widths.reduce((a, b) => a + b, 0);
    // One horizontal scale for the band: its widest line fills the guides, others are centred.
    let x = (widest - total) / 2;
    const v0 = j / m, v1 = (j + 1) / m;
    l.chars.forEach((ch, i) => {
      const w = l.widths[i];
      const u0 = x / widest, u1 = (x + w) / widest;
      x += w;
      if (!ch.trim()) return;
      const t0 = at(band.top, u0), b0 = at(band.bottom, u0), t1 = at(band.top, u1);
      const tl: P = [t0[0] + (b0[0] - t0[0]) * v0, t0[1] + (b0[1] - t0[1]) * v0];
      const bl: P = [t0[0] + (b0[0] - t0[0]) * v1, t0[1] + (b0[1] - t0[1]) * v1];
      const b1 = at(band.bottom, u1);
      const tr: P = [t1[0] + (b1[0] - t1[0]) * v0, t1[1] + (b1[1] - t1[1]) * v0];
      const gw = Math.max(1e-6, w);
      out.push({ ch, matrix: [(tr[0] - tl[0]) / gw, (tr[1] - tl[1]) / gw, (bl[0] - tl[0]) / gh, (bl[1] - tl[1]) / gh, tl[0], tl[1]] });
    });
  });
  return out;
}

export const polyD = (poly: P[], closed = false) => poly.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') + (closed ? ' Z' : '');

/** WordArt Transform gallery: PowerPoint's Korean names. */
export const WARP_LABEL: Record<string, string> = {
  textArchUp: '위쪽 원호', textArchDown: '아래쪽 원호', textCircle: '원', textButton: '단추', textPlain: '사각형', textStop: '정지',
  textTriangle: '삼각형', textTriangleInverted: '역삼각형', textChevron: '갈매기형 수장: 위로', textChevronInverted: '갈매기형 수장: 아래로',
  textRingInside: '원형: 안쪽', textRingOutside: '원형: 바깥쪽', textArchUpPour: '위쪽 원호: 채우기', textArchDownPour: '아래쪽 원호: 채우기',
  textCirclePour: '원: 채우기', textButtonPour: '단추: 채우기', textCurveUp: '위로 구부리기', textCurveDown: '아래로 구부리기',
  textCanUp: '원통: 위로', textCanDown: '원통: 아래로', textWave1: '물결 1', textWave2: '물결 2', textDoubleWave1: '이중 물결 1', textWave4: '이중 물결 2',
  textInflate: '부풀리기', textDeflate: '오목하게', textInflateBottom: '아래쪽 부풀리기', textDeflateBottom: '아래쪽 오목하게',
  textInflateTop: '위쪽 부풀리기', textDeflateTop: '위쪽 오목하게', textDeflateInflate: '오목하게-부풀리기', textDeflateInflateDeflate: '오목하게-부풀리기-오목하게',
  textFadeRight: '오른쪽 줄이기', textFadeLeft: '왼쪽 줄이기', textFadeUp: '위쪽 줄이기', textFadeDown: '아래쪽 줄이기',
  textSlantUp: '위로 기울이기', textSlantDown: '아래로 기울이기', textCascadeUp: '계단식: 위로', textCascadeDown: '계단식: 아래로',
};
