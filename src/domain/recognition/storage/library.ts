// Pure 찬양 라이브러리 matching from shrlak/ppt (src/lib/storage/library.ts). The site's own
// localStorage copy and sync queue are left out: LightCast's library is its presentations plus the
// shared library (online.ts), which the pipeline is handed as LibraryEntry[].
import type {
  LibraryEntry,
  SanitizedLibraryEntry,
  Section,
  SongIdentity,
  StoredProvenance,
  VerificationState,
} from '../utils/types';
import { sortSectionsByOrder } from '../utils/slidePlanner';


/** Lowercase and strip everything but letters, digits and Hangul, for title comparison. */
export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣]+/g, '');
}

const MAX_LYRIC_SECTIONS = 50;
const MAX_LYRIC_LINES = 500;

const VERIFICATION_STATES: VerificationState[] = ['draft', 'verified', 'edited'];
const PROVENANCE_SOURCES = ['library', 'models', 'web', 'manual'] as const;

function trimmedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/**
 * Keep only the provenance fields whose shape we can verify. Provenance
 * arrives from storage written by an older (or newer) build, so an
 * unrecognized or wrongly typed field is dropped rather than carried through
 * into the code that reads it.
 */
export function sanitizeStoredProvenance(raw: unknown): StoredProvenance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const provenance: StoredProvenance = {};
  const pageHash = trimmedString(obj.pageHash, 128);
  if (pageHash) provenance.pageHash = pageHash;
  const source = trimmedString(obj.source, 20);
  if ((PROVENANCE_SOURCES as readonly string[]).includes(source)) {
    provenance.source = source as StoredProvenance['source'];
  }
  const webSourceUrl = trimmedString(obj.webSourceUrl, 500);
  if (/^https?:\/\//.test(webSourceUrl)) provenance.webSourceUrl = webSourceUrl;
  const confidence = Number(obj.confidence);
  if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) provenance.confidence = confidence;
  const modelVersion = trimmedString(obj.correctionModelVersion, 64);
  if (modelVersion) provenance.correctionModelVersion = modelVersion;
  return Object.keys(provenance).length > 0 ? provenance : undefined;
}

/**
 * Coerce a stored library entry into its sanitized form, or null when it is
 * not a usable song at all.
 *
 * Entries written before verification existed carry no state. They are
 * migrated to 'verified': every one of them was put there by an explicit user
 * save, which is exactly what 'verified' means, and it is the only migration
 * that does not silently demote a library the user already trusts.
 */
export function sanitizeLibraryEntry(raw: unknown): SanitizedLibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = trimmedString(obj.title, 200);
  if (!title || !normalizeTitle(title) || !Array.isArray(obj.sections)) return null;

  let lineCount = 0;
  const sections: Section[] = [];
  for (const candidate of obj.sections.slice(0, MAX_LYRIC_SECTIONS)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    if (!Array.isArray(record.lines)) continue;
    const label = trimmedString(record.label, 30);
    if (!label) continue;
    const lines: string[] = [];
    for (const value of record.lines) {
      if (lineCount >= MAX_LYRIC_LINES) break;
      if (typeof value !== 'string') continue;
      lines.push(value.slice(0, 500));
      lineCount += 1;
    }
    sections.push({ label, lines });
    if (lineCount >= MAX_LYRIC_LINES) break;
  }

  const order = Array.isArray(obj.order)
    ? obj.order.map((value) => trimmedString(value, 30)).filter(Boolean).slice(0, 500)
    : [];
  const artist = trimmedString(obj.artist, 200);
  const key = trimmedString(obj.key, 20);
  const verification = VERIFICATION_STATES.includes(obj.verification as VerificationState)
    ? (obj.verification as VerificationState)
    : 'verified';
  const rawVersion = Number(obj.version);
  const version = Number.isSafeInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 1;
  const updatedAt = trimmedString(obj.updatedAt, 40);
  const provenance = sanitizeStoredProvenance(obj.provenance);

  return {
    title,
    ...(artist ? { artist } : {}),
    ...(key ? { key } : {}),
    sections,
    order,
    verification,
    version,
    ...(updatedAt ? { updatedAt } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

export function sanitizeLibraryEntries(raw: unknown): SanitizedLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeLibraryEntry).filter((entry): entry is SanitizedLibraryEntry => entry !== null);
}

/** Trust level of an entry that may predate the verification field. */
export function entryVerification(entry: LibraryEntry): VerificationState {
  return VERIFICATION_STATES.includes(entry.verification as VerificationState)
    ? (entry.verification as VerificationState)
    : 'verified';
}

/** True when this entry is ground truth a user stood behind. */
export function isGroundTruth(entry: LibraryEntry): boolean {
  return entryVerification(entry) !== 'draft';
}

/**
 * The saved entry that may be reused INSTEAD of recognizing the page again.
 *
 * Only user-confirmed entries qualify: a draft is a machine's guess, and
 * reusing one would let a single bad reading become permanent. When an artist
 * is known on both sides it has to agree, so two different songs that share a
 * title stay apart; the highest saved version wins.
 */
export function selectReusableEntry(
  entries: LibraryEntry[],
  identity: SongIdentity,
): LibraryEntry | undefined {
  const wantedTitle = normalizeTitle(identity.title ?? '');
  if (!wantedTitle) return undefined;
  const wantedArtist = identity.artist ? normalizeTitle(identity.artist) : '';
  return entries
    .filter((candidate) => isGroundTruth(candidate))
    .filter((candidate) => normalizeTitle(candidate.title) === wantedTitle)
    .filter(
      (candidate) =>
        !wantedArtist || !candidate.artist || normalizeTitle(candidate.artist) === wantedArtist,
    )
    .sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
}

/**
 * The saved song a title names, for loading straight from the library.
 *
 * A confirmed entry is preferred; when the library only holds a draft under
 * that title, the draft is used — it is already in 찬양 라이브러리, and
 * reading the 악보 again would only take time to produce another draft. Titles
 * must match exactly (ignoring spacing, case and punctuation), and a known
 * artist on both sides must agree, so two songs sharing a title stay apart.
 */
export function findLibrarySong(
  entries: LibraryEntry[],
  identity: SongIdentity,
): LibraryEntry | undefined {
  const confirmed = selectReusableEntry(entries, identity);
  if (confirmed) return confirmed;
  const wantedTitle = normalizeTitle(identity.title ?? '');
  if (!wantedTitle) return undefined;
  const wantedArtist = identity.artist ? normalizeTitle(identity.artist) : '';
  return entries
    .filter((candidate) => normalizeTitle(candidate.title) === wantedTitle)
    .filter(
      (candidate) =>
        !wantedArtist || !candidate.artist || normalizeTitle(candidate.artist) === wantedArtist,
    )
    .sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
}

/**
 * A saved song's lyrics, laid out for this week's service.
 *
 * The 진행 순서 the conti wrote (`contiOrder`) is this week's arrangement: it
 * replaces the saved order, and the saved sections are rearranged to follow
 * it, exactly as sections read off a 악보 are. Without one the saved order
 * and section layout are kept as they are.
 */
export function libraryLyrics(
  entry: Pick<LibraryEntry, 'sections' | 'order'>,
  contiOrder?: string[],
): { sections: Section[]; order: string[] } {
  const sections = structuredClone(entry.sections);
  if (!contiOrder || contiOrder.length === 0) return { sections, order: [...entry.order] };
  return { sections: sortSectionsByOrder(sections, contiOrder), order: [...contiOrder] };
}

/**
 * What a 찬양 라이브러리 entry holds for a song, as one comparable string.
 * Auto-save writes a song back whenever this differs from the saved entry —
 * any change at all, down to one letter, a key or the 진행 순서.
 */
export function libraryContentKey(
  item: Pick<LibraryEntry, 'title' | 'artist' | 'key' | 'sections' | 'order'>,
): string {
  return JSON.stringify({
    title: item.title.trim(),
    artist: item.artist ?? '',
    key: item.key ?? '',
    sections: item.sections.map((section) => ({ label: section.label, lines: section.lines })),
    order: item.order,
  });
}

/** Load the read-only starter library bundled with the site. */
export async function fetchBundledLibrary(baseUrl: string): Promise<LibraryEntry[]> {
  try {
    const res = await fetch(baseUrl + 'library.json');
    if (!res.ok) return [];
    return sanitizeLibraryEntries(await res.json());
  } catch {
    return [];
  }
}

/**
 * Merge bundled and user libraries; user entries win on matching titles —
 * except a draft, which never hides a bundled song. The bundled songs were
 * put there by hand, so they are ground truth, and a draft must not stand in
 * front of ground truth here any more than upsertEntry lets it replace one.
 * Without this, one machine reading auto-saved under a bundled title would
 * load in place of the bundled lyrics on every conti that names the song.
 */
export function mergeLibraries(bundled: LibraryEntry[], user: LibraryEntry[]): LibraryEntry[] {
  const confirmed = new Set(bundled.filter(isGroundTruth).map((e) => normalizeTitle(e.title)));
  const shown = user.filter((e) => isGroundTruth(e) || !confirmed.has(normalizeTitle(e.title)));
  const userTitles = new Set(shown.map((e) => normalizeTitle(e.title)));
  return [...bundled.filter((e) => !userTitles.has(normalizeTitle(e.title))), ...shown];
}

/**
 * The saved entry whose title is the one asked for, or none.
 *
 * Titles are compared normalized, so spacing, case and punctuation do not
 * matter — but the words do. A near miss is a different song: "주 은혜임을"
 * must not answer with "주 은혜임을 아네", because loading that entry puts
 * lyrics the page never had on the screen. This is also the identity
 * upsertEntry writes by, so a save replaces exactly what a load finds.
 */
export function findEntry(library: LibraryEntry[], title: string): LibraryEntry | undefined {
  const want = normalizeTitle(title);
  if (!want) return undefined;
  return library.find((e) => normalizeTitle(e.title) === want);
}

/**
 * The saved entry that may stand in for a page, once the page confirms it.
 *
 * Title equality is exact and the entry must be one somebody confirmed: a
 * draft is a machine's guess, and reusing one would let a single bad reading
 * become permanent. Even then this is only a CANDIDATE — the caller has to
 * see the same lyrics on the page before the saved copy replaces what was
 * read there. Without both checks a conti quietly gets the lyrics of whatever
 * song the library happened to have under a similar name.
 */
export function findReusableEntry(
  library: LibraryEntry[],
  identity: SongIdentity,
): LibraryEntry | undefined {
  return selectReusableEntry(library, identity);
}

/**
 * Replace the entry with the same normalized title, or append. Returns a new
 * array.
 *
 * A draft never replaces ground truth: recognition runs on every conti, so
 * without this rule one weak reading of an already-verified song would quietly
 * overwrite the wording the user confirmed. An explicit verified/edited save
 * still replaces whatever was there, including a newer draft.
 */
export function upsertEntry(entries: LibraryEntry[], entry: LibraryEntry): LibraryEntry[] {
  const want = normalizeTitle(entry.title);
  const idx = entries.findIndex((e) => normalizeTitle(e.title) === want);
  if (idx === -1) return [...entries, entry];
  if (entryVerification(entry) === 'draft' && isGroundTruth(entries[idx])) return entries.slice();
  const next = entries.slice();
  next[idx] = entry;
  return next;
}
