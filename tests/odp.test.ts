import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseOdp, writeOdp, ODP_MIME, hexColor, lengthToCm } from '../src/domain/io/odp';
import type { Presentation, Slide } from '../src/domain/types';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const store = () => {
  const stored = new Map<string, Uint8Array>();
  return { stored, storeImage: (b: Uint8Array) => { const id = `m${stored.size + 1}`; stored.set(id, b); return id; } };
};

const deck = (): Pick<Presentation, 'title' | 'slides' | 'properties'> => ({
  title: '주일 예배 & <광고>',
  properties: { author: '홍길동', title: '주일 예배 & <광고>' },
  slides: [
    {
      id: 's1', group: 'g', text: '', notes: '첫 번째 노트\n둘째 줄', background: { kind: 'color', value: '#ffeeaa' },
      elements: [
        { id: 'e1', kind: 'text', x: 144, y: 108, w: 1152, h: 216, text: '제목 글\n두 번째  줄', fontSize: 72, bold: true, color: '#006633', align: 'center',
          paragraphs: [{ text: '제목 글', fontSize: 72, bold: true, color: '#006633', align: 'center' }, { text: '두 번째  줄', runs: [{ text: '두 번째 ', italic: true, fontSize: 40 }, { text: ' 줄', bold: true, color: '#ff0000', fontSize: 40 }] }] },
        { id: 'e2', kind: 'image', x: 100, y: 400, w: 300, h: 200, mediaId: 'pic1', fit: 'fill' },
        { id: 'e3', kind: 'shape', shape: 'ellipse', x: 600, y: 400, w: 200, h: 200, fill: '#ffcc00', stroke: '#006633', strokeWidth: 6, text: '원', fontSize: 40 },
        { id: 'e4', kind: 'table', x: 100, y: 700, w: 600, h: 200, table: { rows: [[{ text: 'A', bold: true, fill: '#006633' }, { text: 'B' }], [{ text: 'C' }, { text: 'D' }]], cols: [300, 300], heights: [100, 100], style: '', firstRow: false, firstCol: false, lastRow: false, lastCol: false, bandRow: false, bandCol: false } },
      ],
    },
    { id: 's2', group: 'g', text: '본문', title: '제목' },
  ] as Slide[],
});

describe('odp', () => {
  it('writes a valid package: mimetype first and stored, manifest, content, styles', async () => {
    const bytes = await writeOdp(deck(), { loadMedia: (id) => (id === 'pic1' ? { bytes: PNG, mime: 'image/png' } : null) });
    // The first entry's local header: name "mimetype", method 0 (stored), then the type text itself.
    expect(String.fromCharCode(...bytes.slice(30, 38))).toBe('mimetype');
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);
    expect(new TextDecoder().decode(bytes.slice(38, 38 + ODP_MIME.length))).toBe(ODP_MIME);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).slice(0, 2)).toEqual(['mimetype', 'META-INF/manifest.xml']);
    for (const f of ['content.xml', 'styles.xml', 'meta.xml', 'Pictures/image1.png']) expect(zip.file(f)).toBeTruthy();
    expect(await zip.file('META-INF/manifest.xml')!.async('string')).toContain('Pictures/image1.png');
    expect(await zip.file('content.xml')!.async('string')).toContain('<draw:page');
  });

  it('round-trips slides, formatting, pictures, shapes, tables, notes and properties', async () => {
    const bytes = await writeOdp(deck(), { loadMedia: () => ({ bytes: PNG, mime: 'image/png' }) });
    const s = store();
    const doc = await parseOdp(bytes, s);
    expect(doc.title).toBe('주일 예배 & <광고>');
    expect(doc.properties.author).toBe('홍길동');
    expect(doc.slides).toHaveLength(2);
    const [a, b] = doc.slides;
    expect(a.background).toEqual({ kind: 'color', value: '#ffeeaa' });
    expect(a.notes).toBe('첫 번째 노트\n둘째 줄');
    const text = a.elements!.find((e) => e.kind === 'text')!;
    expect(text.text).toBe('제목 글\n두 번째  줄');
    expect(text.bold).toBe(true);
    expect(text.fontSize).toBe(72);
    expect(text.color).toBe('#006633');
    expect(text.paragraphs![0].align).toBe('center');
    // The box's own bold / colour is the default of its lines, so the runs carry it too.
    expect(text.paragraphs![1].runs).toMatchObject([{ text: '두 번째 ', italic: true, fontSize: 40, bold: true }, { text: ' 줄', bold: true, color: '#ff0000', fontSize: 40 }]);
    expect(text.x).toBeCloseTo(144, 0);
    expect(text.w).toBeCloseTo(1152, 0);
    const img = a.elements!.find((e) => e.kind === 'image')!;
    expect(s.stored.get(img.mediaId!)).toEqual(PNG);
    expect(img.y).toBeCloseTo(400, 0);
    const shape = a.elements!.find((e) => e.kind === 'shape')!;
    expect(shape).toMatchObject({ shape: 'ellipse', fill: '#ffcc00', stroke: '#006633', text: '원' });
    const table = a.elements!.find((e) => e.kind === 'table')!.table!;
    expect(table.rows.map((r) => r.map((c) => c.text))).toEqual([['A', 'B'], ['C', 'D']]);
    expect(table.rows[0][0]).toMatchObject({ bold: true, fill: '#006633' });
    expect(table.cols.reduce((x, y) => x + y, 0)).toBe(600);
    // A slide without objects is written from its title and text.
    expect(b.elements!.map((e) => e.text)).toEqual(['제목', '본문']);
  });

  it('stores a picture used twice once', async () => {
    const p = deck();
    p.slides[1].elements = [{ id: 'x', kind: 'image', x: 0, y: 0, w: 10, h: 10, mediaId: 'pic1' }];
    const bytes = await writeOdp(p, { loadMedia: () => ({ bytes: PNG, mime: 'image/png' }) });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).filter((f) => f.startsWith('Pictures/') && !f.endsWith('/'))).toEqual(['Pictures/image1.png']);
  });

  it('reads a LibreOffice-style file: named styles, spans, lists, cm sizes on a 16:9 page', async () => {
    const zip = new JSZip();
    zip.file('mimetype', ODP_MIME, { compression: 'STORE' });
    zip.file('styles.xml', `<office:document-styles xmlns:office="o" xmlns:style="s" xmlns:fo="f" xmlns:draw="d"><office:styles><style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="44pt" fo:font-weight="bold"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="PM0"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM0" draw:style-name="dp9"/></office:master-styles></office:document-styles>`);
    zip.file('content.xml', `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:style="s" xmlns:fo="f" xmlns:draw="d" xmlns:text="t" xmlns:svg="v" xmlns:presentation="p"><office:automatic-styles><style:style style:name="P1" style:family="paragraph" style:parent-style-name="Title"><style:paragraph-properties fo:text-align="end"/></style:style><style:style style:name="T1" style:family="text"><style:text-properties fo:color="#ff0000" fo:font-style="italic"/></style:style></office:automatic-styles><office:body><office:presentation><draw:page draw:name="one" draw:master-page-name="Default"><draw:frame svg:x="2.8cm" svg:y="1.575cm" svg:width="14cm" svg:height="7.875cm"><draw:text-box><text:p text:style-name="P1">Hi <text:span text:style-name="T1">there</text:span><text:s text:c="2"/>x</text:p><text:list><text:list-item><text:p>one</text:p></text:list-item></text:list></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>`);
    const doc = await parseOdp(await zip.generateAsync({ type: 'uint8array' }), store());
    const el = doc.slides[0].elements![0];
    expect(el.text).toBe('Hi there  x\none');
    expect(el.list).toBe('bullet');
    expect(el.x).toBeCloseTo(144, 0);
    expect(el.y).toBeCloseTo(108, 0); // 15.75 cm tall page stretched onto the 4:3 canvas
    expect(el.paragraphs![0]).toMatchObject({ align: 'right' });
    expect(el.paragraphs![0].runs![1]).toMatchObject({ text: 'there', italic: true, color: '#ff0000', bold: true, fontSize: 88 });
  });

  it('rejects files that are not presentations', async () => {
    await expect(parseOdp(new TextEncoder().encode('nope'), store())).rejects.toThrow('.odp');
    const z = new JSZip(); z.file('hello.txt', 'x');
    await expect(parseOdp(await z.generateAsync({ type: 'uint8array' }), store())).rejects.toThrow('.odp');
  });

  it('converts units and colours', () => {
    expect(lengthToCm('25.4mm')).toBeCloseTo(2.54);
    expect(lengthToCm('1in')).toBeCloseTo(2.54);
    expect(lengthToCm('abc')).toBeUndefined();
    expect(hexColor('rgba(255, 0, 0, 0.5)')).toBe('#ff0000');
    expect(hexColor('rgba(0,0,0,0)')).toBeUndefined();
    expect(hexColor('#abc')).toBe('#aabbcc');
  });
});
