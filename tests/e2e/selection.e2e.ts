import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, shutdown, sleep, type Page } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

/** What the editing canvas shows: the selected outlines, how many resize handles, a rotation handle, a caret. */
async function state(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('.ppt-canvas .ce-root')!;
    return {
      selected: root.querySelectorAll('.ce-outline.on').length,
      editing: root.querySelectorAll('.ce-outline.editing').length,
      handles: root.querySelectorAll('.ce-h:not(.ce-line-end)').length,
      rotate: root.querySelectorAll('.ce-rot').length,
      caret: !!document.activeElement?.closest('.ppt-canvas [contenteditable="true"]'),
    };
  });
}

describe('selection on the editing canvas', () => {
  it('a click on the empty slide after typing leaves that box selected; a second click deselects', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '선택 테스트 상자');
    const canvas = page.locator('.ppt-canvas .ce-root');
    const box = await canvas.boundingBox();
    // Into the text box: typing (caret), its frame shown, no handles.
    await page.locator('.ppt-canvas').getByText('선택 테스트 상자').click();
    await sleep(300);
    const typing = await state(page);
    expect(typing).toMatchObject({ editing: 1, handles: 0, caret: true });
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/sel-1-typing.png` });
    // On the empty slide (bottom of the slide, away from the box): typing ends, the box stays selected with its handles.
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
    await sleep(300);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/sel-2-after-click.png` });
    expect(await state(page)).toEqual({ selected: 1, editing: 0, handles: 8, rotate: 1, caret: false });
    // The keyboard works on that selection: an arrow moves the box, Ctrl+Z puts it back.
    const top = () => page.evaluate(() => (document.querySelector('.ppt-canvas .ce-outline.on') as HTMLElement | null)?.style.top ?? '');
    const before = await top();
    await page.keyboard.press('ArrowDown');
    await sleep(200);
    expect(await top()).not.toBe(before);
    await page.keyboard.press('Control+z');
    await sleep(300);
    expect(await top()).toBe(before);
    expect((await state(page)).handles).toBe(8);
    // Again on the empty slide: nothing selected.
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
    await sleep(300);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/sel-3-second-click.png` });
    expect(await state(page)).toEqual({ selected: 0, editing: 0, handles: 0, rotate: 0, caret: false });
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });

  it('with nothing being typed, a drag on the empty slide still selects by marquee', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '마키 선택 상자');
    const box = await page.locator('.ppt-canvas .ce-root').boundingBox();
    await page.locator('.ppt-canvas').getByText('마키 선택 상자').click();
    await sleep(200);
    // Esc ends typing with the box selected, as the click on the empty slide does; Esc again deselects.
    await page.keyboard.press('Escape');
    await sleep(200);
    expect(await state(page)).toMatchObject({ selected: 1, editing: 0, handles: 8 });
    await page.keyboard.press('Escape');
    await sleep(200);
    expect((await state(page)).selected).toBe(0);
    // A drag from the corner around the box selects it.
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height * 0.75, { steps: 8 });
    await page.mouse.up();
    await sleep(200);
    expect(await state(page)).toMatchObject({ selected: 1, editing: 0, handles: 8 });
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });
});
