import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, openApp, openDeck, ribbon, see, shutdown } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

/** A SpeechRecognition that "hears" a sentence a moment after start(). */
const FAKE_SPEECH = `
  class FakeRecognition {
    constructor() { this.lang = 'ko-KR'; this.continuous = false; this.interimResults = false; }
    start() {
      setTimeout(() => {
        const r = [{ 0: { transcript: '안녕하세요 자막 시험입니다' }, isFinal: true, length: 1 }];
        this.onresult && this.onresult({ resultIndex: 0, results: r });
      }, 300);
    }
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
`;
const NO_SPEECH = 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition;';

/** Starts the slide show; resolves with the audience window the show opened. */
async function startShow(page: any) {
  const [audience] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /▶ 슬라이드 쇼/ }).click()]);
  await audience.waitForLoadState();
  await see(page.getByRole('button', { name: /쇼 마침/ }));
  return audience;
}

describe('slide show', () => {
  it('slide show starts: presenter view and an audience window with the slide', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page, '쇼 시작 시험');
    const audience = await startShow(page);
    await see(audience.getByText('쇼 시작 시험'));
    await see(page.getByText('다음 슬라이드', { exact: true }).first());
    await page.keyboard.press('ArrowRight');
    await see(audience.getByText('두 번째 슬라이드'));
    await page.getByRole('button', { name: /쇼 마침/ }).click();
    await see(page.getByRole('tab', { name: '홈', exact: true }));
    await app.close();
  });

  it('laser pointer: Ctrl + moving over the slide shows the dot on the audience window', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page);
    const audience = await startShow(page);
    const area = page.locator('.laser-area').first();
    await see(area);
    const box = await area.boundingBox();
    await page.keyboard.down('Control');
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + (box.width * i) / 8, box.y + box.height / 2);
    await see(audience.locator('.laser-dot'));
    await page.keyboard.up('Control');
    await app.close();
  });

  it('live captions: without speech recognition a notice explains why', async () => {
    const app = await openApp(base, { init: NO_SPEECH });
    const { page } = app;
    await openDeck(page);
    await startShow(page);
    await page.getByRole('button', { name: /자막 켜기/ }).click();
    // Without browser speech recognition and without a cloud speech key the app says why captions cannot start.
    await see(page.getByText(/이 브라우저는 음성 인식을 지원하지 않고, 클라우드 음성 인식도 설정되어 있지 않습니다/));
    await app.close();
  });

  it('live captions: with a stubbed SpeechRecognition the band shows on the audience window', async () => {
    const app = await openApp(base, { init: FAKE_SPEECH });
    const { page } = app;
    await openDeck(page);
    const audience = await startShow(page);
    await page.getByRole('button', { name: /자막 켜기/ }).click();
    await see(audience.locator('.caption-band'), 15_000);
    expect(await audience.locator('.caption-band').first().innerText()).toContain('자막 시험');
    await page.getByRole('button', { name: /자막 끄기/ }).click();
    await app.close();
  });

  it('쇼 설정: the monitor picker renders', async () => {
    const app = await openApp(base);
    const { page } = app;
    await openDeck(page);
    await ribbon(page, '슬라이드 쇼');
    await page.getByRole('button', { name: /쇼 설정/ }).click();
    const dlg = page.getByRole('dialog', { name: '쇼 설정' });
    await see(dlg);
    // A browser that can list monitors offers the two pickers (or asks permission first); others say they cannot.
    const picker = dlg.getByText(/청중 화면 \(슬라이드 쇼\)|모니터 목록 허용|모니터 목록을 읽을 수 없습니다/);
    await see(picker);
    expect(await picker.count()).toBeGreaterThan(0);
    await app.close();
  });
});
