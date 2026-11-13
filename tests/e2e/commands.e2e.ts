import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, see, shutdown } from './harness';
import { PNG_1PX } from './fixtures';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

const SEARCH = { name: '어떤 작업을 원하시나요?' };

describe('command search (Alt+Q)', () => {
  it('Alt+Q focuses the box and finds 붙여넣기 with its drop-down items', async () => {
    const { page, close } = await openApp(base);
    await page.keyboard.press('Alt+q');
    const box = page.getByRole('combobox', SEARCH);
    expect(await box.evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
    await box.fill('붙여넣기');
    await see(page.getByRole('option', { name: /^붙여넣기\s*홈 › 클립보드$/ }));
    await see(page.getByRole('option', { name: /^텍스트만 유지/ }));
    await close();
  });

  it('runs a drop-down item (붙여넣기 › 텍스트만 유지) without an error', async () => {
    const app = await openApp(base);
    const { page } = app;
    await page.getByRole('tab', { name: '삽입', exact: true }).click();
    await page.keyboard.press('Alt+q');
    await page.getByRole('combobox', SEARCH).fill('텍스트만 유지');
    const opt = page.getByRole('option', { name: /^텍스트만 유지/ });
    await see(opt);
    await opt.first().click();
    // Search switches to the tab the command lives on, runs it, and closes its menu again.
    await see(page.getByRole('tab', { name: '홈', exact: true, selected: true }));
    await page.waitForTimeout(600);
    expect(await page.getByText('사용할 수 없습니다').count()).toBe(0);
    expect(await page.locator('.ribbon .rb-body [role="menu"], .ribbon .rb-body .ppt-menu').count()).toBe(0);
    expect(app.errors).toEqual([]);
    await app.close();
  });

  it('runs 그림 글머리 기호 from search: file chooser, then the slide text gets a picture bullet', async () => {
    const { page, close } = await openApp(base);
    // Put the cursor in the slide's text first (the command needs text to act on).
    await page.locator('[data-slide-text-box], [data-text-element]').first().click();
    await page.keyboard.press('Alt+q');
    await page.getByRole('combobox', SEARCH).fill('그림 글머리 기호');
    const opt = page.getByRole('option', { name: /^그림 글머리 기호/ });
    await see(opt);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15_000 }), opt.first().click()]);
    await chooser.setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG_1PX });
    await see(page.locator('.list-marker.list-picture'));
    await close();
  });
});
