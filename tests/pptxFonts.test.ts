import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { decodeFontPart, embedFontsInZip, guidKey, mayEmbed, parseEmbeddedFontList, readEmbeddedFonts, unwrapEot, usedFamilies, wrapEot, xorObfuscate } from '../src/domain/io/pptxFonts';

/** A tiny fake sfnt: TrueType header with one OS/2 table holding `fs` as fsType. */
function fakeFont(fs = 0): Uint8Array {
  const b = new Uint8Array(12 + 16 + 20 + 64);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x4f, 0x53, 0x2f, 0x32], 12);
  v.setUint32(20, 28); // the table starts right after the directory
  v.setUint16(12 + 16 + 8, fs);
  for (let i = 60; i < b.length; i++) b[i] = i;
  return b;
}
const GUID = '{01234567-89AB-CDEF-0123-456789ABCDEF}';

describe('obfuscated fonts', () => {
  it('reads the key from the GUID file name and un-XORs the first 32 bytes', () => {
    const key = guidKey(`ppt/fonts/${GUID}.fntdata`)!;
    expect([...key.slice(0, 3)]).toEqual([0xef, 0xcd, 0xab]);
    const font = fakeFont();
    const hidden = xorObfuscate(font, key);
    expect(hidden).not.toEqual(font);
    expect(hidden.slice(32)).toEqual(font.slice(32));
    const d = decodeFontPart(hidden, `ppt/fonts/${GUID}.fntdata`);
    expect(d?.format).toBe('truetype');
    expect(d?.data).toEqual(font);
  });
  it('takes a plain font as it is and refuses garbage, empty and oversize data without throwing', () => {
    expect(decodeFontPart(fakeFont(), 'ppt/fonts/font1.fntdata')?.format).toBe('truetype');
    expect(decodeFontPart(new Uint8Array(500).fill(7), 'ppt/fonts/font1.fntdata')).toBeNull();
    expect(decodeFontPart(new Uint8Array(0), 'x')).toBeNull();
    expect(decodeFontPart(new Uint8Array(17 * 1024 * 1024), 'x')).toBeNull();
  });
});

describe('EOT', () => {
  it('unwraps an uncompressed EOT and skips a compressed one', () => {
    const font = fakeFont();
    const eot = wrapEot(font);
    expect(unwrapEot(eot)).toEqual(font);
    expect(decodeFontPart(eot, 'ppt/fonts/font1.fntdata')?.data).toEqual(font);
    new DataView(eot.buffer).setUint32(12, 4, true);
    expect(unwrapEot(eot)).toBeNull();
    expect(decodeFontPart(eot, 'ppt/fonts/font1.fntdata')).toBeNull();
  });
});

describe('embedding licence', () => {
  it('does not embed restricted-licence fonts', () => {
    expect(mayEmbed(fakeFont(0))).toBe(true);
    expect(mayEmbed(fakeFont(0x0002))).toBe(false);
  });
});

const PRES = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="1" cy="1"/><p:notesSz cx="1" cy="1"/></p:presentation>';
const RELS = '<Relationships></Relationships>';
const TYPES = '<Types><Default Extension="xml" ContentType="application/xml"/><Override PartName="/x" ContentType="y"/></Types>';
const newZip = () => new JSZip().file('ppt/presentation.xml', PRES).file('ppt/_rels/presentation.xml.rels', RELS).file('[Content_Types].xml', TYPES);

describe('pptx round trip', () => {
  it('writes p:embeddedFontLst and reads it back', async () => {
    const zip = newZip();
    const n = await embedFontsInZip(zip, [{ family: 'Nanum & Co', style: 'regular', data: fakeFont() }, { family: 'Nanum & Co', style: 'bold', data: fakeFont() }, { family: 'Locked', style: 'regular', data: fakeFont(2) }]);
    expect(n).toBe(2);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="fntdata"');
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    expect(pres.indexOf('<p:notesSz')).toBeLessThan(pres.indexOf('<p:embeddedFontLst'));
    const list = parseEmbeddedFontList(pres, await zip.file('ppt/_rels/presentation.xml.rels')!.async('string'));
    expect(list.map((x) => [x.typeface, x.style, x.target])).toEqual([['Nanum & Co', 'regular', 'ppt/fonts/font1.fntdata'], ['Nanum & Co', 'bold', 'ppt/fonts/font2.fntdata']]);
    const { fonts, skipped } = await readEmbeddedFonts(await zip.generateAsync({ type: 'uint8array' }));
    expect(skipped).toBe(0);
    expect(fonts.map((f) => f.family)).toEqual(['Nanum & Co', 'Nanum & Co']);
  });
  it('counts undecodable parts as skipped and survives a non-zip', async () => {
    const zip = newZip();
    zip.file('ppt/presentation.xml', PRES.replace('</p:presentation>', '<p:embeddedFontLst><p:embeddedFont><p:font typeface="X"/><p:regular r:id="rId9"/></p:embeddedFont></p:embeddedFontLst></p:presentation>'));
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId9" Target="fonts/font1.fntdata"/></Relationships>');
    zip.file('ppt/fonts/font1.fntdata', new Uint8Array(100).fill(9));
    const r = await readEmbeddedFonts(await zip.generateAsync({ type: 'uint8array' }));
    expect(r).toEqual({ fonts: [], skipped: 1 });
    expect(await readEmbeddedFonts(new Uint8Array([1, 2, 3]))).toEqual({ fonts: [], skipped: 0 });
  });
  it('leaves a file that already lists fonts alone', async () => {
    const zip = newZip();
    zip.file('ppt/presentation.xml', PRES.replace('</p:presentation>', '<p:embeddedFontLst/></p:presentation>'));
    expect(await embedFontsInZip(zip, [{ family: 'A', style: 'regular', data: fakeFont() }])).toBe(0);
  });
});

describe('usedFamilies', () => {
  it('collects the first face of each fontFamily, not generic names', () => {
    expect(usedFamilies({ a: [{ fontFamily: '"Nanum Gothic", sans-serif' }], t: { fontFamily: 'Calibri, Carlito' }, g: { fontFamily: 'serif' } }).sort()).toEqual(['Calibri', 'Nanum Gothic']);
  });
});
