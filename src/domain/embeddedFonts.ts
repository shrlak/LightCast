// Fonts that came inside imported .pptx files: kept in the media store (IndexedDB) and registered with
// FontFace so every window shows decks from other churches in their own fonts. Also the source of font
// files when a deck is exported with its fonts embedded. Nothing here throws on bad data.
import { getMedia, putMedia, deleteMedia } from './media';
import { embedFontsInZip, mayEmbed, readEmbeddedFonts, sfntFormat, usedFamilies, type FontStyle, type ReadFont } from './io/pptxFonts';
import JSZip from 'jszip';
import { importedFonts, importedSfnt, registerImportedFonts, embedStyleOf } from './importedFonts';

export interface StoredEmbedded { id: string; family: string; style: FontStyle; bytes: number; source: string; at: number }

const INDEX_KEY = 'embfont:index';
/** All imported fonts together stay under this; the oldest go first. */
export const MAX_STORE_BYTES = 120 * 1024 * 1024;
const PREF_KEY = 'lightcast.embedFontsOnExport';

const cssWeightStyle = (s: FontStyle) => ({ weight: s === 'bold' || s === 'boldItalic' ? '700' : '400', style: s === 'italic' || s === 'boldItalic' ? 'italic' : 'normal' });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

let chain: Promise<unknown> = Promise.resolve();
/** One index update at a time, so two imports cannot overwrite each other's list. */
const serial = <T>(f: () => Promise<T>): Promise<T> => { const p = chain.then(f, f); chain = p.catch(() => undefined); return p; };

async function readIndex(): Promise<StoredEmbedded[]> {
  try {
    const b = await getMedia(INDEX_KEY);
    const list = b ? JSON.parse(await b.text()) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
const writeIndex = (list: StoredEmbedded[]) => putMedia(INDEX_KEY, new Blob([JSON.stringify(list)], { type: 'application/json' }));

const registered = new Set<string>();
async function register(id: string, family: string, style: FontStyle, data: ArrayBuffer): Promise<void> {
  if (registered.has(id) || typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  try {
    const { weight, style: fs } = cssWeightStyle(style);
    const face = new FontFace(family, data, { weight, style: fs });
    await face.load();
    document.fonts.add(face);
    registered.add(id);
  } catch { /* an unusable font file is simply not used */ }
}

/** Store and register the fonts of an imported deck (a font already kept for the same family and style is replaced). */
export async function keepEmbeddedFonts(fonts: ReadFont[], source: string): Promise<number> {
  if (!fonts.length) return 0;
  return serial(async () => {
    let list = await readIndex();
    let n = 0;
    for (const f of fonts) {
      try {
        const old = list.find((x) => same(x.family, f.family) && x.style === f.style);
        if (old) { list = list.filter((x) => x !== old); registered.delete(old.id); await deleteMedia(old.id).catch(() => undefined); }
        const id = `embfont:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const buf = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer;
        await putMedia(id, new Blob([buf], { type: f.format === 'opentype' ? 'font/otf' : 'font/ttf' }));
        list.push({ id, family: f.family, style: f.style, bytes: f.data.length, source, at: Date.now() });
        await register(id, f.family, f.style, buf);
        n++;
      } catch { /* storage full or unavailable: skip this font */ }
    }
    list.sort((a, b) => a.at - b.at);
    let total = list.reduce((s, x) => s + x.bytes, 0);
    while (total > MAX_STORE_BYTES && list.length > 1) { const x = list.shift()!; total -= x.bytes; await deleteMedia(x.id).catch(() => undefined); }
    await writeIndex(list).catch(() => undefined);
    return n;
  });
}

/** Read the embedded fonts of a .pptx and keep them; resolves to how many were usable. */
export async function importEmbeddedFonts(pptx: ArrayBuffer, source: string): Promise<number> {
  return (await importEmbeddedFontsReport(pptx, source)).kept;
}

/** Like importEmbeddedFonts, and says which fonts of the deck were skipped and why (for the import notice). */
export async function importEmbeddedFontsReport(pptx: ArrayBuffer, source: string): Promise<{ kept: number; skipped: { family: string; style: FontStyle; reason: string }[] }> {
  try {
    const { fonts, skippedFonts } = await readEmbeddedFonts(pptx);
    const kept = await keepEmbeddedFonts(fonts, source);
    return { kept, skipped: skippedFonts };
  } catch { return { kept: 0, skipped: [] }; }
}

/** "글꼴 N개를 건너뛰었습니다: Name (reason) …" for a toast; null when nothing was skipped. */
export function skippedFontsNotice(skipped: { family: string; reason: string }[]): string | null {
  if (!skipped.length) return null;
  const by = new Map<string, string>();
  for (const s of skipped) by.set(s.family, s.reason);
  const items = [...by].slice(0, 4).map(([f, r]) => `${f}(${r})`).join(', ');
  return `PPTX에 들어 있는 글꼴 ${by.size}개를 가져오지 못했습니다: ${items}${by.size > 4 ? ` 외 ${by.size - 4}개` : ''}. 글꼴 파일이 있으면 글꼴 가져오기로 추가하세요.`;
}

/** The fonts that came inside imported decks (source = the .pptx file name). */
export const listEmbeddedFonts = (): Promise<StoredEmbedded[]> => readIndex();

/** Forget one font that came from a deck. */
export function removeEmbeddedFont(id: string): Promise<void> {
  return serial(async () => {
    const list = await readIndex();
    await writeIndex(list.filter((x) => x.id !== id)).catch(() => undefined);
    registered.delete(id);
    await deleteMedia(id).catch(() => undefined);
  });
}

/** On start-up: register every kept font (the ones from decks and the ones imported from font files). */
export async function registerStoredFonts(): Promise<void> {
  await registerImportedFonts();
  try {
    for (const s of await readIndex()) {
      const b = await getMedia(s.id).catch(() => undefined);
      if (b) await register(s.id, s.family, s.style, await b.arrayBuffer());
    }
  } catch { /* fonts are optional */ }
}

/** Font files for the families a deck uses: kept imported ones first, then the computer's own (Chromium's queryLocalFonts). */
export async function localFontFiles(families: string[]): Promise<{ family: string; style: FontStyle; data: Uint8Array }[]> {
  const out: { family: string; style: FontStyle; data: Uint8Array }[] = [];
  const index = await readIndex();
  let locals: { family: string; style: string; blob(): Promise<Blob> }[] | null = null;
  for (const family of families) {
    const have = new Set<FontStyle>();
    for (const s of index.filter((x) => same(x.family, family))) {
      const b = await getMedia(s.id).catch(() => undefined);
      if (b) { out.push({ family, style: s.style, data: new Uint8Array(await b.arrayBuffer()) }); have.add(s.style); }
    }
    // Fonts imported from files: the regular / bold / italic / bold-italic faces of the family.
    for (const f of importedFonts().filter((x) => same(x.family, family))) {
      const style = embedStyleOf(f);
      if (!style || have.has(style)) continue;
      const data = await importedSfnt(f);
      if (data) { out.push({ family, style, data }); have.add(style); }
    }
    if (have.size) continue;
    try {
      const q = (window as unknown as { queryLocalFonts?: () => Promise<typeof locals> }).queryLocalFonts;
      locals ??= q ? await q.call(window) : [];
      for (const f of (locals ?? []).filter((x) => same(x.family, family))) {
        const st = f.style.toLowerCase();
        const style: FontStyle | null = /^regular$|^normal$|^book$/.test(st) ? 'regular' : /^bold$/.test(st) ? 'bold' : /^(italic|oblique)$/.test(st) ? 'italic' : /^bold (italic|oblique)$/.test(st) ? 'boldItalic' : null;
        if (!style || have.has(style)) continue;
        const data = new Uint8Array(await (await f.blob()).arrayBuffer());
        if (sfntFormat(data)) { out.push({ family, style, data }); have.add(style); }
      }
    } catch { /* no permission or not supported: this family is not embedded */ }
  }
  return out.filter((f) => mayEmbed(f.data));
}

export const embedFontsPref = (): boolean => { try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return false; } };
export const setEmbedFontsPref = (on: boolean) => { try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* a per-viewer convenience only */ } };

/** Put the fonts a deck uses into a finished .pptx. Returns the families that could not be embedded (no file here, or licence forbids). */
export async function embedUsedFonts(blob: Blob, deck: unknown): Promise<{ blob: Blob; embedded: string[]; missing: string[] }> {
  const families = usedFamilies(deck);
  try {
    const files = await localFontFiles(families);
    if (!files.length) return { blob, embedded: [], missing: families };
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    if (!(await embedFontsInZip(zip, files))) return { blob, embedded: [], missing: families };
    const embedded = [...new Set(files.map((f) => f.family))];
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), embedded, missing: families.filter((f) => !embedded.includes(f)) };
  } catch { return { blob, embedded: [], missing: families }; }
}

/** The notice after a PPTX export with 글꼴 포함: which fonts went in and which could not (no file here, licence, WOFF2 / variable). */
export function exportFontNotice(r: { missingFonts: string[]; embedded: string[] } | void): string | null {
  if (!r || (!r.missingFonts.length && !r.embedded.length)) return null;
  const ok = r.embedded.length ? `글꼴 ${r.embedded.length}개를 파일에 넣었습니다. ` : '';
  const miss = r.missingFonts.length ? `넣지 못한 글꼴: ${r.missingFonts.slice(0, 5).join(', ')}${r.missingFonts.length > 5 ? ` 외 ${r.missingFonts.length - 5}개` : ''} (글꼴 파일이 없거나, 저작권상 허용되지 않거나, 지원하지 않는 형식입니다. 글꼴 가져오기로 파일을 추가하세요.)` : '';
  return ok + miss;
}
