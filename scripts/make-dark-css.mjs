#!/usr/bin/env node
// 보기 › 어두운 모드 (DeckCraft's View › Dark Mode): writes src/ui/ppt/dark.css from the editor's own rules in
// src/styles.css, so the dark look follows every change to the light one. Light surfaces become dark, dark
// text becomes light and light borders darker; the slides themselves (canvas, layers, output) are left alone.
//   node scripts/make-dark-css.mjs          write the file
//   node scripts/make-dark-css.mjs --check  exit 1 when the file is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { darkCss } from './darkCss.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(`${root}src/styles.css`, 'utf8') + '\n' + readFileSync(`${root}src/ui/ppt/backgroundRemoval.css`, 'utf8');
const out = darkCss(src);
const file = `${root}src/ui/ppt/dark.css`;
if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(file, 'utf8'); } catch { /* missing */ }
  if (cur !== out) { console.error('src/ui/ppt/dark.css is out of date: run node scripts/make-dark-css.mjs'); process.exit(1); }
} else {
  writeFileSync(file, out);
  console.log(`wrote ${file} (${out.split('\n').length} lines)`);
}
