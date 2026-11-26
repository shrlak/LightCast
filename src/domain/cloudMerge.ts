import type { Library, Presentation, Slide, UsageEntry } from './types';
import { mergeActivity, mergeDevices, newestModification } from './activity';
import { clearTransitions } from './persistence';
import { mergePrefs } from './fontPrefs';
import { keepProtectedMaterials, protectionWinners, mergeProtectionChanges } from './materialProtection';
import { fieldStamp, itemStamp, mergeFieldStamps, mergeRemoved, mergeRemovedCopies, presentationStamp, SLIDE_PARTS, slideStamp, STAMP_KEYS, type StampedField } from './editStamps';

/** The part of the library that is shared through the cloud (online songs come from GitHub instead). */
export function syncable(lib: Library): Library {
  return { ...lib, presentations: lib.presentations.filter((p) => !p.online) };
}

/** JSON with the keys of every object in sorted order: equal content gives equal text, however the object was built. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}
/**
 * The canonical text of a part of the library, remembered per object. Library objects are never changed once made
 * (the reducer and the merge always make new ones), so a key worked out once stays right — and while someone types,
 * only the presentation being typed in is worked out again, not the whole library.
 */
const keyCache = new WeakMap<object, string>();
function partKey(v: unknown): string {
  if (!v || typeof v !== 'object') return canonicalJson(v);
  let k = keyCache.get(v);
  if (k === undefined) { k = canonicalJson(v); keyCache.set(v, k); }
  return k;
}
/** The text two libraries are compared by: equal when their content is equal, whatever the order of their keys (= canonicalJson). */
export const libraryKey = (lib: Library): string => {
  const rec = lib as unknown as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined && typeof rec[k] !== 'function').sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${k === 'presentations' && Array.isArray(rec[k]) ? `[${(rec[k] as unknown[]).map((p) => (p === undefined ? 'null' : partKey(p))).join(',')}]` : partKey(rec[k])}`).join(',')}}`;
};
/** Equal content (the fast check first: equal JSON is equal content; key order alone falls back to the canonical form). */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  return ja === jb || (ja.length === jb.length && canonicalJson(a) === canonicalJson(b));
};
/**
 * Equal apart from the ids of slides and objects inside, which automatic changes (a template refresh on every computer)
 * may give anew. The edit stamps count: a person's edit always stamps what it changed, so deleting a slide and adding
 * one that looks the same is an edit, not a renumbering.
 */
const withoutInnerIds = (v: unknown) => JSON.stringify(v, function (this: unknown, k, x) { return k === 'id' && this !== v ? undefined : x; });
const sameContent = (a: unknown, b: unknown) => a !== undefined && b !== undefined && withoutInnerIds(a) === withoutInnerIds(b);

/** The items `after` shares with `before` are still in `before`'s order. */
function keptOrder(before: { id: string }[], after: { id: string }[]): boolean {
  const inAfter = new Set(after.map((x) => x.id));
  const inBefore = new Set(before.map((x) => x.id));
  const a = before.filter((x) => inAfter.has(x.id)).map((x) => x.id);
  const b = after.filter((x) => inBefore.has(x.id)).map((x) => x.id);
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Of two versions of one thing, the later edit: the later stamp (server time), and for equal stamps the same choice
 * on every computer (by content), so all of them end with one and the same version.
 */
export function later<T>(l: T, r: T, lt: number, rt: number): 'local' | 'remote' {
  if (lt !== rt) return lt > rt ? 'local' : 'remote';
  return canonicalJson(l) >= canonicalJson(r) ? 'local' : 'remote';
}

export type Side = 'local' | 'remote';

/**
 * Three-way merge of id-keyed lists: base (last synced), local and remote.
 * A side that did not change an item since base yields to the other. When both sides changed the same item,
 * `both` merges the two (default: the later edit by `editedAt`). An item deleted on one side and left alone on
 * the other is deleted; deleted on one side and edited on the other, `keepEdited` decides (default: kept).
 */
export function mergeById<T extends { id: string }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
  both: (l: T, r: T, b: T | undefined) => T = (l, r) => (later(l, r, itemStamp(l), itemStamp(r)) === 'local' ? l : r),
  keepEdited: (edited: T, side: Side, b: T) => boolean | T = () => true,
  /** An item only one side has and the last synced copy lacks (new there, or brought back there): kept unless this says no. */
  keepNew: (item: T, side: Side) => boolean | T = () => true,
): T[] {
  const b = new Map((base ?? []).map((x) => [x.id, x]));
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  // The order of the side that reordered wins; when this computer kept the base order, the cloud's order is taken,
  // so two computers never keep writing their own (equally valid) orders over each other.
  const primary = base && keptOrder(base, local) ? remote : local;
  const secondary = primary === local ? remote : local;
  const inPrimary = new Set(primary.map((x) => x.id));
  const order = [...primary.map((x) => x.id), ...secondary.map((x) => x.id).filter((id) => !inPrimary.has(id))];
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
      else out.push(both(lv, rv, bv));
    } else if (lv) {
      // New here, or edited here while it was deleted on another device (kept as it is, or as `keepEdited` returns it).
      const keep = !bv ? keepNew(lv, 'local') : lChanged && keepEdited(lv, 'local', bv);
      if (keep) out.push(keep === true ? lv : keep);
    } else if (rv) {
      const keep = !bv ? keepNew(rv, 'remote') : rChanged && keepEdited(rv, 'remote', bv);
      if (keep) out.push(keep === true ? rv : keep);
    }
  }
  return out;
}

type Rec = Record<string, unknown>;
const ids = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.length > 0 && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
  && new Set(v.map((x) => (x as { id: string }).id)).size === v.length;
const idList = (v: unknown) => v === undefined || (Array.isArray(v) && (v.length === 0 || ids(v)));

/**
 * One field of two versions of an object: the side that changed it, or — both changed it — the later edit of that
 * field (`lt` / `rt`: its stamps). A list of things with ids (text boxes, comments, playlist items) is merged item by
 * item instead, each item by its own stamp (else the field's). Returns the value and which side's stamp it carries.
 */
function mergeField(b: unknown, l: unknown, r: unknown, lt: number, rt: number): { v: unknown; from: Side | 'both' } {
  if (same(l, r)) return { v: l, from: 'both' };
  if (same(b, l)) return { v: r, from: 'remote' };
  if (same(b, r)) return { v: l, from: 'local' };
  if ((ids(l) || ids(r)) && idList(b) && idList(l) && idList(r)) {
    const list = mergeById((b as { id: string }[] | undefined) ?? [], (l as { id: string }[] | undefined) ?? [], (r as { id: string }[] | undefined) ?? [],
      (x, y) => (later(x, y, itemStamp(x) || lt, itemStamp(y) || rt) === 'local' ? x : y),
      // Changed on one side, removed on the other: removed when the removal (that side's last change of the list) is later.
      (x, side) => (itemStamp(x) || (side === 'local' ? lt : rt)) >= (side === 'local' ? rt : lt));
    return { v: list.length || l !== undefined || r !== undefined ? list : undefined, from: 'both' };
  }
  return later(l, r, lt, rt) === 'local' ? { v: l, from: 'local' } : { v: r, from: 'remote' };
}

/**
 * Field by field: what only one side changed is taken from it; a field both changed takes its later edit (by the
 * field's own stamp, else the object's). The result's field stamps are those of the side each field came from.
 */
function mergeRecord<T extends object>(b: T | undefined, l: T, r: T, lt: number, rt: number, skip: Set<string> = new Set()): T {
  const newer = later(l, r, lt, rt);
  if (!b) return newer === 'local' ? l : r;
  const out: Rec = {};
  const stamps: Rec = {};
  const lr = l as Rec, rr = r as Rec, br = b as Rec;
  for (const k of new Set([...Object.keys(lr), ...Object.keys(rr)])) {
    if (skip.has(k) || STAMP_KEYS.has(k)) continue;
    const ls = fieldStamp(l, k, lt), rs = fieldStamp(r, k, rt);
    const { v, from } = mergeField(br[k], lr[k], rr[k], ls, rs);
    if (v !== undefined) out[k] = v;
    const t = from === 'local' ? fieldStamp(l, k, 0) : from === 'remote' ? fieldStamp(r, k, 0) : Math.max(fieldStamp(l, k, 0), fieldStamp(r, k, 0));
    if (t) stamps[k] = t;
  }
  if (Object.keys(stamps).length) out.fieldsEditedAt = stamps;
  return out as T;
}

/** A playlist, theme, macro … changed on both devices: field by field, a field both changed takes its later edit. */
function mergeItem<T extends { id: string }>(l: T, r: T, b: T | undefined): T {
  const lt = itemStamp(l), rt = itemStamp(r);
  if (!b) return lt > rt ? l : r;
  const merged = mergeRecord(b, l, r, lt, rt);
  const t = Math.max(lt, rt);
  return (t ? { ...merged, editedAt: t } : merged) as T;
}

/** Where each side deleted presentations and slides (its trash), with the time: an edit made later still wins. */
interface Deletions {
  presentations: Map<string, number>; slides: Map<string, number>;
  /** The presentation / slide as it was when deleted (every deletion: several devices may have deleted it). */
  copies: Map<string, { at: number; p: Presentation }[]>; slideCopies: Map<string, { at: number; slide: Slide }[]>;
  /** Slides this merge found deleted later than another device edited them: that edit goes into their trash copy. */
  laterDeletedSlides: Map<string, Slide>;
}
function deletionsOf(lib: Library | null): Deletions {
  const out: Deletions = { presentations: new Map(), slides: new Map(), copies: new Map(), slideCopies: new Map(), laterDeletedSlides: new Map() };
  for (const e of lib?.trash ?? []) {
    if (e.kind === 'presentation') {
      out.copies.set(e.presentation.id, [...(out.copies.get(e.presentation.id) ?? []), { at: e.deletedAt, p: e.presentation }]);
      out.presentations.set(e.presentation.id, Math.max(out.presentations.get(e.presentation.id) ?? 0, e.deletedAt));
    }
    else for (const s of e.slides ?? []) {
      const key = `${e.presentation.id}/${s.slide.id}`;
      out.slideCopies.set(key, [...(out.slideCopies.get(key) ?? []), { at: e.deletedAt, slide: s.slide }]);
      out.slides.set(key, Math.max(out.slides.get(key) ?? 0, e.deletedAt));
    }
  }
  return out;
}

/** When a slide (its body, text boxes, comments) was last edited. */
const slideLastEdit = (x: Slide, owner?: Presentation): number => Math.max(slideStamp(x, owner), ...(x.elements ?? []).map(itemStamp), ...(x.comments ?? []).map(itemStamp));
/**
 * A slide that is here although a device deleted it earlier (edited later, so it came back): what that device had on it
 * when it deleted (its trash copy) is folded back in, part by part — its newer text survives with this edit.
 */
function withSlideCopies(slide: Slide, pid: string, deleted: { local: Deletions; remote: Deletions }, owner?: Presentation, versions: (Presentation | undefined)[] = []): Slide {
  const key = `${pid}/${slide.id}`;
  const at = slideLastEdit(slide, owner);
  const copies = [...(deleted.local.slideCopies.get(key) ?? []), ...(deleted.remote.slideCopies.get(key) ?? [])].filter((c) => c.at <= at).map((c) => c.slide);
  // Removed without the trash (lyrics laid out anew): the copy kept with the removal record.
  for (const v of versions) { const c = v?.removedCopies?.[slide.id]; if (c && (v!.removedSlides?.[slide.id] ?? Infinity) <= at) copies.push(c); }
  return copies.length ? copies.reduce((acc, c) => mergeSlideByStamps(acc, c, 'local'), slide) : slide;
}

/** Two versions of one slide without a common ancestor (one from a trash copy): every part by its own stamp. */
function mergeSlideByStamps(a: Slide, b: Slide, tie: Side = 'remote'): Slide {
  if (same(a, b)) return a;
  const by = <T>(x: T, y: T, xs: number, ys: number): T => (xs !== ys ? (xs > ys ? x : y) : tie === 'local' ? x : y);
  const body = by(a, b, itemStamp(a), itemStamp(b));
  const pick = <T extends { id: string }>(x: T, y: T) => (same(x, y) ? x : by(x, y, itemStamp(x), itemStamp(y)));
  const elements = mergeById(undefined, a.elements ?? [], b.elements ?? [], pick);
  const comments = mergeById(undefined, a.comments ?? [], b.comments ?? [], pick);
  return { ...body, ...(elements.length || a.elements || b.elements ? { elements } : {}), ...(comments.length ? { comments } : {}) };
}

/**
 * One slide changed on both devices. Its text boxes, pictures and shapes (elements) and its comments are merged one by
 * one, each by its own stamp; the rest of the slide (its text with its formatting, background, notes …) is one piece,
 * taken from its later edit.
 */
function mergeSlide(b: Slide | undefined, l: Slide, r: Slide, lt: number, rt: number): Slide {
  if (!b) return mergeSlideByStamps(l, r);
  const rest = (x: Slide) => Object.fromEntries(Object.entries(x).filter(([k]) => !SLIDE_PARTS.has(k) && !STAMP_KEYS.has(k)));
  const body = mergeField(rest(b), rest(l), rest(r), lt, rt);
  const out: Rec = { ...(body.v as Rec), id: l.id };
  const bodyAt = body.from === 'local' ? itemStamp(l) : body.from === 'remote' ? itemStamp(r) : Math.max(itemStamp(l), itemStamp(r));
  if (bodyAt) out.editedAt = bodyAt;
  const stamps: Rec = {};
  for (const k of SLIDE_PARTS) {
    const key = k as 'elements' | 'comments';
    const ls = fieldStamp(l, key, lt), rs = fieldStamp(r, key, rt);
    const { v, from } = mergeField(b[key], l[key], r[key], ls, rs);
    if (v !== undefined && !(key === 'comments' && Array.isArray(v) && !v.length && !l.comments && !r.comments)) out[key] = v;
    const t = from === 'local' ? fieldStamp(l, key, 0) : from === 'remote' ? fieldStamp(r, key, 0) : Math.max(fieldStamp(l, key, 0), fieldStamp(r, key, 0));
    if (t) stamps[key] = t;
  }
  if (Object.keys(stamps).length) out.fieldsEditedAt = stamps;
  return out as unknown as Slide;
}

/**
 * One presentation changed on both devices: its settings field by field, its slides one by one (added and removed
 * slides on either side are kept / removed, a slide both changed takes the later edit of each part), so two people
 * editing different slides at once both keep their work, and on the same slide the later edit wins.
 */
function mergePresentation(b: Presentation | undefined, l: Presentation, r: Presentation, deleted: { local: Deletions; remote: Deletions }): Presentation {
  const lt = presentationStamp(l), rt = presentationStamp(r);
  // No common ancestor (both devices brought it back, or a first sign-in): every part by its own stamp.
  if (!b) return mergeByStamps(l, r, deleted);
  const fields = mergeRecord(b, l, r, lt, rt, new Set(['slides']));
  /** Edits to slides that a later removal beat: kept with the removal record (or the trash copy) for restoring. */
  const beaten = new Map<string, Slide>();
  const slides = mergeById<Slide>(b.slides, l.slides, r.slides,
    (ls, rs, bs) => mergeSlide(bs, ls, rs, slideStamp(ls, l), slideStamp(rs, r)),
    // A slide edited on one device and deleted on the other: deleted only when the deletion is the later of the two.
    // Kept, it also gets what the deleting device had on it (its trash copy, part by part); deleted, its trash copy
    // gets this edit — nothing anyone typed is lost either way.
    (edited, side) => {
      const key = `${l.id}/${edited.id}`;
      const other = deleted[side === 'local' ? 'remote' : 'local'];
      const at = removedAt(other.slides.get(key), (side === 'local' ? r : l).removedSlides?.[edited.id]);
      const editedAt = Math.max(slideStamp(edited, side === 'local' ? l : r), ...[...(edited.elements ?? []), ...(edited.comments ?? [])].map(itemStamp));
      if (at == null) return true;
      if (at <= editedAt) return withSlideCopies(edited, l.id, deleted, side === 'local' ? l : r, [l, r]);
      deleted.local.laterDeletedSlides.set(key, edited);
      beaten.set(edited.id, edited);
      return false;
    },
    // New on one side (or brought back there) while the other side deleted it later: deleted.
    (slide, side) => {
      const key = `${l.id}/${slide.id}`;
      const at = removedAt(deleted[side === 'local' ? 'remote' : 'local'].slides.get(key), (side === 'local' ? r : l).removedSlides?.[slide.id]);
      const editedAt = Math.max(slideStamp(slide, side === 'local' ? l : r), ...[...(slide.elements ?? []), ...(slide.comments ?? [])].map(itemStamp));
      if (at == null) return true;
      if (at <= editedAt) return withSlideCopies(slide, l.id, deleted, side === 'local' ? l : r, [l, r]);
      deleted.local.laterDeletedSlides.set(key, slide);
      beaten.set(slide.id, slide);
      return false;
    });
  const t = Math.max(lt, rt);
  const listAt = Math.max(fieldStamp(l, 'slides', 0), fieldStamp(r, 'slides', 0));
  const stamps = listAt ? { ...fields.fieldsEditedAt, slides: listAt } : fields.fieldsEditedAt;
  const removed = mergeRemoved(l.removedSlides, r.removedSlides, t);
  let copies = mergeRemovedCopies(l.removedCopies, r.removedCopies, removed, t);
  for (const [id, edited] of beaten) if (removed?.[id] != null) copies = mergeRemovedCopies(copies, { [id]: copies?.[id] ? mergeSlideByStamps(copies[id], edited, 'remote') : edited }, removed, t);
  return { ...fields, id: l.id, slides, ...(stamps ? { fieldsEditedAt: stamps } : {}), ...(removed ? { removedSlides: removed } : {}), ...(copies ? { removedCopies: copies } : {}), ...(t ? { updatedAt: t } : {}) } as Presentation;
}

/** The later of two removal times of a slide (trash, tombstone), or undefined when it was never removed. */
const removedAt = (...times: (number | undefined)[]): number | undefined => {
  const known = times.filter((t): t is number => typeof t === 'number');
  return known.length ? Math.max(...known) : undefined;
};

/**
 * Two versions of one presentation without a common ancestor (a trash copy from whichever version the deleting device
 * had): every part goes by its stamps alone — each field, each slide's body, each text box its later edit. A slide or
 * text box only one version has stays, unless that version's device deleted it later than it was last edited.
 */
function mergeByStamps(l: Presentation, r: Presentation, deleted: { local: Deletions; remote: Deletions }, tie: Side = 'remote'): Presentation {
  const lt = presentationStamp(l), rt = presentationStamp(r);
  const out: Rec = {};
  const stamps: Rec = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (k === 'slides' || STAMP_KEYS.has(k)) continue;
    const lv = (l as unknown as Rec)[k], rv = (r as unknown as Rec)[k];
    // Without a common ancestor a field counts only by its own stamp: one never edited is older than any edit
    // (the object's newest stamp would make an untouched original look new).
    const ls = fieldStamp(l, k, 0), rs = fieldStamp(r, k, 0);
    // Equal stamps (neither side edited it, or an older app's edit): the cloud's version, as on a first sign-in.
    const side: Side = same(lv, rv) ? 'local' : ls !== rs ? (ls > rs ? 'local' : 'remote') : tie;
    const v = side === 'local' ? lv : rv;
    if (v !== undefined) out[k] = v;
    const t = side === 'local' ? fieldStamp(l, k, 0) : fieldStamp(r, k, 0);
    if (t) stamps[k] = t;
  }
  const byId = (list: Slide[]) => new Map(list.map((x) => [x.id, x]));
  const ls = byId(l.slides), rs = byId(r.slides);
  const order = [...l.slides.map((x) => x.id), ...r.slides.map((x) => x.id).filter((id) => !ls.has(id))];
  // The latest deletion of a slide on any device (its trash): the slide stays only when it was edited after that.
  const deletedAt = (id: string) => Math.max(deleted.local.slides.get(`${l.id}/${id}`) ?? -Infinity, deleted.remote.slides.get(`${l.id}/${id}`) ?? -Infinity, l.removedSlides?.[id] ?? -Infinity, r.removedSlides?.[id] ?? -Infinity);
  const lastEdit = (x: Slide) => Math.max(itemStamp(x), ...(x.elements ?? []).map(itemStamp), ...(x.comments ?? []).map(itemStamp));
  const slides: Slide[] = [];
  for (const id of order) {
    const a = ls.get(id), b = rs.get(id);
    const slide = a && b ? mergeSlideByStamps(a, b, tie) : (a ?? b)!;
    // Removed on some device (trash, or the removed-slides record: deleted, or replaced when lyrics were laid out anew)
    // later than it was last edited: gone. Otherwise kept, whichever version has it.
    if (deletedAt(id) > lastEdit(slide)) continue;
    slides.push(deletedAt(id) > -Infinity ? withSlideCopies(slide, l.id, deleted, undefined, [l, r]) : slide);
  }
  const listAt = Math.max(fieldStamp(l, 'slides', 0), fieldStamp(r, 'slides', 0));
  if (listAt) stamps.slides = listAt;
  if (Object.keys(stamps).length) out.fieldsEditedAt = stamps;
  const t = Math.max(lt, rt);
  const removed = mergeRemoved(l.removedSlides, r.removedSlides, t);
  const copies = mergeRemovedCopies(l.removedCopies, r.removedCopies, removed, t);
  return { ...out, id: l.id, slides, ...(removed ? { removedSlides: removed } : {}), ...(copies ? { removedCopies: copies } : {}), ...(t ? { updatedAt: t } : {}) } as Presentation;
}

/** A library-wide setting both devices changed: the later edit (setting by setting for 주일예배 설정). */
function mergeSetting<K extends StampedField>(key: K, base: Library | null, local: Library, remote: Library): Library[K] {
  const lt = local.fieldsEditedAt?.[key] ?? 0, rt = remote.fieldsEditedAt?.[key] ?? 0;
  const l = local[key], r = remote[key];
  if (!base) return lt > rt ? l : r;
  const b = base[key];
  if (same(l, r) || same(b, r)) return l;
  if (same(b, l)) return r;
  if (key === 'sunday' && l && r && b && typeof l === 'object' && typeof r === 'object' && typeof b === 'object') {
    const out: Rec = {};
    const lr = l as unknown as Rec, rr = r as unknown as Rec, br = b as unknown as Rec;
    for (const k of new Set([...Object.keys(lr), ...Object.keys(rr)])) {
      const v = mergeField(br[k], lr[k], rr[k], local.fieldsEditedAt?.[`sunday.${k}`] ?? lt, remote.fieldsEditedAt?.[`sunday.${k}`] ?? rt).v;
      if (v !== undefined) out[k] = v;
    }
    return out as unknown as Library[K];
  }
  return mergeField(b, l, r, lt, rt).v as Library[K];
}

export interface MergeResult {
  library: Library;
}

/**
 * Merge the cloud library into this computer's library (both without online songs). Whatever only one side changed
 * is taken from it; what both changed takes the later edit, by the server time each edit was made (editStamps.ts).
 * Nothing is ever kept twice and nothing is asked: every computer ends with the same latest version.
 */
export function mergeLibrary(base0: Library | null, local0: Library, remote0: Library): MergeResult {
  if (remote0.cloudResetId && remote0.cloudResetId !== local0.cloudResetId) return { library: remote0 };
  // A copy from before transitions were reset (an older app) must not bring its transitions back.
  const fresh = (l: Library): Library => (l.transitionsReset === true ? l : { ...l, presentations: clearTransitions(l.presentations) });
  const base = base0 && fresh(base0);
  const local = fresh(local0);
  const remote = fresh(remote0);
  const locked = protectionWinners(base, local, remote);
  const deleted = { local: deletionsOf(local), remote: deletionsOf(remote) };
  /** Presentations deleted later than another device edited them: that edit goes into the trash copy (restorable). */
  const laterDeleted = new Map<string, Presentation>();

  const presentations = mergeById<Presentation>(base?.presentations, local.presentations, remote.presentations, (l, r, b) => {
    if (locked.has(l.id)) return locked.get(l.id)!;
    if ((l.protectionChangedAt ?? 0) !== (r.protectionChangedAt ?? 0)) return (l.protectionChangedAt ?? 0) > (r.protectionChangedAt ?? 0) ? l : r;
    return mergePresentation(b, l, r, deleted);
  }, (edited, side) => {
    if (locked.has(edited.id)) return true;
    const other = deleted[side === 'local' ? 'remote' : 'local'];
    const at = other.presentations.get(edited.id);
    if (at == null || at <= presentationStamp(edited)) return true;
    laterDeleted.set(edited.id, edited);
    return false;
  }, (item, side) => {
    // New on one side — or brought back there by an edit later than an earlier deletion — while the other side
    // deleted it later still: deleted (its edits go into the trash copy).
    if (locked.has(item.id)) return true;
    const at = deleted[side === 'local' ? 'remote' : 'local'].presentations.get(item.id);
    if (at == null || at <= presentationStamp(item)) return true;
    laterDeleted.set(item.id, item);
    return false;
  });
  // A presentation that is here although a device deleted it earlier (edited later, so it came back): what that device
  // had in it when it deleted — its own edits, kept in its trash copy — is folded back in, each part by its stamps
  // (the copy can come from any version, so there is no common ancestor to compare with). Every device folds the same
  // copies the same way, so they all end alike, however late each one hears of the deletion.
  const presentationsOut = presentations.map((p) => {
    const copies = [...(deleted.local.copies.get(p.id) ?? []), ...(deleted.remote.copies.get(p.id) ?? [])].filter((c) => c.at <= presentationStamp(p));
    return copies.length ? copies.reduce((acc, c) => mergeByStamps(acc, c.p, deleted, 'local'), p) : p;
  });
  const retreat = mergeSetting('retreat', base, local, remote) ?? local.retreat ?? remote.retreat;
  const usageKey = (u: UsageEntry) => `${u.at}:${u.presentationId}:${u.device?.id ?? ''}`;
  const usage = [...local.usage];
  const seen = new Set(usage.map(usageKey));
  for (const u of remote.usage ?? []) if (!seen.has(usageKey(u))) { usage.push(u); seen.add(usageKey(u)); }
  usage.sort((a, b) => a.at - b.at);
  const m = <K extends 'themes' | 'playlists' | 'media' | 'timers' | 'props' | 'messageTemplates' | 'macros' | 'screens' | 'schedules' | 'looks' | 'stageLayouts'>(k: K) =>
    mergeById<{ id: string }>(base?.[k] as { id: string }[] | undefined, (local[k] ?? []) as { id: string }[], (remote[k] ?? []) as { id: string }[], (l, r, b) => mergeItem(l, r, b)) as Library[K];
  const fonts = mergeById(base?.fonts, local.fonts ?? [], remote.fonts ?? [], (l, r) => (base ? l : r));
  const fontTrash = mergeById(base?.fontTrash, local.fontTrash ?? [], remote.fontTrash ?? []);
  const fontPrefs = mergePrefs(local.fontPrefs, remote.fontPrefs);
  let trash = mergeById(base?.trash, local.trash ?? [], remote.trash ?? []);
  if (laterDeleted.size) {
    trash = trash.map((e) => {
      const edited = e.kind === 'presentation' ? laterDeleted.get(e.presentation.id) : undefined;
      if (!edited) return e;
      return { ...e, presentation: mergeByStamps(e.presentation, edited, deleted, 'remote') };
    });
  }
  if (deleted.local.laterDeletedSlides.size) {
    const laterSlides = deleted.local.laterDeletedSlides;
    trash = trash.map((e) => (e.kind !== 'slides' || !e.slides?.some((x) => laterSlides.has(`${e.presentation.id}/${x.slide.id}`)) ? e
      : { ...e, slides: e.slides.map((x) => { const edited = laterSlides.get(`${e.presentation.id}/${x.slide.id}`); return edited ? { ...x, slide: mergeSlideByStamps(x.slide, edited) } : x; }) }));
  }
  const fieldsEditedAt = mergeFieldStamps(local.fieldsEditedAt, remote.fieldsEditedAt);
  return {
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
      ...(fieldsEditedAt ? { fieldsEditedAt } : {}),
      presentations: presentationsOut,
      trash,
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
      ...(fontTrash.length ? { fontTrash } : {}),
      ...(fontPrefs ? { fontPrefs } : {}),
      usage: usage.slice(-5000),
      sunday: mergeSetting('sunday', base, local, remote),
      logoMediaId: mergeSetting('logoMediaId', base, local, remote),
      ...(retreat ? { retreat } : {}),
    }, locked, [base, local, remote].filter((s): s is Library => !!s)),
  };
}
