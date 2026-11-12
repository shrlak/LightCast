import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import { drawingToElements, OFFICE_THEME } from '../src/domain/io/drawingml';
import { fillXml, lnXml, patchShapeXml } from '../src/domain/io/shapeXml';
import { CAPS, COMPOUNDS, DASHES, JOINS, bevelCss, compoundLayers, dashPattern, fillOpacityOf, gradientStopsOf, withGradientStops } from '../src/domain/shapeEffects';
import { extrusionOf, faceShading, patch3d, scene3dXml, shade } from '../src/domain/shape3d';
import { cloneElements, deleteSelection, enterGroup, enteredGroups, expandSelection, groupSelection, leaveGroups, pruneEntered, selectionUnits, ungroupSelection } from '../src/domain/editOps';
import { selectionRows } from '../src/domain/shapeOps';
import type { Presentation, SlideElement } from '../src/domain/types';

const shape = (o: Partial<SlideElement> = {}): SlideElement => ({ id: 's', kind: 'shape', shape: 'rect', x: 100, y: 100, w: 300, h: 200, fill: '#2E6FD8', ...o });

describe('outline: dash, cap, join, compound', () => {
  it('offers every dash preset of the file format', () => {
    const all = ['solid', 'dot', 'dash', 'lgDash', 'dashDot', 'lgDashDot', 'lgDashDotDot', 'sysDash', 'sysDot', 'sysDashDot', 'sysDashDotDot'];
    expect(DASHES.map((d) => d.id).sort()).toEqual([...all].sort());
    expect(dashPattern('solid', 4)).toBeUndefined();
    // Each preset is a different pattern, in multiples of the line width.
    const patterns = DASHES.filter((d) => d.id !== 'solid').map((d) => dashPattern(d.id, 2));
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(dashPattern('lgDashDotDot', 2)).toBe('16 6 2 6 2 6');
  });

  it('lists the caps, joins and compound types DeckCraft takes', () => {
    expect(CAPS.map((c) => c.id)).toEqual(['flat', 'round', 'square']);
    expect(JOINS.map((c) => c.id)).toEqual(['round', 'bevel', 'miter']);
    expect(COMPOUNDS.map((c) => c.id)).toEqual(['single', 'double', 'thickThin', 'thinThick', 'triple']);
  });

  it('draws double and triple lines as masks over one stroke, thick-thin on a closed shape in two layers', () => {
    expect(compoundLayers('single', 6, true)).toBeNull();
    expect(compoundLayers(undefined, 6, true)).toBeNull();
    const dbl = compoundLayers('double', 9, false)!;
    expect(dbl).toHaveLength(1);
    expect(dbl[0].ops).toEqual([{ op: 'stroke', width: 9, white: true }, { op: 'stroke', width: 3, white: false }]);
    const tri = compoundLayers('triple', 10, true)!;
    expect(tri[0].ops.map((o) => (o.op === 'stroke' ? o.width : 0))).toEqual([10, 6, 2]);
    const tt = compoundLayers('thickThin', 12, true)!;
    expect(tt).toHaveLength(2);
    expect(tt[0].ops.some((o) => o.op === 'fill')).toBe(true); // thick line outside: the shape's own fill hides the inner half
    expect(tt[1].ops.some((o) => o.op === 'outside')).toBe(true);
    // An open path has no inside, so it is a double line.
    expect(compoundLayers('thinThick', 12, false)).toEqual(compoundLayers('double', 12, false));
  });

  it('writes cap, compound, dash, join and arrowheads as a:ln', () => {
    const xml = lnXml(shape({ stroke: '#ff0000', strokeWidth: 8, cap: 'round', join: 'miter', compound: 'thickThin', dash: 'lgDashDot', arrowEnd: true, arrowEndKind: 'stealth', arrowSize: 'lg' }))!;
    expect(xml).toContain('w="50800"'); // 8 px = 4 pt
    expect(xml).toContain('cap="rnd"');
    expect(xml).toContain('cmpd="thickThin"');
    expect(xml).toContain('<a:prstDash val="lgDashDot"/>');
    expect(xml).toContain('<a:miter lim="800000"/>');
    expect(xml).toContain('<a:tailEnd type="stealth" w="lg" len="lg"/>');
    expect(lnXml(shape({ stroke: '#00ff00', cap: 'square', join: 'bevel', compound: 'triple' }))).toMatch(/cap="sq" cmpd="tri">.*<a:bevel\/>/);
    expect(lnXml(shape())).toBeNull();
  });
});

describe('fill transparency', () => {
  it('keeps the fill separate from the object opacity', () => {
    expect(fillOpacityOf(shape())).toBe(1);
    expect(fillOpacityOf(shape({ fillTransparency: 0.25, opacity: 0.5 }))).toBe(0.75);
    expect(fillOpacityOf(shape({ fillTransparency: 7 }))).toBe(0);
  });

  it('a gradient is its stops, or its two colours', () => {
    expect(gradientStopsOf(shape())).toBeNull();
    expect(gradientStopsOf(shape({ gradient: ['#111111', '#eeeeee'] }))!.map((s) => s.pos)).toEqual([0, 100]);
    const patch = withGradientStops([{ pos: 100, color: '#0000ff' }, { pos: 0, color: '#ff0000', transparency: 0.4 }, { pos: 50, color: '#00ff00' }]);
    expect(patch.gradient).toEqual(['#ff0000', '#0000ff']);
    expect(gradientStopsOf(shape(patch))!.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('writes solid, gradient-stop, pattern and picture transparency as alpha', () => {
    expect(fillXml(shape({ fillTransparency: 0.3 }))).toBe('<a:solidFill><a:srgbClr val="2E6FD8"><a:alpha val="70000"/></a:srgbClr></a:solidFill>');
    expect(fillXml(shape())).toBe('<a:solidFill><a:srgbClr val="2E6FD8"/></a:solidFill>');
    expect(fillXml(shape({ fill: 'transparent' }))).toBeNull();
    const grad = fillXml(shape({ gradientAngle: 45, ...withGradientStops([{ pos: 0, color: '#ff0000', transparency: 0.5 }, { pos: 40, color: '#00ff00' }, { pos: 100, color: '#0000ff', transparency: 1 }]) }))!;
    expect(grad).toContain('<a:gs pos="0"><a:srgbClr val="FF0000"><a:alpha val="50000"/>');
    expect(grad).toContain('<a:gs pos="40000"><a:srgbClr val="00FF00"/></a:gs>');
    expect(grad).toContain('<a:alpha val="0"/>');
    expect(grad).toContain('<a:lin ang="2700000" scaled="0"/>');
    expect(fillXml(shape({ gradient: ['#ff0000', '#0000ff'], gradientType: 'radial' }))).toContain('<a:path path="circle">');
    expect(fillXml(shape({ pattern: { kind: 'dkHorz', fg: '#000000', bg: '#ffffff' }, fillTransparency: 0.5 }))).toContain('<a:pattFill prst="dkHorz"><a:fgClr><a:srgbClr val="000000"><a:alpha val="50000"/>');
    expect(fillXml(shape({ fillImage: 'm1', fillTransparency: 0.2 }), 'rId9')).toBe('<a:blipFill><a:blip r:embed="rId9"><a:alphaModFix amt="80000"/></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill>');
  });
});

describe('3-D format', () => {
  const e3 = (f: SlideElement['format3d'], more: Partial<SlideElement> = {}) => shape({ format3d: f, ...more });

  it('stores only what differs from the defaults', () => {
    expect(patch3d(undefined, { depth: 0 })).toBeUndefined();
    expect(patch3d({ depth: 10, material: 'metal' }, { material: undefined })).toEqual({ depth: 10 });
    expect(patch3d({ depth: 10 }, { depth: 0 })).toBeUndefined();
    expect(patch3d(undefined, { bevelW: 0 })).toEqual({ bevelW: 0 });
  });

  it('writes scene3d / sp3d like DeckCraft (points to EMU, camera, light rig, bevels, colours)', () => {
    expect(scene3dXml(shape())).toBeNull();
    const xml = scene3dXml(e3({ depth: 12, contour: 2, material: 'metal', lighting: 'harsh', lightDir: 'tl', bevelBottom: 'angle', bevelBottomW: 4, bevelBottomH: 3, depthColor: '#ff8800' }, { bevel: true, bevelKind: 'softRound', camera3d: 'isometricLeftDown', rotate3d: { x: 35, y: 45 } }))!;
    expect(xml).toContain('<a:camera prst="isometricLeftDown"/>');
    expect(xml).toContain('<a:lightRig rig="harsh" dir="tl"/>');
    expect(xml).toContain('extrusionH="152400"');
    expect(xml).toContain('contourW="25400"');
    expect(xml).toContain('prstMaterial="metal"');
    expect(xml).toContain('<a:bevelT w="76200" h="76200" prst="softRound"/>');
    expect(xml).toContain('<a:bevelB w="50800" h="38100" prst="angle"/>');
    expect(xml).toContain('<a:extrusionClr><a:srgbClr val="FF8800"/></a:extrusionClr>');
    // A hand-set tilt goes out as camera angles (lat = Y, lon = X, rev = Z).
    expect(scene3dXml(shape({ rotate3d: { x: 20, y: 30, z: 10 } }))).toContain('<a:rot lat="1800000" lon="1200000" rev="600000"/>');
  });

  it('draws depth as copies pushed back, contour as a ring, lighting as a gradient over the face', () => {
    expect(extrusionOf(shape())).toBeNull();
    const ext = extrusionOf(e3({ depth: 10, contour: 1 }))!;
    expect(ext.zs.length).toBeGreaterThan(1);
    expect(ext.zs.every((z) => z < 0)).toBe(true);
    expect(Math.min(...ext.zs)).toBeCloseTo(-20, 5); // 10 pt = 20 px
    expect(ext.contour).toBe(2);
    expect(extrusionOf(e3({ depth: 1584 }))!.zs.length).toBeLessThanOrEqual(36);
    expect(extrusionOf(e3({ depth: 4 }, { fill: '#ffffff' }))!.color).toBe(shade('#ffffff', -0.3));
    expect(extrusionOf(e3({ depth: 4, depthColor: '#123456' }))!.color).toBe('#123456');
    expect(faceShading(shape())).toBeNull();
    expect(faceShading(e3({ lighting: 'flat' }))).toBeNull();
    const harsh = faceShading(e3({ lighting: 'harsh', lightDir: 'tl' }))!;
    expect(harsh.x1).toBe(0); expect(harsh.y1).toBe(0); // lit from the top left
    expect(faceShading(e3({ material: 'plastic' }))!.radial).toBe(true);
    expect(faceShading(e3({ material: 'metal' }))!.stops.length).toBe(4);
  });

  it('scales the bevel with its size', () => {
    const small = bevelCss(shape({ bevel: true, bevelKind: 'angle' }))!;
    const big = bevelCss(shape({ bevel: true, bevelKind: 'angle', format3d: { bevelW: 12, bevelH: 12 } }))!;
    expect(small).toContain('inset 4px 4px');
    expect(big).toContain('inset 8px 8px');
  });
});

describe('.pptx export of the outline, fill and 3-D format', () => {
  const deck: Presentation = {
    id: 'd', title: 'shapes', themeId: 'theme_classic', slides: [{
      id: 's', group: 'Slide', text: '', elements: [
        shape({ id: 'a', name: '강조 상자', stroke: '#ff0000', strokeWidth: 8, cap: 'round', join: 'bevel', compound: 'double', dash: 'sysDashDot', fillTransparency: 0.4,
          bevel: true, bevelKind: 'circle', format3d: { depth: 6, material: 'plastic', lighting: 'soft' } }),
        shape({ id: 'b', x: 500, gradient: ['#ff0000', '#0000ff'], ...withGradientStops([{ pos: 0, color: '#ff0000', transparency: 0.5 }, { pos: 100, color: '#0000ff' }]) }),
        shape({ id: 'c', x: 900, fill: '#00ff00' }),
      ],
    }],
  };
  const slide = async () => {
    const lib = { ...createSeedLibrary(), presentations: [deck] };
    const pptx = await buildPptx(lib, { presentation: deck });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    return zip.file('ppt/slides/slide1.xml')!.async('string');
  };

  it('puts the line, fill and 3-D parts into the shape in the schema order', async () => {
    const xml = await slide();
    const first = xml.slice(xml.indexOf('name="강조 상자"'), xml.indexOf('</p:sp>', xml.indexOf('name="강조 상자"')));
    expect(first).toContain('<a:alpha val="60000"/>');
    expect(first).toContain('cap="rnd" cmpd="dbl"');
    expect(first).toContain('<a:prstDash val="sysDashDot"/><a:bevel/>');
    expect(first).toContain('extrusionH="76200"');
    expect(first).toContain('prstMaterial="plastic"');
    expect(first.indexOf('<a:solidFill>')).toBeLessThan(first.indexOf('<a:ln'));
    expect(first.indexOf('</a:ln>')).toBeLessThan(first.indexOf('<a:scene3d>'));
    expect(first.indexOf('</a:sp3d>')).toBeLessThan(first.indexOf('</p:spPr>'));
    expect(xml).toContain('<a:gradFill');
    expect(xml).toContain('<a:gs pos="0"><a:srgbClr val="FF0000"><a:alpha val="50000"/>');
    // A plain shape is left as PptxGenJS wrote it.
    expect(xml).toContain('<a:srgbClr val="00FF00"/>');
    expect(xml).not.toContain('lcs-');
  });

  it('leaves an unknown placeholder alone', () => {
    expect(patchShapeXml('<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/></p:nvSpPr></p:sp>', { marker: 'lcs-99', ln: '<a:ln/>' })).toContain('name="x"');
  });
});

describe('.pptx import of the same', () => {
  const dml = `<p:spTree xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="A"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="635000" y="635000"/><a:ext cx="1905000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"><a:alpha val="40000"/></a:srgbClr></a:gs><a:gs pos="50000"><a:srgbClr val="00FF00"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>
      <a:ln w="38100" cap="sq" cmpd="tri"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:prstDash val="lgDashDotDot"/><a:miter lim="800000"/><a:tailEnd type="diamond"/></a:ln>
      <a:scene3d><a:camera prst="isometricLeftDown"/><a:lightRig rig="sunset" dir="bl"/></a:scene3d><a:sp3d extrusionH="127000" contourW="25400" prstMaterial="metal"><a:bevelT w="63500" h="63500" prst="slope"/></a:sp3d>
    </p:spPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="ABCDEF"><a:alpha val="25000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>
  </p:spTree>`;
  it('reads the outline, stops with alpha, fill alpha and the 3-D format', () => {
    const [a, b] = drawingToElements(dml, { theme: OFFICE_THEME });
    expect(a).toMatchObject({ stroke: '#112233', cap: 'square', compound: 'triple', join: 'miter', dash: 'lgDashDotDot', arrowEnd: true, arrowEndKind: 'diamond' });
    expect(a.gradientStops).toEqual([{ pos: 0, color: '#ff0000', transparency: 0.6 }, { pos: 50, color: '#00ff00' }, { pos: 100, color: '#0000ff' }]);
    expect(a.camera3d).toBe('isometricLeftDown');
    expect(a.bevel).toBe(true);
    expect(a.bevelKind).toBe('slope');
    expect(a.format3d).toEqual({ lighting: 'sunset', lightDir: 'bl', depth: 10, contour: 2, material: 'metal', bevelW: 5, bevelH: 5 });
    expect(b.fillTransparency).toBe(0.75);
  });
});

describe('selecting inside a group', () => {
  const els = (): SlideElement[] => [
    shape({ id: 'a', x: 0, y: 0, w: 100, h: 100 }), shape({ id: 'b', x: 200, y: 0, w: 100, h: 100 }), shape({ id: 'c', x: 400, y: 0, w: 100, h: 100 }), shape({ id: 'solo', x: 0, y: 300 }),
  ];
  const grouped = () => groupSelection(els(), ['a', 'b', 'c']);

  it('a member selects the whole group until the group is entered', () => {
    leaveGroups();
    const g = grouped();
    expect(expandSelection(g, ['b']).sort()).toEqual(['a', 'b', 'c']);
    expect(selectionUnits(g, ['b'])).toHaveLength(1);
    enterGroup(g[0].groupId!);
    expect(expandSelection(g, ['b'])).toEqual(['b']);
    expect(selectionUnits(g, ['b'])[0].members).toEqual(['b']);
    // Ctrl+click toggles members: two of the three.
    expect(expandSelection(g, ['a', 'c']).sort()).toEqual(['a', 'c']);
    leaveGroups();
  });

  it('the group box follows the member that moved', () => {
    leaveGroups();
    let g = grouped();
    const box = (list: SlideElement[]) => selectionUnits(list, ['a'])[0].box;
    expect(box(g)).toMatchObject({ x: 0, w: 500 });
    g = g.map((e) => (e.id === 'c' ? { ...e, x: 700, w: 200 } : e));
    expect(box(g)).toMatchObject({ x: 0, w: 900 });
  });

  it('is left when the selection goes elsewhere', () => {
    const g = grouped();
    enterGroup(g[0].groupId!);
    pruneEntered(g, ['b']);
    expect(enteredGroups().size).toBe(1);
    pruneEntered(g, ['solo']);
    expect(enteredGroups().size).toBe(0);
  });

  it('formatting reaches one member, or every member of the group', () => {
    leaveGroups();
    const g = grouped();
    const paint = (sel: string[]) => { const ids = expandSelection(g, sel); return g.map((e) => (ids.includes(e.id) ? { ...e, fill: '#ff0000' } : e)); };
    expect(paint(['a']).filter((e) => e.fill === '#ff0000')).toHaveLength(3);
    enterGroup(g[0].groupId!);
    expect(paint(['a']).filter((e) => e.fill === '#ff0000').map((e) => e.id)).toEqual(['a']);
    leaveGroups();
  });

  it('deleting or copying part of a group leaves no one-member group; ungroup takes the whole group apart', () => {
    leaveGroups();
    const g = grouped();
    enterGroup(g[0].groupId!);
    const gone = deleteSelection({ id: 's', group: 'x', text: '', elements: g } as never, ['a']).elements!;
    expect(gone.map((e) => e.id)).toEqual(['b', 'c', 'solo']);
    expect(gone.filter((e) => e.groupId)).toHaveLength(2);
    const gone2 = deleteSelection({ id: 's', group: 'x', text: '', elements: gone } as never, ['b']).elements!;
    expect(gone2.every((e) => !e.groupId)).toBe(true);
    expect(cloneElements(g.filter((e) => e.id === 'a'))[0].groupId).toBeUndefined();
    expect(cloneElements(g.filter((e) => e.groupId))[0].groupId).toBeDefined();
    expect(ungroupSelection(g, ['b']).every((e) => !e.groupId)).toBe(true);
    leaveGroups();
  });

  it('the Selection pane lists a group as one row, its members when expanded', () => {
    const g = grouped();
    const gid = g[0].groupId!;
    const closed = selectionRows(g, new Set());
    expect(closed.map((r) => r.kind)).toEqual(['el', 'group']);
    expect(closed[1]).toMatchObject({ kind: 'group', gid, n: 1, open: false });
    const open = selectionRows(g, new Set([gid]));
    expect(open.map((r) => (r.kind === 'el' ? `${r.inGroup ? 'm' : 'e'}:${r.el.id}` : 'g'))).toEqual(['e:solo', 'g', 'm:c', 'm:b', 'm:a']);
  });
});

describe('export then import keeps the shape format', () => {
  it('round-trips the outline, gradient stops and 3-D format through a .pptx slide', async () => {
    const el = shape({ id: 'rt', stroke: '#ff0000', strokeWidth: 8, cap: 'square', join: 'bevel', compound: 'thinThick', dash: 'sysDashDotDot', arrowEnd: true, arrowEndKind: 'oval',
      ...withGradientStops([{ pos: 0, color: '#ff0000', transparency: 0.5 }, { pos: 60, color: '#00ff00' }, { pos: 100, color: '#0000ff' }]),
      bevel: true, bevelKind: 'convex', camera3d: 'obliqueTopLeft', rotate3d: { x: 15, y: 15 }, format3d: { depth: 8, contour: 1.5, material: 'plastic', lighting: 'morning', lightDir: 'r', bevelW: 3, bevelH: 4, bevelBottom: 'angle', bevelBottomW: 2, bevelBottomH: 2 } });
    const deck: Presentation = { id: 'rt', title: 'rt', themeId: 'theme_classic', slides: [{ id: 's', group: 'Slide', text: '', elements: [el] }] };
    const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [deck] }, { presentation: deck });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const tree = xml.slice(xml.indexOf('<p:spTree>'), xml.indexOf('</p:spTree>') + 11).replace('<p:spTree>', `<p:spTree ${ns}>`);
    const back = drawingToElements(tree, { theme: OFFICE_THEME }).find((e) => e.kind === 'shape' && e.stroke)!;
    expect(back).toMatchObject({ cap: 'square', join: 'bevel', compound: 'thinThick', dash: 'sysDashDotDot', arrowEnd: true, arrowEndKind: 'oval', camera3d: 'obliqueTopLeft', bevel: true, bevelKind: 'convex' });
    expect(back.gradientStops).toEqual([{ pos: 0, color: '#ff0000', transparency: 0.5 }, { pos: 60, color: '#00ff00' }, { pos: 100, color: '#0000ff' }]);
    expect(back.format3d).toEqual(el.format3d);
  });

  it('adds a picture fill as a related image with its alpha', async () => {
    const { patchPptx } = await import('../src/domain/io/shapeXml');
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld><p:sp><p:nvSpPr><p:cNvPr id="2" name="lcs-7"></p:cNvPr></p:nvSpPr><p:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln></a:ln></p:spPr></p:sp></p:sld>');
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships></Relationships>');
    zip.file('[Content_Types].xml', '<Types><Default Extension="xml" ContentType="application/xml"/><Override PartName="/x"/></Types>');
    await patchPptx(zip, [{ marker: 'lcs-7', name: '그림 채우기', fill: fillXml(shape({ fillImage: 'm', fillTransparency: 0.5 }), 'rIdLc7'), blip: { id: 'rIdLc7', ext: 'webp', data: new Uint8Array([1, 2, 3]) } }]);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('name="그림 채우기"');
    expect(xml).toContain('<a:blip r:embed="rIdLc7"><a:alphaModFix amt="50000"/>');
    expect(xml).not.toContain('<a:solidFill>');
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('Target="../media/lcfill-rIdLc7.webp"');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="webp" ContentType="image/webp"');
    expect(await zip.file('ppt/media/lcfill-rIdLc7.webp')!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]));
  });
});
