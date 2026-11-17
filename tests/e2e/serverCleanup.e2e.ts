import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, see, shutdown, sleep } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

/** A church server in memory: it lists some media files, records which were deleted, and knows no library of its own. */
function fakeServer(initial: { id: string; size: number }[]) {
  const files = new Map(initial.map((f) => [f.id, f.size]));
  const deleted: string[] = [];
  const handler = async (route: any) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\/cloud\//, '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === 'media' && req.method() === 'GET') return json(200, { items: [...files].map(([id, size]) => ({ id, size, type: 'image' })) });
    if (path.startsWith('media/') && req.method() === 'DELETE') {
      const id = decodeURIComponent(path.slice('media/'.length));
      deleted.push(id);
      files.delete(id);
      return json(200, { ok: true });
    }
    if (path.startsWith('library') && req.method() === 'GET') return route.fulfill({ status: 204 });
    if (path === 'library' && req.method() === 'PUT') return json(200, { version: 2 });
    if (path === 'storage') return json(404, { error: 'not found' });
    return json(200, {});
  };
  return { handler, deleted, files };
}

describe('서버 용량 정리 (account window)', () => {
  it('the top 계정 button opens the account window, and 불필요한 것 모두 정리 deletes the server files nothing lists', async () => {
    const server = fakeServer([{ id: 'orphan-a', size: 700_000 }, { id: 'orphan-b', size: 300_000 }]);
    const app = await openApp(base, {
      init: `try { if (!localStorage.getItem('freecast.cloud')) localStorage.setItem('freecast.cloud', JSON.stringify({ token: 'test-token', username: 'tester', version: 1 })); } catch {}`,
    });
    await app.ctx.route('**/api/cloud/**', server.handler);
    const { page } = app;
    const dialogs: string[] = [];
    page.on('dialog', async (d: any) => { dialogs.push(d.message()); await d.accept(); });
    await page.reload();
    await page.getByRole('button', { name: '파일', exact: true }).waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.getElementById('boot-splash')?.remove());

    // The top button goes straight to the account window (not the sync status window).
    await page.getByRole('button', { name: /☁ tester/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Account' });
    await see(dlg);
    await see(dlg.getByText('라이브러리 데이터 용량'));
    await see(dlg.getByText(/전체 2개/)); // the server list is shown in full, with its total

    await dlg.getByRole('button', { name: '불필요한 것 모두 정리' }).click();
    await expect.poll(() => server.deleted.slice().sort(), { timeout: 15_000, message: '서버에서 쓰지 않는 파일 2개가 지워져야 합니다' }).toEqual(['orphan-a', 'orphan-b']);
    expect(dialogs.some((m) => m.includes('서버 파일 2개'))).toBe(true);
    await sleep(300);
    expect(app.errors.filter((e) => !/Failed to load resource|favicon/.test(e))).toEqual([]);
    await app.close();
  });
});
