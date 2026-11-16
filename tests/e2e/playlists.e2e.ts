import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, shutdown, sleep, type Page } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

const names = (page: Page): Promise<string[]> => page.locator('select.playlist-select option').allInnerTexts();

/** 라이브러리 › 재생목록 ⋯ › ＋ 새 재생목록 with the given name (the new list becomes the active one). */
async function newPlaylist(page: Page, name: string) {
  await page.locator('button.pl-more').click();
  await page.getByRole('menuitem', { name: /새 재생목록/ }).click();
  const dlg = page.getByRole('dialog', { name: '새 재생목록' });
  await dlg.getByRole('textbox').fill(name);
  await dlg.getByRole('button', { name: '저장' }).click();
  await sleep(300);
}

describe('비어 있는 재생목록 자동 삭제', () => {
  it('empty lists are removed when the app starts again; the list with a deck stays', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '남아 있는 재생목록'); // imports deck.pptx: a playlist named "deck" with a deck in it
    await page.getByRole('button', { name: '라이브러리', exact: true }).click();
    await newPlaylist(page, '빈 목록 하나');
    await newPlaylist(page, '빈 목록 둘');
    // While the app runs, a list that was just made (and the one being worked in) stays.
    const before = await names(page);
    expect(before).toEqual(expect.arrayContaining(['deck', '빈 목록 하나', '빈 목록 둘']));
    // Start again: the empty lists that are not the active one go.
    await page.reload();
    await page.getByRole('button', { name: '파일', exact: true }).waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.getElementById('boot-splash')?.remove());
    await page.getByRole('button', { name: '라이브러리', exact: true }).click();
    await sleep(800);
    const after = await names(page);
    expect(after).toContain('deck');
    // The active list after a restart is the first one, so neither empty list is protected: both are gone.
    expect(after.filter((n) => n.startsWith('빈 목록'))).toEqual([]);
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });
});
