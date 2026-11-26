// When each part of the library was last edited, in the church server's time (serverClock.ts). Every edit made on
// this computer stamps exactly what it changed, so cloud sync (cloudMerge.ts) can give every part to its latest edit:
//   presentation  updatedAt (its newest edit of anything) + fieldsEditedAt[field] (title, theme, background …)
//   slide         editedAt (its text, formatting, background, notes …) + fieldsEditedAt.elements / .comments
//   text box …    editedAt (each element and comment on its own)
//   list item     editedAt + fieldsEditedAt[field] (playlists, themes, macros …)
//   library       fieldsEditedAt['sunday.<setting>'], ['logoMediaId'], ['retreat']
// When two devices changed the same part before they synced, the later edit wins — there is no "keep mine / keep
// theirs" question. Two people changing different parts (different slides, different text boxes, different fields)
// both keep their work.
//
// Changes are found by object identity: the reducer never mutates, so a part is changed exactly when it is a new
// object. That keeps stamping cheap on every keystroke, however large the library.
import type { Library, Presentation, Slide } from './types';

/** The lists whose items are stamped (besides presentations); fonts follow their own sync (fontSync.ts). */
export const STAMPED_LISTS = ['playlists', 'themes', 'media', 'timers', 'props', 'messageTemplates', 'macros', 'screens', 'schedules', 'looks', 'stageLayouts'] as const;
export type StampedList = typeof STAMPED_LISTS[number];
/** Library-wide settings with their own stamps (주일예배 설정 one per setting). */
export const STAMPED_FIELDS = ['sunday', 'logoMediaId', 'retreat'] as const;
export type StampedField = typeof STAMPED_FIELDS[number];
/** Field → server time of its last edit. */
export type FieldsEditedAt = Record<string, number>;

/** Keys that are stamps, not content. */
export const STAMP_KEYS = new Set(['editedAt', 'updatedAt', 'fieldsEditedAt']);
/** The parts of a slide with their own stamps; everything else on it is its body (one piece, stamped `editedAt`). */
export const SLIDE_PARTS = new Set(['elements', 'comments']);

const num = (t: unknown): number => (typeof t === 'number' && Number.isFinite(t) ? t : 0);
/** The time a list item, element or comment was last edited, 0 when never here. */
export const itemStamp = (x: unknown): number => num((x as { editedAt?: unknown } | null | undefined)?.editedAt);
/** The time a presentation was last edited (anything in it). */
export const presentationStamp = (p: Presentation | null | undefined): number => num(p?.updatedAt);
/** The time a slide's body was last edited (its presentation's time when the slide has none of its own). */
export const slideStamp = (s: Slide | null | undefined, owner?: Presentation | null): number => num((s as { editedAt?: unknown } | null | undefined)?.editedAt) || presentationStamp(owner);
/** The time one field of an object was last edited, else `fallback` (the object's own time). */
export const fieldStamp = (o: unknown, key: string, fallback: number): number => num((o as { fieldsEditedAt?: Record<string, unknown> } | null | undefined)?.fieldsEditedAt?.[key]) || fallback;

/** The keys whose values are new objects / other values in `next` than in `old`. */
function changedKeys(old: object, next: object, skip: Set<string>): string[] {
  const o = old as Record<string, unknown>, n = next as Record<string, unknown>;
  const out: string[] = [];
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) if (!STAMP_KEYS.has(k) && !skip.has(k) && k !== 'id' && o[k] !== n[k]) out.push(k);
  return out;
}
function stampFields(old: object | undefined, next: object, at: number, skip: Set<string> = new Set()): FieldsEditedAt | undefined {
  const prev = (next as { fieldsEditedAt?: FieldsEditedAt }).fieldsEditedAt ?? (old as { fieldsEditedAt?: FieldsEditedAt } | undefined)?.fieldsEditedAt;
  if (!old) return prev;
  const keys = changedKeys(old, next, skip);
  if (!keys.length) return prev;
  const out = { ...prev };
  for (const k of keys) out[k] = at;
  return out;
}

/** Each changed element / comment stamped; the list itself unchanged when none changed. */
function stampItems<T extends { id: string }>(before: T[] | undefined, after: T[] | undefined, at: number): T[] | undefined {
  if (!after || before === after) return after;
  const old = new Map((before ?? []).map((x) => [x?.id, x]));
  let changed = false;
  const out = after.map((x) => {
    if (!x || typeof x !== 'object' || old.get(x.id) === x) return x;
    changed = true;
    return { ...x, editedAt: at };
  });
  return changed ? out : after;
}

function stampSlide(old: Slide | undefined, s: Slide, at: number): Slide {
  let out: Slide = s;
  const body = !old || changedKeys(old, s, SLIDE_PARTS).length > 0;
  if (body) out = { ...out, editedAt: at };
  for (const k of SLIDE_PARTS) {
    const key = k as 'elements' | 'comments';
    if (old ? old[key] === s[key] : s[key] === undefined) continue;
    const list = stampItems(old?.[key] as { id: string }[] | undefined, s[key] as { id: string }[] | undefined, at);
    out = { ...out, ...(list !== undefined ? { [key]: list } : {}), fieldsEditedAt: { ...out.fieldsEditedAt, [key]: at } };
  }
  return out;
}

function stampPresentation(old: Presentation | undefined, p: Presentation, at: number): Presentation {
  const slidesBefore = new Map((old?.slides ?? []).map((s) => [s.id, s]));
  const slides = p.slides === old?.slides ? p.slides : p.slides.map((s) => (slidesBefore.get(s.id) === s ? s : stampSlide(slidesBefore.get(s.id), s, at)));
  const fields = stampFields(old, p, at);
  return { ...p, updatedAt: at, slides, ...(fields ? { fieldsEditedAt: fields } : {}) };
}

function stampList<T extends { id: string }>(before: T[] | undefined, after: T[] | undefined, at: number): T[] | undefined {
  if (!after || before === after) return after;
  const old = new Map((before ?? []).map((x) => [x?.id, x]));
  let changed = false;
  const out = after.map((x) => {
    if (!x || typeof x !== 'object') return x;
    const o = old.get(x.id);
    if (o === x) return x;
    changed = true;
    const fields = stampFields(o, x, at);
    return { ...x, editedAt: at, ...(fields ? { fieldsEditedAt: fields } : {}) };
  });
  return changed ? out : after;
}

/**
 * `after` with everything that differs from `before` stamped with `at` (the server time of the edit). Online songs
 * are not stamped (they are not this library's until edited). Returns `after` itself when nothing changed.
 */
export function stampEdits(before: Library, after: Library, at: number): Library {
  if (before === after || !Number.isFinite(at)) return after;
  let out = after;
  if (after.presentations !== before.presentations) {
    const old = new Map(before.presentations.map((p) => [p.id, p]));
    let changed = false;
    const presentations = after.presentations.map((p) => {
      if (p.online || old.get(p.id) === p) return p;
      changed = true;
      return stampPresentation(old.get(p.id), p, at);
    });
    if (changed) out = { ...out, presentations };
  }
  for (const key of STAMPED_LISTS) {
    const list = stampList(before[key] as { id: string }[] | undefined, after[key] as { id: string }[] | undefined, at);
    if (list !== after[key]) out = { ...out, [key]: list };
  }
  let fields: FieldsEditedAt | undefined;
  for (const key of STAMPED_FIELDS) {
    if (before[key] === after[key]) continue;
    (fields ??= { ...after.fieldsEditedAt })[key] = at;
    const b = before[key], a = after[key];
    if (key === 'sunday' && b && a && typeof b === 'object' && typeof a === 'object') for (const k of changedKeys(b, a, new Set())) fields[`sunday.${k}`] = at;
  }
  if (fields) out = { ...out, fieldsEditedAt: fields };
  return out;
}

/** JSON of a value without its edit stamps: for "is this the same content" checks that must not see when it was saved. */
export const withoutStamps = (v: unknown): string => JSON.stringify(v, (k, x) => (STAMP_KEYS.has(k) ? undefined : x));

/** Two sets of field stamps together (the later of each). */
export function mergeFieldStamps(a: FieldsEditedAt | undefined, b: FieldsEditedAt | undefined): FieldsEditedAt | undefined {
  if (!a && !b) return undefined;
  const out: FieldsEditedAt = { ...a };
  for (const [k, t] of Object.entries(b ?? {})) if (num(t) > num(out[k])) out[k] = t;
  return Object.keys(out).length ? out : undefined;
}

/** Field stamps read from storage / the server: finite times only, a bounded number of them. */
export function normalizeFieldStamps(v: unknown): FieldsEditedAt | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: FieldsEditedAt = {};
  for (const [k, t] of Object.entries(v as Record<string, unknown>).slice(0, 500)) if (k.length <= 120 && typeof t === 'number' && Number.isFinite(t) && t > 0) out[k] = t;
  return Object.keys(out).length ? out : undefined;
}
