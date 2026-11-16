import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import { boot, openApp, openFile, see, shutdown, sleep, type Page } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

const LONG = '1. <청년부 여름 수련회 등록 안내와 회비 납부 방법 및 마감 일정>';
const SHORT = '2. <새가족 환영>';

/** Two 광고 slides laid out like the church template: heading in the corner, "n. <제목>" (28 pt bold), the text (25 pt). */
async function announcementDeck(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_4x3';
  for (const [title, body] of [[LONG, '등록은 다음 주일까지 받습니다'], [SHORT, '오늘 처음 오신 분들을 환영합니다']]) {
    const s = pptx.addSlide();
    s.addText([{ text: '광고', options: { breakLine: true } }, { text: 'Announcements' }], { x: 0.43, y: 0.46, w: 9.13, h: 1.03, fontSize: 20, bold: true, valign: 'top', fontFace: 'Arial' });
    s.addText(title, { x: 0.39, y: 1.59, w: 9.13, h: 0.62, fontSize: 28, bold: true, valign: 'top', fontFace: 'Arial' });
    s.addText(body, { x: 0.43, y: 2.3, w: 9.13, h: 4.08, fontSize: 25, valign: 'top', fontFace: 'Arial' });
  }
  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
}

/** The title box and the text box of the slide on the editing canvas: their boxes (canvas px) and the title's drawn lines. */
async function layout(page: Page, title: string, body: string) {
  return page.evaluate(([title, body]: string[]) => {
    const canvas = document.querySelector('.ppt-canvas')!;
    const box = (text: string) => [...canvas.querySelectorAll<HTMLElement>('[data-text-element]')].find((e) => e.textContent?.trim() === text)!;
    const t = box(title), b = box(body);
    const r = (e: HTMLElement) => ({ top: parseFloat(e.style.top), height: parseFloat(e.style.height), font: parseFloat(getComputedStyle(e.querySelector('[data-para]') ?? e).fontSize) });
    const range = document.createRange(); range.selectNodeContents(t);
    // Line boxes: Latin and Hangul glyph boxes on one line start at slightly different heights.
    const tops = [...range.getClientRects()].filter((q) => q.width > 1).map((q) => q.top).sort((a, b) => a - b);
    const lines = tops.filter((top, i) => i === 0 || top - tops[i - 1] > 12).length;
    const tr = t.getBoundingClientRect(), textRect = range.getBoundingClientRect();
    return { title: r(t), body: r(b), lines, clipped: textRect.bottom > tr.bottom + 1 };
  }, [title, body]);
}

describe('광고 slides', () => {
  it('a long title wraps onto two lines and the text box moves down under it; a short one stays on one line', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openFile(page, /PowerPoint · OpenDocument/, { name: 'ads.pptx', buffer: await announcementDeck() });
    await see(page.locator('.ppt-canvas').getByText(LONG));
    await sleep(500);
    const long = await layout(page, LONG, '등록은 다음 주일까지 받습니다');
    if (process.env.E2E_SHOTS) await page.locator('.ppt-canvas').screenshot({ path: `${process.env.E2E_SHOTS}/ad-long.png` });
    expect(long.lines).toBe(2);
    expect(long.clipped).toBe(false);
    expect(long.title.font).toBe(56);
    // The text starts below the two-line title.
    expect(long.body.top).toBeGreaterThanOrEqual(long.title.top + long.title.height);
    // The second slide: one line, the template's spacing.
    await page.getByLabel(/^슬라이드 2 · /).first().click();
    await see(page.locator('.ppt-canvas').getByText(SHORT));
    await sleep(300);
    const short = await layout(page, SHORT, '오늘 처음 오신 분들을 환영합니다');
    if (process.env.E2E_SHOTS) await page.locator('.ppt-canvas').screenshot({ path: `${process.env.E2E_SHOTS}/ad-short.png` });
    expect(short.lines).toBe(1);
    expect(short.title.height).toBeLessThan(long.title.height);
    expect(long.body.top - short.body.top).toBe(long.title.height - short.title.height);
    // Both text boxes end at the same place.
    expect(long.body.top + long.body.height).toBe(short.body.top + short.body.height);
    // Typed longer in the editor, the title wraps and pushes the text down, as on the first slide.
    await page.locator('.ppt-canvas').getByText(SHORT).click();
    await sleep(200);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' 예배 후 본당 앞에서 새가족팀장을 만나 주세요');
    await sleep(400);
    const box = await page.locator('.ppt-canvas .ce-root').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
    await sleep(500);
    const typed = await layout(page, '2. <새가족 환영 예배 후 본당 앞에서 새가족팀장을 만나 주세요>', '오늘 처음 오신 분들을 환영합니다');
    if (process.env.E2E_SHOTS) await page.locator('.ppt-canvas').screenshot({ path: `${process.env.E2E_SHOTS}/ad-typed.png` });
    expect(typed.lines).toBe(2);
    expect(typed.clipped).toBe(false);
    expect(typed.body.top).toBeGreaterThanOrEqual(typed.title.top + typed.title.height);
    expect(typed.body.top + typed.body.height).toBe(short.body.top + short.body.height);
    expect(app.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await app.close();
  });
});
