import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backstage, boot, openApp, openDeck, see, shutdown } from './harness';

let base = '';
beforeAll(async () => { base = await boot(); });
afterAll(async () => { await shutdown(); });

async function download(page: any, click: () => Promise<void>, timeout = 60_000) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), click()]);
  return { name: dl.suggestedFilename() as string, bytes: await readFile(await dl.path()) };
}

describe('export', () => {
  it('embedded fonts checkbox is on the 저장 page and keeps its state', async () => {
    const { page, close } = await openApp(base);
    const bs = await backstage(page, '저장');
    const box = bs.getByRole('checkbox', { name: /PPTX에 글꼴 포함/ });
    await see(box);
    const was = await box.isChecked();
    await box.setChecked(!was);
    expect(await box.isChecked()).toBe(!was);
    // The choice is remembered when the page is opened again.
    await bs.getByRole('button', { name: '열기', exact: true }).click();
    await bs.getByRole('button', { name: '저장', exact: true }).click();
    expect(await bs.getByRole('checkbox', { name: /PPTX에 글꼴 포함/ }).isChecked()).toBe(!was);
    await close();
  });

  it('GIF export produces a file starting with GIF89a', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page);
    const bs = await backstage(page, '내보내기');
    const f = await download(page, () => bs.getByRole('button', { name: '애니메이션 GIF 저장' }).click());
    expect(f.name).toMatch(/\.gif$/);
    expect(f.bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(f.bytes.length).toBeGreaterThan(100);
    await close();
  });

  it('outline export: .rtf and .txt carry the slide text', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page, '개요에 들어갈 문장');
    const bs = await backstage(page, '내보내기');
    const rtf = await download(page, () => bs.getByRole('button', { name: /\(\.rtf\)/ }).click());
    expect(rtf.name).toMatch(/\.rtf$/);
    expect(rtf.bytes.subarray(0, 5).toString('latin1')).toBe('{\\rtf');
    // RTF writes non-ASCII text as signed 16-bit \uN escapes: 개 = U+AC1C = 44060 = -21476.
    expect(rtf.bytes.toString('latin1')).toContain('\\u-21476');
    const txt = await download(page, () => bs.getByRole('button', { name: /\(\.txt\)/ }).click());
    expect(txt.name).toMatch(/\.txt$/);
    expect(txt.bytes.toString('utf8')).toContain('개요에 들어갈 문장');
    await close();
  });

  it('video export: the panel opens and records a short video', async () => {
    const { page, close } = await openApp(base);
    await openDeck(page);
    const bs = await backstage(page, '내보내기');
    await see(bs.getByRole('heading', { name: '동영상 만들기' }));
    const secs = bs.getByLabel('타이밍이 없는 슬라이드의 시간(초)');
    await secs.fill('0.5');
    const fast = bs.getByRole('checkbox', { name: /빠르게 만들기/ });
    // The fast path (WebCodecs) when this browser has it, and the real-time recorder (MediaRecorder).
    const modes = (await fast.isEnabled()) ? [true, false] : [false];
    for (const useFast of modes) {
      if (await fast.isEnabled()) await fast.setChecked(useFast);
      const f = await download(page, () => bs.getByRole('button', { name: '동영상 만들기' }).click(), 90_000);
      expect(f.name).toMatch(/\.(mp4|webm)$/);
      expect(f.bytes.length).toBeGreaterThan(500);
      if (f.name.endsWith('.webm')) expect(f.bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
      else expect(f.bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
      await see(bs.getByText(/동영상을 저장했습니다/));
    }
    await close();
  });
});
