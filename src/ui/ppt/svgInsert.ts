// Where an inserted SVG picture goes: its own aspect, centred on the slide, so the selection frame
// hugs the drawing (a vector has no pixels to run out of, so any size is sharp).
import { isSvgBlob, prepareMediaBlob, svgIntrinsicSize } from '../../domain/svgPicture';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';

/** The box for an SVG blob that fits 1000 × 760 canvas px (or its own size when smaller); null when `blob` is not an SVG. */
export async function svgPictureBox(file: Blob): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const blob = await prepareMediaBlob(file);
  if (!isSvgBlob(blob)) return null;
  let size: { w: number; h: number } | null = null;
  try { size = svgIntrinsicSize(await blob.text()); } catch { /* no size */ }
  if (!size) return null;
  const own = { w: size.w * 1.5, h: size.h * 1.5 }; // CSS px → canvas px (96 dpi → 144 per inch)
  const k = Math.min(1000 / own.w, 760 / own.h);
  // A small drawing is shown at least 400 px wide: a logo drawn 24 px wide is still a usable object.
  const scale = Math.max(k < 1 ? k : 1, Math.min(k, 400 / Math.max(own.w, own.h)));
  const w = own.w * scale, h = own.h * scale;
  return { x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w: Math.round(w), h: Math.round(h) };
}
