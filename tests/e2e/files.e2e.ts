import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backstage, boot, openApp, openFile, see, shutdown, textOf } from './harness';
import { makeLcast, makeOdp, makePpt, makePptx } from './fixtures';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

describe('start and open', () => {
  it('app loads without console errors', async () => {
    const app = await openApp(base);
    await app.page.waitForTimeout(1500);
    await app.page.getByRole('tab', { name: '삽입', exact: true }).click();
    expect(app.errors).toEqual([]);
    await app.close();
  });

  it('opens a .pptx through 파일 › 열기', async () => {
    const app = await openApp(base);
    await openFile(app.page, /PowerPoint · OpenDocument/, { name: 'hello.pptx', buffer: await makePptx('PPTX 안녕하세요') });
    await see(app.page.getByText('PPTX 안녕하세요'));
    await see(app.page.getByText('두 번째 슬라이드'));
    await app.close();
  });

  it('opens a legacy .ppt through 파일 › 열기', async () => {
    const app = await openApp(base);
    await openFile(app.page, /PowerPoint · OpenDocument/, { name: 'old.ppt', buffer: makePpt() });
    await see(app.page.getByText('레거시 PPT 제목'));
    await see(app.page.getByText('Second legacy slide'));
    await app.close();
  });

  it('opens an .odp through 파일 › 열기', async () => {
    const app = await openApp(base);
    await openFile(app.page, /PowerPoint · OpenDocument/, { name: 'doc.odp', buffer: await makeOdp('ODP 문서 본문') });
    await see(app.page.getByText('ODP 문서 본문'));
    await app.close();
  });

  it('.lcast: wrong password shows the Korean error, the right one opens', async () => {
    const app = await openApp(base);
    const file = { name: 'secret.lcast', buffer: await makeLcast('열쇠1234', '비밀 본문입니다') };
    await openFile(app.page, /LightCast 파일 \(\.lcast\)/, file);
    const dlg = app.page.getByRole('dialog', { name: '암호', exact: true });
    await dlg.waitFor();
    await dlg.getByLabel('암호:').fill('틀린암호');
    await dlg.getByRole('button', { name: '확인' }).click();
    expect(await textOf(dlg.getByRole('alert'))).toContain('암호가 올바르지 않');
    await dlg.getByLabel('암호:').fill('열쇠1234');
    await dlg.getByRole('button', { name: '확인' }).click();
    await see(app.page.getByText('비밀 본문입니다'));
    await app.close();
  });

  it('.lcast save with a password downloads an encrypted file', async () => {
    const app = await openApp(base);
    const bs = await backstage(app.page, '저장');
    await bs.getByRole('button', { name: /암호로 보호하여 저장/ }).click();
    const dlg = app.page.getByRole('dialog', { name: '문서 암호화' });
    await dlg.getByLabel('암호(P):').fill('열쇠1234');
    await dlg.getByLabel('암호 확인(C):').fill('열쇠1234');
    const [dl] = await Promise.all([app.page.waitForEvent('download'), dlg.getByRole('button', { name: '확인' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.lcast$/);
    const bytes = await (await import('node:fs/promises')).readFile(await dl.path());
    expect(bytes.subarray(0, 5).toString()).toBe('LCENC');
    await app.close();
  });

  it('Compare accepts a .ppt', async () => {
    const app = await openApp(base);
    await app.page.getByRole('tab', { name: '검토', exact: true }).click();
    await app.page.getByRole('button', { name: /비교/ }).first().click();
    const dlg = app.page.getByRole('dialog', { name: /비교/ });
    await dlg.waitFor();
    const [chooser] = await Promise.all([app.page.waitForEvent('filechooser'), dlg.getByRole('button', { name: /파일|열기|찾아/ }).first().click()]);
    await chooser.setFiles({ name: 'old.ppt', mimeType: 'application/vnd.ms-powerpoint', buffer: makePpt() });
    // The dialog closes and the 수정 내용 pane lists what differs in the .ppt.
    await see(app.page.getByText('수정 내용 — old.ppt'));
    await see(app.page.getByRole('button', { name: /모두 적용 \(\d+\)/ }));
    await app.close();
  });
});
