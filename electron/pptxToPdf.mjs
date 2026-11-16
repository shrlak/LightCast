// Turns a .pptx into a PDF with the program that really knows how to draw it — PowerPoint if it
// is installed (Windows, macOS), else LibreOffice — so an imported slide looks exactly like the
// original. Returns null when neither is available or the conversion fails.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const run = (cmd, args, timeout = 120000) =>
  new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true }, (err) => resolve(!err)));

const exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

async function viaPowerPoint(input, output, format = 'pdf') {
  if (process.platform === 'win32') {
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const script = `$ErrorActionPreference='Stop';$p=New-Object -ComObject PowerPoint.Application;`
      + `try{$d=$p.Presentations.Open(${q(input)},-1,0,0);$d.SaveAs(${q(output)},${format === 'pptx' ? 24 : format === 'ppt' ? 1 : 32})}finally{if($d){$d.Close()}}`;
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  }
  if (process.platform === 'darwin') {
    // PowerPoint for Mac's scripting dictionary has no reliable constant for the 97–2003 format: LibreOffice makes .ppt there.
    if (format === 'ppt' || !exists('/Applications/Microsoft PowerPoint.app/Contents/Info.plist')) return false;
    const script = [
      'on run argv',
      'tell application "Microsoft PowerPoint"',
      'open POSIX file (item 1 of argv)',
      `save active presentation in (item 2 of argv) as save as ${format === 'pptx' ? 'Open XML presentation' : 'PDF'}`,
      'close active presentation saving no',
      'end tell',
      'end run',
    ];
    return run('osascript', [...script.flatMap((l) => ['-e', l]), input, output]);
  }
  return false;
}

function sofficeCandidates() {
  const list = ['soffice', 'libreoffice'];
  if (process.platform === 'darwin') list.unshift('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (base) list.unshift(path.join(base, 'LibreOffice', 'program', 'soffice.exe'));
    }
  }
  return list;
}

async function viaLibreOffice(input, dir, format = 'pdf') {
  for (const exe of sofficeCandidates()) {
    if (path.isAbsolute(exe) && !exists(exe)) continue;
    const profile = pathToFileURL(path.join(path.dirname(dir), 'lo-profile')).href;
    if (await run(exe, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', format, '--outdir', dir, input], 180000)
      && exists(path.join(dir, `deck.${format}`))) return true;
  }
  return false;
}

/** Legacy .ppt must become OOXML, never an image/PDF, before the renderer can edit it. */
export async function pptToPptx(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecast-ppt-'));
  try {
    const input = path.join(dir, 'deck.ppt');
    const output = path.join(dir, 'out', 'deck.pptx');
    fs.mkdirSync(path.dirname(output));
    fs.writeFileSync(input, bytes);
    if (!(await viaPowerPoint(input, output, 'pptx')) || !exists(output)) {
      if (!(await viaLibreOffice(input, path.dirname(output), 'pptx'))) return null;
    }
    const result = fs.readFileSync(output);
    return result.length > 4 && result[0] === 0x50 && result[1] === 0x4b ? result : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The opposite of pptToPptx: a .pptx as legacy binary .ppt (97–2003), by PowerPoint (Windows) or LibreOffice. null when none is installed or it fails. */
export async function pptxToPpt(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecast-topt-'));
  try {
    const input = path.join(dir, 'deck.pptx');
    const output = path.join(dir, 'out', 'deck.ppt');
    fs.mkdirSync(path.dirname(output));
    fs.writeFileSync(input, bytes);
    if (!(await viaPowerPoint(input, output, 'ppt')) || !exists(output)) {
      if (!(await viaLibreOffice(input, path.dirname(output), 'ppt')) || !exists(output)) return null;
    }
    const result = fs.readFileSync(output);
    // A real .ppt is an OLE compound file.
    return result.length > 8 && result[0] === 0xd0 && result[1] === 0xcf && result[2] === 0x11 && result[3] === 0xe0 ? result : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {Uint8Array} bytes the .pptx @returns {Promise<Buffer | null>} the PDF */
export async function pptxToPdf(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecast-pptx-'));
  try {
    const input = path.join(dir, 'deck.pptx');
    const output = path.join(dir, 'out', 'deck.pdf');
    fs.mkdirSync(path.dirname(output));
    fs.writeFileSync(input, bytes);
    if (!(await viaPowerPoint(input, output)) || !exists(output)) {
      if (!(await viaLibreOffice(input, path.dirname(output))) || !exists(output)) return null;
    }
    return fs.readFileSync(output);
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
