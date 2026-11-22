// A deck in a font this computer lacks: the notice finds it on the internet and adds it by itself. The font
// server's answers are stubbed (a bundled Carlito file stands in for the download), so no real internet is needed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import { boot, openApp, openFile, see, shutdown } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

const FAMILY = 'LightCast Test Serif';
const fontBytes = readFileSync(createRequire(import.meta.url).resolve('@fontsource/carlito/files/carlito-latin-400-normal.woff'));

async function deckInFont(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.addSlide().addText('글꼴 없는 본문', { x: 1, y: 1, w: 8, h: 1.5, fontSize: 32, fontFace: FAMILY });
  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
}

describe('missing fonts from the internet', () => {
  it('downloads a missing deck font and keeps it under the deck’s name', async () => {
    const { page, close, errors } = await openApp(base);
    const asked: string[] = [];
    await page.route('**/api/fonts/find?**', (route: any) => {
      asked.push(new URL(route.request().url()).searchParams.get('family') ?? '');
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ query: FAMILY, match: { family: 'Carlito', source: 'Google Fonts', license: 'OFL-1.1', category: 'sans-serif', faces: [{ weight: 400, italic: false }] } }) });
    });
    await page.route('**/api/fonts/file?**', (route: any) => route.fulfill({ contentType: 'font/woff', body: fontBytes, headers: { 'x-font-format': 'ttf' } }));
    await openFile(page, /PowerPoint · OpenDocument/, { name: 'font-deck.pptx', buffer: await deckInFont() });
    await see(page.locator('.ppt-canvas').getByText('글꼴 없는 본문'));
    await see(page.locator('.font-missing-notice').getByText(/인터넷에서 글꼴을 받아 추가했습니다/), 30_000);
    expect(asked).toContain(FAMILY);
    expect(await page.evaluate((f: string) => [...document.fonts].some((x) => x.family.replace(/"/g, '') === f && x.status === 'loaded'), FAMILY)).toBe(true);
    // The missing-font warning is gone: only the success line is left.
    await page.waitForFunction(() => !/없는 글꼴이 있습니다/.test(document.querySelector('.font-missing-notice')?.textContent ?? ''), null, { timeout: 10_000 });
    expect(await page.locator('.font-missing-notice').innerText()).toMatch(/LightCast Test Serif\(Carlito\)/);
    expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await close();
  });
});
