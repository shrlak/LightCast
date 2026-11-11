// Picture Format › Adjust: the picture is drawn into a canvas, its pixels go through the Rust
// engine's pipeline (Remove Background, Corrections, Color, Artistic Effects, Set Transparent
// Color, Compress), and the result is stored as a new picture. The original is kept, so every
// change starts again from it and Reset Picture brings it back.
import type { Dispatch } from 'react';
import type { Action } from '../../domain/reducer';
import type { PictureAdjust, SlideElement } from '../../domain/types';
import { getMedia, putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { processPicture, type PictureSteps } from '../../engine';

async function pixels(mediaId: string): Promise<{ data: ImageData; w: number; h: number } | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
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
  const px = await pixels(original);
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

/** The colour of the picture at a point of the object (Set Transparent Color), `#rrggbb`. */
export async function colorAt(el: SlideElement, fx: number, fy: number): Promise<string | null> {
  const px = await pixels(el.picture?.original ?? el.mediaId ?? '');
  if (!px) return null;
  const x = Math.max(0, Math.min(px.w - 1, Math.round(fx * px.w)));
  const y = Math.max(0, Math.min(px.h - 1, Math.round(fy * px.h)));
  const i = (y * px.w + x) * 4;
  const d = px.data.data;
  return `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
