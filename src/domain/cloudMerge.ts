import type { Library, Presentation, UsageEntry } from './types';
import { uid } from './lyrics';
import { mergeActivity, mergeDevices, newestModification } from './activity';
import { clearTransitions } from './persistence';
import { keepProtectedMaterials, protectionWinners, mergeProtectionChanges } from './materialProtection';

/** The part of the library that is shared through the cloud (online songs come from GitHub instead). */
export function syncable(lib: Library): Library {
  return { ...lib, presentations: lib.presentations.filter((p) => !p.online) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Equal apart from the ids of slides and objects inside (which automatic changes may give anew). */
const withoutInnerIds = (v: unknown) => JSON.stringify(v, function (this: unknown, k, x) { return k === 'id' && this !== v ? undefined : x; });
const sameContent = (a: unknown, b: unknown) => a !== undefined && b !== undefined && withoutInnerIds(a) === withoutInnerIds(b);

/**
 * Three-way merge of id-keyed lists: base (last synced), local and remote.
 * A side that did not change since base yields to the other; deletions on one side win
 * when the other side left the item untouched. When both sides changed the same item,
 * `onConflict` decides (default: keep local).
 */
export function mergeById<T extends { id: string }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
  onConflict: (l: T, r: T) => T[] = (l) => [l],
): T[] {
  const b = new Map((base ?? []).map((x) => [x.id, x]));
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const order = [...local.map((x) => x.id), ...remote.map((x) => x.id).filter((id) => !l.has(id))];
  const out: T[] = [];
  for (const id of order) {
    const bv = b.get(id);
    const lv = l.get(id);
    const rv = r.get(id);
    const lChanged = !same(bv, lv);
    const rChanged = !same(bv, rv);
    if (lv && rv) {
      if (!lChanged) out.push(rv);
      else if (!rChanged || same(lv, rv)) out.push(lv);
      // Both changed it the same way (an automatic change made on each computer), or this computer
      // only renumbered its ids: the cloud's copy, so every computer ends up with one and the same.
      else if (sameContent(lv, rv) || sameContent(bv, lv)) out.push(rv);
      // Only the cloud's ids changed: this computer's real edit stays.
      else if (sameContent(bv, rv)) out.push(lv);
      else out.push(...onConflict(lv, rv));
    } else if (lv) {
      if (!(bv && !lChanged)) out.push(lv); // new locally, or edited locally while deleted remotely
    } else if (rv) {
      if (!(bv && !rChanged)) out.push(rv); // new remotely, or edited remotely while deleted locally
    }
  }
  return out;
}

const pick = <V>(base: V | undefined, local: V, remote: V, hasBase: boolean): V => (!hasBase || same(base, local) ? remote : local);

export interface MergeResult {
  library: Library;
  /** Titles of presentations both devices edited; the other device's version was kept as a copy. */
  conflicts: string[];
  /** The same, with the ids of this computer's version and of the copy, so the choice can be made later. */
  conflictPairs: { title: string; localId: string; copyId: string }[];
}

/** Merge the cloud library into this computer's library (both without online songs). */
export function mergeLibrary(base0: Library | null, local0: Library, remote0: Library): MergeResult {
  if (remote0.cloudResetId && remote0.cloudResetId !== local0.cloudResetId) return { library: remote0, conflicts: [], conflictPairs: [] };
  const conflicts: string[] = [];
  const conflictPairs: MergeResult['conflictPairs'] = [];
  // A copy from before transitions were reset (an older app) must not bring its transitions back.
  const fresh = (l: Library): Library => (l.transitionsReset === true ? l : { ...l, presentations: clearTransitions(l.presentations) });
  const base = base0 && fresh(base0);
  const local = fresh(local0);
  const remote = fresh(remote0);
  const locked = protectionWinners(base, local, remote);
  // First sync on this computer (no shared history): the cloud copy wins, local-only items are added.
  const presentations = mergeById<Presentation>(base?.presentations, local.presentations, remote.presentations, (l, r) => {
    if (locked.has(l.id)) return [locked.get(l.id)!];
    if ((l.protectionChangedAt ?? 0) !== (r.protectionChangedAt ?? 0)) return [(l.protectionChangedAt ?? 0) > (r.protectionChangedAt ?? 0) ? l : r];
    if (!base) return [r];
    conflicts.push(l.title);
    const copy = { ...r, id: uid('p'), title: `${r.title} (다른 기기)` };
    conflictPairs.push({ title: l.title, localId: l.id, copyId: copy.id });
    return [l, copy];
  });
  const retreat = pick(base?.retreat, local.retreat, remote.retreat, !!base) ?? local.retreat ?? remote.retreat;
  const usageKey = (u: UsageEntry) => `${u.at}:${u.presentationId}:${u.device?.id ?? ''}`;
  const usage = [...local.usage];
  const seen = new Set(usage.map(usageKey));
  for (const u of remote.usage ?? []) if (!seen.has(usageKey(u))) { usage.push(u); seen.add(usageKey(u)); }
  usage.sort((a, b) => a.at - b.at);
  const m = <K extends 'themes' | 'playlists' | 'media' | 'timers' | 'props' | 'messageTemplates' | 'macros' | 'screens' | 'schedules' | 'looks' | 'stageLayouts' | 'fonts'>(k: K) =>
    mergeById<{ id: string }>(base?.[k] as { id: string }[] | undefined, (local[k] ?? []) as { id: string }[], (remote[k] ?? []) as { id: string }[], (l, r) => [base ? l : r]) as Library[K];
  const fonts = m('fonts') ?? [];
  return {
    conflicts,
    conflictPairs,
    library: keepProtectedMaterials({
      version: 1,
      cloudResetId: remote.cloudResetId ?? local.cloudResetId,
      aspect: '4:3',
      transitionsReset: true,
      backgroundLibraryReset: local.backgroundLibraryReset || remote.backgroundLibraryReset,
      protectionChanges: mergeProtectionChanges(base, local, remote),
      devices: mergeDevices(local.devices, remote.devices),
      activity: mergeActivity(local.activity, remote.activity),
      lastModified: newestModification(local.lastModified, remote.lastModified),
      presentations,
      trash: mergeById(base?.trash, local.trash ?? [], remote.trash ?? []),
      themes: m('themes'),
      playlists: m('playlists'),
      media: m('media'),
      timers: m('timers'),
      props: m('props'),
      messageTemplates: m('messageTemplates'),
      macros: m('macros'),
      screens: m('screens'),
      schedules: m('schedules'),
      looks: m('looks'),
      stageLayouts: m('stageLayouts'),
      ...(fonts.length ? { fonts } : {}),
      usage: usage.slice(-5000),
      sunday: pick(base?.sunday, local.sunday, remote.sunday, !!base),
      logoMediaId: pick(base?.logoMediaId, local.logoMediaId, remote.logoMediaId, !!base),
      ...(retreat ? { retreat } : {}),
    }, locked, [base, local, remote].filter((s): s is Library => !!s)),
  };
}
