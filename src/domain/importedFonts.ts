// Fonts a person imports from files (.ttf .otf .woff .woff2 .ttc): kept in the media store (IndexedDB, own
// "impfont:" keys), registered with FontFace so every window (editor, audience / output, stage) draws in
// them, and handed to the .lcast file and the PPTX export. Weights of one family group under one family
// name because each face is registered with its own weight / style descriptors. Nothing here throws.
import { getMedia, putMedia, deleteMedia } from './media';
import { parseFontFile, cssWeightDescriptor, embeddingForbidden, woffToSfnt, type FontFileFormat, type ParsedFont } from './fontFile';
import { usedFamilies, type FontStyle } from './io/pptxFonts';
import type { NativeFont } from './io/lcastFile';
import { sha256Hex, type CloudFont } from './fontSync';

export interface ImportedFont {
  id: string;
  family: string;
  subfamily: string;
  weight: number;
  weightRange?: [number, number];
  italic: boolean;
  format: FontFileFormat;
  bytes: number;
  fsType: number;
  /** 'user' = imported from a font file; anything else names the .pptx it came from. */
  source: string;
  at: number;
  /** SHA-256 of the file (hex): the same bytes are one entry in the church cloud. Older entries get it at their first sync. */
  hash?: string;
  /** This font's own cloud-sync switch; undefined = the default (fonts the person imported: on; deck fonts: only when a synced deck uses them). */
  sync?: boolean;
  /** The person confirmed sharing it although its licence (fsType) forbids embedding. */
  allowRestricted?: boolean;
}

const INDEX_KEY = 'impfont:index';
const CHANNEL = 'lightcast-fonts';
/** All imported fonts together stay under this; one import takes at most this many files. */
export const MAX_IMPORTED_BYTES = 200 * 1024 * 1024;
export const MAX_FILES_PER_IMPORT = 40;
/** A deck carries at most this many font files / bytes inside a .lcast file. */
export const MAX_LCAST_FONTS = 24;
export const MAX_LCAST_FONT_BYTES = 48 * 1024 * 1024;

export const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.woff', '.woff2'];
export const FONT_ACCEPT = FONT_EXTENSIONS.join(',');
export const isFontFileName = (name: string): boolean => FONT_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e));

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ── Pure helpers (tested without a browser) ────────────────────────────────────────────────────
/** The FontFace descriptors of a stored font: weight ("700" or "100 900") and style. */
export function faceDescriptors(f: Pick<ImportedFont, 'weight' | 'weightRange' | 'italic'>): { weight: string; style: string } {
  return { weight: cssWeightDescriptor(f), style: f.italic ? 'italic' : 'normal' };
}

/** The weights (100 … 900) a family has among `list`; a variable font covers its whole range. */
export function familyWeights(list: ImportedFont[], family: string): number[] {
  const set = new Set<number>();
  for (const f of list) {
    if (!same(f.family, family)) continue;
    if (f.weightRange) for (let w = f.weightRange[0]; w <= f.weightRange[1]; w += 100) set.add(w);
    else set.add(f.weight);
  }
  return [...set].sort((a, b) => a - b);
}

export interface FontFamilyGroup { family: string; fonts: ImportedFont[]; weights: number[]; bytes: number; sources: string[] }

/** The list grouped by family (sorted by name), each family with its weights. */
export function groupFamilies(list: ImportedFont[]): FontFamilyGroup[] {
  const map = new Map<string, FontFamilyGroup>();
  for (const f of list) {
    const key = f.family.toLowerCase();
    const g = map.get(key) ?? { family: f.family, fonts: [], weights: [], bytes: 0, sources: [] };
    g.fonts.push(f);
    g.bytes += f.bytes;
    if (!g.sources.includes(f.source)) g.sources.push(f.source);
    map.set(key, g);
  }
  const out = [...map.values()];
  for (const g of out) { g.weights = familyWeights(g.fonts, g.family); g.fonts.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)); }
  return out.sort((a, b) => a.family.localeCompare(b.family, 'ko'));
}

/** Add a font to an index: one already there with the same family, weight and style is replaced (returned as `replaced`). */
export function mergeFont(list: ImportedFont[], add: ImportedFont): { list: ImportedFont[]; replaced?: ImportedFont } {
  const old = list.find((x) => same(x.family, add.family) && x.weight === add.weight && x.italic === add.italic && x.source === add.source);
  return { list: [...list.filter((x) => x !== old), add], replaced: old };
}

/** Oldest first until the total fits `max` bytes (the newest font always stays). */
export function trimToBudget(list: ImportedFont[], max = MAX_IMPORTED_BYTES): { keep: ImportedFont[]; drop: ImportedFont[] } {
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const drop: ImportedFont[] = [];
  let total = sorted.reduce((s, x) => s + x.bytes, 0);
  while (total > max && sorted.length > 1) { const x = sorted.shift()!; total -= x.bytes; drop.push(x); }
  return { keep: sorted, drop };
}

/** The PPTX embed slot (regular / bold / italic / boldItalic) a face best fills, or null for a face in no slot. */
export function embedStyleOf(f: Pick<ImportedFont, 'weight' | 'italic'>): FontStyle | null {
  if (f.weight === 400) return f.italic ? 'italic' : 'regular';
  if (f.weight === 700) return f.italic ? 'boldItalic' : 'bold';
  return null;
}

// ── Registry ───────────────────────────────────────────────────────────────────────────────────
let cache: ImportedFont[] = [];
const listeners = new Set<() => void>();
const registered = new Map<string, FontFace>();
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => { const p = chain.then(f, f); chain = p.catch(() => undefined); return p; };

const notify = () => listeners.forEach((l) => { try { l(); } catch { /* a listener must not break the others */ } });
/** Call `cb` whenever the imported list changes (add / remove / another window). Returns the unsubscribe. */
export function subscribeImportedFonts(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
/** The imported fonts known in this window (kept in step by the functions below and by other windows). */
export const importedFonts = (): ImportedFont[] => cache;
export const importedFamilies = (): string[] => groupFamilies(cache).map((g) => g.family);

async function readIndex(): Promise<ImportedFont[]> {
  try {
    const b = await getMedia(INDEX_KEY);
    const list = b ? JSON.parse(await b.text()) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string' && typeof x.family === 'string') : [];
  } catch { return []; }
}
const writeIndex = async (list: ImportedFont[]) => { await putMedia(INDEX_KEY, new Blob([JSON.stringify(list)], { type: 'application/json' })); };

async function register(f: ImportedFont, data: ArrayBuffer): Promise<boolean> {
  if (registered.has(f.id)) return true;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
  try {
    const face = new FontFace(f.family, data, faceDescriptors(f));
    await face.load();
    document.fonts.add(face);
    registered.set(f.id, face);
    return true;
  } catch { return false; /* an unusable font file is simply not used */ }
}
function unregister(id: string) {
  const face = registered.get(id);
  if (face) { try { document.fonts.delete(face); } catch { /* ignore */ } registered.delete(id); }
}

let channel: BroadcastChannel | null = null;
function tell() {
  try { channel ??= typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null; channel?.postMessage('changed'); } catch { /* other windows read it at their next start */ }
}
let listening = false;
function listen() {
  if (listening || typeof BroadcastChannel === 'undefined') return;
  listening = true;
  try { const ch = new BroadcastChannel(CHANNEL); ch.onmessage = () => { void registerImportedFonts(); }; } catch { /* no cross-window refresh */ }
}

/** On start-up (and when another window changed the list): register every kept font, drop the removed ones. */
export async function registerImportedFonts(): Promise<void> {
  listen();
  try {
    const list = await readIndex();
    const ids = new Set(list.map((x) => x.id));
    for (const id of [...registered.keys()]) if (!ids.has(id)) unregister(id);
    cache = list;
    for (const f of list) {
      if (registered.has(f.id)) continue;
      const b = await getMedia(f.id).catch(() => undefined);
      if (b) await register(f, await b.arrayBuffer());
    }
  } catch { /* fonts are optional */ }
  notify();
}

export interface ImportReport { added: ImportedFont[]; skipped: { name: string; reason: string }[]; notes: string[] }

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const mime = (f: FontFileFormat) => (f === 'opentype' ? 'font/otf' : f === 'woff' ? 'font/woff' : f === 'woff2' ? 'font/woff2' : 'font/ttf');

/** Store and register parsed faces (a face the browser cannot load is reported as skipped, not kept). */
export async function keepParsedFonts(parsed: { face: ParsedFont; fileName: string }[], source = 'user'): Promise<ImportReport> {
  return serial(async () => {
    const report: ImportReport = { added: [], skipped: [], notes: [] };
    let list = await readIndex();
    for (const { face, fileName } of parsed) {
      try {
        const id = `impfont:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const font: ImportedFont = { id, family: face.family, subfamily: face.subfamily, weight: face.weight, weightRange: face.weightRange, italic: face.italic, format: face.format, bytes: face.data.length, fsType: face.fsType, source, at: Date.now() };
        const buf = toArrayBuffer(face.data);
        try { font.hash = await sha256Hex(buf); } catch { /* hashed at the first sync instead */ }
        if (!(await register(font, buf))) { report.skipped.push({ name: fileName, reason: '브라우저가 이 글꼴을 읽지 못했습니다.' }); continue; }
        await putMedia(id, new Blob([buf], { type: mime(face.format) }));
        const merged = mergeFont(list, font);
        list = merged.list;
        if (merged.replaced) { unregister(merged.replaced.id); await deleteMedia(merged.replaced.id).catch(() => undefined); }
        report.added.push(font);
        if (face.nameFromFile) report.notes.push(`${fileName}: 글꼴 이름을 파일 이름에서 가져왔습니다(${face.family}).`);
        if (embeddingForbidden(face.fsType)) report.notes.push(`${face.family}: 저작권상 문서에 포함할 수 없는 글꼴이라 PPTX·LightCast 파일에는 넣지 않습니다.`);
      } catch { report.skipped.push({ name: fileName, reason: '저장하지 못했습니다(저장 공간 확인).' }); }
    }
    const { keep, drop } = trimToBudget(list);
    for (const d of drop) { unregister(d.id); await deleteMedia(d.id).catch(() => undefined); report.notes.push(`공간이 부족해 오래된 글꼴을 지웠습니다: ${d.family}`); }
    list = keep;
    await writeIndex(list).catch(() => undefined);
    cache = list;
    notify();
    tell();
    return report;
  });
}

/** Import font files (a file picker's or a drop's): parse, store, register. Several at once. */
export async function importFontFiles(files: File[]): Promise<ImportReport> {
  const parsed: { face: ParsedFont; fileName: string }[] = [];
  const skipped: ImportReport['skipped'] = [];
  for (const file of files.slice(0, MAX_FILES_PER_IMPORT)) {
    if (!isFontFileName(file.name)) { skipped.push({ name: file.name, reason: '글꼴 파일이 아닙니다.' }); continue; }
    try {
      const res = await parseFontFile(new Uint8Array(await file.arrayBuffer()), file.name);
      if (!res.faces.length) skipped.push({ name: file.name, reason: res.error ?? '읽지 못했습니다.' });
      for (const face of res.faces) parsed.push({ face, fileName: file.name });
    } catch { skipped.push({ name: file.name, reason: '읽지 못했습니다.' }); }
  }
  if (files.length > MAX_FILES_PER_IMPORT) skipped.push({ name: `${files.length - MAX_FILES_PER_IMPORT}개`, reason: `한 번에 ${MAX_FILES_PER_IMPORT}개까지 가져옵니다.` });
  const report = await keepParsedFonts(parsed);
  report.skipped.unshift(...skipped);
  return report;
}

/** A one-line Korean summary of an import for a toast. */
export function importSummary(r: ImportReport): string {
  const fams = [...new Set(r.added.map((f) => f.family))];
  const head = r.added.length ? `글꼴 ${fams.length}개(${r.added.length}개 파일)를 가져왔습니다: ${fams.slice(0, 3).join(', ')}${fams.length > 3 ? ' 외' : ''}.` : '가져온 글꼴이 없습니다.';
  const skip = r.skipped.length ? ` 건너뜀 ${r.skipped.length}개: ${r.skipped.slice(0, 2).map((s) => `${s.name}(${s.reason})`).join(', ')}${r.skipped.length > 2 ? ' 외' : ''}` : '';
  return head + skip;
}

/** Remove one imported font (all of a family when `family` is given). */
export async function removeImportedFonts(match: { id?: string; family?: string }): Promise<number> {
  return serial(async () => {
    const list = await readIndex();
    const gone = list.filter((x) => (match.id ? x.id === match.id : match.family ? same(x.family, match.family) : false));
    for (const g of gone) { unregister(g.id); await deleteMedia(g.id).catch(() => undefined); }
    const rest = list.filter((x) => !gone.includes(x));
    await writeIndex(rest).catch(() => undefined);
    cache = rest;
    notify();
    if (gone.length) tell();
    return gone.length;
  });
}

/** The stored bytes of an imported font (null when gone). */
export async function importedFontBytes(f: ImportedFont): Promise<Uint8Array | null> {
  try { const b = await getMedia(f.id); return b ? new Uint8Array(await b.arrayBuffer()) : null; } catch { return null; }
}

/** Sfnt bytes of an imported font for PowerPoint (WOFF is unwrapped; WOFF2 and variable fonts cannot be given). */
export async function importedSfnt(f: ImportedFont): Promise<Uint8Array | null> {
  if (f.weightRange && f.weightRange[0] !== f.weightRange[1]) return null;
  const b = await importedFontBytes(f);
  if (!b) return null;
  if (f.format === 'woff') return woffToSfnt(b);
  return f.format === 'woff2' ? null : b;
}

// ── Fonts a deck needs (opening a deck, .lcast) ───────────────────────────────────────────────
/** Is a font of this family usable here: one of LightCast's own, an imported one, or installed on the computer? */
export function fontAvailable(family: string, ownFamilies: string[] = []): boolean {
  const name = family.trim();
  if (!name) return true;
  if (ownFamilies.some((x) => same(x, name)) || importedFamilies().some((x) => same(x, name))) return true;
  try {
    if (typeof document === 'undefined') return true;
    if (document.fonts?.check(`12px "${name.replace(/"/g, '')}"`) && [...document.fonts].some((f) => same(f.family.replace(/["']/g, ''), name))) return true;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return true;
    const sample = 'mmmmmmmmmlli가나다WQ@';
    const width = (font: string) => { ctx.font = `32px ${font}`; return ctx.measureText(sample).width; };
    return ['monospace', 'serif', 'sans-serif'].some((g) => width(`"${name.replace(/"/g, '')}", ${g}`) !== width(g));
  } catch { return true; }
}

/** The generic names and bundled families that never need importing. */
export const NEVER_MISSING = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|arial|calibri|inter|helvetica|georgia|times new roman|courier new|맑은 고딕|malgun gothic|apple sd gothic neo|nanum gothic|나눔고딕|nanum myeongjo)$/i;

/** Families a deck uses that this computer cannot draw (for the "import it" notice). */
export function missingFamilies(used: string[], ownFamilies: string[] = []): string[] {
  return used.filter((f) => !NEVER_MISSING.test(f) && !fontAvailable(f, ownFamilies));
}

/** The imported font files the families of `deck` use, for a .lcast file (fonts whose licence forbids embedding stay out). */
export async function collectDeckFonts(deck: unknown): Promise<NativeFont[]> {
  const out: NativeFont[] = [];
  try {
    const used = usedFamilies(deck);
    for (const f of importedFonts()) {
      if (!used.some((u) => same(u, f.family)) || embeddingForbidden(f.fsType)) continue;
      const bytes = await importedFontBytes(f);
      if (bytes) out.push({ family: f.family, subfamily: f.subfamily, weight: f.weight, weightRange: f.weightRange, italic: f.italic, format: f.format, bytes });
    }
  } catch { /* the file is saved without fonts */ }
  return out;
}

/** Fonts that came inside an opened .lcast file: kept like imported ones (a family already imported is left alone). */
export async function restoreNativeFonts(fonts: NativeFont[], source: string): Promise<number> {
  const have = (f: NativeFont) => importedFonts().some((x) => same(x.family, f.family) && x.weight === f.weight && x.italic === f.italic);
  const fresh = fonts.filter((f) => !have(f));
  if (!fresh.length) return 0;
  const res = await keepParsedFonts(fresh.map((f) => ({
    fileName: f.family,
    face: { family: f.family, subfamily: f.subfamily, fullName: f.family, weight: f.weight, weightRange: f.weightRange, italic: f.italic, fsType: 0, format: f.format, nameFromFile: false, data: f.bytes },
  })), source);
  return res.added.length;
}

// ── Cloud sync of imported fonts (the plan itself is in fontSync.ts) ───────────────────────────
/** Change a few fields of one stored font (its hash, its sync switch). */
export async function updateImportedFont(id: string, patch: Partial<ImportedFont>): Promise<void> {
  return serial(async () => {
    const list = await readIndex();
    const next = list.map((x) => (x.id === id ? { ...x, ...patch } : x));
    for (const [k, v] of Object.entries(patch)) if (v === undefined) for (const x of next) if (x.id === id) delete (x as unknown as Record<string, unknown>)[k];
    await writeIndex(next).catch(() => undefined);
    cache = next;
    notify();
  });
}

/** Keep a font that came from the church cloud (already checked against its hash): stored and registered like an imported one. */
export async function addCloudFont(entry: CloudFont, data: ArrayBuffer): Promise<boolean> {
  return serial(async () => {
    const list = await readIndex();
    const hash = entry.id.slice('font-'.length);
    if (list.some((x) => x.hash === hash)) return true;
    const id = `impfont:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const font: ImportedFont = { id, family: entry.family, subfamily: entry.subfamily, weight: entry.weight, weightRange: entry.weightRange, italic: entry.italic, format: entry.format, bytes: data.byteLength, fsType: entry.fsType, source: entry.source, at: Date.now(), hash, ...(entry.restrictedOk ? { allowRestricted: true } : {}) };
    try {
      if (!(await register(font, data))) return false;
      await putMedia(id, new Blob([data], { type: mime(entry.format) }));
      const next = [...list, font];
      await writeIndex(next);
      cache = next;
      notify();
      tell();
      return true;
    } catch { unregister(id); await deleteMedia(id).catch(() => undefined); return false; }
  });
}

/** Re-read the stored list (after a change made by sync). */
export async function refreshImportedFonts(): Promise<ImportedFont[]> {
  const list = await readIndex();
  cache = list;
  return list;
}
