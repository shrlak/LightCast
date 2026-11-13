// .odp: rotation, gradients, groups, transitions, hidden slides and master-page objects (read and write).
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseOdp, writeOdp, ODP_MIME } from '../src/domain/io/odp';
import { applyPoint, formatDuration, gradientToLc, lcToGradient, mul, parseAngle, parseDuration, parseTransform, readTransition, transformBox, transitionAttrs } from '../src/domain/io/odpGeometry';
import type { Slide } from '../src/domain/types';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const store = () => {
  const stored = new Map<string, Uint8Array>();
  return { stored, storeImage: (b: Uint8Array) => { const id = `m${stored.size + 1}`; stored.set(id, b); return id; } };
};

const NSA = 'xmlns:office="o" xmlns:style="s" xmlns:fo="f" xmlns:draw="d" xmlns:text="t" xmlns:svg="v" xmlns:presentation="p" xmlns:smil="m" xmlns:anim="a"';
async function odpOf(content: string, styles = '', master = ''): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('mimetype', ODP_MIME, { compression: 'STORE' });
  z.file('styles.xml', `<office:document-styles ${NSA}><office:styles>${styles}</office:styles><office:automatic-styles><style:page-layout style:name="PM0"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM0">${master}</style:master-page></office:master-styles></office:document-styles>`);
  z.file('content.xml', `<office:document-content ${NSA}>${content}</office:document-content>`);
  return z.generateAsync({ type: 'uint8array' });
}
const noPics = { loadMedia: () => null };

describe('odp geometry helpers', () => {
  it('reads draw:transform lists in the order written (counter-clockwise radians)', () => {
    const m = parseTransform('rotate (1.5707963267949) translate (2cm 3cm)');
    // The point (1, 0) turns a quarter turn counter-clockwise (up the page), then moves.
    const [x, y] = applyPoint(m, 1, 0);
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(2);
    expect(applyPoint(parseTransform('translate (10mm 0.5in)'), 0, 0)[0]).toBeCloseTo(1);
    const [sx, sy] = applyPoint(mul(parseTransform('scale (2)'), parseTransform('translate (1cm 1cm)')), 1, 1);
    expect([sx, sy]).toEqual([4, 4]);
  });

  it('turns a box into centre, size and clockwise rotation', () => {
    const t = transformBox(parseTransform('rotate (-0.5235987755983)'), { x: 0, y: 0, w: 4, h: 2 });
    expect(t.rotation).toBeCloseTo(30, 1);
    expect(t.w).toBeCloseTo(4);
    expect(transformBox(parseTransform(''), { x: 1, y: 2, w: 3, h: 4 })).toMatchObject({ cx: 2.5, cy: 4, rotation: 0 });
  });

  it('parses angles and durations', () => {
    expect(parseAngle('30deg')).toBe(30);
    expect(parseAngle('30°')).toBe(30);
    expect(parseAngle('100grad')).toBeCloseTo(90);
    expect(parseDuration('PT00H00M05S')).toBe(5);
    expect(parseDuration('PT1M30S')).toBe(90);
    expect(parseDuration('soon')).toBeUndefined();
    expect(formatDuration(65)).toBe('PT00H01M05S');
  });

  it('maps gradients both ways (ODF angle 0 runs top to bottom; radial starts at the edge)', () => {
    expect(gradientToLc({ style: 'linear', start: '#ff0000', end: '#0000ff', angle: 0 })).toMatchObject({ gradient: ['#ff0000', '#0000ff'], gradientAngle: 90 });
    expect(gradientToLc({ style: 'linear', start: '#ff0000', end: '#0000ff', angle: 90 })).toMatchObject({ gradientAngle: 0 });
    expect(gradientToLc({ style: 'radial', start: '#ff0000', end: '#0000ff', angle: 0 })).toMatchObject({ gradient: ['#0000ff', '#ff0000'], gradientType: 'radial' });
    expect(gradientToLc({ style: 'axial', start: '#ff0000', end: '#0000ff', angle: 0 }).gradientStops).toHaveLength(3);
    expect(lcToGradient({ gradient: ['#f00', '#00f'], gradientAngle: 45 })).toEqual({ style: 'linear', start: '#ff0000', end: '#0000ff', angle: 45 });
    expect(lcToGradient({})).toBeNull();
  });

  it('reads transitions and automatic advance from page properties', () => {
    expect(readTransition({ 'smil:type': 'pushWipe', 'presentation:transition-speed': 'slow' })).toEqual({ transition: { kind: 'fx:push', duration: 1500 } });
    expect(readTransition({ 'presentation:transition-style': 'dissolve' }).transition?.kind).toBe('fx:dissolve');
    expect(readTransition({ 'presentation:transition-type': 'automatic', 'presentation:duration': 'PT00H00M07S' })).toEqual({ transition: { kind: 'cut', duration: 1, advanceOnClick: false }, autoAdvance: 7 });
    expect(readTransition({ 'presentation:transition-style': 'none' })).toEqual({});
    expect(transitionAttrs({ kind: 'fade', duration: 500 }, undefined)).toContain('transition-speed="fast"');
  });
});

describe('odp round trip: rotation, gradients, groups, transitions, hidden', () => {
  const slide = (): Slide => ({
    id: 's1', group: 'g', text: '', disabled: true, autoAdvance: 8, transition: { kind: 'fx:wipe', duration: 1000 },
    background: { kind: 'gradient', value: 'linear-gradient(180deg, #112233 0%, #445566 100%)' },
    elements: [
      { id: 'a', kind: 'text', x: 200, y: 300, w: 600, h: 200, text: '기울인 글', fontSize: 60, rotation: 30 },
      { id: 'b', kind: 'shape', shape: 'rect', x: 900, y: 100, w: 300, h: 200, fill: '#ff0000', gradient: ['#ff0000', '#0000ff'], gradientAngle: 45 },
      { id: 'c', kind: 'shape', shape: 'ellipse', x: 900, y: 500, w: 300, h: 300, fill: '#ffffff', gradient: ['#ffffff', '#00aa00'], gradientType: 'radial', rotation: 90 },
      { id: 'd', kind: 'image', x: 100, y: 600, w: 200, h: 100, mediaId: 'pic1', rotation: 15 },
      { id: 'g1', kind: 'shape', shape: 'rect', x: 50, y: 50, w: 100, h: 100, fill: '#111111', groupId: 'G', groupName: '묶음' },
      { id: 'g2', kind: 'shape', shape: 'rect', x: 200, y: 50, w: 100, h: 100, fill: '#222222', groupId: 'G', groupName: '묶음' },
      { id: 'l', kind: 'shape', shape: 'line', x: 400, y: 800, w: 200, h: 100, stroke: '#000000', flipV: true },
    ],
  });

  it('keeps rotation, gradient fills, groups, transition, auto advance and hidden slides', async () => {
    const bytes = await writeOdp({ title: 't', slides: [slide(), { id: 's2', group: 'g', text: 'x' }], properties: {} }, { loadMedia: () => ({ bytes: PNG, mime: 'image/png' }) });
    const doc = await parseOdp(bytes, store());
    const [a, b] = doc.slides;
    expect(a.disabled).toBe(true);
    expect(b.disabled).toBeUndefined();
    expect(a.autoAdvance).toBe(8);
    expect(a.transition).toEqual({ kind: 'fx:wipe', duration: 1000 });
    expect(b.transition).toBeUndefined();
    expect(a.background).toEqual({ kind: 'gradient', value: 'linear-gradient(180deg, #112233 0%, #445566 100%)' });
    const [text, lin, rad, img, g1, g2, line] = a.elements!;
    expect(text.rotation).toBeCloseTo(30, 1);
    expect(text).toMatchObject({ x: 200, y: 300, w: 600, h: 200 });
    expect(lin).toMatchObject({ gradient: ['#ff0000', '#0000ff'], gradientAngle: 45 });
    expect(lin.gradientType).toBeUndefined();
    expect(rad).toMatchObject({ gradient: ['#ffffff', '#00aa00'], gradientType: 'radial' });
    expect(rad.rotation).toBeCloseTo(90, 1);
    expect(img.rotation).toBeCloseTo(15, 1);
    expect(img.x).toBe(100);
    expect(g1.groupId).toBeTruthy();
    expect(g2.groupId).toBe(g1.groupId);
    expect(g1.groupName).toBe('묶음');
    expect(text.groupId).toBeUndefined();
    expect(line).toMatchObject({ shape: 'line', x: 400, y: 800, w: 200, h: 100, flipV: true });
  });

  it('writes a hidden / timed page style, groups, turns and gradient definitions', async () => {
    const zip = await JSZip.loadAsync(await writeOdp({ title: 't', slides: [slide()], properties: {} }, noPics));
    const xml = await zip.file('content.xml')!.async('string');
    expect(xml).toContain('presentation:visibility="hidden"');
    expect(xml).toContain('presentation:duration="PT00H00M08S"');
    expect(xml).toContain('<draw:g draw:name="묶음">');
    expect(xml).toContain('draw:transform="rotate (');
    expect(await zip.file('styles.xml')!.async('string')).toContain('<draw:gradient');
  });
});

describe("odp reading of other programs' files", () => {
  it('flattens groups into slide coordinates, applying group and shape transforms', async () => {
    const bytes = await odpOf(`<office:body><office:presentation><draw:page draw:name="p">
      <draw:g draw:name="묶음" draw:transform="translate (2.8cm 2.1cm)">
        <draw:frame svg:x="0cm" svg:y="0cm" svg:width="2.8cm" svg:height="2.1cm"><draw:text-box><text:p>안</text:p></draw:text-box></draw:frame>
        <draw:g><draw:custom-shape svg:x="2.8cm" svg:y="0cm" svg:width="2.8cm" svg:height="2.1cm"><draw:enhanced-geometry draw:type="ellipse"/></draw:custom-shape></draw:g>
      </draw:g>
      <draw:custom-shape svg:width="5.6cm" svg:height="2.1cm" draw:transform="rotate (0.5235987755983) translate (14cm 10.5cm)"><draw:enhanced-geometry draw:type="rectangle"/></draw:custom-shape>
    </draw:page></office:presentation></office:body>`);
    const els = (await parseOdp(bytes, store())).slides[0].elements!;
    expect(els).toHaveLength(3);
    expect(els[0]).toMatchObject({ kind: 'text', x: 144, y: 108, w: 144, h: 108 });
    expect(els[1]).toMatchObject({ shape: 'ellipse', x: 288, y: 108 });
    expect(els[1].groupId).toBe(els[0].groupId);
    expect(els[2].groupId).toBeUndefined();
    // Turned 30° counter-clockwise about its own corner, then moved.
    expect(els[2].rotation).toBeCloseTo(330, 1);
    expect(els[2].w).toBe(288);
  });

  it('reads named gradients (linear, radial, multi-stop) and a gradient page background', async () => {
    const styles = `<draw:gradient draw:name="g1" draw:style="linear" draw:start-color="#ff0000" draw:end-color="#0000ff" draw:angle="90deg"/>
      <draw:gradient draw:name="g2" draw:style="radial" draw:start-color="#ffffff" draw:end-color="#000000"/>
      <draw:gradient draw:name="g3" draw:style="linear" draw:start-color="#000000" draw:end-color="#ffffff" draw:angle="0"><loext:gradient-stop xmlns:loext="l" svg:offset="0" svg:stop-color="#111111"/><loext:gradient-stop xmlns:loext="l" svg:offset="0.5" svg:stop-color="#00ff00"/><loext:gradient-stop xmlns:loext="l" svg:offset="1" svg:stop-color="#222222"/></draw:gradient>`;
    const bytes = await odpOf(`<office:automatic-styles>
        <style:style style:name="a" style:family="graphic"><style:graphic-properties draw:fill="gradient" draw:fill-gradient-name="g1"/></style:style>
        <style:style style:name="b" style:family="graphic"><style:graphic-properties draw:fill="gradient" draw:fill-gradient-name="g2"/></style:style>
        <style:style style:name="c" style:family="graphic"><style:graphic-properties draw:fill="gradient" draw:fill-gradient-name="g3"/></style:style>
        <style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="gradient" draw:fill-gradient-name="g1"/></style:style>
      </office:automatic-styles><office:body><office:presentation><draw:page draw:style-name="dp1">
        <draw:custom-shape draw:style-name="a" svg:x="0cm" svg:y="0cm" svg:width="5cm" svg:height="5cm"/>
        <draw:custom-shape draw:style-name="b" svg:x="6cm" svg:y="0cm" svg:width="5cm" svg:height="5cm"/>
        <draw:custom-shape draw:style-name="c" svg:x="12cm" svg:y="0cm" svg:width="5cm" svg:height="5cm"/>
      </draw:page></office:presentation></office:body>`, styles);
    const slide = (await parseOdp(bytes, store())).slides[0];
    const [a, b, c] = slide.elements!;
    expect(a).toMatchObject({ gradient: ['#ff0000', '#0000ff'], gradientAngle: 0 });
    expect(b).toMatchObject({ gradient: ['#000000', '#ffffff'], gradientType: 'radial' });
    expect(c.gradientStops!.map((s) => s.color)).toEqual(['#111111', '#00ff00', '#222222']);
    expect(c.gradientStops![1].pos).toBe(50);
    expect(slide.background).toEqual({ kind: 'gradient', value: 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)' });
  });

  it('reads hidden slides, transitions and timing from LibreOffice-style page properties', async () => {
    const bytes = await odpOf(`<office:automatic-styles>
        <style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties presentation:visibility="hidden" presentation:transition-type="automatic" presentation:duration="PT00H00M12S" smil:type="pushWipe" smil:subtype="fromLeft" presentation:transition-speed="slow"/></style:style>
        <style:style style:name="dp2" style:family="drawing-page"><style:drawing-page-properties presentation:transition-style="dissolve"/></style:style>
      </office:automatic-styles><office:body><office:presentation>
        <draw:page draw:style-name="dp1"/>
        <draw:page draw:style-name="dp2"/>
        <draw:page draw:display="false"/>
        <draw:page><anim:par><anim:transitionFilter smil:type="fade" smil:dur="2s"/></anim:par></draw:page>
      </office:presentation></office:body>`);
    const [a, b, c, d] = (await parseOdp(bytes, store())).slides;
    expect(a).toMatchObject({ disabled: true, autoAdvance: 12, transition: { kind: 'fx:push', duration: 1500, advanceOnClick: false } });
    expect(b.transition).toEqual({ kind: 'fx:dissolve', duration: 1000 });
    expect(b.disabled).toBeUndefined();
    expect(c.disabled).toBe(true);
    expect(d.transition).toEqual({ kind: 'fade', duration: 2000 });
  });

  it('puts simple master-page objects under each slide, leaving out placeholders', async () => {
    const master = `<draw:custom-shape draw:name="띠" svg:x="0cm" svg:y="19cm" svg:width="28cm" svg:height="2cm"><draw:enhanced-geometry draw:type="rectangle"/></draw:custom-shape>
      <draw:frame presentation:class="page-number" svg:x="1cm" svg:y="1cm" svg:width="3cm" svg:height="1cm"><draw:text-box><text:p>1</text:p></draw:text-box></draw:frame>
      <draw:frame svg:x="1cm" svg:y="1cm" svg:width="6cm" svg:height="1cm"><draw:text-box><text:p>우리 교회</text:p></draw:text-box></draw:frame>`;
    const bytes = await odpOf(`<office:automatic-styles><style:style style:name="dpx" style:family="drawing-page"><style:drawing-page-properties presentation:background-objects-visible="false"/></style:style></office:automatic-styles><office:body><office:presentation>
      <draw:page draw:master-page-name="Default"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="2cm"><draw:text-box><text:p>본문</text:p></draw:text-box></draw:frame></draw:page>
      <draw:page draw:master-page-name="Default"/>
      <draw:page draw:master-page-name="Default" draw:style-name="dpx"/>
    </office:presentation></office:body>`, '', master);
    const [a, b, c] = (await parseOdp(bytes, store())).slides;
    expect(a.elements!.map((e) => e.text ?? e.name)).toEqual(['마스터: 띠', '우리 교회', '본문']);
    expect(a.elements![0]).toMatchObject({ kind: 'shape', y: 977, w: 1440 });
    expect(b.elements).toHaveLength(2);
    expect(new Set([...a.elements!, ...b.elements!].map((e) => e.id)).size).toBe(5);
    expect(c.elements).toHaveLength(0);
  });
});
