// Copy and paste of slide objects through the system clipboard (Ctrl+C / Ctrl+V on the slide and
// Home › Clipboard). LightCast objects keep every property and their place; PowerPoint's copied shapes
// are read from its own clipboard format in the desktop app (exact positions, fonts and colours) or
// from the HTML it writes; other programs' formatted text keeps its formatting.
import type { MediaMeta, SlideElement, TextRun } from '../../domain/types';
import { CLIP_TYPE, decodePayload, htmlToElements, objectsHtml, objectsText, payloadFromHtml, type ClipMedia, type ClipPayload } from '../../domain/clipboard';
import { readGvml } from '../../domain/io/drawingml';
import { cloneElements } from '../../domain/editOps';
import { getMedia, putMedia } from '../../domain/media';
import { desktop } from '../../domain/desktop';
import { uid } from '../../domain/lyrics';

/** What a paste found on the clipboard. */
export interface ClipSource { custom?: string; html?: string; text?: string; images: Blob[] }
/** Paste Options: 원본 서식 유지 / 대상 테마 사용 / 텍스트만 유지. */
export type PasteMode = 'source' | 'dest' | 'text';
export interface PasteResult { elements: SlideElement[]; media: MediaMeta[]; from: 'freecast' | 'powerpoint' | 'html' | 'picture' | 'text' }

/** The last objects copied in this window (used when the system clipboard cannot be read). */
let lastCopied: SlideElement[] = [];
export const lastCopiedObjects = () => lastCopied;

const mediaIdsOf = (els: SlideElement[]) => [...new Set(els.flatMap((e) => [e.mediaId, e.fillImage].filter((x): x is string => !!x)))];
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** Pictures the objects use, as data (so another LightCast without them can paste them), up to 12 MB. */
async function mediaOf(els: SlideElement[], names: (id: string) => string | undefined): Promise<Record<string, ClipMedia>> {
  const out: Record<string, ClipMedia> = {};
  let total = 0;
  for (const id of mediaIdsOf(els)) {
    const blob = await getMedia(id).catch(() => undefined);
    if (!blob || !blob.type.startsWith('image/') || total + blob.size > 12e6) continue;
    total += blob.size;
    out[id] = { name: names(id) ?? '그림', type: blob.type, data: await blobToDataUrl(blob) };
  }
  return out;
}

/**
 * Copy objects: into a copy event's clipboard data when given (synchronous), and then onto the
 * system clipboard with their pictures attached (asynchronous, when there are pictures or no event).
 */
export function copyObjectsToClipboard(els: SlideElement[], data?: DataTransfer | null, names: (id: string) => string | undefined = () => undefined) {
  if (!els.length) return;
  lastCopied = els.map((e) => ({ ...e }));
  const text = objectsText(els);
  if (data) {
    data.setData(CLIP_TYPE, JSON.stringify({ v: 1, elements: els } satisfies ClipPayload));
    data.setData('text/html', objectsHtml(els));
    data.setData('text/plain', text);
  }
  const needsMedia = mediaIdsOf(els).length > 0;
  if (data && !needsMedia) return;
  void (async () => {
    const media = needsMedia ? await mediaOf(els, names) : undefined;
    const html = objectsHtml(els, media);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } catch {
      if (!data) await navigator.clipboard?.writeText(text).catch(() => undefined);
    }
  })();
}

/** A copy / paste event's clipboard contents. */
export function sourceOf(data: DataTransfer): ClipSource {
  return {
    custom: data.getData(CLIP_TYPE) || undefined,
    html: data.getData('text/html') || undefined,
    text: data.getData('text/plain') || undefined,
    images: Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/')),
  };
}

/** The system clipboard (Home › Paste); null when the browser does not allow reading it. */
export async function readSystemClipboard(): Promise<ClipSource | null> {
  try {
    const items = await navigator.clipboard.read();
    const src: ClipSource = { images: [] };
    for (const item of items) {
      for (const t of item.types) {
        if (t === 'text/html') src.html = await (await item.getType(t)).text();
        else if (t === 'text/plain') src.text = await (await item.getType(t)).text();
        else if (t === `web ${CLIP_TYPE}`) src.custom = await (await item.getType(t)).text();
        else if (t.startsWith('image/')) src.images.push(await item.getType(t));
      }
    }
    return src;
  } catch {
    const text = await navigator.clipboard?.readText().catch(() => null);
    return text == null ? null : { text, images: [] };
  }
}

/** Remove the formatting that comes from the source's theme (Paste Options › 대상 테마 사용). */
function destinationTheme(el: SlideElement): SlideElement {
  const strip = (runs?: TextRun[]) => runs?.map(({ color: _c, fontFamily: _f, highlight: _h, ...r }) => r);
  const { color: _c, fontFamily: _f, ...rest } = el;
  return { ...rest, runs: el.runs?.map((l) => strip(l)!), paragraphs: el.paragraphs?.map((p) => ({ ...p, color: undefined, runs: strip(p.runs) })) };
}

/** Where a picture of this size goes: centred, shrunk to fit the slide like PowerPoint. */
async function pictureElement(blob: Blob, id: string): Promise<SlideElement> {
  let w = 800, h = 600;
  try {
    const bmp = await createImageBitmap(blob);
    w = bmp.width * 1.5; h = bmp.height * 1.5; // CSS px → canvas px (96 dpi → 144 per inch)
    bmp.close();
  } catch { /* keep the default size */ }
  const k = Math.min(1, 1300 / w, 960 / h);
  w *= k; h *= k;
  return { id: uid('el'), kind: 'image', mediaId: id, fit: 'fill', x: (1440 - w) / 2, y: (1080 - h) / 2, w, h, name: '그림' };
}

/** PowerPoint's shapes in its own clipboard format (desktop app only). */
async function fromPowerPoint(): Promise<PasteResult | null> {
  const bytes = await desktop?.readOfficeClipboard?.().catch(() => null);
  if (!bytes) return null;
  const r = await readGvml(bytes);
  if (!r?.elements.length) return null;
  const media: MediaMeta[] = [];
  for (const m of r.media) { await putMedia(m.id, m.blob); media.push({ id: m.id, name: m.name, type: 'image' }); }
  return { elements: r.elements, media, from: 'powerpoint' };
}

/** LightCast objects, with any picture this LightCast does not have restored from the clipboard. */
async function fromLightCast(p: ClipPayload, existing: SlideElement[]): Promise<PasteResult> {
  const media: MediaMeta[] = [];
  for (const id of mediaIdsOf(p.elements)) {
    const have = await getMedia(id).catch(() => undefined);
    const carried = p.media?.[id];
    if (have || !carried) continue;
    const blob = await (await fetch(carried.data)).blob();
    await putMedia(id, blob);
    media.push({ id, name: carried.name, type: 'image' });
  }
  // On the slide they came from, copies are set off (again for each paste); elsewhere they keep their place.
  const taken = (dx: number) => p.elements.some((s) => existing.some((el) => el.kind === s.kind && Math.abs(el.x - (s.x + dx)) < 0.5 && Math.abs(el.y - (s.y + dx)) < 0.5));
  let off = 0;
  while (taken(off) && off < 600) off += 30;
  return { elements: cloneElements(p.elements, off), media, from: 'freecast' };
}

/** Everything a paste puts on the slide, read from the clipboard. */
export async function clipboardToElements(src: ClipSource, existing: SlideElement[], mode: PasteMode = 'source'): Promise<PasteResult | null> {
  const text = src.text?.replace(/\r\n?/g, '\n');
  const own = decodePayload(src.custom) ?? payloadFromHtml(src.html);
  let result: PasteResult | null = null;
  if (mode === 'text') {
    const t = text?.trim() || (own ? objectsText(own.elements) : '');
    return t ? { elements: [{ id: uid('el'), kind: 'text', text: t, x: 220, y: 340, w: 1000, h: 400, fontSize: 56, color: '#ffffff', align: 'left' }], media: [], from: 'text' } : null;
  }
  if (own) result = await fromLightCast(own, existing);
  if (!result && desktop?.readOfficeClipboard) result = await fromPowerPoint();
  if (!result && src.html) {
    const { elements, images } = htmlToElements(src.html);
    const media: MediaMeta[] = [];
    const pics: SlideElement[] = [];
    for (const img of images) {
      const id = uid('m');
      await putMedia(id, await (await fetch(img.src)).blob());
      media.push({ id, name: '붙여넣은 그림', type: 'image' });
      pics.push({ id: uid('el'), kind: 'image', mediaId: id, fit: 'fill', ...img.box, name: '그림' });
    }
    // A copied picture comes with HTML that only points at it: paste the picture itself.
    if (elements.length || pics.length) result = { elements: [...pics, ...elements], media, from: 'html' };
  }
  if (!result && src.images.length) {
    const id = uid('m');
    await putMedia(id, src.images[0]);
    result = { elements: [await pictureElement(src.images[0], id)], media: [{ id, name: '붙여넣은 그림', type: 'image' }], from: 'picture' };
  }
  if (!result && text?.trim()) {
    result = { elements: [{ id: uid('el'), kind: 'text', text: text.replace(/\n+$/, ''), x: 220, y: 340, w: 1000, h: 400, fontSize: 56, color: '#ffffff', align: 'center' }], media: [], from: 'text' };
  }
  if (result && mode === 'dest') result = { ...result, elements: result.elements.map(destinationTheme) };
  return result;
}
