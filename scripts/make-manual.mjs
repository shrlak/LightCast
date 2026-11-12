// Builds docs/LightCast-Manual.pdf from docs/manual/manual.html.
// Needs Chromium through Playwright (`npx playwright install chromium` once if it is missing).
// Usage: node scripts/make-manual.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'docs', 'manual', 'manual.html');
const target = path.join(root, 'docs', 'LightCast-Manual.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: target, format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`Wrote ${path.relative(root, target)}`);
