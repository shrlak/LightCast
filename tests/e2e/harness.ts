// Shared plumbing for the browser checks: serve dist/, launch Chromium with fake devices, open the app.
// Playwright is provided by the machine (not a dependency of the project), so it is loaded with require
// and typed loosely.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFailed } from 'vitest';
// @ts-expect-error plain ESM server module
import { startServer } from '../../server/app.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Page = any;
export type Ctx = any;

const req = createRequire(import.meta.url);
const { chromium } = req('playwright');

let srv: { port: number; close: () => Promise<void> } | undefined;
let browser: any;

export async function boot() {
  const root = fileURLToPath(new URL('../../dist', import.meta.url));
  srv = await startServer({ root, port: 0 });
  const executablePath = process.env.E2E_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? undefined : undefined);
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-select-tab-capture-source-by-title=LightCast',
      '--enable-usermedia-screen-capturing',
      '--trace=off',
    ],
  });
  return `http://127.0.0.1:${srv!.port}`;
}

export async function shutdown() {
  await browser?.close();
  await srv?.close();
}

export interface App {
  page: Page;
  ctx: Ctx;
  errors: string[];
  close: () => Promise<void>;
}

/** A fresh browser profile with the editor open. Console errors and page errors are collected in `errors`. */
export async function openApp(base: string, opts: { init?: string } = {}): Promise<App> {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    acceptDownloads: true,
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
  });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
  // A failing check leaves a screenshot of the page (E2E_SHOTS, default the system temp folder).
  onTestFailed(async () => {
    const dir = process.env.E2E_SHOTS || join(tmpdir(), 'lightcast-e2e');
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `fail-${Date.now()}.png`) }).catch(() => undefined);
    process.stderr.write(`\n[e2e] screenshot of the failing page: ${dir}\n`);
  });
  await page.goto(base + '/');
  // The animated start screen removes itself when it ends or is clicked.
  await page.getByRole('button', { name: '파일', exact: true }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.getElementById('boot-splash')?.remove());
  return { page, ctx, errors, close: () => ctx.close() };
}

/** 파일 › the given backstage page. */
export async function backstage(page: Page, to: '홈' | '열기' | '정보' | '저장' | '인쇄' | '내보내기') {
  const bs = page.getByRole('dialog', { name: '파일', exact: true });
  if (!(await bs.isVisible().catch(() => false))) await page.getByRole('button', { name: '파일', exact: true }).click();
  await bs.waitFor();
  await bs.getByRole('button', { name: to, exact: true }).click();
  return bs;
}

/** 파일 › 열기 › the first card, choosing the given file in the file chooser. */
export async function openFile(page: Page, cardName: RegExp | string, file: { name: string; mimeType?: string; buffer: Buffer }) {
  const bs = await backstage(page, '열기');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), bs.getByRole('button', { name: cardName }).first().click()]);
  await chooser.setFiles({ name: file.name, mimeType: file.mimeType ?? 'application/octet-stream', buffer: file.buffer });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the locator is visible (Playwright's `expect` is not available under vitest). */
export async function see(loc: any, timeout = 20_000) {
  await loc.first().waitFor({ state: 'visible', timeout });
}

export async function textOf(loc: any, timeout = 20_000): Promise<string> {
  await loc.first().waitFor({ state: 'visible', timeout });
  return (await loc.first().innerText()) as string;
}

/** Ribbon tab by name. */
export async function ribbon(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click();
}

/** Opens a small imported deck (so there is something editable on the canvas) and waits until its slide shows. */
export async function openDeck(page: Page, text = '편집용 슬라이드') {
  const { makePptx } = await import('./fixtures');
  await openFile(page, /PowerPoint · OpenDocument/, { name: 'deck.pptx', buffer: await makePptx(text) });
  await see(page.locator('.ppt-canvas').getByText(text));
}
