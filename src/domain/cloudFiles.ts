// 서버 파일: every media file the church server holds, with what each one is used by, so the operator can look at
// all of them and delete them. The rules (what is "in use", what may be deleted, what a delete has to do) are kept
// here so they can be tested; the screen only draws them.
import type { Library } from './types';
import { protectedMediaIds } from './materialProtection';

export type FileKind = 'image' | 'video' | 'audio' | 'other';
export const KIND_LABEL: Record<FileKind, string> = { image: '이미지', video: '동영상', audio: '오디오', other: '기타' };

export interface ServerFile {
  id: string;
  name: string;
  kind: FileKind;
  type: string;
  size: number;
}

export interface ServerFileRow extends ServerFile {
  /** This computer's library lists the file (a delete has to take it out of the library too). */
  inLibrary: boolean;
  /** Only the server's copy of the library lists it (another computer's): wait for the next sync before deleting. */
  listedElsewhere: boolean;
  /** Titles of the presentations that use the file (up to the whole list). */
  usedBy: string[];
  /** A protected (필수) presentation uses it: it cannot be deleted. */
  protectedFile: boolean;
}

export function kindOf(type: string): FileKind {
  const t = type.toLowerCase();
  if (t === 'image' || t.startsWith('image/')) return 'image';
  if (t === 'video' || t.startsWith('video/')) return 'video';
  if (t === 'audio' || t.startsWith('audio/')) return 'audio';
  return 'other';
}

/** Every string stored under a key that ends in "mediaId", anywhere inside the value. */
function mediaIdsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => mediaIdsIn(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/mediaId$/i.test(key) && typeof child === 'string') out.add(child);
      else mediaIdsIn(child, out);
    }
  }
  return out;
}

/** Which presentations (by title) use each media id. */
export function usageByMedia(lib: Pick<Library, 'presentations'>): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const p of lib.presentations) {
    for (const id of mediaIdsIn(p)) {
      const list = used.get(id) ?? [];
      list.push(p.title || '제목 없는 자료');
      used.set(id, list);
    }
  }
  return used;
}

/** The server's file list joined with this computer's library (names, use) and the server's copy of the library. */
export function buildServerFileRows(
  items: readonly { id: string; size: number; type?: string }[],
  local: Pick<Library, 'media' | 'presentations'>,
  remoteLibrary: unknown,
): ServerFileRow[] {
  const names = new Map<string, { name: string; type: string }>();
  const remoteIds = new Set<string>();
  const remoteMedia = remoteLibrary && typeof remoteLibrary === 'object' ? (remoteLibrary as { media?: unknown }).media : null;
  if (Array.isArray(remoteMedia)) for (const m of remoteMedia) {
    if (m && typeof m.id === 'string') { remoteIds.add(m.id); names.set(m.id, { name: typeof m.name === 'string' ? m.name.trim() : '', type: typeof m.type === 'string' ? m.type : '' }); }
  }
  const inLocal = new Set<string>();
  for (const m of local.media) { inLocal.add(m.id); names.set(m.id, { name: m.name?.trim() ?? '', type: m.type ?? '' }); }
  const usage = usageByMedia(local);
  const protectedIds = protectedMediaIds(local as Library);
  const rows = new Map<string, ServerFileRow>();
  for (const item of items) {
    if (typeof item.id !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('서버 파일 용량이 올바르지 않습니다.');
    const meta = names.get(item.id);
    const type = item.type || meta?.type || '';
    rows.set(item.id, {
      id: item.id, name: meta?.name || item.id, type, kind: kindOf(type), size: item.size,
      inLibrary: inLocal.has(item.id),
      listedElsewhere: !inLocal.has(item.id) && remoteIds.has(item.id),
      usedBy: usage.get(item.id) ?? [],
      protectedFile: protectedIds.has(item.id),
    });
  }
  return [...rows.values()];
}

export type StatusFilter = 'all' | 'unused' | 'used';
export type SortKey = 'size' | 'name' | 'kind';
export interface FileView { query: string; kind: FileKind | 'all'; status: StatusFilter; sort: SortKey }
export const DEFAULT_VIEW: FileView = { query: '', kind: 'all', status: 'all', sort: 'size' };

export const isUsed = (r: ServerFileRow): boolean => r.inLibrary || r.listedElsewhere;

export function viewRows(rows: readonly ServerFileRow[], view: FileView): ServerFileRow[] {
  const q = view.query.trim().toLowerCase();
  const out = rows.filter((r) =>
    (view.kind === 'all' || r.kind === view.kind)
    && (view.status === 'all' || (view.status === 'used') === isUsed(r))
    && (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.usedBy.some((t) => t.toLowerCase().includes(q))));
  const by: Record<SortKey, (a: ServerFileRow, b: ServerFileRow) => number> = {
    size: (a, b) => b.size - a.size,
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    kind: (a, b) => KIND_LABEL[a.kind].localeCompare(KIND_LABEL[b.kind], 'ko') || b.size - a.size,
  };
  return out.sort((a, b) => by[view.sort](a, b) || a.id.localeCompare(b.id));
}

/** What a delete of these files has to do: which can go, which are skipped and why. */
export interface DeletePlan {
  /** Not in any library: only the server's copy goes. */
  serverOnly: ServerFileRow[];
  /** In this computer's library: also taken out of the library and this computer. */
  withLibrary: ServerFileRow[];
  /** Skipped: protected material uses it, or another computer's library lists it and this one has not synced yet. */
  skipped: { row: ServerFileRow; reason: string }[];
  bytes: number;
}

export function planDelete(rows: readonly ServerFileRow[]): DeletePlan {
  const plan: DeletePlan = { serverOnly: [], withLibrary: [], skipped: [], bytes: 0 };
  for (const r of rows) {
    if (r.protectedFile) plan.skipped.push({ row: r, reason: '보호된 자료가 쓰고 있습니다' });
    else if (r.listedElsewhere) plan.skipped.push({ row: r, reason: '다른 컴퓨터의 라이브러리에 있습니다 (먼저 동기화하세요)' });
    else if (r.inLibrary) { plan.withLibrary.push(r); plan.bytes += r.size; }
    else { plan.serverOnly.push(r); plan.bytes += r.size; }
  }
  return plan;
}

/** The sentence asked before deleting: what goes, from where, and what is lost. */
export function deleteQuestion(plan: DeletePlan, formatBytes: (n: number) => string): string {
  const n = plan.serverOnly.length + plan.withLibrary.length;
  if (!n) return '';
  const lines = [`서버 파일 ${n}개 (${formatBytes(plan.bytes)})를 삭제할까요? 되돌릴 수 없습니다.`];
  if (plan.withLibrary.length) {
    const users = new Set(plan.withLibrary.flatMap((r) => r.usedBy));
    lines.push('', `이 중 ${plan.withLibrary.length}개는 미디어 보관함(라이브러리)에 있는 파일입니다. 서버뿐 아니라 라이브러리와 이 컴퓨터에서도 지워지고, 다른 컴퓨터에서도 다음 동기화 때 지워집니다.`);
    if (users.size) lines.push(`${users.size}개 프레젠테이션에서 쓰고 있어, 배경은 비워지고 슬라이드에 넣은 그림·영상은 빈 자리로 남습니다: ${[...users].slice(0, 5).join(', ')}${users.size > 5 ? ` 외 ${users.size - 5}개` : ''}`);
  }
  if (plan.skipped.length) lines.push('', `지우지 않는 파일 ${plan.skipped.length}개: ${plan.skipped.slice(0, 3).map((s) => `${s.row.name} (${s.reason})`).join(', ')}${plan.skipped.length > 3 ? ' …' : ''}`);
  return lines.join('\n');
}

// Selection (the same rules as the 휴지통).
export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export const selectedIn = (shown: readonly ServerFileRow[], selected: ReadonlySet<string>): ServerFileRow[] => shown.filter((r) => selected.has(r.id));
export type SelectAllState = 'none' | 'some' | 'all';
export function selectAllState(shown: readonly ServerFileRow[], selected: ReadonlySet<string>): SelectAllState {
  const n = selectedIn(shown, selected).length;
  return !shown.length || !n ? 'none' : n === shown.length ? 'all' : 'some';
}
export const toggleSelectAll = (shown: readonly ServerFileRow[], selected: ReadonlySet<string>): Set<string> =>
  selectAllState(shown, selected) === 'all' ? new Set() : new Set(shown.map((r) => r.id));

export interface Totals { count: number; bytes: number; unusedCount: number; unusedBytes: number; usedCount: number }
export function totals(rows: readonly ServerFileRow[]): Totals {
  const t: Totals = { count: rows.length, bytes: 0, unusedCount: 0, unusedBytes: 0, usedCount: 0 };
  for (const r of rows) {
    t.bytes += r.size;
    if (isUsed(r)) t.usedCount++; else { t.unusedCount++; t.unusedBytes += r.size; }
  }
  return t;
}
