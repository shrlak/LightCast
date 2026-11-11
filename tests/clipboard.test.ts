import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { SlideElement } from '../src/domain/types';
import { colorOf, drawingToElements, keepOnSlide, OFFICE_THEME, readGvml } from '../src/domain/io/drawingml';
import { parseMarkup } from '../src/domain/io/markup';
import { cssColor, cssLength, decodePayload, encodePayload, htmlToElements, htmlToLines, isOfficeHtml, objectsHtml, objectsText, payloadFromHtml } from '../src/domain/clipboard';
import { officeFont } from '../src/domain/fonts';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"';
const canvas = (inner: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic ${NS}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas>
<a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr>
<a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="1524000"/><a:chOff x="1524000" y="762000"/><a:chExt cx="4572000" cy="1524000"/></a:xfrm></a:grpSpPr>
${inner}
</lc:lockedCanvas></a:graphicData></a:graphic>`;

// A text box as PowerPoint copies it: 1 in from the left, 0.5 in down, 맑은 고딕 28 pt black title
// with a red bold word and a second, centred line in Arial 18 pt.
const TEXT_BOX = `<a:sp><a:nvSpPr><a:cNvPr id="4" name="TextBox 3"/><a:cNvSpPr txBox="1"/></a:nvSpPr>
<a:spPr><a:xfrm><a:off x="1524000" y="762000"/><a:ext cx="4572000" cy="1524000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></a:spPr>
<a:txSp><a:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/>
<a:p><a:r><a:rPr lang="ko-KR" altLang="en-US" sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:rPr><a:t>은혜 </a:t></a:r><a:r><a:rPr lang="ko-KR" sz="2800" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ea typeface="+mn-ea"/></a:rPr><a:t>아멘</a:t></a:r></a:p>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1800" i="1"><a:latin typeface="Arial"/></a:rPr><a:t>Grace &amp; peace</a:t></a:r></a:p>
</a:txBody><a:useSpRect/></a:txSp></a:sp>`;

// A rounded rectangle in the default shape style (accent1 fill, darker outline, white text).
const STYLED = `<a:sp><a:nvSpPr><a:cNvPr id="5" name="Rounded Rectangle 4"/><a:cNvSpPr/></a:nvSpPr>
<a:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="635000" y="1270000"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom></a:spPr>
<a:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></a:style>
<a:txSp><a:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ko-KR" altLang="en-US" dirty="0"/><a:t>찬양</a:t></a:r></a:p></a:txBody><a:useSpRect/></a:txSp></a:sp>`;

const PICTURE = `<a:pic><a:nvPicPr><a:cNvPr id="6" name="Picture 5" descr="cross"/><a:cNvPicPr/></a:nvPicPr>
<a:blipFill><a:blip r:embed="rId1"/><a:srcRect l="10000" r="20000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>
<a:spPr><a:xfrm><a:off x="3175000" y="3175000"/><a:ext cx="1905000" cy="1270000"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></a:spPr></a:pic>`;

const GROUP = `<a:grpSp><a:nvGrpSpPr><a:cNvPr id="7" name="Group 6"/><a:cNvGrpSpPr/></a:nvGrpSpPr>
<a:grpSpPr><a:xfrm><a:off x="635000" y="635000"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="635000" cy="635000"/></a:xfrm></a:grpSpPr>
<a:sp><a:nvSpPr><a:cNvPr id="8" name="Oval"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="317500" cy="317500"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00B050"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill><a:prstDash val="dash"/></a:ln></a:spPr></a:sp>
<a:cxnSp><a:nvCxnSpPr><a:cNvPr id="9" name="Arrow"/><a:cNvCxnSpPr/></a:nvCxnSpPr><a:spPr><a:xfrm><a:off x="317500" y="317500"/><a:ext cx="317500" cy="0"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></a:spPr></a:cxnSp>
</a:grpSp>`;

const THEME = `<a:theme ${NS} name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="1F8A52"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="맑은 고딕"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

async function gvml(inner: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('_rels/.rels', '<Relationships/>');
  zip.file('clipboard/drawings/drawing1.xml', canvas(inner));
  zip.file('clipboard/drawings/_rels/drawing1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  zip.file('clipboard/theme/theme1.xml', THEME);
  zip.file('clipboard/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('markup reader', () => {
  it('reads XML with prefixes and forgiving HTML', () => {
    const x = parseMarkup('<a:p><a:r><a:t>x &amp; &#xAC00;</a:t></a:r><a:br/></a:p>');
    expect(x.children[0].name).toBe('a:p');
    expect(x.children[0].children[0].children[0].children[0].text).toBe('x & 가');
    const h = parseMarkup('<P class=MsoNormal><span style=\'font-size:28pt\'>A<br>B</P><img src=x>', true);
    expect(h.children[0].name).toBe('p');
    expect(h.children[0].attrs.class).toBe('MsoNormal');
    expect(h.children[1].name).toBe('img');
  });
});

describe('PowerPoint clipboard (GVML) → objects', () => {
  it('keeps a text box’s place, fonts, sizes, colours and paragraph format', async () => {
    const r = await readGvml(await gvml(TEXT_BOX), () => 'm1');
    expect(r).not.toBeNull();
    const el = r!.elements[0];
    expect(el).toMatchObject({ kind: 'text', x: 240, y: 120, w: 720, h: 240, vAlign: 'top', autoFit: true, text: '은혜 아멘\nGrace & peace' });
    // The box's formatting is that of most of its text; the rest is in runs.
    expect(el.fontSize).toBe(56);
    expect(el.color).toBe('#000000');
    expect(el.fontFamily).toBe(officeFont('맑은 고딕'));
    // Two alignments → per-line paragraphs.
    expect(el.paragraphs?.map((p) => p.align)).toEqual(['left', 'center']);
    expect(el.paragraphs?.[0].runs).toEqual([{ text: '은혜 ' }, { text: '아멘', bold: true, color: '#ff0000' }]);
    expect(el.paragraphs?.[1].runs).toEqual([{ text: 'Grace & peace', fontSize: 36, italic: true, color: undefined, fontFamily: officeFont('Arial') }].map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined))));
  });

  it('reads a styled shape: theme fill, shaded outline, white text, rotation, flip and adjust value', () => {
    const [el] = drawingToElements(canvas(STYLED), { theme: OFFICE_THEME });
    expect(el).toMatchObject({ kind: 'shape', shape: 'roundRect', adj: [25000], x: 100, y: 200, w: 200, h: 100, rotation: 90, flipH: true, fill: '#4472c4', text: '찬양', color: '#ffffff', align: 'center', vAlign: 'middle', fontSize: 36 });
    expect(el.stroke).toBe(colorOf(parseMarkup('<a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr>').children[0], OFFICE_THEME)!.hex);
    expect(el.strokeWidth).toBe(2);
  });

  it('stores pictures and keeps their crop and shape; groups stay grouped in place', async () => {
    const r = await readGvml(await gvml(PICTURE + GROUP), () => 'pic1');
    const [pic, oval, arrow] = r!.elements;
    expect(r!.media).toHaveLength(1);
    expect(r!.media[0].blob.type).toBe('image/png');
    expect(pic).toMatchObject({ kind: 'image', mediaId: 'pic1', x: 500, y: 500, w: 300, h: 200, crop: [0.1, 0, 0.2, 0], maskShape: 'ellipse', alt: 'cross' });
    // The group is drawn twice its child size, from (100, 100).
    expect(oval).toMatchObject({ kind: 'shape', shape: 'ellipse', x: 100, y: 100, w: 100, h: 100, fill: '#00b050', stroke: '#ffff00', strokeWidth: 4, dash: 'dash' });
    expect(arrow).toMatchObject({ kind: 'shape', shape: 'straightConnector1', x: 200, y: 200, w: 100, h: 0, stroke: '#000000', arrowEnd: true });
    expect(oval.groupId).toBeTruthy();
    expect(arrow.groupId).toBe(oval.groupId);
  });

  it('uses the copied theme’s colours', async () => {
    const r = await readGvml(await gvml(STYLED));
    expect(r!.elements[0].fill).toBe('#1f8a52');
  });

  it('brings objects from a wide slide onto the 4:3 slide', () => {
    const els = keepOnSlide([{ id: 'a', kind: 'text', x: 1500, y: 100, w: 300, h: 100 } as SlideElement]);
    expect(els[0].x).toBe(1140);
    expect(keepOnSlide([{ id: 'a', kind: 'text', x: 10, y: 10, w: 30, h: 10 } as SlideElement])[0].x).toBe(10);
  });

  it('applies luminance modifiers like PowerPoint (accent1, lighter 40%)', () => {
    const c = colorOf(parseMarkup('<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>').children[0], OFFICE_THEME);
    expect(c?.hex).toBe('#8faadc');
  });

  it('is not fooled by something that is not a package', async () => {
    expect(await readGvml(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('FreeCast objects on the system clipboard', () => {
  const els: SlideElement[] = [
    { id: 'e1', kind: 'text', x: 33, y: 44, w: 500, h: 120, text: '주 하나님\nHoly', fontSize: 72, fontFamily: officeFont('맑은 고딕'), color: '#fde718', bold: true, runs: [[{ text: '주 ' }, { text: '하나님', color: '#1f8a52', italic: true }], [{ text: 'Holy' }]] },
    { id: 'e2', kind: 'shape', shape: 'star5', x: 900, y: 600, w: 200, h: 200, fill: '#1f8a52', rotation: 15 },
  ];

  it('round-trips every property through the HTML', () => {
    const html = objectsHtml(els, { m1: { name: 'a.png', type: 'image/png', data: 'data:image/png;base64,AAAA' } });
    const back = payloadFromHtml(html);
    expect(back?.elements).toEqual(els);
    expect(back?.media?.m1.name).toBe('a.png');
    // Unicode survives base64.
    expect(decodePayload(encodePayload({ v: 1, elements: els }))?.elements[0].text).toBe('주 하나님\nHoly');
    // The older private type (a JSON array) is still read.
    expect(decodePayload(JSON.stringify(els))?.elements).toHaveLength(2);
    expect(payloadFromHtml('<p>nothing</p>')).toBeNull();
  });

  it('writes the text as formatted HTML for other programs', () => {
    const html = objectsHtml(els);
    expect(html).toContain('font-size:36pt');
    expect(html).toContain('color:#1f8a52');
    expect(html).toContain('font-style:italic');
    expect(objectsText(els)).toBe('주 하나님\nHoly');
    // …and FreeCast reads its own HTML back as the same formatted lines.
    const lines = htmlToLines(html.replace(/data-freecast-objects="[^"]*"/, ''));
    expect(lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['주 하나님', 'Holy']);
    expect(lines[0].runs[1]).toMatchObject({ text: '하나님', color: '#1f8a52', italic: true, bold: true, fontSize: 72 });
  });
});

describe('HTML from other programs', () => {
  it('reads CSS lengths and colours', () => {
    expect(cssLength('28pt')).toBe(56);
    expect(cssLength('16px')).toBe(24);
    expect(cssLength('1in')).toBe(144);
    expect(cssLength('25%', 1440)).toBe(360);
    expect(cssColor('rgb(31, 138, 82)')).toBe('#1f8a52');
    expect(cssColor('#FFF')).toBe('#ffffff');
    expect(cssColor('rgba(0,0,0,0)')).toBeUndefined();
  });

  it('keeps fonts, sizes, colours and emphasis of Word / PowerPoint text', () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!-- p.MsoNormal {font-size:20.0pt; font-family:"맑은 고딕";} --></style></head><body><!--StartFragment-->
<p class=MsoNormal align=center><b><span style='color:#C00000'>주님의</span></b> 은혜</p>
<p class=MsoNormal><span lang=EN-US style='font-size:14.0pt;font-family:Georgia'>Amazing <i>grace</i></span></p>
<!--EndFragment--></body></html>`;
    expect(isOfficeHtml(html)).toBe(true);
    const lines = htmlToLines(html);
    expect(lines).toHaveLength(2);
    expect(lines[0].align).toBe('center');
    expect(lines[0].runs[0]).toMatchObject({ text: '주님의', bold: true, color: '#c00000', fontSize: 40, fontFamily: officeFont('맑은 고딕') });
    expect(lines[0].runs[1]).toMatchObject({ text: ' 은혜', fontSize: 40 });
    expect(lines[1].runs[1]).toMatchObject({ text: 'grace', italic: true, fontSize: 28, fontFamily: officeFont('Georgia') });
  });

  it('keeps empty lines between paragraphs and line breaks', () => {
    expect(htmlToLines('<p>a</p><p><br></p><p>b</p>').map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['a', '', 'b']);
    expect(htmlToLines('<div>one<br>two</div><div>three</div>').map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['one', 'two', 'three']);
  });

  it('places absolutely positioned boxes (PowerPoint shapes) where they were', () => {
    const html = `<html xmlns:p="urn:schemas-microsoft-com:office:powerpoint"><body>
<div style='position:absolute;top:10%;left:25%;width:50%;height:20%'><div style='text-align:center'><span style='font-size:44pt;font-family:"Malgun Gothic";color:#1F8A52'>예배로의 부름</span></div></div>
<div style='position:absolute;top:144pt;left:72pt;width:216pt;height:72pt;background:#FDE718'><span style='font-size:18pt'>광고</span></div>
</body></html>`;
    const { elements } = htmlToElements(html);
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ kind: 'text', x: 360, y: 108, w: 720, h: 216, text: '예배로의 부름', fontSize: 88, color: '#1f8a52', align: 'center', fontFamily: officeFont('Malgun Gothic') });
    expect(elements[1]).toMatchObject({ kind: 'shape', shape: 'rect', fill: '#fde718', x: 144, y: 288, w: 432, h: 144, text: '광고', fontSize: 36 });
  });

  it('puts unplaced text in one formatted text box, and returns inline pictures', () => {
    const { elements, images } = htmlToElements('<p><span style="font-size:24px;color:red">Hello</span></p><img src="data:image/png;base64,AAAA" width="200" height="100">');
    expect(elements[0]).toMatchObject({ kind: 'text', text: 'Hello', fontSize: 36, color: '#ff0000' });
    expect(images[0].box).toMatchObject({ w: 300, h: 150 });
  });
});

import { insertLines, sliceLines, withBoxFormat } from '../src/domain/richText';

describe('copying and pasting part of a text box', () => {
  const L = [[{ text: 'ab' }, { text: 'cd', bold: true }], [{ text: 'ef' }]];
  const plain = (ls: { text: string }[][]) => ls.map((l) => l.map((r) => r.text).join('')).join('\n');

  it('slices the selected characters with their runs', () => {
    expect(sliceLines(L, 1, 3)).toEqual([[{ text: 'b' }, { text: 'c', bold: true }]]);
    expect(plain(sliceLines(L, 3, 6))).toBe('d\ne');
    expect(plain(sliceLines(L, 4, 5))).toBe('\n');
    expect(sliceLines(L, 0, 7)).toEqual(L);
  });

  it('inserts formatted lines in place of the selection and puts the caret after them', () => {
    const r = insertLines(L, 1, 3, [[{ text: 'X', italic: true }], [{ text: 'Y' }]]);
    expect(plain(r.lines)).toBe('aX\nYd\nef');
    expect(r.lines[0]).toEqual([{ text: 'a' }, { text: 'X', italic: true }]);
    expect(r.lines[1]).toEqual([{ text: 'Y' }, { text: 'd', bold: true }]);
    expect(r.caret).toBe(4);
    expect(insertLines([[]], 0, 0, [[{ text: 'X' }]])).toEqual({ lines: [[{ text: 'X' }]], caret: 1 });
    expect(plain(insertLines(L, 7, 7, [[{ text: '!' }]]).lines)).toBe('abcd\nef!');
  });

  it('gives copied runs the box’s own formatting so they look the same elsewhere', () => {
    expect(withBoxFormat([[{ text: 'a' }, { text: 'b', fontSize: 30 }]], { fontSize: 64, color: '#ffffff', fontFamily: 'Georgia' })).toEqual([[{ text: 'a', fontSize: 64, color: '#ffffff', fontFamily: 'Georgia' }, { text: 'b', fontSize: 30, color: '#ffffff', fontFamily: 'Georgia' }]]);
  });
});

import { pastedLines, runsHtml } from '../src/domain/clipboard';

describe('pasting into a text box', () => {
  it('takes FreeCast’s own copied runs exactly', () => {
    const lines = [[{ text: '할렐루야', fontSize: 64, color: '#fde718', fontFamily: 'Georgia, serif' }], [{ text: 'amen', italic: true }]];
    expect(pastedLines(runsHtml(lines))).toEqual(lines);
  });
  it('takes a copied text object’s text with its box formatting', () => {
    const html = objectsHtml([{ id: 'x', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'A\nB', fontSize: 50, color: '#123456', runs: [[{ text: 'A', bold: true }], [{ text: 'B' }]] }]);
    expect(pastedLines(html)).toEqual([[{ text: 'A', bold: true, fontSize: 50, color: '#123456' }], [{ text: 'B', fontSize: 50, color: '#123456' }]]);
  });
  it('reads other programs’ formatting, and gives up on empty HTML', () => {
    expect(pastedLines('<span style="font-size:30pt;color:#00ff00">hi</span>')).toEqual([[{ text: 'hi', fontSize: 60, color: '#00ff00' }]]);
    expect(pastedLines('', null)).toBeNull();
  });
});
