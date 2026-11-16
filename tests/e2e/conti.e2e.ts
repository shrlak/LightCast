import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backstage, boot, openApp, see, shutdown, sleep } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

const CONTI = readFileSync(new URL('../fixtures/real/conti/conti-3-songs.pdf', import.meta.url));

describe('주일예배 마법사: 콘티 읽기', () => {
  it('goes on in the background: the progress shows on every tab, and a second upload is refused', async () => {
    const app = await openApp(base);
    const { page } = app;
    // The models answer slowly, so the reading is certainly still going while the tabs are changed.
    await page.route('**/api/recognition/gemini/**', async (route: any) => { await sleep(2500); await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test"}' }); });
    const bs = await backstage(page, '홈');
    await bs.getByRole('button', { name: /주일예배 마법사/ }).first().click();
    await see(page.locator('.wizard-body'));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /콘티 PDF 올리기/ }).click()]);
    await chooser.setFiles({ name: '1122 콘티.pdf', mimeType: 'application/pdf', buffer: CONTI });

    const reading = page.locator('.wizard-body .card.busy', { hasText: '콘티 읽는 중' });
    const tab = (n: string) => page.getByRole('button', { name: new RegExp(`^${n}\\.`) });
    await see(reading);
    expect(await tab('1').innerText()).toContain('⏳');

    // Another tab: the reading is still shown (and the first tab still says it is reading).
    await tab('2').click();
    await see(reading);
    expect(await reading.first().innerText()).toContain('다른 탭으로 옮겨도 계속 읽습니다');
    expect(await tab('1').innerText()).toContain('⏳');
    await sleep(1500);
    await tab('3').click();
    await see(reading);

    // Back on 찬양: it is the same reading (not a new one), the upload button waits, and the file name is shown.
    await tab('1').click();
    await see(page.getByRole('button', { name: '콘티 읽는 중…' }));
    expect(await page.getByRole('button', { name: '콘티 읽는 중…' }).isDisabled()).toBe(true);
    await see(page.getByText('1122 콘티.pdf'));
    expect(await reading.count()).toBe(1);
    expect(app.errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
    await app.close();
  });
});
