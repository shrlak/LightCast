import { describe, expect, it } from 'vitest';
import { containBox, looksLikeSvg, prepareMediaBlob, sanitizeCss, sanitizeSvg, svgForPptx, svgIntrinsicSize } from '../src/domain/svgPicture';

const EVIL = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" onload="alert(1)">
  <script>alert(1)</script>
  <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <rect id="r" width="10" height="10" fill="red" onclick="x()" style="fill:url(http://evil/x.svg#a);stroke:blue"/>
  <image href="https://evil.example/a.png" width="5" height="5"/>
  <image href="data:image/png;base64,AAAA" width="5" height="5"/>
  <use xlink:href="#r"/>
  <use xlink:href="http://evil.example/x.svg#r"/>
  <a href="javascript:alert(1)"><circle r="3" fill="url(#g)"/></a>
  <animate attributeName="x" to="1"/>
  <style>@import url(http://evil/x.css); .a{fill:green;background:url(http://evil/y.png)}</style>
  <text>A &amp; B</text>
</svg>`;

describe('sanitizeSvg', () => {
  const out = sanitizeSvg(EVIL)!;
  it('drops script, foreignObject, animation and handlers', () => {
    expect(out).not.toMatch(/script|foreignObject|animate|onload|onclick|alert/i);
  });
  it('drops external references but keeps local ones', () => {
    expect(out).not.toMatch(/evil/);
    expect(out).toContain('href="#r"');
    expect(out).toContain('href="data:image/png;base64,AAAA"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('stroke:blue');
    expect(out).toContain('fill:green');
  });
  it('keeps content of links and escapes text', () => {
    expect(out).toContain('<circle');
    expect(out).toContain('A &amp; B');
    expect(out).not.toContain('<a ');
  });
  it('gives a picture that states only a viewBox its size', () => {
    expect(out).toContain('width="100"');
    expect(out).toContain('height="50"');
  });
  it('is not an svg: null', () => {
    expect(sanitizeSvg('<html><body/></html>')).toBeNull();
    expect(sanitizeSvg('hello')).toBeNull();
  });
  it('adds the namespace when missing', () => {
    expect(sanitizeSvg('<svg width="10" height="20"><rect width="1" height="1"/></svg>')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
  it('rejects a script namespace declaration', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://evil/"><g/></svg>')).not.toContain('evil');
  });
});

describe('sanitizeCss', () => {
  it('removes imports, expressions and outside urls', () => {
    expect(sanitizeCss('@import "a.css"; a{width:expression(alert(1));fill:url(#g);b:url("http://x/y")}')).toBe(' a{width:;fill:url(#g);b:none}');
  });
});

describe('svgIntrinsicSize', () => {
  it('reads width/height, units and viewBox', () => {
    expect(svgIntrinsicSize('<svg width="2in" height="1in"/>')).toEqual({ w: 192, h: 96 });
    expect(svgIntrinsicSize('<svg viewBox="0 0 40 20"/>')).toEqual({ w: 40, h: 20 });
    expect(svgIntrinsicSize('<svg width="80" viewBox="0 0 40 20"/>')).toEqual({ w: 80, h: 40 });
    expect(svgIntrinsicSize('<svg width="50%"/>')).toBeNull();
  });
});

describe('looksLikeSvg / prepareMediaBlob', () => {
  it('recognises by type, name or text', () => {
    expect(looksLikeSvg('image/svg+xml')).toBe(true);
    expect(looksLikeSvg('', 'a.svg')).toBe(true);
    expect(looksLikeSvg('', undefined, '<?xml version="1.0"?><svg/>')).toBe(true);
    expect(looksLikeSvg('image/png', 'a.svg')).toBe(false);
  });
  it('stores a cleaned, typed svg and leaves rasters alone', async () => {
    const blob = await prepareMediaBlob(new Blob([EVIL], { type: '' }));
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).not.toMatch(/script/);
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    expect(await prepareMediaBlob(png)).toBe(png);
  });
});

describe('export helpers', () => {
  it('containBox centres a picture of another aspect', () => {
    expect(containBox({ x: 0, y: 0, w: 10, h: 10 }, { w: 20, h: 10 })).toEqual({ x: 0, y: 2.5, w: 10, h: 5 });
  });
  it('svgForPptx sets a pixel size for the PNG fallback and keeps the viewBox', () => {
    const s = svgForPptx('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', 2, 1);
    expect(s).toContain('width="384"');
    expect(s).toContain('height="192"');
    expect(s).toContain('viewBox="0 0 10 10"');
  });
});
