// Pictures recoloured as PowerPoint draws them (domain/pictureColor): the pixels are worked once per picture and
// colour and kept as a blob URL, so the slide show draws the result like any other picture.
import { useEffect, useState } from 'react';
import { applyPictureColor, pictureColorKey, type PictureColor } from '../domain/pictureColor';

const done = new Map<string, string>();
const working = new Map<string, Promise<string | null>>();
/** Pictures are worked at most this many pixels (a bigger one is scaled down first). */
const MAX_PIXELS = 16_000_000;

async function recolour(url: string, pc: PictureColor): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, bmp.width * bmp.height)));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const data = g.getImageData(0, 0, w, h);
    applyPictureColor(data.data, pc);
    g.putImageData(data, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  } catch { return null; }
}

/** The picture at `url` with its colour changes, once worked; the plain picture meanwhile (or when there are none). */
export function usePictureColor(url: string | null, pc: PictureColor | undefined): string | null {
  const key = url && pc ? `${url}|${pictureColorKey(pc)}` : '';
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key || done.has(key) || !url || !pc) return;
    let live = true;
    let job = working.get(key);
    if (!job) { job = recolour(url, pc); working.set(key, job); }
    void job.then((u) => { working.delete(key); if (u) done.set(key, u); if (live) bump((n) => n + 1); });
    return () => { live = false; };
  }, [key]);
  return key ? done.get(key) ?? url : url;
}
