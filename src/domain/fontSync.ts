// Imported fonts follow the church cloud like other media. Pure logic (no network, no browser): content
// hashing, the plan of what to upload / download / remove, and the sync settings. The font files travel as
// ordinary cloud media under the id "font-<sha256>" (same bytes = same entry), and the list of them (with the
// parsed family / weight / style / fsType) is `Library.fonts`, merged three-way like every other library list,
// so a removal on one computer reaches the others with the same "untouched side yields" rule as media.
import type { ImportedFont } from './importedFonts';
import { embeddingForbidden } from './fontFile';

/** One font in the church library (the file itself is the cloud media `id`). */
export interface CloudFont {
  /** "font-<sha256 hex of the file>" — also the cloud media id. */
  id: string;
  family: string;
  subfamily: string;
  weight: number;
  weightRange?: [number, number];
  italic: boolean;
  format: ImportedFont['format'];
  bytes: number;
  fsType: number;
  /** Where it came from on the computer that shared it ('user' or the .pptx name). */
  source: string;
  at: number;
  /** The person confirmed sharing a font whose licence forbids embedding. */
  restrictedOk?: boolean;
}

export const CLOUD_FONT_PREFIX = 'font-';
export const isCloudFontId = (id: string): boolean => id.startsWith(CLOUD_FONT_PREFIX);
export const cloudFontId = (hash: string): string => `${CLOUD_FONT_PREFIX}${hash}`;
/** One font file at most this big goes to the cloud; all synced fonts together stay under the total. */
export const MAX_CLOUD_FONT_BYTES = 30 * 1024 * 1024;
export const MAX_CLOUD_FONTS_TOTAL = 100 * 1024 * 1024;
/** Fonts never take the last 5 % of the server's quota. */
export const QUOTA_RESERVE = 0.05;
/** Same as the local budget in importedFonts.ts (kept here so this file stays free of runtime imports). */
const LOCAL_BUDGET = 200 * 1024 * 1024;

export interface FontSyncSettings {
  /** Master switch: off = nothing is sent or received. */
  enabled: boolean;
  /** Also share fonts that came from a .pptx / .lcast file (default: only those a synced deck uses). */
  includeDeckFonts: boolean;
}
export const DEFAULT_FONT_SYNC: FontSyncSettings = { enabled: true, includeDeckFonts: false };
const SETTINGS_KEY = 'lightcast.fontSync';
export const FONT_SYNC_EVENT = 'lightcast-fontsync';

export function loadFontSyncSettings(): FontSyncSettings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return { enabled: v?.enabled !== false, includeDeckFonts: v?.includeDeckFonts === true };
  } catch { return { ...DEFAULT_FONT_SYNC }; }
}
export function saveFontSyncSettings(s: FontSyncSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* kept for this window only */ }
  try { window.dispatchEvent(new Event(FONT_SYNC_EVENT)); } catch { /* no window */ }
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buf = data instanceof Uint8Array ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const lower = (s: string) => s.trim().toLowerCase();

/** Does this font go to the cloud? Its own switch wins; otherwise fonts the person imported do, deck fonts only when a synced deck uses them. */
export function wantsSync(f: Pick<ImportedFont, 'sync' | 'source' | 'family'>, settings: FontSyncSettings, used: Set<string>): boolean {
  if (typeof f.sync === 'boolean') return f.sync;
  if (f.source === 'user') return true;
  return settings.includeDeckFonts || used.has(lower(f.family));
}

export type SkipReason = 'restricted' | 'too-big' | 'quota' | 'missing-file' | 'local-space' | 'same-face';
export const SKIP_LABEL: Record<SkipReason, string> = {
  restricted: '저작권상 공유할 수 없는 글꼴이라 올리지 않았습니다',
  'too-big': `파일이 ${MAX_CLOUD_FONT_BYTES / 1048576}MB보다 커서 올리지 않았습니다`,
  quota: '서버 저장공간이 부족해 올리지 않았습니다',
  'missing-file': '서버에 파일이 아직 없어 다음에 다시 받습니다',
  'local-space': '이 컴퓨터의 글꼴 저장 한도를 넘어 받지 않았습니다',
  'same-face': '같은 글꼴·굵기가 이미 있어 받지 않았습니다',
};

export interface FontPlan {
  /** Fonts whose file hash is not known yet (compute it and plan again). */
  hashNeeded: ImportedFont[];
  /** The new `Library.fonts`. */
  manifest: CloudFont[];
  upload: { font: ImportedFont; entry: CloudFont }[];
  download: CloudFont[];
  removeLocal: ImportedFont[];
  /** Cloud files of fonts this computer removed. */
  removeCloud: string[];
  /** Hashes this computer has seen in the library (a font that later disappears from it was removed elsewhere). */
  known: Set<string>;
  skipped: { family: string; reason: SkipReason }[];
}

const faceKey = (f: Pick<ImportedFont, 'family' | 'weight' | 'italic'>) => `${lower(f.family)}|${f.weight}|${f.italic ? 1 : 0}`;

export interface PlanInput {
  local: ImportedFont[];
  manifest: CloudFont[];
  /** Ids of the files on the server. */
  remoteIds: Set<string>;
  known: Set<string>;
  settings: FontSyncSettings;
  /** Lower-cased families used by the synced decks. */
  used: Set<string>;
  /** Bytes still free on the server (null = unknown: only the fixed caps apply). */
  freeBytes: number | null;
}

/**
 * What to do so this computer and the library hold the same fonts. Idempotent: planning again after the plan
 * was carried out gives an empty plan; a half-done plan (offline, a file that would not go) is simply planned again.
 */
export function planFontSync(input: PlanInput): FontPlan {
  const { local, settings } = input;
  const known = new Set(input.known);
  const plan: FontPlan = { hashNeeded: [], manifest: input.manifest.slice(), upload: [], download: [], removeLocal: [], removeCloud: [], known, skipped: [] };
  if (!settings.enabled) return plan;
  plan.hashNeeded = local.filter((f) => !f.hash && wantsSync(f, settings, input.used));
  if (plan.hashNeeded.length) return plan;
  const inManifest = new Map(plan.manifest.map((e) => [e.id, e]));
  const byHash = new Map<string, ImportedFont>();
  let total = plan.manifest.reduce((s, e) => s + e.bytes, 0);
  let free = input.freeBytes;
  const fits = (f: ImportedFont): SkipReason | null => {
    if (embeddingForbidden(f.fsType) && !f.allowRestricted) return 'restricted';
    if (f.bytes > MAX_CLOUD_FONT_BYTES) return 'too-big';
    if (total + f.bytes > MAX_CLOUD_FONTS_TOTAL || (free !== null && f.bytes > free)) return 'quota';
    return null;
  };
  for (const f of local) {
    if (!f.hash || byHash.has(f.hash)) continue; // the same bytes twice are one entry
    byHash.set(f.hash, f);
    const id = cloudFontId(f.hash);
    const listed = inManifest.get(id);
    if (known.has(id) && !listed) {
      // It was in the library and is not any more: removed on another computer (unless this font opted out).
      if (f.sync !== false) { plan.removeLocal.push(f); known.delete(id); }
      continue;
    }
    if (!wantsSync(f, settings, input.used)) continue;
    if (listed && input.remoteIds.has(id)) { known.add(id); continue; }
    const why = fits(f);
    if (why) { plan.skipped.push({ family: f.family, reason: why }); continue; }
    const entry: CloudFont = listed ?? {
      id, family: f.family, subfamily: f.subfamily, weight: f.weight, ...(f.weightRange ? { weightRange: f.weightRange } : {}), italic: f.italic,
      format: f.format, bytes: f.bytes, fsType: f.fsType, source: f.source, at: f.at, ...(f.allowRestricted ? { restrictedOk: true } : {}),
    };
    if (!listed) { plan.manifest.push(entry); inManifest.set(id, entry); }
    total += f.bytes;
    if (free !== null) free -= f.bytes;
    plan.upload.push({ font: f, entry });
    known.add(id);
  }
  const faces = new Set(local.map(faceKey));
  let localBytes = local.reduce((s, f) => s + f.bytes, 0);
  for (const e of input.manifest) {
    const hash = e.id.slice(CLOUD_FONT_PREFIX.length);
    if (byHash.has(hash)) continue;
    if (known.has(e.id)) {
      // Seen before, not on this computer now: it was removed here. Take it out of the library and the cloud.
      plan.manifest = plan.manifest.filter((x) => x.id !== e.id);
      plan.removeCloud.push(e.id);
      known.delete(e.id);
      continue;
    }
    if (faces.has(faceKey(e))) { plan.skipped.push({ family: e.family, reason: 'same-face' }); continue; }
    if (!input.remoteIds.has(e.id)) { plan.skipped.push({ family: e.family, reason: 'missing-file' }); continue; }
    if (localBytes + e.bytes > LOCAL_BUDGET) { plan.skipped.push({ family: e.family, reason: 'local-space' }); continue; }
    localBytes += e.bytes;
    faces.add(faceKey(e));
    plan.download.push(e);
  }
  return plan;
}

// ── Running a plan (the cloud and the font store are passed in, so tests use fakes) ─────────────
export interface FontCloudApi {
  list(): Promise<{ id: string; size: number }[]>;
  upload(id: string, blob: Blob): Promise<void>;
  download(id: string): Promise<Blob>;
  remove(id: string): Promise<void>;
}
export interface FontStoreApi {
  list(): ImportedFont[];
  bytes(f: ImportedFont): Promise<Uint8Array | null>;
  setFields(id: string, patch: Partial<ImportedFont>): Promise<void>;
  add(entry: CloudFont, bytes: ArrayBuffer): Promise<boolean>;
  remove(id: string): Promise<void>;
  loadKnown(): Promise<Set<string>>;
  saveKnown(known: Set<string>): Promise<void>;
}
export interface FontSyncReport {
  uploaded: number; downloaded: number; removedHere: number; removedCloud: number;
  failed: string[]; skipped: { family: string; reason: SkipReason }[];
  /** Fonts still waiting (a failed transfer or no room). */
  waiting: number;
  at: number;
}
const isFatal = (e: unknown) => { const x = e as { status?: number; network?: boolean }; return x?.status === 401 || x?.network === true; };

/**
 * One round of font sync. Returns the new `Library.fonts` (undefined = unchanged) and a report. A lost connection or
 * an expired login throws (the caller retries later); one file that fails is listed in `failed` and tried again next time.
 */
export async function runFontSync(
  deps: { cloud: FontCloudApi; store: FontStoreApi },
  input: { manifest: CloudFont[]; settings: FontSyncSettings; used: Set<string>; freeBytes: number | null; remote?: { id: string; size: number }[]; sha?: typeof sha256Hex },
  onProgress: (msg: string) => void = () => undefined,
): Promise<{ manifest: CloudFont[] | undefined; report: FontSyncReport }> {
  const { cloud, store } = deps;
  const sha = input.sha ?? sha256Hex;
  const report: FontSyncReport = { uploaded: 0, downloaded: 0, removedHere: 0, removedCloud: 0, failed: [], skipped: [], waiting: 0, at: Date.now() };
  if (!input.settings.enabled) return { manifest: undefined, report };
  const remote = input.remote ?? await cloud.list();
  const remoteIds = new Set(remote.map((m) => m.id));
  const known = await store.loadKnown();
  let local = store.list();
  const pick = (): FontPlan => planFontSync({ local, manifest: input.manifest, remoteIds, known, settings: input.settings, used: input.used, freeBytes: input.freeBytes });
  let plan = pick();
  if (plan.hashNeeded.length) {
    for (const f of plan.hashNeeded) {
      const b = await store.bytes(f);
      if (b) await store.setFields(f.id, { hash: await sha(b) });
    }
    local = store.list();
    plan = pick();
  }
  report.skipped = plan.skipped;
  await store.saveKnown(plan.known);
  const doneKnown = new Set(plan.known);
  for (const { font, entry } of plan.upload) {
    try {
      const b = await store.bytes(font);
      if (!b) { report.failed.push(font.family); continue; }
      onProgress(`글꼴 올리는 중: ${font.family}`);
      await cloud.upload(entry.id, new Blob([b as BlobPart], { type: 'application/octet-stream' }));
      report.uploaded++;
    } catch (e) {
      if (isFatal(e)) throw e;
      report.failed.push(font.family);
    }
  }
  for (const entry of plan.download) {
    try {
      onProgress(`글꼴 받는 중: ${entry.family}`);
      const blob = await cloud.download(entry.id);
      const data = await blob.arrayBuffer();
      if (cloudFontId(await sha(data)) !== entry.id) { report.failed.push(entry.family); continue; }
      if (await store.add(entry, data)) { doneKnown.add(entry.id); report.downloaded++; } else report.failed.push(entry.family);
    } catch (e) {
      if (isFatal(e)) throw e;
      report.failed.push(entry.family);
    }
  }
  for (const f of plan.removeLocal) { await store.remove(f.id); report.removedHere++; }
  for (const id of plan.removeCloud) {
    try { await cloud.remove(id); report.removedCloud++; } catch (e) { if (isFatal(e)) throw e; /* stays listed under "서버 글꼴" for a manual delete */ }
  }
  await store.saveKnown(doneKnown);
  report.waiting = report.failed.length + report.skipped.filter((s) => s.reason === 'missing-file').length;
  const changed = JSON.stringify(plan.manifest) !== JSON.stringify(input.manifest);
  return { manifest: changed ? plan.manifest : undefined, report };
}

/** The scope a "known" list belongs to: another account or a server reset starts it over. */
export const fontKnownScope = (username: string, resetId: string | undefined): string => `${username}|${resetId ?? ''}`;

/** Bytes a server delete of fonts frees, for the panel. */
export const totalFontBytes = (list: { bytes: number }[]): number => list.reduce((s, f) => s + f.bytes, 0);

/** Server free space for the plan from the usage numbers (null when unknown). */
export function freeBytesOf(server: { usedBytes: number; limitBytes: number } | undefined | null): number | null {
  if (!server) return null;
  return Math.max(0, server.limitBytes * (1 - QUOTA_RESERVE) - server.usedBytes);
}

/** One line for the sync status. */
export function describeFontReport(r: FontSyncReport): string {
  const parts = [r.uploaded && `올림 ${r.uploaded}`, r.downloaded && `받음 ${r.downloaded}`, r.removedHere && `다른 기기에서 지워 이 컴퓨터에서도 지움 ${r.removedHere}`, r.removedCloud && `서버에서 지움 ${r.removedCloud}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '변경 없음';
}
