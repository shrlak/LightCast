// Fonts embedded in a .pptx (p:embeddedFontLst). Pure byte / XML logic; the browser side (storing and
// registering the fonts) is in ../embeddedFonts.ts.
//
// What is read: plain TrueType / OpenType (Google Slides), ECMA-376 obfuscated parts (first 32 bytes XORed
// with the GUID of the part's file name) and uncompressed EOT. MicroType-Express compressed EOT (what
// PowerPoint itself writes for most fonts) cannot be decoded and is skipped.
import JSZip from 'jszip';

export type FontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';
export interface EmbeddedFontRef { typeface: string; style: FontStyle; target: string }
export interface DecodedFont { data: Uint8Array; format: 'truetype' | 'opentype' }
export interface ReadFont { family: string; style: FontStyle; data: Uint8Array; format: DecodedFont['format'] }

/** One font file is never larger than this, and a deck brings in at most this many / this many bytes. */
export const MAX_FONT_BYTES = 16 * 1024 * 1024;
export const MAX_FONTS_PER_DECK = 24;
export const MAX_DECK_FONT_BYTES = 64 * 1024 * 1024;

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (xml: string, name: string) => new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`).exec(xml)?.[1];
const STYLES: FontStyle[] = ['regular', 'bold', 'italic', 'boldItalic'];

/** The embedded fonts a presentation.xml lists, with the part each one lives in (relationships resolved). */
export function parseEmbeddedFontList(presentationXml: string, relsXml: string): EmbeddedFontRef[] {
  const list = /<p:embeddedFontLst\b[^>]*>([\s\S]*?)<\/p:embeddedFontLst>/.exec(presentationXml)?.[1];
  if (!list) return [];
  const targets = new Map<string, string>();
  for (const [tag] of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(tag, 'Id'), t = attr(tag, 'Target');
    if (id && t) targets.set(id, t);
  }
  const out: EmbeddedFontRef[] = [];
  for (const [, body] of list.matchAll(/<p:embeddedFont\b[^>]*>([\s\S]*?)<\/p:embeddedFont>/g)) {
    const face = /<p:font\b[^>]*>/.exec(body)?.[0];
    const typeface = face && attr(face, 'typeface');
    if (!typeface) continue;
    for (const style of STYLES) {
      const tag = new RegExp(`<p:${style}\\b[^>]*>`).exec(body)?.[0];
      const rid = tag && attr(tag, 'r:id');
      const target = rid && targets.get(rid);
      if (target) out.push({ typeface: decode(typeface), style, target: new URL(target, 'https://x/ppt/presentation.xml').pathname.slice(1) });
    }
  }
  return out;
}

/** The 16 key bytes of a part named like "{01234567-89AB-CDEF-0123-456789ABCDEF}.odttf" (or a bare GUID); null when it has no GUID. */
export function guidKey(partName: string): Uint8Array | null {
  const m = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/i.exec(partName.split('/').pop() ?? '');
  if (!m) return null;
  const hex = m.slice(1).join('');
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return bytes.reverse();
}

/** The odttf transform; it is its own inverse. Returns a copy. */
export function xorObfuscate(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = data.slice();
  for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= key[i % 16];
  return out;
}

/** 'truetype' / 'opentype' when the bytes start like a single-font sfnt, else null (a .ttc collection is not accepted). */
export function sfntFormat(b: Uint8Array): DecodedFont['format'] | null {
  if (b.length < 12) return null;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === 'OTTO') return 'opentype';
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || tag === 'true') return 'truetype';
  return null;
}

/** The OS/2 `fsType` embedding flags of an sfnt, or 0 when there is none. */
export function fsType(b: Uint8Array): number {
  if (!sfntFormat(b)) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(4);
  for (let i = 0; i < n && 12 + i * 16 + 16 <= b.length; i++) {
    const o = 12 + i * 16;
    if (String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === 'OS/2') {
      const at = v.getUint32(o + 8);
      return at + 10 <= b.length ? v.getUint16(at + 8) : 0;
    }
  }
  return 0;
}

/** Fonts whose licence forbids embedding (restricted licence or bitmap-only). */
export const mayEmbed = (b: Uint8Array) => (fsType(b) & 0x0302) === 0;

/** The font inside an uncompressed EOT file, or null (compressed, bad sizes). */
export function unwrapEot(b: Uint8Array): Uint8Array | null {
  if (b.length < 82) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint16(34, true) !== 0x504c) return null;
  const size = v.getUint32(0, true), fontSize = v.getUint32(4, true), flags = v.getUint32(12, true);
  if (flags & 0x4) return null; // MicroType Express compression
  if (size > b.length || fontSize === 0 || fontSize > size - 82) return null;
  const data = b.slice(size - fontSize, size);
  return flags & 0x10000000 ? data.map((x) => x ^ 0x50) : data;
}

/** An sfnt wrapped as an EOT (version 2.1, no compression, no name strings), the .fntdata form PowerPoint reads. */
export function wrapEot(font: Uint8Array): Uint8Array {
  const head = 100;
  const out = new Uint8Array(head + font.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, out.length, true);
  v.setUint32(4, font.length, true);
  v.setUint32(8, 0x00020001, true);
  v.setUint16(34, 0x504c, true);
  v.setUint8(26, 1); // charset DEFAULT
  v.setUint32(28, 400, true);
  out.set(font, head);
  return out;
}

/** Decode one embedded part: plain sfnt first, then uncompressed EOT, then the GUID obfuscation. Never throws. */
export function decodeFontPart(bytes: Uint8Array, partName: string): DecodedFont | null {
  try {
    if (!bytes.length || bytes.length > MAX_FONT_BYTES + 4096) return null;
    const tries: (Uint8Array | null)[] = [bytes];
    const eot = unwrapEot(bytes);
    if (eot) tries.push(eot);
    const key = guidKey(partName);
    if (key) tries.push(xorObfuscate(bytes, key));
    for (const t of tries) {
      const format = t && sfntFormat(t);
      if (t && format && t.length <= MAX_FONT_BYTES) return { data: t, format };
    }
  } catch { /* fall through */ }
  return null;
}

/** Every decodable embedded font of a .pptx, within the size caps. Bad or unsupported parts are skipped. */
export async function readEmbeddedFonts(file: ArrayBuffer | Uint8Array): Promise<{ fonts: ReadFont[]; skipped: number }> {
  const fonts: ReadFont[] = [];
  let skipped = 0;
  try {
    const zip = await JSZip.loadAsync(file);
    const pres = (await zip.file('ppt/presentation.xml')?.async('string')) ?? '';
    const rels = (await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')) ?? '';
    let total = 0;
    for (const ref of parseEmbeddedFontList(pres, rels)) {
      const part = zip.file(ref.target);
      if (!part || fonts.length >= MAX_FONTS_PER_DECK) { skipped++; continue; }
      const d = decodeFontPart(await part.async('uint8array'), ref.target);
      if (!d || total + d.data.length > MAX_DECK_FONT_BYTES) { skipped++; continue; }
      total += d.data.length;
      fonts.push({ family: ref.typeface, style: ref.style, data: d.data, format: d.format });
    }
  } catch { /* a damaged file brings in no fonts */ }
  return { fonts, skipped };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The font families named anywhere in (a slice of) the deck: every `fontFamily` value, first face of each stack, generic names left out. */
export function usedFamilies(root: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) return x.forEach(walk);
    for (const [k, v] of Object.entries(x)) {
      if (k === 'fontFamily' && typeof v === 'string') {
        const first = v.split(',')[0].replace(/["']/g, '').trim();
        if (first && !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit)$/i.test(first)) found.add(first);
      } else walk(v);
    }
  };
  walk(root);
  return [...found];
}

/**
 * Add embedded fonts to a finished .pptx: the font parts, their relationships, the content type and the
 * p:embeddedFontLst of presentation.xml. Returns how many were written; the zip is left alone on any problem.
 */
export async function embedFontsInZip(zip: JSZip, fonts: { family: string; style: FontStyle; data: Uint8Array }[]): Promise<number> {
  const usable = fonts.filter((f) => sfntFormat(f.data) && mayEmbed(f.data) && f.data.length <= MAX_FONT_BYTES).slice(0, MAX_FONTS_PER_DECK);
  if (!usable.length) return 0;
  const presFile = zip.file('ppt/presentation.xml'), relsFile = zip.file('ppt/_rels/presentation.xml.rels'), typesFile = zip.file('[Content_Types].xml');
  if (!presFile || !relsFile || !typesFile) return 0;
  let pres = await presFile.async('string');
  let rels = await relsFile.async('string');
  let types = await typesFile.async('string');
  const notes = /<p:notesSz\b[^>]*\/>/.exec(pres);
  if (pres.includes('<p:embeddedFontLst') || !notes) return 0;
  const byFamily = new Map<string, typeof usable>();
  for (const f of usable) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f]);
  const parts: [string, Uint8Array][] = [];
  let n = 0, total = 0;
  let xml = '<p:embeddedFontLst>';
  for (const [family, list] of byFamily) {
    let entry = `<p:embeddedFont><p:font typeface="${esc(family)}"/>`;
    let any = false;
    for (const f of list) {
      if (total + f.data.length > MAX_DECK_FONT_BYTES) continue;
      total += f.data.length;
      const id = `rIdLcFont${++n}`;
      any = true;
      parts.push([`ppt/fonts/font${n}.fntdata`, wrapEot(f.data)]);
      rels = rels.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.fntdata"/></Relationships>`);
      entry += `<p:${f.style} r:id="${id}"/>`;
    }
    if (any) xml += `${entry}</p:embeddedFont>`;
  }
  xml += '</p:embeddedFontLst>';
  if (!n) return 0;
  pres = pres.replace(notes[0], notes[0] + xml);
  if (!/Extension="fntdata"/i.test(types)) types = types.replace(/<Override/, '<Default Extension="fntdata" ContentType="application/x-fontdata"/><Override');
  for (const [name, data] of parts) zip.file(name, data);
  zip.file('ppt/presentation.xml', pres);
  zip.file('ppt/_rels/presentation.xml.rels', rels);
  zip.file('[Content_Types].xml', types);
  return n;
}
