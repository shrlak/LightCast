import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backstage, boot, openApp, openDeck, see, shutdown, sleep, type Page } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

/** Three entries in the 휴지통 (copies of the open deck with other titles), then the 휴지통 window. */
async function openTrash(page: Page) {
  await openDeck(page, '휴지통 시험');
  await sleep(800); // the library is saved a moment after the import
  await page.evaluate(() => {
    const KEY = 'freecast.library.v1';
    const lib = JSON.parse(localStorage.getItem(KEY)!);
    const base = lib.presentations[0];
    lib.trash = ['첫째 자료', '둘째 자료', '셋째 자료'].map((title, i) => ({
      id: `t${i}`, kind: 'presentation', deletedAt: Date.now() - i * 1000, expiresAt: Date.now() + 30 * 86400000, presentation: { ...base, id: `tp${i}`, title },
    }));
    localStorage.setItem(KEY, JSON.stringify(lib));
  });
  await page.reload();
  await page.getByRole('button', { name: '파일', exact: true }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.getElementById('boot-splash')?.remove());
  const bs = await backstage(page, '정보');
  await bs.getByRole('button', { name: /휴지통/ }).first().click();
  const dlg = page.getByRole('dialog', { name: '휴지통' });
  await see(dlg);
  return dlg;
}

describe('휴지통: 모두 선택 · 모두 삭제', () => {
  it('select all, select some, delete the selected, then delete all (each asks first)', async () => {
    const app = await openApp(base);
    const { page } = app;
    const dlg = await openTrash(page);
    const rows = dlg.locator('.trash-row');
    expect(await rows.count()).toBe(3);

    // 모두 선택: every row is ticked and the count says so.
    await dlg.getByRole('checkbox', { name: '모두 선택' }).check();
    await see(dlg.getByText('모두 선택 (3/3)'));
    expect(await dlg.locator('.trash-row input[type=checkbox]:checked').count()).toBe(3);

    // Un-tick one: part of the list is selected (the box shows a dash).
    await dlg.getByRole('checkbox', { name: '둘째 자료 선택' }).uncheck();
    await see(dlg.getByText('모두 선택 (2/3)'));
    expect(await dlg.getByRole('checkbox', { name: '모두 선택' }).evaluate((e: HTMLInputElement) => e.indeterminate)).toBe(true);

    // Delete the two selected: asked first; "cancel" deletes nothing.
    page.once('dialog', (d: any) => { expect(d.message()).toContain('선택한 2개'); void d.dismiss(); });
    await dlg.getByRole('button', { name: '선택 항목 영구 삭제' }).click();
    await sleep(400);
    expect(await rows.count()).toBe(3);
    page.once('dialog', (d: any) => void d.accept());
    await dlg.getByRole('button', { name: '선택 항목 영구 삭제' }).click();
    await sleep(400);
    expect(await rows.count()).toBe(1);
    expect(await rows.first().innerText()).toContain('둘째 자료');
    await see(dlg.getByText('모두 선택 (0/1)'));

    // 모두 삭제 (휴지통 비우기): asked first, then the trash is empty and the bulk buttons go.
    page.once('dialog', (d: any) => { expect(d.message()).toContain('모두 영구 삭제'); void d.accept(); });
    await dlg.getByRole('button', { name: /모두 삭제/ }).click();
    await see(dlg.getByText('휴지통이 비어 있습니다.'));
    expect(await dlg.getByRole('toolbar').count()).toBe(0);
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });

  it('with a search, 모두 삭제 only deletes the matches', async () => {
    const app = await openApp(base);
    const { page } = app;
    const dlg = await openTrash(page);
    await dlg.getByRole('textbox', { name: '휴지통 검색' }).fill('셋째');
    await see(dlg.getByRole('button', { name: '검색된 1개 모두 삭제' }));
    page.once('dialog', (d: any) => { expect(d.message()).toContain('검색된 1개'); void d.accept(); });
    await dlg.getByRole('button', { name: '검색된 1개 모두 삭제' }).click();
    await sleep(400);
    await dlg.getByRole('textbox', { name: '휴지통 검색' }).fill('');
    await sleep(200);
    const left = await dlg.locator('.trash-row').allInnerTexts();
    expect(left.length).toBe(2);
    expect(left.join(' ')).toContain('첫째 자료');
    expect(left.join(' ')).toContain('둘째 자료');
    expect(left.join(' ')).not.toContain('셋째 자료');
    await app.close();
  });
});
