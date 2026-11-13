// Metafile pictures as ordinary images: an SVG blob, or (with a DOM) a PNG drawn from it, so every
// place that shows or processes pictures (img, canvas, createImageBitmap) can use them.
import { isMetafile, metafileToSvg } from './index';

/** File types offered wherever a picture is chosen. */
export const METAFILE_ACCEPT = '.wmf,.emf';
export const isMetafileName = (name: string | undefined | null) => /\.(wmf|emf)$/i.test(name ?? '');

const hasDom = () => typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

/** Draws an SVG string into a PNG (about `long` px on the longer side). Null when no canvas is available or the drawing fails. */
async function rasterize(svg: string, w: number, h: number, long: number): Promise<Blob | null> {
  if (!hasDom()) return null;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg')); img.src = url; });
    const k = long / Math.max(w, h, 1);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A metafile's bytes as an image blob (PNG when a DOM can draw it, else SVG); null when it cannot be read. */
export async function metafileToBlob(bytes: ArrayBuffer | ArrayBufferView): Promise<Blob | null> {
  const r = metafileToSvg(bytes);
  if (!r) return null;
  const long = Math.min(3000, Math.max(1024, Math.max(r.width, r.height) * 2));
  return (await rasterize(r.svg, r.width, r.height, long)) ?? new Blob([r.svg], { type: 'image/svg+xml' });
}

/** The size, in pixels at 96 dpi, a metafile picture is meant to have. */
export function metafileSize(bytes: ArrayBuffer | ArrayBufferView): { width: number; height: number } | null {
  const r = metafileToSvg(bytes);
  return r ? { width: r.width, height: r.height } : null;
}

const PREFIX = 64;

/**
 * A picture file or blob as something the editor can show: a metafile (by its bytes, or by its
 * .wmf / .emf name) is converted; anything else comes back as it is.
 */
export async function pictureBlob(blob: Blob, name?: string): Promise<Blob> {
  const type = blob.type;
  const maybe = isMetafileName(name) || isMetafileName((blob as File).name) || !type || /emf|wmf|octet-stream|metafile/i.test(type);
  if (!maybe || blob.size < 18) return blob;
  try {
    const head = new Uint8Array(await blob.slice(0, PREFIX).arrayBuffer());
    if (!isMetafile(head)) return blob;
    return (await metafileToBlob(await blob.arrayBuffer())) ?? blob;
  } catch {
    return blob;
  }
}
