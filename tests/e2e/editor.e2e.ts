import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, ribbon, see, shutdown } from './harness';
import { makePng } from './fixtures';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

describe('editor features', () => {
  it('picture bullet inserts from the 글머리 기호 drop-down', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page, '그림 글머리 본문');
    await page.locator('.ppt-canvas').getByText('그림 글머리 본문').click();
    await ribbon(page, '홈');
    await page.getByRole('button', { name: '글머리 기호 옵션' }).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /그림 글머리 기호…/ }).click()]);
    await chooser.setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: makePng(24, 24, () => [200, 30, 30, 255]) });
    await see(page.locator('.ppt-slides .list-picture'));
    await close();
  });

  it('background removal: dialog opens, marks areas and applies', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page);
    await ribbon(page, '삽입');
    // A white picture with a red square in the middle.
    const png = makePng(80, 60, (x, y) => (x > 25 && x < 55 && y > 15 && y < 45 ? [200, 30, 30, 255] : [255, 255, 255, 255]));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '그림', exact: true }).first().click()]);
    await chooser.setFiles({ name: 'square.png', mimeType: 'image/png', buffer: png });
    await see(page.locator('.ppt-canvas img'));
    await page.getByRole('tab', { name: '그림 서식', exact: true }).click();
    await page.getByTitle('배경 제거 옵션').click();
    await page.getByRole('button', { name: /유지\/제거할 영역 표시/ }).click();
    const dlg = page.getByRole('dialog', { name: '배경 제거' });
    const canvas = dlg.getByLabel('배경 제거 미리 보기');
    await see(canvas);
    const box = await canvas.boundingBox();
    await dlg.getByRole('button', { name: /제거할 영역 표시/ }).click();
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + 8, { steps: 6 });
    await page.mouse.up();
    await see(dlg.getByRole('button', { name: '실행 취소' }));
    await dlg.getByRole('button', { name: '변경 내용 유지' }).click();
    await dlg.waitFor({ state: 'detached', timeout: 15_000 });
    // The marked cut-out is kept: its undo entry in the drop-down is now available.
    await page.getByTitle('배경 제거 옵션').click();
    expect(await page.getByRole('button', { name: '표시한 배경 제거 취소' }).isEnabled()).toBe(true);
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });

  it('ink to shape: a hand-drawn rectangle becomes a shape (and stays ink when the switch is off)', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page);
    await ribbon(page, '그리기');
    const clear = page.getByRole('button', { name: '모든 잉크 지우기' });
    const box = await page.locator('.ppt-canvas').boundingBox();
    const rectangle = async (dy: number) => {
      const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * dy, x1 = box.x + box.width * 0.7, y1 = y0 + box.height * 0.2;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]]) await page.mouse.move(x, y, { steps: 8 });
      await page.mouse.up();
    };
    await page.getByRole('button', { name: '잉크를 셰이프로' }).click();
    await page.getByRole('button', { name: '펜', exact: true }).first().click();
    await rectangle(0.55);
    await page.waitForTimeout(500);
    expect(await clear.isDisabled()).toBe(true); // converted: no ink left
    await page.getByRole('button', { name: '잉크를 셰이프로' }).click(); // off
    await rectangle(0.2);
    await page.waitForTimeout(500);
    expect(await clear.isDisabled()).toBe(false); // plain ink stays ink
    await close();
  });

  it('version history: save a version, edit, restore the slide', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page, '원래 문장');
    await ribbon(page, '검토');
    await page.getByRole('button', { name: /버전 기록/ }).click();
    const dlg = page.getByRole('dialog', { name: /버전 기록/ });
    await dlg.getByRole('button', { name: '지금 버전 저장' }).click();
    await see(dlg.locator('.vh-list li button'));
    await dlg.getByRole('button', { name: '닫기', exact: true }).last().click();
    // Change the slide text.
    await page.locator('.ppt-canvas').getByText('원래 문장').dblclick();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('바뀐 문장');
    await page.keyboard.press('Escape');
    await see(page.locator('.ppt-canvas').getByText('바뀐 문장'));
    await ribbon(page, '검토');
    await page.getByRole('button', { name: /버전 기록/ }).click();
    const dlg2 = page.getByRole('dialog', { name: /버전 기록/ });
    await dlg2.locator('.vh-list li button').first().click();
    await dlg2.getByRole('button', { name: '이 슬라이드 복원' }).first().click();
    await dlg2.getByRole('button', { name: '닫기', exact: true }).last().click();
    await see(page.locator('.ppt-canvas').getByText('원래 문장'));
    expect(await page.locator('.ppt-canvas').getByText('바뀐 문장').count()).toBe(0);
    await close();
  });
});
