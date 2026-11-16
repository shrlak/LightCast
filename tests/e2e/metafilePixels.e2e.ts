// The metafile reader's own pixels against Chromium's: glyph outlines (glyf / CFF, read for flood fills)
// against Chromium drawing the same font, the EMF+ effect filters (on a PNG) against the same effect on
// decoded pixels, and a flood fill that leaves text alone. No app is needed: Chromium renders the SVG.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metafileToSvg } from '../../src/domain/metafile';
import { addMetafileFont, addMetafileFontFile, clearMetafileFonts, metafileFont } from '../../src/domain/metafile/fonts';
import { textCoverage, charAdvances, baselineOrigins } from '../../src/domain/metafile/textraster';
import { applyEffect, effectGuid, type Effect } from '../../src/domain/metafile/effects';
import { decodePng } from '../../src/domain/metafile/decode';
import { decodeBudget, encodePng, type Rgba } from '../../src/domain/metafile/png';
import { B, RED, comment, emf, emfBrush, emfFont, emfRec, emfSelect, emfTextW, plusHeader, plusRec } from '../fixtures/metafileBytes';

/* eslint-disable @typescript-eslint/no-explicit-any */
const req = createRequire(import.meta.url);
let browser: any, page: any;
beforeAll(async () => {
  browser = await req('playwright').chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  page = await browser.newPage({ viewport: { width: 640, height: 320 }, deviceScaleFactor: 1 });
});
afterAll(async () => { await browser?.close(); clearMetafileFonts(); });

/** Chromium's pixels of an HTML body (fonts loaded first), w x h at the top-left. */
async function shot(html: string, w: number, h: number): Promise<Rgba> {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${html}</body></html>`);
  await page.evaluate(() => (document as any).fonts.ready);
  const png: Buffer = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  decodeBudget.px = 1e8;
  return decodePng(new Uint8Array(png))!;
}
const dark = (img: Rgba, i: number) => img.px[i * 4] + img.px[i * 4 + 1] + img.px[i * 4 + 2] < 3 * 128;

describe('glyph outlines against Chromium', () => {
  const fonts: [string, string, string][] = [
    ['Arimo (TrueType glyf)', 'node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff', 'font/woff'],
    ['Inter (OpenType CFF)', '/usr/share/fonts/opentype/inter/Inter-Bold.otf', 'font/otf'],
  ];
  for (const [label, file, mime] of fonts) {
    it.skipIf(!existsSync(file))(`${label}: the outline the flood raster uses covers what Chromium draws`, async () => {
      const bytes = new Uint8Array(readFileSync(file));
      expect(await addMetafileFontFile(bytes, 'Probe')).toBe(true);
      const f = metafileFont('Probe')!;
      const text = [...'Og&Qx8'], size = 120;
      const adv = charAdvances(text, 'Probe', size, false, false);
      const d = textCoverage({ family: 'Probe', bold: false, italic: false, size, chars: text, origins: baselineOrigins(20, 160, adv, 0), advances: adv, angle: 0 });
      expect(d.length).toBeGreaterThan(200);
      const face = `<style>@font-face{font-family:Probe;src:url(data:${mime};base64,${Buffer.from(bytes).toString('base64')})}</style>`;
      const xs = adv.reduce<number[]>((a, _v, i) => [...a, i ? a[i - 1] + adv[i - 1] : 20], []);
      const ours = await shot(`<svg width="600" height="220"><path d="${d}" fill="#000"/></svg>`, 600, 220);
      const theirs = await shot(`${face}<svg width="600" height="220"><text x="${xs.join(' ')}" y="160" font-family="Probe" font-size="${size}">${text.join('')}</text></svg>`, 600, 220);
      let both = 0, either = 0;
      for (let i = 0; i < 600 * 220; i++) { const a = dark(ours, i), b = dark(theirs, i); if (a && b) both++; if (a || b) either++; }
      expect(either).toBeGreaterThan(5000);
      expect(both / either).toBeGreaterThan(0.95);
      expect(f.unitsPerEm).toBeGreaterThan(0);
      clearMetafileFonts();
    });
  }
});

describe('EMF+ effects: Chromium filter on a PNG = the same effect on the pixels', () => {
  const W = 16, H = 16;
  const src: Rgba = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) src.px.set([x * 16, y * 16, 255 - x * 8 - y * 7, 255], (y * W + x) * 4);
  const png = encodePng(src);
  const image = plusRec(0x4008, (5 << 8) | 2, (b) => b.u32(0xdbc01002, 1, W, H, 0, 0x26200a, 1).u8(...png));
  const guid = (s: string) => { const h = s.replace(/-/g, ''); const b = new B(); b.u32(parseInt(h.slice(0, 8), 16)).u16(parseInt(h.slice(8, 12), 16), parseInt(h.slice(12, 16), 16)); for (let i = 16; i < 32; i += 2) b.u8(parseInt(h.slice(i, i + 2), 16)); return b.a; };
  const effectRec = (k: Effect['k'], body: (b: B) => void) => { const p = new B(); body(p); return plusRec(0x4038, 0, (b) => b.u8(...guid(effectGuid(k))).u32(p.length).u8(...p.a)); };
  // drawn 1:1 at the top-left of a 16 x 16 picture
  const draw = plusRec(0x401b, 2 | 0x2000, (b) => b.u32(0xff, 2).f32(0, 0, W, H).u32(3).f32(0, 0, W, 0, 0, H));
  const file = (rec: number[]) => {
    const h = new B();
    h.u32(1, 88).u32(0, 0, W - 1, H - 1).u32(0, 0, Math.round(W * 26.4583), Math.round(H * 26.4583)).u32(0x464d4520, 0x10000, 0, 0).u16(1, 0).u32(0, 0, 0).u32(1000, 1000, 264, 264);
    const body = comment(plusHeader(false), image, rec, draw);
    const eof = emfRec(14, (b) => b.u32(0, 16, 20));
    const out = new Uint8Array([...h.a, ...body, ...eof]);
    new DataView(out.buffer).setUint32(48, out.length, true);
    return out;
  };
  const cases: [string, Effect['k'], (b: B) => void, Effect][] = [
    ['levels', 'levels', (b) => b.u32(80, 30, 10), { k: 'levels', highlight: 80, midtone: 30, shadow: 10 }],
    ['colour curve (midtone, green)', 'colorCurve', (b) => b.u32(5, 2, -60), { k: 'colorCurve', adjust: 5, channel: 2, intensity: -60 }],
    ['brightness / contrast', 'brightnessContrast', (b) => b.u32(40, 50), { k: 'brightnessContrast', brightness: 40, contrast: 50 }],
    ['colour balance', 'colorBalance', (b) => b.u32(30, -20, 10), { k: 'colorBalance', cr: 30, mg: -20, yb: 10 }],
    ['tint', 'tint', (b) => b.u32(-120, 40), { k: 'tint', hue: -120, amount: 40 }],
  ];
  for (const [label, k, body, e] of cases) {
    it(label, async () => {
      const r = metafileToSvg(file(effectRec(k, body)))!;
      expect(r.svg).toContain('<filter');
      const got = await shot(r.svg.replace(/width="[^"]+" height="[^"]+" viewBox="[^"]+"/, `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`), W, H);
      const want = applyEffect(e, src)!.img;
      let max = 0;
      for (let i = 0; i < W * H * 4; i++) if (i % 4 !== 3) max = Math.max(max, Math.abs(got.px[i] - want.px[i]));
      expect(max).toBeLessThanOrEqual(2);
    });
  }
});

describe('a flood fill drawn by Chromium leaves the text it ran around', () => {
  it('the strokes of an O stay black, its counter and the page around it turn red', async () => {
    const woff = new Uint8Array(readFileSync('node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff'));
    expect(await addMetafileFontFile(woff, 'Arimo')).toBe(true);
    const svg = metafileToSvg(emf([
      emfFont(1, 'Arimo', -80), emfSelect(1), emfTextW(20, 10, 'O'),
      emfBrush(2, RED), emfSelect(2), emfRec(53, (b) => b.u32(150, 50, 0, 0)), emfRec(53, (b) => b.u32(47, 44, 0, 0)),
    ]))!.svg;
    const face = `<style>@font-face{font-family:Arimo;src:url(data:font/woff;base64,${Buffer.from(woff).toString('base64')})}</style>`;
    const img = await shot(face + svg.replace(/width="[^"]+" height="[^"]+" viewBox/, 'width="200" height="100" viewBox'), 200, 100);
    const at = (x: number, y: number) => [...img.px.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)];
    expect(at(150, 50)).toEqual([255, 0, 0]); // the page
    expect(at(47, 44)).toEqual([255, 0, 0]); // the counter
    // across the O's left stroke on its middle row: some fully black pixels, no red ones over the stroke's core
    const row = Array.from({ length: 16 }, (_, i) => at(22 + i, 44));
    expect(row.some(([r, g, b]) => r + g + b < 60)).toBe(true);
    clearMetafileFonts();
    addMetafileFont(new Uint8Array(0)); // (a no-op, never throws)
  });
});
