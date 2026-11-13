// Reads the facts LightCast needs from a font file a person imports: family, style name, weight, italic,
// licence embedding flags. .ttf / .otf / .ttc (collections are split into one standalone font per face),
// .woff (zlib tables are inflated to read the name table), .woff2 (Brotli: the tables are not read here, the
// name comes from the file name; the browser itself still loads the font). Pure byte logic, never throws:
// bad data gives `{ faces: [], error }`.

export type FontFileFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

export interface ParsedFont {
  /** The family as written in the file (typographic family when there is one, so weights group). */
  family: string;
  subfamily: string;
  fullName: string;
  /** CSS weight 100–900 (OS/2 usWeightClass snapped). */
  weight: number;
  /** For a variable font with a weight axis: its range. */
  weightRange?: [number, number];
  italic: boolean;
  /** OS/2 fsType embedding flags (0 when the font has no OS/2 table). */
  fsType: number;
  format: FontFileFormat;
  /** True when family / weight had to be guessed from the file name (WOFF2, or a font without a name table). */
  nameFromFile: boolean;
  /** The bytes to register with FontFace (a face of a collection is extracted as a standalone font). */
  data: Uint8Array;
}

export interface ParseResult { faces: ParsedFont[]; error?: string }

export const MAX_FONT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TABLES = 128;
const MAX_FACES = 64;
const MAX_NAME_RECORDS = 4000;

const tagAt = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** CSS weight 100–900 from an OS/2 usWeightClass (1–1000; the 1–9 spelling is accepted too). */
export function weightFromClass(c: number): number {
  if (!Number.isFinite(c) || c <= 0) return 400;
  const w = c <= 9 ? c * 100 : c;
  return Math.min(900, Math.max(100, Math.round(w / 100) * 100));
}

/** Weight and italic guessed from a style / file name ("Bold Italic", "Noto-Light", "SemiBold"). */
export function styleFromName(name: string): { weight: number; italic: boolean } {
  const s = name.toLowerCase().replace(/[-_]/g, ' ');
  const italic = /\b(italic|oblique)\b|italic$/.test(s);
  const table: [RegExp, number][] = [
    [/extra ?black|ultra ?black|heavy|black/, 900], [/extra ?bold|ultra ?bold/, 800], [/semi ?bold|demi ?bold|demi/, 600],
    [/extra ?light|ultra ?light/, 200], [/thin|hairline/, 100], [/light/, 300], [/medium/, 500], [/bold/, 700],
  ];
  for (const [re, w] of table) if (re.test(s)) return { weight: w, italic };
  return { weight: 400, italic };
}

interface Table { tag: string; offset: number; length: number; checksum: number }

function readDirectory(b: Uint8Array, base: number): Table[] | null {
  if (base + 12 > b.length) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(base + 4);
  if (n === 0 || n > MAX_TABLES || base + 12 + n * 16 > b.length) return null;
  const out: Table[] = [];
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 16;
    const offset = v.getUint32(o + 8), length = v.getUint32(o + 12);
    if (offset > b.length || length > b.length - offset) continue;
    out.push({ tag: tagAt(b, o), offset, length, checksum: v.getUint32(o + 4) });
  }
  return out.length ? out : null;
}

function decodeName(b: Uint8Array, platform: number, start: number, len: number): string {
  if (len <= 0 || len > 1000 || start + len > b.length) return '';
  let s = '';
  if (platform === 3 || platform === 0) for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode((b[start + i] << 8) | b[start + i + 1]);
  else for (let i = 0; i < len; i++) s += String.fromCharCode(b[start + i]);
  return s.replace(/\0/g, '').trim();
}

/** name-table strings by nameID; Windows (3) beats Unicode (0) beats Mac (1), English preferred. */
function readNames(b: Uint8Array, t: Table): Map<number, string> {
  const out = new Map<number, string>();
  const rank = new Map<number, number>();
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const count = Math.min(v.getUint16(t.offset + 2), MAX_NAME_RECORDS);
    const strings = t.offset + v.getUint16(t.offset + 4);
    for (let i = 0; i < count; i++) {
      const o = t.offset + 6 + i * 12;
      if (o + 12 > t.offset + t.length) break;
      const platform = v.getUint16(o), lang = v.getUint16(o + 4), id = v.getUint16(o + 6);
      const text = decodeName(b, platform, strings + v.getUint16(o + 10), v.getUint16(o + 8));
      if (!text) continue;
      const score = (platform === 3 ? 30 : platform === 0 ? 20 : 10) + (lang === 0x409 || lang === 0 ? 5 : 0);
      if (score > (rank.get(id) ?? -1)) { rank.set(id, score); out.set(id, text); }
    }
  } catch { /* a damaged name table gives what was read so far */ }
  return out;
}

const STYLE_WORDS = /[-_ ](regular|bold|italic|light|medium|thin|black|semibold|extrabold|extralight|oblique|variable).*$/i;

/** The facts of one sfnt (the whole file, or a face already extracted). */
function readSfnt(b: Uint8Array, base: number, fileName: string): Omit<ParsedFont, 'format' | 'data'> | null {
  const tables = readDirectory(b, base);
  if (!tables) return null;
  const find = (tag: string) => tables.find((t) => t.tag === tag);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nameTable = find('name');
  const names = nameTable ? readNames(b, nameTable) : new Map<number, string>();
  const stem = fileName.replace(/\.[^.]+$/, '');
  const guess = styleFromName(stem);
  const fileFamily = stem.replace(STYLE_WORDS, '').replace(/[-_]+/g, ' ').trim();
  const family = (names.get(16) || names.get(1) || '').trim() || fileFamily;
  if (!family) return null;
  const subfamily = names.get(17) || names.get(2) || '';
  let weight: number, italic: boolean, fsTypeVal = 0, haveOs2 = false;
  const os2 = find('OS/2');
  if (os2 && os2.length >= 64) {
    haveOs2 = true;
    weight = weightFromClass(v.getUint16(os2.offset + 4));
    fsTypeVal = v.getUint16(os2.offset + 8);
    italic = (v.getUint16(os2.offset + 62) & 1) !== 0;
  } else {
    const fromStyle = styleFromName(subfamily);
    weight = fromStyle.weight !== 400 ? fromStyle.weight : guess.weight;
    italic = fromStyle.italic || guess.italic;
  }
  const head = find('head');
  if (!haveOs2 && head && head.length >= 46 && (v.getUint16(head.offset + 44) & 2)) italic = true;
  let weightRange: [number, number] | undefined;
  const fvar = find('fvar');
  try {
    if (fvar && fvar.length >= 16) {
      const axesAt = fvar.offset + v.getUint16(fvar.offset + 4), n = Math.min(v.getUint16(fvar.offset + 8), 16), size = v.getUint16(fvar.offset + 10);
      for (let i = 0; i < n && size >= 20; i++) {
        const o = axesAt + i * size;
        if (o + 20 > b.length) break;
        if (tagAt(b, o) === 'wght') {
          const lo = v.getInt32(o + 4) / 65536, hi = v.getInt32(o + 12) / 65536;
          if (lo >= 1 && hi >= lo) weightRange = [weightFromClass(lo), weightFromClass(hi)];
        }
      }
    }
  } catch { /* no variable range */ }
  const fullName = names.get(4) || [family, subfamily].filter(Boolean).join(' ');
  return { family, subfamily, fullName, weight, weightRange, italic, fsType: fsTypeVal, nameFromFile: !(names.get(16) || names.get(1)) };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** A standalone sfnt made from one face of a collection: its tables copied behind a fresh directory. */
export function extractFace(b: Uint8Array, base: number): Uint8Array | null {
  const tables = readDirectory(b, base);
  if (!tables) return null;
  let size = 12 + tables.length * 16;
  for (const t of tables) size += pad4(t.length);
  if (size > MAX_FONT_FILE_BYTES) return null;
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  out.set(b.subarray(base, base + 4), 0);
  ov.setUint16(4, tables.length);
  let search = 1, log = 0;
  while (search * 2 <= tables.length) { search *= 2; log++; }
  ov.setUint16(6, search * 16); ov.setUint16(8, log); ov.setUint16(10, tables.length * 16 - search * 16);
  let at = 12 + tables.length * 16;
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k);
    ov.setUint32(o + 4, t.checksum);
    ov.setUint32(o + 8, at);
    ov.setUint32(o + 12, t.length);
    out.set(b.subarray(t.offset, t.offset + t.length), at);
    at += pad4(t.length);
  });
  return out;
}

/** WOFF 1 → sfnt (tables inflated with the platform's DecompressionStream); null when it cannot be done. */
export async function woffToSfnt(b: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (b.length < 44 || tagAt(b, 0) !== 'wOFF') return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = v.getUint16(12), total = v.getUint32(16);
    if (n === 0 || n > MAX_TABLES || total > MAX_FONT_FILE_BYTES || 44 + n * 20 > b.length) return null;
    const tables: { tag: string; data: Uint8Array; checksum: number }[] = [];
    let size = 12 + n * 16;
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20;
      const off = v.getUint32(o + 4), comp = v.getUint32(o + 8), orig = v.getUint32(o + 12);
      if (off > b.length || comp > b.length - off || orig > MAX_FONT_FILE_BYTES) return null;
      let data = b.subarray(off, off + comp);
      if (comp < orig) {
        if (typeof DecompressionStream === 'undefined') return null;
        const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
        if (data.length !== orig) return null;
      }
      tables.push({ tag: tagAt(b, o), data, checksum: v.getUint32(o + 16) });
      size += pad4(data.length);
    }
    if (size > MAX_FONT_FILE_BYTES) return null;
    const out = new Uint8Array(size), ov = new DataView(out.buffer);
    ov.setUint32(0, v.getUint32(4));
    ov.setUint16(4, n);
    let search = 1, log = 0;
    while (search * 2 <= n) { search *= 2; log++; }
    ov.setUint16(6, search * 16); ov.setUint16(8, log); ov.setUint16(10, n * 16 - search * 16);
    let at = 12 + n * 16;
    tables.forEach((t, i) => {
      const o = 12 + i * 16;
      for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k);
      ov.setUint32(o + 4, t.checksum);
      ov.setUint32(o + 8, at);
      ov.setUint32(o + 12, t.data.length);
      out.set(t.data, at);
      at += pad4(t.data.length);
    });
    return out;
  } catch { return null; }
}

/** Parse a font file. Never throws; a file that is not a usable font gives an `error` in Korean. */
export async function parseFontFile(bytes: Uint8Array, fileName = ''): Promise<ParseResult> {
  try {
    if (!bytes.length) return { faces: [], error: '빈 파일입니다.' };
    if (bytes.length > MAX_FONT_FILE_BYTES) return { faces: [], error: '글꼴 파일이 너무 큽니다(32MB 이하).' };
    if (bytes.length < 12) return { faces: [], error: '글꼴 파일이 아닙니다.' };
    const tag = tagAt(bytes, 0);
    const isSfnt = tag === 'OTTO' || tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0);
    if (isSfnt) {
      const info = readSfnt(bytes, 0, fileName);
      if (!info) return { faces: [], error: '글꼴 정보를 읽지 못했습니다.' };
      return { faces: [{ ...info, format: tag === 'OTTO' ? 'opentype' : 'truetype', data: bytes }] };
    }
    if (tag === 'ttcf') {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const n = Math.min(v.getUint32(8), MAX_FACES);
      const faces: ParsedFont[] = [];
      for (let i = 0; i < n && 12 + i * 4 + 4 <= bytes.length; i++) {
        const base = v.getUint32(12 + i * 4);
        const info = base + 12 <= bytes.length ? readSfnt(bytes, base, fileName) : null;
        const data = info ? extractFace(bytes, base) : null;
        if (info && data) faces.push({ ...info, format: tagAt(bytes, base) === 'OTTO' ? 'opentype' : 'truetype', data });
      }
      return faces.length ? { faces } : { faces: [], error: '글꼴 모음(.ttc)을 읽지 못했습니다.' };
    }
    if (tag === 'wOFF') {
      const sfnt = await woffToSfnt(bytes);
      const info = sfnt ? readSfnt(sfnt, 0, fileName) : null;
      if (!info) return { faces: [], error: 'WOFF 글꼴을 읽지 못했습니다.' };
      return { faces: [{ ...info, format: 'woff', data: bytes }] };
    }
    if (tag === 'wOF2') {
      const stem = fileName.replace(/\.[^.]+$/, '');
      const s = styleFromName(stem);
      const family = stem.replace(STYLE_WORDS, '').replace(/[-_]+/g, ' ').trim();
      if (!family) return { faces: [], error: 'WOFF2 글꼴의 이름을 알 수 없습니다. 파일 이름에 글꼴 이름이 있어야 합니다.' };
      return { faces: [{ family, subfamily: '', fullName: stem, weight: s.weight, italic: s.italic, fsType: 0, format: 'woff2', nameFromFile: true, data: bytes }] };
    }
    return { faces: [], error: '글꼴 파일(.ttf .otf .woff .woff2 .ttc)이 아닙니다.' };
  } catch {
    return { faces: [], error: '글꼴 파일을 읽지 못했습니다.' };
  }
}

/** Licence: the font's fsType forbids embedding in documents (restricted licence / bitmap only). */
export const embeddingForbidden = (fsType: number): boolean => (fsType & 0x0302) !== 0;

/** The CSS @font-face weight descriptor of a parsed font ("700", or "100 900" for a variable font). */
export const cssWeightDescriptor = (f: Pick<ParsedFont, 'weight' | 'weightRange'>): string =>
  f.weightRange && f.weightRange[0] !== f.weightRange[1] ? `${f.weightRange[0]} ${f.weightRange[1]}` : String(f.weightRange?.[0] ?? f.weight);
