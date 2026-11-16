// Slides (and files) pasted from PowerPoint, LibreOffice or the file manager: every clipboard format is read,
// told apart by its bytes (src/domain/clipboardScan.ts), and a whole presentation found there goes through the
// same readers as 파일 › 열기 (importFiles.filesToSlides) so objects, formatting, notes and backgrounds survive.
import type { Slide } from '../domain/types';
import { CLIP_ENTRY_CAP, CLIP_TOTAL_CAP, DECK_FILE, clipboardReport, scanClipboardEntries, type ClipDeck, type ClipEntry, type ClipScan } from '../domain/clipboardScan';
import { desktop } from '../domain/desktop';

export const NO_SLIDE_DATA = '클립보드에서 슬라이드 데이터를 찾지 못했습니다. PowerPoint에서 슬라이드를 .pptx로 저장한 뒤 파일 › 열기로 여세요. (홈 › 붙여넣기 › 클립보드 형식 보기…에서 클립보드 내용을 확인할 수 있습니다.)';
const MIME: Record<ClipDeck['format'], string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation', fodp: 'application/vnd.oasis.opendocument.presentation',
};

/** A paste event's clipboard, taken at once (a DataTransfer is only readable while the event runs). */
export interface ClipSnapshot { files: File[]; strings: [string, string][] }

export function snapshotDataTransfer(dt: DataTransfer | null | undefined): ClipSnapshot {
  const out: ClipSnapshot = { files: [], strings: [] };
  if (!dt) return out;
  try { out.files = Array.from(dt.files ?? []); } catch { /* none */ }
  try {
    for (const type of Array.from(dt.types ?? [])) {
      if (type === 'Files') continue;
      const v = dt.getData(type);
      if (v) out.strings.push([type, v]);
    }
  } catch { /* none */ }
  return out;
}

const encoder = new TextEncoder();

/** The snapshot as clipboard entries (files by their bytes; text formats as UTF-8). */
export async function snapshotEntries(snap: ClipSnapshot | null | undefined): Promise<ClipEntry[]> {
  const entries: ClipEntry[] = [];
  let total = 0;
  for (const f of snap?.files ?? []) {
    const name = f.name || f.type || 'file';
    if (f.size > CLIP_ENTRY_CAP || total + f.size > CLIP_TOTAL_CAP) { entries.push({ name, size: f.size, error: 'large' }); continue; }
    try { total += f.size; entries.push({ name: f.type ? `${name} (${f.type})` : name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) }); }
    catch { entries.push({ name, size: f.size, error: '읽기 실패' }); }
  }
  for (const [type, value] of snap?.strings ?? []) {
    const bytes = encoder.encode(value);
    if (total + bytes.length > CLIP_TOTAL_CAP) { entries.push({ name: type, size: bytes.length, error: 'large' }); continue; }
    total += bytes.length;
    entries.push({ name: type, size: bytes.length, bytes });
  }
  return entries;
}

/** The browser's async Clipboard API: text/html, text/plain, image/png and the "web …" custom formats it exposes. */
export async function browserClipboardEntries(): Promise<ClipEntry[] | null> {
  try {
    const items = await navigator.clipboard.read();
    const entries: ClipEntry[] = [];
    let total = 0;
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (blob.size > CLIP_ENTRY_CAP || total + blob.size > CLIP_TOTAL_CAP) { entries.push({ name: type, size: blob.size, error: 'large' }); continue; }
        total += blob.size;
        entries.push({ name: type, size: blob.size, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    return entries;
  } catch { return null; }
}

/** The browser lets a page read the clipboard without asking (so a plain Ctrl+V never opens a prompt). */
async function browserReadGranted(): Promise<boolean> {
  try { return (await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })).state === 'granted'; } catch { return false; }
}

export interface ClipboardRead extends ClipScan { source: 'desktop' | 'browser' | 'event'; platform?: string }
let last: ClipboardRead | null = null;
/** What the last paste or scan found (for the diagnostic dialog). */
export const lastClipboardRead = () => last;

/**
 * Everything the clipboard holds: the desktop app's own scan (all formats), the paste event's files and text, and,
 * when asked (an explicit Paste button) or already allowed, the browser's async Clipboard API.
 */
export async function readClipboard(opts: { snapshot?: ClipSnapshot | null; browserRead?: boolean } = {}): Promise<ClipboardRead> {
  const entries: ClipEntry[] = [];
  let source: ClipboardRead['source'] = 'event';
  let platform: string | undefined;
  const scanned = await desktop?.scanClipboard?.().catch(() => null);
  if (scanned) { entries.push(...scanned.entries); source = 'desktop'; platform = scanned.platform; }
  entries.push(...await snapshotEntries(opts.snapshot));
  if (!scanned && (opts.browserRead || await browserReadGranted())) {
    const b = await browserClipboardEntries();
    if (b) { entries.push(...b); source = 'browser'; }
  }
  const scan = await scanClipboardEntries(entries);
  last = { ...scan, source, platform };
  return last;
}

/** Log the formats a paste could not use, so the list can be sent for a follow-up fix. */
export function logUnrecognised(read: ClipScan, why: string) {
  try { console.info(clipboardReport(read.rows, why)); } catch { /* console unavailable */ }
}

/** The report for the diagnostic dialog's copy button. */
export const reportOf = (read: ClipboardRead) => clipboardReport(read.rows, `${read.source}${read.platform ? `, ${read.platform}` : ''}`);

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Turn the presentations found into slides, richest form first, until one gives slides; `toSlides` is File › Open's
 * reader (filesToSlides). Errors of a form are collected, never thrown.
 */
export async function importClipboardDecks(decks: ClipDeck[], toSlides: (file: File) => Promise<Slide[]>, name = '붙여넣은 슬라이드'): Promise<{ slides: Slide[]; used?: ClipDeck; errors: string[] }> {
  const errors: string[] = [];
  for (const deck of decks) {
    await tick();
    try {
      const file = new File([deck.bytes as BlobPart], `${name}.${deck.format}`, { type: MIME[deck.format] });
      const slides = await toSlides(file);
      if (slides.length) return { slides, used: deck, errors };
      errors.push(`${deck.from}: 슬라이드가 없습니다.`);
    } catch (e) {
      errors.push(`${deck.from}: ${(e as Error).message}`);
    }
  }
  return { slides: [], errors };
}

/** Files of a snapshot that are slide files by name (PowerPoint / OpenDocument), as the file manager copies them. */
export const deckFilesOf = (snap: ClipSnapshot | null | undefined) => (snap?.files ?? []).filter((f) => DECK_FILE.test(f.name));
