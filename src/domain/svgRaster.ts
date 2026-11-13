// Drawing an SVG picture into pixels (browser only): for the places that need a bitmap — picture
// corrections, a PNG fallback for PowerPoint, a picture used as a fill or background. The SVG is
// drawn at the size asked for, so the bitmap is as sharp as that size needs.
import { SVG_MIME, svgIntrinsicSize } from './svgPicture';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('svg')); i.src = url; });
}

/** `svg` (source text) drawn on a canvas `w` × `h` pixels (default: its own size, longest side at most `max`). */
export async function svgToCanvas(svg: string, w?: number, h?: number, max = 2048): Promise<HTMLCanvasElement> {
  const own = svgIntrinsicSize(svg) ?? { w: 300, h: 150 };
  let cw = w ?? own.w, ch = h ?? own.h;
  const k = Math.min(1, max / Math.max(cw, ch));
  cw = Math.max(1, Math.round(cw * k)); ch = Math.max(1, Math.round(ch * k));
  const url = URL.createObjectURL(new Blob([svg], { type: SVG_MIME }));
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d')!.drawImage(img, 0, 0, cw, ch);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/** A PNG of the SVG at `w` × `h` pixels. */
export async function svgToPngBlob(svg: string, w?: number, h?: number, max = 2048): Promise<Blob> {
  const c = await svgToCanvas(svg, w, h, max);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

/** `createImageBitmap` that also takes an SVG blob (browsers refuse those): the picture at its own size (at most 2048 px). */
export async function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  if ((blob.type || '').toLowerCase().startsWith(SVG_MIME)) return createImageBitmap(await svgToCanvas(await blob.text()));
  return createImageBitmap(blob);
}

export const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
