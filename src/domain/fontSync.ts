// Imported fonts follow the church cloud like other media. Pure logic (no network, no browser): content
// hashing, the plan of what to upload / download / remove, and the sync settings. The font files travel as
// ordinary cloud media under the id "font-<sha256>" (same bytes = same entry), and the list of them (with the
// parsed family / weight / style / fsType) is `Library.fonts`, merged three-way like every other library list,
// so a removal on one computer reaches the others with the same "untouched side yields" rule as media.
import type { ImportedFont } from './importedFonts';
import { embeddingForbidden } from './fontFile';
import { reconcilePrefs, type FontPrefs } from './fontPrefs';
import { addToFontTrash, expiredFontFiles, pruneFontTrash, type CloudFontTrash } from './fontTrash';

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
  /** The file came out of an imported .pptx (the "embfont:" store); other computers keep it in their deck-font store too. */
  embedded?: true;
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
  /** When the switches were last changed on any computer (0 / missing = never): the later change wins across computers. */
  at?: number;
}
export const DEFAULT_FONT_SYNC: FontSyncSettings = { enabled: true, includeDeckFonts: false };
const SETTINGS_KEY = 'lightcast.fontSync';
export const FONT_SYNC_EVENT = 'lightcast-fontsync';

export function loadFontSyncSettings(): FontSyncSettings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return { enabled: v?.enabled !== false, includeDeckFonts: v?.includeDeckFonts === true, at: Number.isFinite(v?.at) ? v.at : 0 };
  } catch { return { ...DEFAULT_FONT_SYNC }; }
}
/** Save the switches. A change made by the person is stamped with the time (so it wins over older ones on other computers); one taken over from the account keeps the account's stamp (`stamp: false`). */
export function saveFontSyncSettings(s: FontSyncSettings, stamp = true): void {
  const value = stamp ? { ...s, at: Date.now() } : s;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* kept for this window only */ }
  try { window.dispatchEvent(new Event(FONT_SYNC_EVENT)); } catch { /* no window */ }
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buf = data instanceof Uint8Array ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Does this font go to the cloud? Its own switch wins; otherwise fonts the person imported and fonts downloaded from the
 * internet for a deck ("web:…", open licence) do, deck fonts only when a synced deck uses them.
 */
export function wantsSync(f: Pick<ImportedFont, 'sync' | 'source' | 'family'>, settings: FontSyncSettings, used: Set<string>): boolean {
  if (typeof f.sync === 'boolean') return f.sync;
  if (f.source === 'user' || f.source.startsWith('web:')) return true;
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

const faceKey = (f: Pick<ImportedFont, 'family' | 'weight' | 'italic'>) => `${lower(f.family)}|${f.weight}|${f.italic ? 1 : 0}`;
export { faceKey as fontFaceKey };

// ── Two different files for one family / weight / style ─────────────────────────────────────────
/**
 * Which of two versions of the same face the church keeps: the larger file (it usually has more glyphs), then the earlier
 * upload, then the smaller id. Both computers compute the same answer from the same two entries, so they converge.
 */
export function pickWinner(a: CloudFont, b: CloudFont): CloudFont {
  if (a.bytes !== b.bytes) return a.bytes > b.bytes ? a : b;
  if (a.at !== b.at) return a.at < b.at ? a : b;
  return a.id <= b.id ? a : b;
}

export interface FontConflict {
  family: string;
  weight: number;
  italic: boolean;
  /** The version the rule keeps. */
  winner: CloudFont;
  /** The other versions in the list (they stay in the cloud; "keep both" fetches one under a suffix). */
  others: CloudFont[];
  /** This computer has the winner. */
  holdsWinner: boolean;
  /** The other versions this computer has (ids). */
  holdsOthers: string[];
}

/** Every face the library lists with more than one file, with who wins. */
export function fontConflicts(manifest: CloudFont[], local: Pick<ImportedFont, 'hash'>[]): FontConflict[] {
  const held = new Set(local.flatMap((f) => (f.hash ? [cloudFontId(f.hash)] : [])));
  const groups = new Map<string, CloudFont[]>();
  for (const e of manifest) groups.set(faceKey(e), [...(groups.get(faceKey(e)) ?? []), e]);
  const out: FontConflict[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const winner = g.reduce(pickWinner);
    const others = g.filter((e) => e.id !== winner.id);
    out.push({ family: winner.family, weight: winner.weight, italic: winner.italic, winner, others, holdsWinner: held.has(winner.id), holdsOthers: others.filter((e) => held.has(e.id)).map((e) => e.id) });
  }
  return out;
}

/** The family name "keep both" gives the other version. */
export const KEEP_BOTH_SUFFIX = ' (다른 기기)';

export interface FontPlan {
  /** Fonts whose file hash is not known yet (compute it and plan again). */
  hashNeeded: ImportedFont[];
  /** The new `Library.fonts`. */
  manifest: CloudFont[];
  upload: { font: ImportedFont; entry: CloudFont }[];
  download: CloudFont[];
  /** Downloads that take the place of this computer's own versions of the same face (the conflict rule picked the other one). */
  replace: { winner: CloudFont; losers: ImportedFont[] }[];
  removeLocal: ImportedFont[];
  /** Entries this computer removed: they go to the font trash (the file stays on the server for the trash period). */
  toTrash: CloudFont[];
  /** Server files whose trash period is over. */
  purge: string[];
  /** The new `Library.fontTrash`. */
  trash: CloudFontTrash[];
  /** Faces with two different files in the library. */
  conflicts: FontConflict[];
  /** Hashes this computer has seen in the library (a font that later disappears from it was removed elsewhere). */
  known: Set<string>;
  skipped: { family: string; reason: SkipReason }[];
}

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
  /** The font trash of the library (default: empty). */
  trash?: CloudFontTrash[];
  now?: number;
}

/**
 * What to do so this computer and the library hold the same fonts. Idempotent: planning again after the plan
 * was carried out gives an empty plan; a half-done plan (offline, a file that would not go) is simply planned again.
 */
export function planFontSync(input: PlanInput): FontPlan {
  const { local, settings } = input;
  const now = input.now ?? Date.now();
  const known = new Set(input.known);
  const trash0 = input.trash ?? [];
  const plan: FontPlan = { hashNeeded: [], manifest: input.manifest.slice(), upload: [], download: [], replace: [], removeLocal: [], toTrash: [], purge: [], trash: trash0, conflicts: [], known, skipped: [] };
  if (!settings.enabled) return plan;
  plan.hashNeeded = local.filter((f) => !f.hash && wantsSync(f, settings, input.used));
  if (plan.hashNeeded.length) return plan;
  const inManifest = new Map(plan.manifest.map((e) => [e.id, e]));
  const trashed = new Set(trash0.map((t) => t.id));
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
    const entry: CloudFont = listed ?? {
      id, family: f.family, subfamily: f.subfamily, weight: f.weight, ...(f.weightRange ? { weightRange: f.weightRange } : {}), italic: f.italic,
      format: f.format, bytes: f.bytes, fsType: f.fsType, source: f.source, at: f.at, ...(f.allowRestricted ? { restrictedOk: true } : {}), ...(f.embedded ? { embedded: true as const } : {}),
    };
    if (!listed && trashed.has(id) && input.remoteIds.has(id)) {
      // The same file was in the trash and is still on the server: back in the list without sending it again.
      plan.manifest.push(entry); inManifest.set(id, entry); total += f.bytes; known.add(id);
      continue;
    }
    const why = fits(f);
    if (why) { plan.skipped.push({ family: f.family, reason: why }); continue; }
    if (!listed) { plan.manifest.push(entry); inManifest.set(id, entry); }
    total += f.bytes;
    if (free !== null) free -= f.bytes;
    plan.upload.push({ font: f, entry });
    known.add(id);
  }
  const faces = new Set(local.map(faceKey));
  const groups = new Map<string, CloudFont[]>();
  for (const e of input.manifest) groups.set(faceKey(e), [...(groups.get(faceKey(e)) ?? []), e]);
  let localBytes = local.reduce((s, f) => s + f.bytes, 0);
  for (const e of input.manifest) {
    const hash = e.id.slice(CLOUD_FONT_PREFIX.length);
    if (byHash.has(hash)) continue;
    if (known.has(e.id)) {
      // Seen before, not on this computer now: it was removed here. Out of the library, into the font trash (the file stays).
      plan.manifest = plan.manifest.filter((x) => x.id !== e.id);
      plan.toTrash.push(e);
      known.delete(e.id);
      continue;
    }
    const group = groups.get(faceKey(e)) ?? [e];
    // Two files for one face: only the rule's winner is fetched; the other stays in the cloud ("keep both" in the font manager fetches it).
    if (group.reduce(pickWinner).id !== e.id) continue;
    const groupIds = new Set(group.map((x) => x.id));
    const losers = group.length > 1
      ? local.filter((f) => f.hash && f.hash !== hash && faceKey(f) === faceKey(e) && groupIds.has(cloudFontId(f.hash)) && input.remoteIds.has(cloudFontId(f.hash)))
      : [];
    if (faces.has(faceKey(e)) && !losers.length) { plan.skipped.push({ family: e.family, reason: 'same-face' }); continue; }
    if (!input.remoteIds.has(e.id)) { plan.skipped.push({ family: e.family, reason: 'missing-file' }); continue; }
    const freed = losers.reduce((s, f) => s + f.bytes, 0);
    if (localBytes - freed + e.bytes > LOCAL_BUDGET) { plan.skipped.push({ family: e.family, reason: 'local-space' }); continue; }
    localBytes += e.bytes - freed;
    faces.add(faceKey(e));
    plan.download.push(e);
    if (losers.length) plan.replace.push({ winner: e, losers });
  }
  plan.conflicts = fontConflicts(plan.manifest, local);
  plan.purge = expiredFontFiles(trash0, plan.manifest, now);
  plan.trash = pruneFontTrash(addToFontTrash(trash0, plan.toTrash, now), plan.manifest, now);
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
  /** The imported fonts and the fonts that came inside .pptx files (those are `embedded`). */
  list(): ImportedFont[];
  bytes(f: ImportedFont): Promise<Uint8Array | null>;
  setFields(id: string, patch: Partial<ImportedFont>): Promise<void>;
  /** Keep a downloaded font (an `embedded` entry goes to the deck-font store). `familySuffix` renames it ("keep both"). */
  add(entry: CloudFont, bytes: ArrayBuffer, familySuffix?: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  loadKnown(): Promise<Set<string>>;
  saveKnown(known: Set<string>): Promise<void>;
}
export interface FontSyncReport {
  uploaded: number; downloaded: number; removedHere: number;
  /** Fonts moved to the font trash (removed on this computer). */
  trashed: number;
  /** Trashed fonts whose period ended and whose file was deleted from the server. */
  purged: number;
  /** Own versions replaced by the other version of the same face (the conflict rule). */
  replaced: { family: string; weight: number; italic: boolean }[];
  failed: string[]; skipped: { family: string; reason: SkipReason }[];
  /** Fonts still waiting (a failed transfer or no room). */
  waiting: number;
  at: number;
}
const isFatal = (e: unknown) => { const x = e as { status?: number; network?: boolean }; return x?.status === 401 || x?.network === true; };
const isGone = (e: unknown) => (e as { status?: number })?.status === 404;

export interface FontSyncOutcome {
  /** The new `Library.fonts` (undefined = unchanged). */
  manifest: CloudFont[] | undefined;
  /** The new `Library.fontTrash` (undefined = unchanged; an empty list = emptied). */
  trash: CloudFontTrash[] | undefined;
  /** The new `Library.fontPrefs` (undefined = unchanged). */
  prefs: FontPrefs | undefined;
  /** Switches taken over from the account: the caller saves them (without a new stamp). */
  settings: FontSyncSettings | undefined;
  conflicts: FontConflict[];
  report: FontSyncReport;
}

/**
 * One round of font sync. Returns the new library lists (undefined = unchanged) and a report. A lost connection or
 * an expired login throws (the caller retries later); one file that fails is listed in `failed` and tried again next time.
 */
export async function runFontSync(
  deps: { cloud: FontCloudApi; store: FontStoreApi },
  input: { manifest: CloudFont[]; settings: FontSyncSettings; used: Set<string>; freeBytes: number | null; remote?: { id: string; size: number }[]; sha?: typeof sha256Hex; trash?: CloudFontTrash[]; prefs?: FontPrefs; now?: number },
  onProgress: (msg: string) => void = () => undefined,
): Promise<FontSyncOutcome> {
  const { cloud, store } = deps;
  const sha = input.sha ?? sha256Hex;
  const now = input.now ?? Date.now();
  const report: FontSyncReport = { uploaded: 0, downloaded: 0, removedHere: 0, trashed: 0, purged: 0, replaced: [], failed: [], skipped: [], waiting: 0, at: now };
  // The switches first: a newer change from another computer decides what this round does.
  let settings = input.settings;
  let local = store.list();
  const rec = reconcilePrefs({ global: settings, fonts: local }, input.prefs);
  let takenOver: FontSyncSettings | undefined;
  if (rec.globalFromAccount) { settings = { enabled: rec.global.enabled, includeDeckFonts: rec.global.includeDeckFonts, at: rec.global.at }; takenOver = settings; }
  for (const a of rec.apply) for (const f of local.filter((x) => x.hash === a.hash)) await store.setFields(f.id, { sync: a.sync, syncAt: a.at });
  if (rec.apply.length) local = store.list();
  const prefsChanged = JSON.stringify(rec.prefs) !== JSON.stringify(input.prefs);
  const out = (o: Partial<FontSyncOutcome>): FontSyncOutcome => ({ manifest: undefined, trash: undefined, prefs: prefsChanged ? rec.prefs : undefined, settings: takenOver, conflicts: [], report, ...o });
  if (!settings.enabled) return out({});
  const remote = input.remote ?? await cloud.list();
  const remoteIds = new Set(remote.map((m) => m.id));
  const known = await store.loadKnown();
  const pick = (): FontPlan => planFontSync({ local, manifest: input.manifest, remoteIds, known, settings, used: input.used, freeBytes: input.freeBytes, trash: input.trash, now });
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
      if (!(await store.add(entry, data))) { report.failed.push(entry.family); continue; }
      doneKnown.add(entry.id); report.downloaded++;
      // The conflict rule chose this version: this computer's own versions of the face make room (they stay in the cloud).
      for (const r of plan.replace.filter((x) => x.winner.id === entry.id)) {
        for (const loser of r.losers) {
          await store.remove(loser.id);
          if (loser.hash) doneKnown.delete(cloudFontId(loser.hash)); // not "removed here": the library keeps it
        }
        report.replaced.push({ family: entry.family, weight: entry.weight, italic: entry.italic });
      }
    } catch (e) {
      if (isFatal(e)) throw e;
      report.failed.push(entry.family);
    }
  }
  for (const f of plan.removeLocal) { await store.remove(f.id); report.removedHere++; }
  report.trashed = plan.toTrash.length;
  for (const id of plan.purge) {
    try { await cloud.remove(id); report.purged++; } catch (e) { if (isFatal(e)) throw e; if (isGone(e)) report.purged++; }
  }
  await store.saveKnown(doneKnown);
  report.waiting = report.failed.length + report.skipped.filter((s) => s.reason === 'missing-file').length;
  const changed = JSON.stringify(plan.manifest) !== JSON.stringify(input.manifest);
  const trashChanged = JSON.stringify(plan.trash) !== JSON.stringify(input.trash ?? []);
  return out({ manifest: changed ? plan.manifest : undefined, trash: trashChanged ? plan.trash : undefined, conflicts: plan.conflicts });
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
  const parts = [r.uploaded && `올림 ${r.uploaded}`, r.downloaded && `받음 ${r.downloaded}`, r.removedHere && `다른 기기에서 지워 이 컴퓨터에서도 지움 ${r.removedHere}`, r.trashed && `휴지통으로 옮김 ${r.trashed}`, r.purged && `보관 기간이 끝나 서버에서 지움 ${r.purged}`, r.replaced.length && `같은 글꼴의 다른 파일로 교체 ${r.replaced.length}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '변경 없음';
}

/** The notice for versions replaced by the conflict rule (null when none): says what happened and where the old file is. */
export function conflictNotice(r: Pick<FontSyncReport, 'replaced'>): string | null {
  if (!r.replaced.length) return null;
  const names = [...new Set(r.replaced.map((x) => x.family))].slice(0, 3).join(', ');
  return `다른 컴퓨터에도 같은 글꼴(${names})의 다른 파일이 있어 더 큰 파일(없으면 먼저 올린 파일)로 맞추었습니다. 이전 파일은 서버에 남아 있으니 설정 › 글꼴에서 '둘 다 보관'으로 다시 받을 수 있습니다.`;
}
