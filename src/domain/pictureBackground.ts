// Format Background › Picture or texture fill: tile the picture as a texture (offset, scale, alignment,
// mirror) and make it transparent. Ported from DeckCraft's slide_background.rs (`apply_picture_props`);
// the numbers are clamped the same way (offset ±4000, scale 1 %–1000 %).
import type { BackgroundPicture } from './types';

export const ALIGNS = ['tl', 't', 'tr', 'l', 'ctr', 'r', 'bl', 'b', 'br'] as const;
export const MIRRORS = ['none', 'x', 'y', 'xy'] as const;
export const ALIGN_LABEL: Record<(typeof ALIGNS)[number], string> = { tl: '왼쪽 위', t: '위', tr: '오른쪽 위', l: '왼쪽', ctr: '가운데', r: '오른쪽', bl: '왼쪽 아래', b: '아래', br: '오른쪽 아래' };
export const MIRROR_LABEL: Record<(typeof MIRRORS)[number], string> = { none: '없음', x: '가로', y: '세로', xy: '가로 및 세로' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** `patch` merged into `cur`, with every number clamped and unknown values ignored; empty results are undefined. */
export function patchPicture(cur: BackgroundPicture | undefined, patch: Partial<BackgroundPicture>): BackgroundPicture | undefined {
  const o: BackgroundPicture = { ...cur };
  if (typeof patch.tile === 'boolean') {
    if (patch.tile) o.tile = true; else delete o.tile;
  }
  const set = (k: 'scaleX' | 'scaleY' | 'offsetX' | 'offsetY' | 'transparency', lo: number, hi: number, neutral: number) => {
    const v = num(patch[k]);
    if (v === undefined) return;
    const c = clamp(v, lo, hi);
    if (c === neutral) delete o[k]; else o[k] = c;
  };
  set('scaleX', 1, 1000, 100); set('scaleY', 1, 1000, 100); set('offsetX', -4000, 4000, 0); set('offsetY', -4000, 4000, 0); set('transparency', 0, 100, 0);
  if (patch.mirror !== undefined && (MIRRORS as readonly string[]).includes(patch.mirror)) { if (patch.mirror === 'none') delete o.mirror; else o.mirror = patch.mirror; }
  if (patch.align !== undefined && (ALIGNS as readonly string[]).includes(patch.align)) { if (patch.align === 'tl') delete o.align; else o.align = patch.align; }
  return Object.keys(o).length ? o : undefined;
}

const ANCHOR: Record<(typeof ALIGNS)[number], [number, number]> = { tl: [0, 0], t: [50, 0], tr: [100, 0], l: [0, 50], ctr: [50, 50], r: [100, 50], bl: [0, 100], b: [50, 100], br: [100, 100] };

export interface TileLayout {
  /** The repeating cell in px (a mirrored axis doubles it: picture and its reflection). */
  cellW: number; cellH: number;
  mirrorX: boolean; mirrorY: boolean;
  /** CSS background-position. */
  position: string;
}

/** How a picture of natural size `nat` tiles under options `o`. */
export function tileLayout(o: BackgroundPicture | undefined, nat: { w: number; h: number }): TileLayout {
  const sx = clamp(o?.scaleX ?? 100, 1, 1000) / 100, sy = clamp(o?.scaleY ?? 100, 1, 1000) / 100;
  const mirror = o?.mirror ?? 'none';
  const mirrorX = mirror === 'x' || mirror === 'xy', mirrorY = mirror === 'y' || mirror === 'xy';
  const a = o?.align ?? 'tl';
  const [px, py] = ANCHOR[a];
  const w = Math.max(1, nat.w * sx), h = Math.max(1, nat.h * sy);
  return {
    cellW: w * (mirrorX ? 2 : 1), cellH: h * (mirrorY ? 2 : 1), mirrorX, mirrorY,
    position: `calc(${px}% + ${clamp(o?.offsetX ?? 0, -4000, 4000)}px) calc(${py}% + ${clamp(o?.offsetY ?? 0, -4000, 4000)}px)`,
  };
}

/** The picture's opacity (transparency is a percentage). */
export const pictureOpacity = (o: BackgroundPicture | undefined) => 1 - clamp(o?.transparency ?? 0, 0, 100) / 100;
