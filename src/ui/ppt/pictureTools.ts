// Picture Format › Adjust: the picture is drawn into a canvas, its pixels go through the Rust
// engine's pipeline (Remove Background, Corrections, Color, Artistic Effects, Set Transparent
// Color, Compress), and the result is stored as a new picture. The original is kept, so every
// change starts again from it and Reset Picture brings it back.
import type { Dispatch } from 'react';
import type { Action } from '../../domain/reducer';
import type { CutoutMarks, PictureAdjust, SlideElement } from '../../domain/types';
import { getMedia, putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { processPicture, type PictureSteps } from '../../engine';
import { bitmapOf } from '../../domain/svgRaster';
import { compressPlan, fitUv, realCrop } from '../../domain/pictureFormat';

async function pixels(mediaId: string): Promise<{ data: ImageData; w: number; h: number } | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  const bmp = await bitmapOf(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(bmp, 0, 0);
  return { data: g.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height };
}

async function toPng(data: Uint8ClampedArray, w: number, h: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

const stepsOf = (a: PictureAdjust, extra: PictureSteps = {}): PictureSteps => ({
  removeBackground: a.removeBackground, transparentColor: a.transparentColor, transparentTolerance: 8,
  brightness: a.brightness, contrast: a.contrast, saturation: a.saturation, temperature: a.temperature, sharpness: a.sharpness,
  recolor: a.recolor, artistic: a.artistic, ...extra,
});

/**
 * The picture element with `patch` applied to its adjustments (null clears them all: Reset
 * Picture). Resolves to null when the picture could not be read.
 */
export async function adjustPicture(el: SlideElement, patch: Partial<PictureAdjust> | null, dispatch: Dispatch<Action>, scheme?: string, extra?: PictureSteps): Promise<Partial<SlideElement> | null> {
  if (el.kind !== 'image' || !el.mediaId) return null;
  const original = el.picture?.original ?? el.mediaId;
  if (patch === null) return { mediaId: original, picture: undefined };
  const adjust: PictureAdjust = { ...(el.picture ?? { original }), ...patch, original };
  const px = await pixels(adjust.cutout ?? original);
  if (!px) return null;
  const out = processPicture(px.data.data, px.w, px.h, stepsOf(adjust, extra), scheme);
  if (!out) return null;
  const png = await toPng(out.data, out.w, out.h);
  if (!png) return null;
  const id = uid('m');
  await putMedia(id, png);
  dispatch({ type: 'media/add', media: { id, name: '서식을 바꾼 그림.png', type: 'image', backgroundHidden: true } });
  // Compress replaces the original itself (that is its point).
  if (extra?.maxSide) return { mediaId: id, picture: el.picture ? { ...adjust, original: id } : undefined };
  const plain = Object.entries(adjust).every(([k, v]) => k === 'original' || v === undefined || v === 0 || v === 'none');
  return plain ? { mediaId: original, picture: undefined } : { mediaId: id, picture: adjust };
}

/**
 * The colour of the picture at a point of the object (Set Transparent Color), `#rrggbb`. `fx`, `fy`
 * are already in the picture's own coordinates when it is cropped (the canvas maps them); an
 * uncropped picture is mapped through its fit, as DeckCraft maps the click to the picture's own
 * pixel. 'off' when the point is beside the picture (letterbox), 'clear' on a transparent pixel.
 */
export async function colorAt(el: SlideElement, fx: number, fy: number): Promise<string | 'off' | 'clear' | null> {
  const px = await pixels(el.picture?.original ?? el.mediaId ?? '');
  if (!px) return null;
  const uv = realCrop(el.crop) ? [fx, fy] : fitUv(fx, fy, el.w, el.h, px.w, px.h, el.fit ?? 'contain');
  if (!uv) return 'off';
  const x = Math.max(0, Math.min(px.w - 1, Math.floor(uv[0] * px.w)));
  const y = Math.max(0, Math.min(px.h - 1, Math.floor(uv[1] * px.h)));
  const i = (y * px.w + x) * 4;
  const d = px.data.data;
  // A transparent pixel keeps a colour nobody sees: clearing it would clear that colour where it shows.
  if (d[i + 3] === 0) return 'clear';
  return `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The picture's own pixel size. */
export async function pictureSize(mediaId: string): Promise<{ w: number; h: number } | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  try { const b = await bitmapOf(blob); return { w: b.width, h: b.height }; } catch { return null; }
}

/**
 * Compress Pictures for one picture object (DeckCraft picture.compress): its original is redrawn at
 * the resolution `ppi` needs for the size it is shown at, its cropped part cut away when asked, and
 * stored again (JPEG at 85 % when the source is a JPEG without transparency, else PNG). A picture
 * with corrections is remade from the new original. Null when nothing would get smaller.
 */
export async function compressElement(el: SlideElement, ppi: number, deleteCropped: boolean, dispatch: Dispatch<Action>, scheme?: string): Promise<{ patch: Partial<SlideElement>; before: number; after: number } | null> {
  if (el.kind !== 'image' || !el.mediaId) return null;
  const original = el.picture?.original ?? el.mediaId;
  const blob = await getMedia(original);
  if (!blob || /svg|gif/.test(blob.type)) return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  const plan = compressPlan(bmp.width, bmp.height, el.crop, el.w, el.h, ppi, deleteCropped);
  if (!plan) return null;
  const c = document.createElement('canvas');
  c.width = plan.w;
  c.height = plan.h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  const src = plan.cut ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
  g.drawImage(bmp, src.x, src.y, src.w, src.h, 0, 0, plan.w, plan.h);
  let alpha = false;
  const d = g.getImageData(0, 0, plan.w, plan.h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
  const jpeg = blob.type === 'image/jpeg' && !alpha;
  const out = await new Promise<Blob | null>((res) => c.toBlob(res, jpeg ? 'image/jpeg' : 'image/png', 0.85));
  // Never make a picture bigger just to resample it; cutting away a crop is worth it regardless.
  if (!out || (out.size >= blob.size && !plan.cut)) return null;
  const id = uid('m');
  await putMedia(id, out);
  dispatch({ type: 'media/add', media: { id, name: jpeg ? '압축한 그림.jpg' : '압축한 그림.png', type: 'image', backgroundHidden: true } });
  const base: Partial<SlideElement> = { mediaId: id, crop: plan.crop };
  if (!el.picture) return { patch: base, before: blob.size, after: out.size };
  const remade = await adjustPicture({ ...el, ...base, picture: { ...el.picture, original: id } }, {}, dispatch, scheme);
  return { patch: { ...base, ...(remade ?? { picture: { ...el.picture, original: id } }) }, before: blob.size, after: out.size };
}

/** The picture's own pixels (the original, so marks always start from it), for the marking tool. */
export async function originalPixels(el: SlideElement): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  const id = el.picture?.original ?? el.mediaId;
  const px = id ? await pixels(id) : null;
  return px ? { data: px.data.data, w: px.w, h: px.h } : null;
}

/**
 * Keep a cut-out made with the marking tool as the shown picture (a PNG with transparency). The
 * original stays, so Reset Picture brings it back; later adjustments start from the cut-out.
 */
export async function storeCutout(el: SlideElement, rgba: Uint8ClampedArray, w: number, h: number, dispatch: Dispatch<Action>, marks?: CutoutMarks): Promise<Partial<SlideElement> | null> {
  if (el.kind !== 'image' || !el.mediaId) return null;
  const png = await toPng(rgba, w, h);
  if (!png) return null;
  const original = el.picture?.original ?? el.mediaId;
  const id = uid('m');
  await putMedia(id, png);
  dispatch({ type: 'media/add', media: { id, name: '배경을 제거한 그림.png', type: 'image', backgroundHidden: true } });
  // The marks stay with the picture, so the dialog can open on them again (Reset Picture clears them with the rest).
  return { mediaId: id, picture: { ...(el.picture ?? {}), original, cutout: id, cutoutMarks: marks, removeBackground: undefined } };
}
