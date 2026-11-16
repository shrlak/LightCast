// What is on the system clipboard, told apart by the bytes themselves (never by the format's name):
// a whole presentation PowerPoint / LibreOffice put there when slides were copied (.pptx zip, .ppt
// compound file, embedded-object wrappers around either, .odp zip, flat .fodp), shapes (PowerPoint's
// GVML package), or only pictures and text. Pure logic: no DOM, never throws, sizes capped.
import JSZip from 'jszip';
import { isCfb, readCfb } from './io/cfb';

/** The total of all clipboard formats read (the desktop app stops reading at this). */
export const CLIP_TOTAL_CAP = 200 * 1024 * 1024;
/** One clipboard format larger than this is listed but not read. */
export const CLIP_ENTRY_CAP = 128 * 1024 * 1024;

export type ClipClass =
  | 'pptx' | 'ppt' | 'odp' | 'fodp'
  | 'pptx-in-ole' | 'ppt-in-ole'
  | 'gvml' | 'office-other' | 'zip' | 'cfb'
  | 'html' | 'rtf' | 'svg' | 'png' | 'jpeg' | 'gif' | 'bmp' | 'emf' | 'wmf' | 'text'
  | 'empty' | 'too-large' | 'unread' | 'unknown';

/** A whole presentation found on the clipboard, in a form File › Open reads. */
export interface ClipDeck { format: 'pptx' | 'ppt' | 'odp' | 'fodp'; bytes: Uint8Array; /** Which clipboard format it came from. */ from: string; /** Slides in it, when cheap to know (.pptx). */ slideCount?: number }

export interface ClipEntry { name: string; size: number; bytes?: Uint8Array; error?: string }
export interface ClipRow { name: string; size: number; cls: ClipClass; label: string; detail?: string }
export interface ClipScan { rows: ClipRow[]; decks: ClipDeck[]; gvml?: Uint8Array }

const LABELS: Record<ClipClass, string> = {
  pptx: 'PowerPoint 프레젠테이션 (.pptx 전체)', ppt: 'PowerPoint 97-2003 프레젠테이션 (.ppt 전체)',
  odp: 'OpenDocument 프레젠테이션 (.odp)', fodp: '단일 XML OpenDocument 프레젠테이션 (.fodp)',
  'pptx-in-ole': 'OLE 개체 안의 .pptx', 'ppt-in-ole': 'OLE 개체 안의 .ppt',
  gvml: 'PowerPoint 도형 묶음 (GVML)', 'office-other': '다른 Office 문서 (zip)', zip: 'ZIP 압축 파일', cfb: 'OLE 복합 문서 (슬라이드 데이터 없음)',
  html: 'HTML', rtf: 'RTF 서식 있는 텍스트', svg: 'SVG 그림', png: 'PNG 그림', jpeg: 'JPEG 그림', gif: 'GIF 그림', bmp: 'BMP 그림', emf: 'EMF 그림', wmf: 'WMF 그림',
  text: '텍스트', empty: '비어 있음', 'too-large': '너무 커서 읽지 않음', unread: '읽을 수 없음', unknown: '알 수 없는 형식',
};
export const classLabel = (c: ClipClass) => LABELS[c];

const starts = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => { let s = ''; for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]); return s; };
const isZip = (b: Uint8Array) => b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);

/** Text of the start of a buffer: UTF-8, or UTF-16 with a byte-order mark (what Windows text formats are). */
function head(b: Uint8Array, n = 4096): string {
  try {
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2, 2 + n * 2));
    const from = b[0] === 0xef && b[1] === 0xbb ? 3 : 0;
    return new TextDecoder('utf-8').decode(b.subarray(from, from + n));
  } catch { return ''; }
}
const printable = (s: string) => s.length > 0 && !/[\u0000-\u0008\u000e-\u001f]/.test(s.slice(0, 512));

/** ODF mimetype → deck, for a zip. */
const ODF_DECK = /application\/vnd\.oasis\.opendocument\.(presentation|graphics)(-template)?$/;

interface Found { cls: ClipClass; deck?: Omit<ClipDeck, 'from'>; detail?: string }

async function inspectZip(bytes: Uint8Array): Promise<Found> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return { cls: 'zip', detail: '손상된 ZIP' }; }
  const names = Object.keys(zip.files);
  const mime = (await zip.file('mimetype')?.async('string').catch(() => ''))?.trim();
  if (mime && ODF_DECK.test(mime)) return { cls: 'odp', deck: { format: 'odp', bytes }, detail: mime };
  if (zip.file('ppt/presentation.xml')) {
    const slideCount = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
    return { cls: 'pptx', deck: { format: 'pptx', bytes, slideCount }, detail: `${slideCount}개 슬라이드` };
  }
  const ct = (await zip.file('[Content_Types].xml')?.async('string').catch(() => '')) ?? '';
  if (/presentationml\.(presentation|slideshow|template)\.main/.test(ct)) return { cls: 'pptx', deck: { format: 'pptx', bytes }, detail: 'Content_Types' };
  if (names.some((n) => /^(word\/document|xl\/workbook)\.xml$/.test(n))) return { cls: 'office-other', detail: names.some((n) => n.startsWith('word/')) ? 'Word' : 'Excel' };
  // PowerPoint's shape package: DrawingML parts, no presentation.
  if (ct && (names.some((n) => /(^|\/)drawing\d*\.xml$/i.test(n) || /^(ppt|gvml)\//i.test(n)) || /drawingml|gvml/i.test(ct))) return { cls: 'gvml' };
  return { cls: 'zip' };
}

/** The bytes of an OLE "Ole10Native" stream's payload (4-byte size, label, paths, then the data). */
function ole10Payload(s: Uint8Array): Uint8Array | null {
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const sniff = () => { for (let i = 0; i < Math.min(s.length - 8, 4096); i++) if (isZip(s.subarray(i)) || starts(s, [0xd0, 0xcf, 0x11, 0xe0], i)) return s.subarray(i); return null; };
  try {
    let p = 6;
    for (let z = 0; z < 2 && p < s.length; z++) { while (p < s.length && s[p] !== 0) p++; p++; }
    p += 4; // unused
    const tmp = dv.getUint32(p, true); p += 4 + Math.min(tmp, 65536);
    const size = dv.getUint32(p, true); p += 4;
    if (size > 0 && p + size <= s.length) return s.subarray(p, p + size);
  } catch { /* use the sniff below */ }
  return sniff();
}

async function inspectCfb(bytes: Uint8Array, depth: number): Promise<Found> {
  const cfb = readCfb(bytes);
  if (!cfb) return { cls: 'cfb', detail: '읽을 수 없는 OLE 파일' };
  if (cfb.stream('PowerPoint Document')) return { cls: 'ppt', deck: { format: 'ppt', bytes } };
  if (depth >= 3) return { cls: 'cfb' };
  // An embedded object: the presentation itself rides in one of these streams.
  for (const name of ['Package', '\u0001Ole10Native', 'Ole10Native', 'CONTENTS', 'EmbeddedPackage']) {
    const raw = cfb.stream(name);
    if (!raw || raw.length < 8) continue;
    const inner = name.endsWith('Ole10Native') ? ole10Payload(raw) : raw;
    if (!inner) continue;
    const r = await inspectBytes(inner, depth + 1);
    if (r.deck) return { cls: r.deck.format === 'ppt' ? 'ppt-in-ole' : r.deck.format === 'pptx' ? 'pptx-in-ole' : r.cls, deck: r.deck, detail: name };
  }
  return { cls: 'cfb', detail: cfb.entries.slice(0, 8).map((e) => e.name).join(', ') };
}

async function inspectBytes(b: Uint8Array, depth: number): Promise<Found> {
  if (isZip(b)) return inspectZip(b);
  if (isCfb(b)) return inspectCfb(b, depth);
  return { cls: 'unknown' };
}

/** What kind of thing these clipboard bytes are, and the presentation inside them when there is one. */
export async function classifyClipboardBytes(b: Uint8Array): Promise<{ cls: ClipClass; deck?: Omit<ClipDeck, 'from'>; detail?: string }> {
  try {
    if (!b.length) return { cls: 'empty' };
    if (isZip(b) || isCfb(b)) {
      const r = await inspectBytes(b, 0);
      return { cls: r.cls, deck: r.deck, detail: r.detail };
    }
    if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return { cls: 'png' };
    if (starts(b, [0xff, 0xd8, 0xff])) return { cls: 'jpeg' };
    if (starts(b, [0x47, 0x49, 0x46, 0x38])) return { cls: 'gif' };
    if (starts(b, [0xd7, 0xcd, 0xc6, 0x9a])) return { cls: 'wmf' };
    if (b.length > 44 && b[0] === 1 && b[1] === 0 && b[2] === 0 && b[3] === 0 && ascii(b, 40, 44) === ' EMF') return { cls: 'emf' };
    if (b[0] === 0x42 && b[1] === 0x4d && b.length > 26) return { cls: 'bmp' };
    const t = head(b);
    if (!printable(t)) return { cls: 'unknown' };
    const lead = t.trimStart();
    if (/^\{\\rtf/i.test(lead)) return { cls: 'rtf' };
    if (/<office:document[\s>]/.test(t) && /office:mimetype\s*=\s*"application\/vnd\.oasis\.opendocument\.(presentation|graphics)(-template)?"/.test(t)) {
      return { cls: 'fodp', deck: { format: 'fodp', bytes: b } };
    }
    if (/^(<\?xml[^>]*\?>\s*)?(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(lead)) return { cls: 'svg' };
    if ((/^Version:\d/.test(lead) && /StartHTML:/.test(t)) || /<(html|body|!--StartFragment|p|div|span|table|img)[\s>]/i.test(t)) return { cls: 'html' };
    return { cls: 'text' };
  } catch {
    return { cls: 'unknown' };
  }
}

/** Preference when the clipboard carries the same slides in several forms: the richest first. */
const DECK_ORDER: ClipDeck['format'][] = ['pptx', 'odp', 'fodp', 'ppt'];

/** Classify every clipboard format read; the report rows and the presentations found, best first. */
export async function scanClipboardEntries(entries: ClipEntry[]): Promise<ClipScan> {
  const rows: ClipRow[] = [];
  const decks: ClipDeck[] = [];
  let gvml: Uint8Array | undefined;
  for (const e of entries) {
    if (!e.bytes) {
      const cls: ClipClass = e.error === 'large' ? 'too-large' : 'unread';
      rows.push({ name: e.name, size: e.size, cls, label: LABELS[cls], detail: e.error && e.error !== 'large' ? e.error : undefined });
      continue;
    }
    const r = await classifyClipboardBytes(e.bytes);
    rows.push({ name: e.name, size: e.size || e.bytes.length, cls: r.cls, label: LABELS[r.cls], detail: r.detail });
    if (r.deck) decks.push({ ...r.deck, from: e.name });
    else if (r.cls === 'gvml' && !gvml) gvml = e.bytes;
  }
  decks.sort((a, b) => DECK_ORDER.indexOf(a.format) - DECK_ORDER.indexOf(b.format));
  return { rows, decks, gvml };
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** The report the user can send for a follow-up fix. */
export function clipboardReport(rows: ClipRow[], context = ''): string {
  const lines = [`LightCast 클립보드 형식 보고${context ? ` (${context})` : ''}`, `형식 ${rows.length}개`, ''];
  for (const r of rows) lines.push(`${r.name}\t${formatBytes(r.size)}\t${r.cls}\t${r.label}${r.detail ? ` [${r.detail}]` : ''}`);
  return lines.join('\n');
}

/** A file name File › Open recognises for a deck read from the clipboard. */
export const deckFileName = (d: ClipDeck, base = '붙여넣은 슬라이드') => `${base}.${d.format}`;

/** Slide files a paste or drop carries (PowerPoint, OpenDocument and their templates / flat / drawing forms). */
export const DECK_FILE = /\.(pptx|pptm|ppsx|ppsm|potx|potm|ppt|pps|pot|odp|fodp|otp|odg|fodg|otg)$/i;
