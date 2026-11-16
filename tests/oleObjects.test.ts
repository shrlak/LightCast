import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { OLE_MAX_BYTES, oleContentType, oleExtOf, oleRelTypeOf, patchOleObjects, patchOleSlideXml, readOleFrame, type OlePatch } from '../src/domain/io/oleObjects';
import { slideFromRendered } from '../src/domain/templates/convert';
import type { OleObject } from '../src/domain/types';
import type { RenderedPictureShape, RenderedSlide } from '../src/domain/io/pptxRender';

const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Worksheet"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="100" y="200"/><a:ext cx="3000" cy="2000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="Worksheet" r:id="rId3" imgW="3000" imgH="2000" progId="Excel.Sheet.12"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="3000" cy="2000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
const parse = (inner: string) => new DOMParser().parseFromString(`<root ${ns}>${inner}</root>`, 'text/xml').documentElement.firstChild as unknown as Element;

describe('reading an OLE frame', () => {
  it('finds the progId, the embedded part id, the size hint and the preview picture', () => {
    const f = readOleFrame(parse(frame))!;
    expect(f).toMatchObject({ progId: 'Excel.Sheet.12', name: 'Worksheet', embedRId: 'rId3', imgW: 3000, imgH: 2000, icon: false });
    expect(f.xfrm?.localName).toBe('xfrm');
    expect(f.pic.localName).toBe('pic');
  });
  it('reads the preview inside the old AlternateContent wrapper and ignores other frames', () => {
    const wrapped = `<mc:AlternateContent><mc:Choice Requires="v">${frame.replace(/<p:pic>[\s\S]*<\/p:pic>/, '')}</mc:Choice><mc:Fallback>${frame}</mc:Fallback></mc:AlternateContent>`;
    expect(readOleFrame(parse(wrapped))?.progId).toBe('Excel.Sheet.12');
    expect(readOleFrame(parse('<p:graphicFrame><a:graphic><a:graphicData><a:tbl/></a:graphicData></a:graphic></p:graphicFrame>'))).toBeNull();
  });
  it('knows the part kinds', () => {
    expect(oleRelTypeOf('../embeddings/oleObject1.bin')).toBe('oleObject');
    expect(oleRelTypeOf('../embeddings/Microsoft_Excel_Worksheet.xlsx')).toBe('package');
    expect(oleExtOf('x/Book1.XLSX')).toBe('xlsx');
    expect(oleContentType('xlsx')).toContain('spreadsheetml');
    expect(OLE_MAX_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});

const ole: OleObject = { progId: 'Excel.Sheet.12', partId: 'm-ole0', ext: 'xlsx', relType: 'package', name: 'Worksheet', bytes: 5, imgW: 3000, imgH: 2000 };
const exportedPic = `<p:pic><p:nvPicPr><p:cNvPr id="7" name="lcole-1"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="300" cy="200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

describe('export: the preview picture becomes the OLE object again', () => {
  it('replaces only the marked picture', () => {
    const other = exportedPic.replace('lcole-1', 'Picture 2');
    const patch: OlePatch = { marker: 'lcole-1', ole, data: new Uint8Array([1, 2, 3, 4, 5]) };
    const { xml, used } = patchOleSlideXml(`<p:spTree>${other}${exportedPic}</p:spTree>`, [patch], () => 'rIdOle1');
    expect(used).toEqual([patch]);
    expect(xml).toContain(other);
    expect(xml).toContain('<p:oleObj name="Worksheet" r:id="rIdOle1" imgW="3000" imgH="2000" progId="Excel.Sheet.12"><p:embed/>');
    expect(xml).toContain('<p:xfrm><a:off x="10" y="20"/><a:ext cx="300" cy="200"/></p:xfrm>');
    expect(xml).toContain('<a:blip r:embed="rId2"/>');
    expect(xml).not.toContain('lcole-1');
  });
  it('writes the part, the relationship and the content type into the package', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types><Default Extension="png" ContentType="image/png"/><Override PartName="/x" ContentType="y"/></Types>');
    zip.file('ppt/slides/slide1.xml', `<p:sld><p:spTree>${exportedPic}</p:spTree></p:sld>`);
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId2" Type="image" Target="../media/image1.png"/></Relationships>');
    const n = await patchOleObjects(zip, [{ marker: 'lcole-1', ole, data: new Uint8Array([9, 8, 7]) }]);
    expect(n).toBe(1);
    expect([...await zip.file('ppt/embeddings/oleObject1.xlsx')!.async('uint8array')]).toEqual([9, 8, 7]);
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('Id="rIdOle1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/oleObject1.xlsx"');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="xlsx"');
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('<p:graphicFrame>');
  });
});

describe('import: the preview stays an object that remembers the file', () => {
  it('slideFromRendered keeps the OLE data on the picture element', () => {
    const shape: RenderedPictureShape = { kind: 'picture', xEmu: 0, yEmu: 0, wEmu: 914400, hEmu: 914400, imageUrl: 'blob:p', ole: { progId: 'Word.Document.12', ext: 'docx', relType: 'package', bytes: 9, icon: true } };
    const rs: RenderedSlide = { index: 0, widthEmu: 9144000, heightEmu: 6858000, shapes: [shape] };
    const s = slideFromRendered(rs, 'bg', 'g', new Map([['blob:p|', 'pic1']]), new Map([[shape, 'bg-ole0']]));
    expect(s.elements?.[0]).toMatchObject({ kind: 'image', mediaId: 'pic1', ole: { progId: 'Word.Document.12', partId: 'bg-ole0', ext: 'docx', icon: true } });
    // too big / linked (no part id): just a picture
    const plain = slideFromRendered(rs, 'bg', 'g', new Map([['blob:p|', 'pic1']]));
    expect(plain.elements?.[0].ole).toBeUndefined();
  });
});
