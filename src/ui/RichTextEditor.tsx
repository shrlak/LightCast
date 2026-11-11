// Typing on the slide, as in PowerPoint: the text box becomes editable where it is, and any part of
// its text can be selected and given its own size, bold, italic, underline or colour. The words and
// their formatting are kept as runs (domain/richText); the box's own formatting applies to the rest.
//
// While a box is being typed in, the ribbon's and Format pane's font buttons act on the selected
// characters through `activeTextEditor` (the selection is remembered when focus moves to a ribbon
// control, such as the font size box).
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent as RKeyboardEvent } from 'react';
import type { TextRun } from '../domain/types';
import { normalizeRuns, type RunFormat } from '../domain/richText';
import { stepFontSize } from '../domain/textFormat';
import { runStyle } from './runStyle';

export interface RichTextApi {
  /** Is part of the text selected (formatting then applies to it rather than the whole box)? */
  hasSelection(): boolean;
  /** Formatting at the start of the selection. */
  current(): RunFormat;
  /** Give the selected characters this formatting. */
  apply(patch: RunFormat): void;
  /** Make the selected characters bigger / smaller. */
  step(dir: 1 | -1): void;
}

let active: RichTextApi | null = null;
let spell = false;
try { spell = localStorage.getItem('fc.spellCheck') === '1'; } catch { /* storage unavailable */ }
/** Review › Spelling: underline misspelled words while typing (the browser's own checker). */
export const spellCheckOn = () => spell;
export function setSpellCheck(on: boolean) {
  spell = on;
  try { localStorage.setItem('fc.spellCheck', on ? '1' : '0'); } catch { /* storage unavailable */ }
  document.querySelectorAll<HTMLElement>('.ce-rich').forEach((el) => { el.spellcheck = on; });
}
const listeners = new Set<() => void>();
/** The text box being typed in, if any. */
export const activeTextEditor = () => active;
export function onTextSelection(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

/** Runs → the editor's DOM (one block per line, one span per run, sizes in canvas pixels). */
function render(root: HTMLElement, lines: TextRun[][]) {
  root.textContent = '';
  for (const line of lines) {
    const block = document.createElement('div');
    for (const r of line) {
      if (!r.text) continue;
      const span = document.createElement('span');
      const { text: _t, ...fmt } = r;
      if (Object.keys(fmt).length) span.dataset.run = JSON.stringify(fmt);
      const css = runStyle(r);
      for (const [k, v] of Object.entries(css)) if (v !== undefined) (span.style as unknown as Record<string, string>)[k] = typeof v === 'number' && k === 'fontSize' ? `${v}px` : String(v);
      span.textContent = r.text;
      block.append(span);
    }
    if (!block.childNodes.length) block.append(document.createElement('br'));
    root.append(block);
  }
}

const BLOCK = new Set(['DIV', 'P', 'LI']);

/** The editor's DOM → lines of runs (whatever structure the browser made while typing). */
export function readLines(root: HTMLElement): TextRun[][] {
  const lines: TextRun[][] = [[]];
  const fmtOf = (node: Node): RunFormat => {
    const chain: RunFormat[] = [];
    for (let n: Node | null = node.parentNode; n && n !== root; n = n.parentNode) {
      const d = (n as HTMLElement).dataset?.run;
      if (d) try { chain.unshift(JSON.parse(d) as RunFormat); } catch { /* ignore */ }
      const tag = (n as HTMLElement).tagName;
      if (tag === 'B' || tag === 'STRONG') chain.push({ bold: true });
      if (tag === 'I' || tag === 'EM') chain.push({ italic: true });
      if (tag === 'U') chain.push({ underline: true });
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') chain.push({ strike: true });
      if (tag === 'SUB') chain.push({ baseline: 'sub' });
      if (tag === 'SUP') chain.push({ baseline: 'super' });
    }
    return Object.assign({}, ...chain) as RunFormat;
  };
  const walk = (node: Node, top: boolean) => {
    node.childNodes.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/ /g, ' ').replace(/\n/g, '');
        if (text) lines[lines.length - 1].push({ text, ...fmtOf(child) });
        return;
      }
      const el = child as HTMLElement;
      if (el.tagName === 'BR') {
        // A <br> ending a block is only the browser holding an empty line open.
        const last = i === node.childNodes.length - 1 && BLOCK.has((node as HTMLElement).tagName ?? '');
        if (!last) lines.push([]);
        return;
      }
      if (BLOCK.has(el.tagName)) {
        const startsLine = !(top && i === 0) && (lines[lines.length - 1].length > 0 || i > 0);
        if (startsLine) lines.push([]);
        walk(el, false);
        return;
      }
      walk(el, false);
    });
  };
  walk(root, true);
  return lines.map(normalizeRuns);
}

/** Text nodes with the character offset (lines joined by \n) each starts at. */
function textMap(root: HTMLElement): { node: Text; start: number }[] {
  const out: { node: Text; start: number }[] = [];
  let at = 0;
  root.childNodes.forEach((block, li) => {
    if (li > 0) at += 1;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      out.push({ node: n, start: at });
      at += n.data.length;
    }
  });
  return out;
}

function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const map = textMap(root);
  if (node.nodeType === Node.TEXT_NODE) {
    const hit = map.find((m) => m.node === node);
    if (hit) return hit.start + offset;
  }
  // An element boundary: the first text at or after it.
  const marker = node.nodeType === Node.TEXT_NODE ? node : node.childNodes[offset] ?? null;
  if (marker) {
    for (const m of map) {
      const pos = marker.compareDocumentPosition(m.node);
      if (m.node === marker || pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) return m.start;
    }
  }
  // Past the end of a block: where that block's text ends.
  const block = node === root ? null : [...root.childNodes].find((b) => b === node || b.contains(node));
  if (block) {
    const inBlock = map.filter((m) => block.contains(m.node));
    const last = inBlock[inBlock.length - 1];
    if (last) return last.start + last.node.data.length;
    const before = map.filter((m) => block.compareDocumentPosition(m.node) & Node.DOCUMENT_POSITION_PRECEDING);
    const idx = [...root.childNodes].indexOf(block as ChildNode);
    return before.length ? before[before.length - 1].start + before[before.length - 1].node.data.length + 1 : idx;
  }
  const last = map[map.length - 1];
  return last ? last.start + last.node.data.length : 0;
}

function pointAt(root: HTMLElement, offset: number): [Node, number] {
  const map = textMap(root);
  for (const m of map) if (offset <= m.start + m.node.data.length && offset >= m.start) return [m.node, offset - m.start];
  // Empty line or end: put the caret in the block holding that line.
  let at = 0;
  for (const block of root.childNodes) {
    const len = block.textContent?.length ?? 0;
    if (offset <= at + len) return [block, 0];
    at += len + 1;
  }
  return [root, root.childNodes.length];
}

/** Split the lines' runs at [a, b) and give that part `patch` (undefined values clear a format). */
export function formatRange(lines: TextRun[][], a: number, b: number, patch: (r: TextRun) => RunFormat): TextRun[][] {
  let at = 0;
  return lines.map((line) => {
    const out: TextRun[] = [];
    for (const r of line) {
      const s = at, e = at + r.text.length;
      at = e;
      const from = Math.max(s, a), to = Math.min(e, b);
      if (to <= from) { out.push(r); continue; }
      if (from > s) out.push({ ...r, text: r.text.slice(0, from - s) });
      const mid: TextRun = { ...r, ...patch(r), text: r.text.slice(from - s, to - s) };
      for (const k of Object.keys(mid) as (keyof TextRun)[]) if (mid[k] === undefined) delete mid[k];
      out.push(mid);
      if (to < e) out.push({ ...r, text: r.text.slice(to - s) });
    }
    at += 1;
    return normalizeRuns(out);
  });
}

/** The run covering character `at` (or the one just before it). */
function runAt(lines: TextRun[][], at: number): TextRun | null {
  let pos = 0;
  let prev: TextRun | null = null;
  for (const line of lines) {
    for (const r of line) {
      if (at >= pos && at < pos + r.text.length) return r;
      prev = r;
      pos += r.text.length;
    }
    pos += 1;
  }
  return prev;
}

interface Props {
  lines: TextRun[][];
  /** The box's own formatting, which runs without their own take (canvas pixels). */
  base: { fontSize: number; bold: boolean; italic: boolean; color: string };
  style: CSSProperties;
  onChange: (lines: TextRun[][]) => void;
  onDone: () => void;
  /** Selection only formats plain text (the slide's own lyrics keep one style per line). */
  plain?: boolean;
  /** Review › Language: the proofing language, and no spelling check. */
  lang?: string;
  noProof?: boolean;
}

/** The editable text box. Mounted for one typing session. */
export function RichTextEditor({ lines, base, style, onChange, onDone, plain, lang, noProof }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sel = useRef<[number, number]>([0, 0]);
  const latest = useRef({ onChange, onDone, base });
  latest.current = { onChange, onDone, base };

  useLayoutEffect(() => {
    const root = ref.current!;
    render(root, lines.length ? lines : [[]]);
    root.focus();
    // The caret goes to the end, as a click into PowerPoint's text puts it in the text.
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const total = lines.reduce((n, l) => n + l.reduce((m, r) => m + r.text.length, 0), 0) + Math.max(0, lines.length - 1);
    sel.current = [total, total];
    // Mounted once per typing session; later text comes from the DOM itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = ref.current!;
    /** Read the live selection; true when it moved. */
    const remember = (): boolean => {
      const s = window.getSelection();
      if (!s || !s.rangeCount || !root.contains(s.anchorNode)) return false;
      const r = s.getRangeAt(0);
      const a = offsetOf(root, r.startContainer, r.startOffset), b = offsetOf(root, r.endContainer, r.endOffset);
      const next: [number, number] = [Math.min(a, b), Math.max(a, b)];
      if (next[0] === sel.current[0] && next[1] === sel.current[1]) return false;
      sel.current = next;
      return true;
    };
    const onSelection = () => { if (remember()) notify(); };
    document.addEventListener('selectionchange', onSelection);
    const restore = () => {
      const [a, b] = sel.current;
      const [na, oa] = pointAt(root, a), [nb, ob] = pointAt(root, b);
      const range = document.createRange();
      range.setStart(na, oa);
      range.setEnd(nb, ob);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    };
    const reformat = (fn: (r: TextRun) => RunFormat) => {
      // selectionchange arrives after the keys that moved the selection: read it now while typing here.
      if (document.activeElement === root) remember();
      const [a, b] = sel.current;
      const cur = readLines(root);
      const all = a === b;
      const total = cur.reduce((n, l) => n + l.reduce((m, r) => m + r.text.length, 0), 0) + Math.max(0, cur.length - 1);
      const next = formatRange(cur, all ? 0 : a, all ? total : b, fn);
      render(root, next);
      latest.current.onChange(next);
      root.focus();
      restore();
      notify();
    };
    const api: RichTextApi = {
      hasSelection: () => { if (document.activeElement === root) remember(); return sel.current[0] !== sel.current[1]; },
      current: () => {
        if (document.activeElement === root) remember();
        const r = runAt(readLines(root), sel.current[0]) ?? { text: '' };
        const b = latest.current.base;
        return { fontSize: r.fontSize ?? b.fontSize, bold: r.bold ?? b.bold, italic: r.italic ?? b.italic, underline: r.underline, color: r.color ?? b.color, strike: r.strike, baseline: r.baseline };
      },
      apply: (patch) => reformat(() => patch),
      step: (dir) => reformat((r) => ({ fontSize: stepFontSize(r.fontSize ?? latest.current.base.fontSize, dir) })),
    };
    if (!plain) active = api;
    notify();
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      if (active === api) active = null;
      notify();
    };
  }, [plain]);

  const onKeyDown = (e: RKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); latest.current.onDone(); return; }
    // Tab types a tab (it goes to the box's next tab stop) instead of leaving the box.
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '\t'); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey || plain) return;
    const k = e.key.toLowerCase();
    const api = active;
    if (!api) return;
    const cur = api.current();
    if (k === 'b') api.apply({ bold: !cur.bold });
    else if (k === 'i') api.apply({ italic: !cur.italic });
    else if (k === 'u') api.apply({ underline: !cur.underline || undefined });
    // Ctrl+= subscript, Ctrl+Shift+= (Ctrl++) superscript, as in PowerPoint.
    else if (k === '=' && !e.shiftKey) api.apply({ baseline: cur.baseline === 'sub' ? undefined : 'sub' });
    else if (k === '+' || (k === '=' && e.shiftKey)) api.apply({ baseline: cur.baseline === 'super' ? undefined : 'super' });
    else if (k === ']' || (e.shiftKey && (k === '>' || k === '.'))) api.step(1);
    else if (k === '[' || (e.shiftKey && (k === '<' || k === ','))) api.step(-1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className="ce-rich"
      contentEditable
      suppressContentEditableWarning
      spellCheck={spell && !noProof}
      lang={lang}
      style={style}
      onInput={() => onChange(readLines(ref.current!))}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        // Plain text only: formatting pasted from elsewhere would not fit the slide's look.
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => {
        // Focus moving to a ribbon or Format pane control keeps the session (and selection) alive.
        setTimeout(() => {
          const f = document.activeElement as HTMLElement | null;
          if (f && (f === ref.current || f.closest('.ribbon, .ppt-format, .ppt-menu, .rb-menu, .ce-rich, .ppt-dialog'))) return;
          if (!ref.current?.isConnected) return;
          latest.current.onDone();
        }, 0);
      }}
    />
  );
}
