import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, ribbon, shutdown, sleep } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

// DeckCraft 44c80663 / c74671d7 / d532ff66: the slide keeps the keyboard after toolbar presses, and Tab
// leaves it past the last object.
describe('the slide canvas keeps the keyboard', () => {
  it('after a ribbon press, and lets Tab go past the last object', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page);
    const inCanvas = () => page.evaluate(() => !!document.activeElement?.closest('.ce-root'));
    await page.locator('.ce-root').click({ position: { x: 5, y: 5 } });
    expect(await inCanvas()).toBe(true);
    await ribbon(page, '삽입');
    await sleep(100);
    expect(await inCanvas()).toBe(true);
    // One object on the slide: the first Tab selects it, the next leaves the canvas.
    await page.keyboard.press('Tab');
    expect(await inCanvas()).toBe(true);
    await page.keyboard.press('Tab');
    expect(await inCanvas()).toBe(false);
    await close();
  });
});
