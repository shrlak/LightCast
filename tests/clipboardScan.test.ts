// What a paste finds on the clipboard, told apart by signature; whole decks (20 slides) through the same readers as
// File › Open. Fixtures are real LibreOffice output from a python-pptx deck (tests/fixtures/real/clipboard/README.md).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { classifyClipboardBytes, clipboardReport, scanClipboardEntries, type ClipDeck, type ClipEntry } from '../src/domain/clipboardScan';
import { writeCfb } from '../src/domain/io/cfbWrite';
import { parseOdp } from '../src/domain/io/odp';
import { importPpt } from '../src/domain/io/pptImport';
import { importPptx } from '../src/domain/io/pptxImport';
import { importClipboardDecks } from '../src/ui/clipboardSlides';
import { OPENDOCUMENT_FILE, SLIDE_DECK_ACCEPT, SLIDE_DECK_FILE } from '../src/ui/importFiles';
import type { Slide } from '../src/domain/types';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/clipboard/${n}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);
const EXPECTED = Array.from({ length: 20 }, (_, i) => `슬라이드 ${String(i + 1).padStart(2, '0')} 제목`);

/** What File › Open's readers give for these bytes, without a browser. */
async function readDeck(deck: ClipDeck): Promise<Slide[]> {
  if (deck.format === 'odp' || deck.format === 'fodp') return (await parseOdp(deck.bytes, { storeImage: (b, m) => `img:${m}:${b.length}` })).slides;
  if (deck.format === 'ppt') {
    let n = 0;
    return (await importPpt(deck.bytes, 'clip.ppt', { group: 'g', newId: (p) => `${p}${++n}`, store: async () => 'm1' })).slides;
  }
  return (await importPptx(new Blob([deck.bytes as BlobPart]))).map((s, i) => ({ id: `s${i}`, group: 'g', text: s.text, title: s.title, notes: s.notes }) as Slide);
}

/** An OLE "Ole10Native" stream: size, flags, label, source path, unused, temp path, size, data. */
function ole10(label: string, data: Uint8Array): Uint8Array {
  const z = (s: string) => [...enc(s), 0];
  const head = [2, 0, ...z(label), ...z(`C:\\${label}`), 0, 0, 0, 0, 0, 0, 0, 0 /* temp path length 0 */];
  const out = new Uint8Array(4 + head.length + 4 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, out.length - 4, true);
  out.set(head, 4);
  dv.setUint32(4 + head.length, data.length, true);
  out.set(data, 4 + head.length + 4);
  return out;
}

describe('classifying clipboard bytes by signature', () => {
  it('knows a whole .pptx (and counts its slides) apart from PowerPoint shapes (GVML) and other zips', async () => {
    const pptx = await classifyClipboardBytes(fx('deck20.pptx'));
    expect(pptx).toMatchObject({ cls: 'pptx', deck: { format: 'pptx', slideCount: 20 } });
    const gvml = new JSZip();
    gvml.file('[Content_Types].xml', '<Types><Override PartName="/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagram+xml"/></Types>');
    gvml.file('drawing1.xml', '<a:graphic/>');
    expect((await classifyClipboardBytes(await gvml.generateAsync({ type: 'uint8array' }))).cls).toBe('gvml');
    const docx = new JSZip();
    docx.file('[Content_Types].xml', '<Types/>'); docx.file('word/document.xml', '<w:document/>');
    expect((await classifyClipboardBytes(await docx.generateAsync({ type: 'uint8array' }))).cls).toBe('office-other');
    const plain = new JSZip(); plain.file('a.txt', 'hello world, not a document');
    expect((await classifyClipboardBytes(await plain.generateAsync({ type: 'uint8array' }))).cls).toBe('zip');
  });

  it('a pptx is told by its content type even when the part name differs', async () => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<Types><Override PartName="/x.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml"/></Types>');
    expect((await classifyClipboardBytes(await z.generateAsync({ type: 'uint8array' }))).deck?.format).toBe('pptx');
  });

  it('knows .ppt (a compound file with a PowerPoint Document stream), .odp, templates and drawings', async () => {
    expect(await classifyClipboardBytes(fx('deck20.ppt'))).toMatchObject({ cls: 'ppt', deck: { format: 'ppt' } });
    expect(await classifyClipboardBytes(fx('deck20.odp'))).toMatchObject({ cls: 'odp', deck: { format: 'odp' } });
    expect(await classifyClipboardBytes(fx('deck20.otp'))).toMatchObject({ cls: 'odp', detail: 'application/vnd.oasis.opendocument.presentation-template' });
    expect(await classifyClipboardBytes(fx('deck20.odg'))).toMatchObject({ cls: 'odp', detail: 'application/vnd.oasis.opendocument.graphics' });
  });

  it('knows flat XML OpenDocument (.fodp), also with a BOM or UTF-16', async () => {
    expect(await classifyClipboardBytes(fx('deck20.fodp'))).toMatchObject({ cls: 'fodp', deck: { format: 'fodp' } });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...fx('deck20.fodp')]);
    expect((await classifyClipboardBytes(bom)).cls).toBe('fodp');
  });

  it('finds a presentation inside an OLE embedding (Embed Source: Package or Ole10Native)', async () => {
    const pptx = fx('deck20.pptx');
    const viaPackage = writeCfb([{ name: 'Package', data: pptx }, { name: '\u0001CompObj', data: new Uint8Array(40) }]);
    expect(await classifyClipboardBytes(viaPackage)).toMatchObject({ cls: 'pptx-in-ole', deck: { format: 'pptx', slideCount: 20 }, detail: 'Package' });
    const viaNative = writeCfb([{ name: '\u0001Ole10Native', data: ole10('deck.pptx', pptx) }]);
    expect(await classifyClipboardBytes(viaNative)).toMatchObject({ cls: 'pptx-in-ole', deck: { format: 'pptx' } });
    const wrappedPpt = writeCfb([{ name: 'Package', data: fx('deck20.ppt') }]);
    expect(await classifyClipboardBytes(wrappedPpt)).toMatchObject({ cls: 'ppt-in-ole', deck: { format: 'ppt' } });
    // An OLE file with neither is only listed.
    expect((await classifyClipboardBytes(writeCfb([{ name: 'WordDocument', data: new Uint8Array(100) }]))).cls).toBe('cfb');
  });

  it('classifies the picture and text formats', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect((await classifyClipboardBytes(png)).cls).toBe('png');
    expect((await classifyClipboardBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).cls).toBe('jpeg');
    const emf = new Uint8Array(64); emf[0] = 1; emf.set(enc(' EMF'), 40);
    expect((await classifyClipboardBytes(emf)).cls).toBe('emf');
    expect((await classifyClipboardBytes(new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0]))).cls).toBe('wmf');
    expect((await classifyClipboardBytes(enc('{\\rtf1\\ansi Hello}'))).cls).toBe('rtf');
    expect((await classifyClipboardBytes(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).cls).toBe('svg');
    expect((await classifyClipboardBytes(enc('Version:0.9\r\nStartHTML:0000000105\r\n<html><body>x</body></html>'))).cls).toBe('html');
    expect((await classifyClipboardBytes(enc('<p>안녕</p>'))).cls).toBe('html');
    expect((await classifyClipboardBytes(enc('그냥 글자'))).cls).toBe('text');
    expect((await classifyClipboardBytes(new Uint8Array([1, 2, 3, 0, 5, 6, 0, 8]))).cls).toBe('unknown');
    expect((await classifyClipboardBytes(new Uint8Array(0))).cls).toBe('empty');
  });

  it('never throws on damaged data', async () => {
    const pptx = fx('deck20.pptx');
    for (const bytes of [pptx.slice(0, 5000), pptx.slice(0, 30), fx('deck20.ppt').slice(0, 700), fx('deck20.fodp').slice(0, 3000), new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])]) {
      const r = await classifyClipboardBytes(bytes);
      expect(typeof r.cls).toBe('string');
    }
  });
});

describe('scanning a whole clipboard', () => {
  const ppEntries = (): ClipEntry[] => [
    { name: 'text/plain', size: 10, bytes: enc('슬라이드 01 제목') },
    { name: 'text/html', size: 60, bytes: enc('<html><body><p>x</p></body></html>') },
    { name: 'Object Descriptor', size: 12, bytes: new Uint8Array([9, 9, 9, 0, 1, 1, 1, 1]) },
    { name: 'Embed Source', size: fx('deck20.ppt').length, bytes: fx('deck20.ppt') },
    { name: 'PowerPoint 12.0 Internal Slides', size: fx('deck20.pptx').length, bytes: fx('deck20.pptx') },
    { name: 'image/png', size: 8, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
    { name: 'Huge', size: 300e6, error: 'large' },
    { name: 'Odd', size: 0, error: 'refused' },
  ];

  it('classifies by the bytes, not the name; the richest form of the slides comes first', async () => {
    const scan = await scanClipboardEntries(ppEntries());
    expect(scan.rows.find((r) => r.name === 'PowerPoint 12.0 Internal Slides')?.cls).toBe('pptx');
    expect(scan.rows.find((r) => r.name === 'Embed Source')?.cls).toBe('ppt');
    expect(scan.rows.find((r) => r.name === 'Huge')?.cls).toBe('too-large');
    expect(scan.rows.find((r) => r.name === 'Odd')).toMatchObject({ cls: 'unread', detail: 'refused' });
    expect(scan.decks.map((d) => [d.format, d.from])).toEqual([['pptx', 'PowerPoint 12.0 Internal Slides'], ['ppt', 'Embed Source']]);
  });

  it('a LibreOffice-style clipboard: Star EMBS (an .odp package) is a deck, the drawing format is only listed', async () => {
    const scan = await scanClipboardEntries([
      { name: 'application/x-openoffice-embed-source-xml;windows_formatname="Star EMBS"', size: 1, bytes: fx('deck20.odp') },
      { name: 'application/x-openoffice-drawing;windows_formatname="Drawing Format"', size: 4, bytes: new Uint8Array([3, 0, 1, 0, 9, 9]) },
    ]);
    expect(scan.decks).toHaveLength(1);
    expect(scan.decks[0].format).toBe('odp');
    expect(scan.rows[1].cls).toBe('unknown');
  });

  it('shapes only (GVML) give no deck; the report lists every format', async () => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<Types><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagram+xml"/></Types>'); z.file('drawing.xml', '<a/>');
    const scan = await scanClipboardEntries([{ name: 'Art::GVML ClipFormat', size: 1, bytes: await z.generateAsync({ type: 'uint8array' }) }]);
    expect(scan.decks).toHaveLength(0);
    expect(scan.gvml).toBeTruthy();
    const report = clipboardReport(ppEntriesRows(await scanClipboardEntries(ppEntries())), 'test');
    expect(report).toContain('Embed Source');
    expect(report).toContain('형식 8개');
  });
});
const ppEntriesRows = (s: { rows: import('../src/domain/clipboardScan').ClipRow[] }) => s.rows;

describe('20 slides copied from PowerPoint / LibreOffice arrive in order through the File › Open readers', () => {
  const toSlides = (file: File) => file.arrayBuffer().then(async (b) => {
    const bytes = new Uint8Array(b);
    return readDeck({ format: file.name.split('.').pop() as ClipDeck['format'], bytes, from: file.name });
  });

  it.each([['pptx', 'deck20.pptx'], ['ppt', 'deck20.ppt'], ['odp', 'deck20.odp'], ['fodp', 'deck20.fodp'], ['otp (as odp)', 'deck20.otp']])('%s: 20 slides, in order, with text', async (_n, file) => {
    const bytes = fx(file);
    const c = await classifyClipboardBytes(bytes);
    expect(c.deck, file).toBeTruthy();
    const started = Date.now();
    const out = await importClipboardDecks([{ ...c.deck!, from: file }], toSlides);
    expect(out.errors).toEqual([]);
    expect(out.slides).toHaveLength(20);
    const texts = out.slides.map((s) => [s.title, s.text, ...(s.elements ?? []).map((e) => e.text)].join(' '));
    EXPECTED.forEach((t, i) => expect(texts[i], `${file} slide ${i + 1}`).toContain(t.replace(' 제목', '')));
    expect(Date.now() - started).toBeLessThan(15000);
  });

  it('falls back to the next form when the first gives no slides, and never throws', async () => {
    const broken: ClipDeck = { format: 'pptx', bytes: fx('deck20.pptx').slice(0, 3000), from: 'broken' };
    const good: ClipDeck = { format: 'odp', bytes: fx('deck20.odp'), from: 'good' };
    const out = await importClipboardDecks([broken, good], toSlides);
    expect(out.used?.from).toBe('good');
    expect(out.slides).toHaveLength(20);
    expect(out.errors).toHaveLength(1);
    const none = await importClipboardDecks([broken], toSlides);
    expect(none.slides).toEqual([]);
    expect(none.errors[0]).toContain('broken');
  });

  it('keeps shapes, tables, notes and backgrounds of an .odp, a .fodp and an .otp alike', async () => {
    for (const n of ['deck20.odp', 'deck20.fodp', 'deck20.otp']) {
      const doc = await parseOdp(fx(n), { storeImage: () => 'x' });
      const s = doc.slides[2];
      expect(s.notes, n).toBe('발표자 노트 3');
      expect(s.background, n).toMatchObject({ kind: 'color', value: '#24285a' });
      expect(s.elements!.map((e) => e.kind), n).toEqual(['text', 'shape', 'table']);
    }
  });
});

describe('LibreOffice flat XML, templates and drawings', () => {
  it('reads a .fodp with pictures stored as base64', async () => {
    const stored: string[] = [];
    const doc = await parseOdp(fx('libreoffice-rich.fodp'), { storeImage: (b, mime) => { stored.push(`${mime}:${b.length}`); return `img${stored.length}`; } });
    expect(doc.slides).toHaveLength(5);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((s) => /^image\/(png|jpeg|svg\+xml|gif):\d+$/.test(s) && Number(s.split(':')[1]) > 100)).toBe(true);
    const imgs = doc.slides.flatMap((s) => s.elements ?? []).filter((e) => e.kind === 'image');
    expect(imgs.length).toBeGreaterThan(0);
    // The same slides as the zip it was made from.
    const zip = await parseOdp(new Uint8Array(readFileSync(new URL('./fixtures/real/odp/libreoffice-rich.odp', import.meta.url))), { storeImage: () => 'x' });
    expect(doc.slides.map((s) => (s.elements ?? []).length)).toEqual(zip.slides.map((s) => (s.elements ?? []).length));
  });

  it('reads a .odg drawing: one slide per page', async () => {
    const doc = await parseOdp(fx('deck20.odg'), { storeImage: () => 'x' });
    expect(doc.slides).toHaveLength(20);
    expect(doc.slides[6].elements!.some((e) => /슬라이드/.test(e.text ?? ''))).toBe(true);
  });

  it('refuses text that is not an OpenDocument presentation, with a Korean message', async () => {
    await expect(parseOdp(enc('<?xml version="1.0"?><html><body>no</body></html>'), { storeImage: () => 'x' })).rejects.toThrow(/OpenDocument/);
    await expect(parseOdp(enc('<office:document xmlns:office="o" office:mimetype="application/vnd.oasis.opendocument.text"><x></office:document>'), { storeImage: () => 'x' })).rejects.toThrow(/OpenDocument|읽지/);
  });

  it('file names: .fodp .otp .odg are slide decks, .odp is not a PowerPoint name, and the picker lists them', () => {
    for (const n of ['a.fodp', 'a.OTP', 'b.odg', 'b.fodg', 'c.otg', 'd.odp']) expect(OPENDOCUMENT_FILE.test(n), n).toBe(true);
    for (const n of ['a.pptx', 'a.odt', 'a.fodt', 'a.ods']) expect(OPENDOCUMENT_FILE.test(n), n).toBe(false);
    for (const n of ['a.pptx', 'a.potm', 'a.pot', 'a.fodp', 'a.otp', 'a.odg', 'a.ppt']) expect(SLIDE_DECK_FILE.test(n), n).toBe(true);
    for (const ext of ['.fodp', '.otp', '.odg', '.potm', '.odp', '.ppt', '.pptx']) expect(SLIDE_DECK_ACCEPT.split(',')).toContain(ext);
  });
});
