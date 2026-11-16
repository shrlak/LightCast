import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, ribbon, see, shutdown, textOf, type Page } from './harness';
import { makeOdp, makePptxSlides } from './fixtures';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

/** A paste event carrying these files (what the browser fires for Ctrl+V of files copied in the file manager). */
async function pasteFiles(page: Page, files: { name: string; type: string; buffer: Buffer }[]) {
  await page.evaluate(({ list }: { list: { name: string; type: string; b64: string }[] }) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { list: files.map((f) => ({ name: f.name, type: f.type, b64: f.buffer.toString('base64') })) });
}

const thumbs = (page: Page) => page.locator('.ppt-thumb');

describe('paste slides in the browser', () => {
  it('Ctrl+V of a 20-slide .pptx puts 20 slides after the current slide, in order, as one undo step', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '기존 슬라이드');
    await thumbs(page).first().click();
    const before = await thumbs(page).count();
    await pasteFiles(page, [{ name: 'copied.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await makePptxSlides(20) }]);
    await see(page.getByText('슬라이드 20장을 붙여넣었습니다'), 90_000);
    expect(await thumbs(page).count()).toBe(before + 20);
    // The first pasted slide is selected and shown; the 20th comes right before the deck's old second slide.
    await see(page.locator('.ppt-canvas').getByText('슬라이드 01 제목'));
    await thumbs(page).nth(20).click();
    await see(page.locator('.ppt-canvas').getByText('슬라이드 20 제목'));
    await thumbs(page).nth(21).click();
    await see(page.locator('.ppt-canvas').getByText('두 번째 슬라이드'));
    await page.locator('.ppt-thumb').first().focus();
    await page.keyboard.press('Control+z');
    // One Ctrl+Z takes all 20 out again (one undo step).
    for (let i = 0; i < 50 && (await thumbs(page).count()) !== before; i++) await page.waitForTimeout(200);
    expect(await thumbs(page).count()).toBe(before);
    expect(app.errors).toEqual([]);
    await app.close();
  });

  it('pasting an .odp file gives its slides; a damaged .pptx says so in Korean without a crash', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '기존 슬라이드');
    const before = await thumbs(page).count();
    await pasteFiles(page, [{ name: 'copied.odp', type: 'application/vnd.oasis.opendocument.presentation', buffer: await makeOdp('붙여넣은 ODP') }]);
    await see(page.getByText('슬라이드 2장을 붙여넣었습니다'), 30_000);
    expect(await thumbs(page).count()).toBe(before + 2);
    await pasteFiles(page, [{ name: 'broken.pptx', type: 'application/octet-stream', buffer: Buffer.from('not a presentation at all, only some text') }]);
    await see(page.getByText(/broken\.pptx: 슬라이드를 읽지 못했습니다/), 20_000);
    expect(await thumbs(page).count()).toBe(before + 2);
    expect(app.errors).toEqual([]);
    await app.close();
  });

  it('홈 › 붙여넣기 › 클립보드 형식 보기… lists the formats with their kind and copies the report', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '기존 슬라이드');
    await ribbon(page, '홈');
    await page.evaluate(async () => { await navigator.clipboard.writeText('복사한 글자'); });
    await page.locator('.ppt-thumb').first().click();
    await page.keyboard.press('Alt+q');
    await page.getByRole('combobox', { name: '어떤 작업을 원하시나요?' }).fill('클립보드 형식');
    const opt = page.getByRole('option', { name: /클립보드 형식 보기/ });
    await see(opt);
    await opt.first().click();
    const dlg = page.getByRole('dialog', { name: '클립보드 형식' });
    await see(dlg);
    expect(await textOf(dlg.locator('table'))).toContain('text/plain');
    await dlg.getByRole('button', { name: '목록 복사' }).click();
    await see(page.getByText('형식 목록을 복사했습니다'));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('text/plain');
    await app.close();
  });
});
