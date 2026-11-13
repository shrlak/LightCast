import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, ribbon, see, shutdown } from './harness';
import { SVG, makeEmf, makeWmf } from './fixtures';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

describe('insert media', () => {
  it('audio recording: fake mic records, stops and inserts', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page);
    await ribbon(page, '삽입');
    await page.getByRole('button', { name: /오디오/ }).first().click();
    await page.getByRole('button', { name: /오디오 녹음/ }).click();
    const dlg = page.getByRole('dialog', { name: '오디오 녹음' });
    await dlg.getByRole('button', { name: /● 녹음/ }).click();
    await see(dlg.getByRole('button', { name: /■ 중지/ }));
    await page.waitForTimeout(1500);
    await dlg.getByRole('button', { name: /■ 중지/ }).click();
    await see(dlg.getByLabel('녹음 미리 듣기'));
    await dlg.getByRole('button', { name: '삽입' }).click();
    await see(page.locator('.ppt-canvas .audio-object'));
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });

  it('screenshot dialog: capture, crop by dragging, insert a picture', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page);
    const before = await page.locator('.ppt-canvas img').count();
    await ribbon(page, '삽입');
    await page.getByRole('button', { name: /스크린샷/ }).click();
    const dlg = page.getByRole('dialog', { name: '화면 캡처' });
    await dlg.getByRole('button', { name: /화면 선택|캡처/ }).first().click();
    const crop = page.getByLabel('자를 영역을 끌어서 고르세요');
    await see(crop, 30_000);
    const box = await crop.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await see(page.getByText(/선택 영역/));
    await page.getByRole('dialog', { name: '화면 캡처 — 자르기' }).getByRole('button', { name: '자른 부분 삽입' }).click();
    await page.waitForFunction((n: number) => document.querySelectorAll('.ppt-canvas img').length > n, before, { timeout: 15_000 });
    await app.close();
  });

  it('metafile (.wmf and .emf) inserts as a picture', async () => {
    for (const [name, buffer] of [['logo.wmf', makeWmf()], ['logo.emf', makeEmf()]] as const) {
      const app = await openApp(base);
      const { page } = app;
      await openDeck(page);
      const before = await page.locator('.ppt-canvas img').count();
      await ribbon(page, '삽입');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '그림', exact: true }).first().click()]);
      await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer });
      await page.waitForFunction((n: number) => document.querySelectorAll('.ppt-canvas img').length > n, before, { timeout: 15_000 });
      // The picture really decoded (the metafile was drawn into an image the browser can show).
      await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('.ppt-canvas img')] as HTMLImageElement[]; return imgs.some((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 15_000 });
      await app.close();
    }
  });

  it('SVG inserts as a picture', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page);
    const before = await page.locator('.ppt-canvas img').count();
    await ribbon(page, '삽입');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '그림', exact: true }).first().click()]);
    await chooser.setFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: SVG });
    await page.waitForFunction((n: number) => document.querySelectorAll('.ppt-canvas img').length > n, before, { timeout: 15_000 });
    await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('.ppt-canvas img')] as HTMLImageElement[]; return imgs.some((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 15_000 });
    await app.close();
  });
});
