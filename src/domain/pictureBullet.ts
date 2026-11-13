// 홈 › 글머리 기호 › 그림 글머리 기호: an image used as the bullet of each paragraph. The picture is kept
// as a small PNG data URL (`bulletPicture`) beside `list: 'picture'`; PowerPoint writes it as a:buBlip.
import type { ListStyle } from './types';

/** Longest side, in pixels, a bullet picture is shrunk to (a bullet is only a line high). */
export const BULLET_PICTURE_PX = 64;
/** Largest source file taken as a bullet picture. */
export const BULLET_PICTURE_MAX_BYTES = 8 * 1024 * 1024;
/** The em size of a picture bullet on the canvas (a little above the cap height of the line). */
export const BULLET_PICTURE_EM = 0.8;

/** The picture of a 그림 글머리 기호, when the list style is one and has a usable image. */
export function bulletPictureOf(f: { list?: ListStyle; bulletPicture?: string }): string | undefined {
  return f.list === 'picture' && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(f.bulletPicture ?? '') ? f.bulletPicture : undefined;
}

/** The size a picture of `w` × `h` is drawn at as a bullet: its longest side `max`, never enlarged. */
export function bulletPictureSize(w: number, h: number, max = BULLET_PICTURE_PX): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: max, h: max };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Whether a chosen file can be a bullet picture. */
export function isBulletPictureFile(f: { type: string; size: number }): boolean {
  return /^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/i.test(f.type) && f.size > 0 && f.size <= BULLET_PICTURE_MAX_BYTES;
}

// ── PPTX export ─────────────────────────────────────────────────────────────────────────────

/** The private-use character (4 hex digits) that stands for the n-th bullet picture while PptxGenJS writes the file. */
export const bulletPlaceholder = (index: number) => (0xe100 + index).toString(16).toUpperCase();

/** One image a .pptx needs for its picture bullets. */
export interface BulletMedia { id: string; ext: string; data: Uint8Array }

const rid = (i: number) => `rIdLcBu${i}`;

/** The decoded bytes and file type of a bullet picture's data URL. */
export function bulletMedia(dataUrl: string, index: number): BulletMedia | null {
  const m = /^data:image\/([a-z+.-]+);base64,(.*)$/is.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { id: rid(index), ext: m[1].toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg'), data };
}

/**
 * Turns the placeholder bullets of one slide's XML into `a:buBlip` bullets. Returns the new XML and the
 * indexes of the pictures it now refers to (they need a relationship each).
 */
export function patchBulletXml(xml: string, count: number): { xml: string; used: number[] } {
  const used: number[] = [];
  let out = xml;
  for (let i = 0; i < count; i++) {
    const re = new RegExp(`<a:buChar char="&#x${bulletPlaceholder(i)};"\\s*/>`, 'gi');
    if (!re.test(out)) continue;
    used.push(i);
    out = out.replace(new RegExp(re.source, 'gi'), `<a:buBlip><a:blip r:embed="${rid(i)}"/></a:buBlip>`);
  }
  return { xml: out, used };
}
