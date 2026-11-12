// Typing on the slide, as in PowerPoint: the text box becomes editable where it is, and any part of
// its text can be selected and given its own size, bold, italic, underline or colour. The words and
// their formatting are kept as runs (domain/richText); the box's own formatting applies to the rest.
//
// While a box is being typed in, the ribbon's and Format pane's font buttons act on the selected
// characters through `activeTextEditor` (the selection is remembered when focus moves to a ribbon
// control, such as the font size box).
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ClipboardEvent as RClipboardEvent, type FormEvent, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from 'react';
import type { ListStyle, SlideElement, TextRun } from '../domain/types';
import { insertLines, normalizeRuns, sliceLines, withBoxFormat, type RunFormat } from '../domain/richText';
import { CLIP_TYPE, pastedLines, runsHtml } from '../domain/clipboard';
import { formatSpan, stepFontSize } from '../domain/textFormat';
import { applyFormat, armedPainter, finishPainter, heldFormat, holdFormat, runFormatOf, textPart, type Painted } from '../domain/formatPainter';
import { runStyle } from './runStyle';
import { deleteWord, paraDown, paraUp, paragraphRange, toOffset, toPos, wordMove, wordRange, type Pos } from '../domain/textEditing';
import { autoCorrectAt, autoCorrectPrefs, smartQuote } from '../domain/autoCorrect';

export interface RichTextApi {
  /** Is part of the text selected (formatting then applies to it rather than the whole box)? */
  hasSelection(): boolean;
  /** Formatting at the start of the selection. */
  current(): RunFormat;
  /** Give the selected characters this formatting. */
  apply(patch: RunFormat): void;
  /** Make the selected characters bigger / smaller (each from its own size). */
  step(dir: 1 | -1): void;
  /** The formatting of every selected piece of text (the caret's when nothing is selected), for the ribbon's mixed state. */
  spans(): RunFormat[];
  /** Insert › Link: the address on the characters at the start of the selection, and putting one on the selected characters (none removes it). */
  currentLink(): string | undefined;
  link(url: string | undefined): void;
  /** 서식 복사: the formatting at the start of the selection (the whole box's when nothing is selected). */
  pick(): Painted;
  /** 서식 붙여넣기: replace the formatting of the selected characters (of the whole box when nothing is selected). */
  drop(p: Painted): void;
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
      // A soft line break (\v in the text) is a <br data-soft>: one character of the model, not a new block.
      r.text.split('\u000b').forEach((piece, i) => {
        if (i) span.append(softBreak());
        if (piece) span.append(document.createTextNode(piece));
      });
      block.append(span);
    }
    // A line ending in a soft break needs something after it for the empty line to show.
    if (endsWithSoft(block)) block.append(document.createElement('br'));
    if (!block.childNodes.length) block.append(document.createElement('br'));
    root.append(block);
  }
}

const BLOCK = new Set(['DIV', 'P', 'LI']);

const isSoft = (n: Node | null): n is HTMLBRElement => (n as HTMLElement | null)?.tagName === 'BR' && !!(n as HTMLElement).dataset.soft;
const softBreak = () => { const br = document.createElement('br'); br.dataset.soft = '1'; return br; };

/** The last real thing in a node (empty text nodes, which splitting text leaves behind, do not count). */
function lastLeaf(n: Node): Node | null {
  for (let c = n.lastChild; c; c = c.previousSibling) {
    if (c.nodeType === Node.TEXT_NODE && !(c as Text).data) continue;
    return lastLeaf(c) ?? c;
  }
  return null;
}
/** Does the block's last character come from a soft line break? */
const endsWithSoft = (block: Node) => isSoft(lastLeaf(block));

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
      if (isSoft(el)) { lines[lines.length - 1].push({ text: '\u000b', ...fmtOf(el) }); return; }
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

/** What the model counts as characters in the DOM: text nodes and soft breaks, with the offset (lines joined by \n) each starts at. */
interface Piece { node: Node; start: number; len: number }
function textMap(root: HTMLElement): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  root.childNodes.forEach((block, li) => {
    if (li > 0) at += 1;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === Node.TEXT_NODE || isSoft(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.nodeType === Node.TEXT_NODE ? (n as Text).data.length : 1;
      out.push({ node: n, start: at, len });
      at += len;
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
  // An element boundary: the first text (or soft break) at or after it.
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
    if (last) return last.start + last.len;
    const before = map.filter((m) => block.compareDocumentPosition(m.node) & Node.DOCUMENT_POSITION_PRECEDING);
    const idx = [...root.childNodes].indexOf(block as ChildNode);
    return before.length ? before[before.length - 1].start + before[before.length - 1].len + 1 : idx;
  }
  const last = map[map.length - 1];
  return last ? last.start + last.len : 0;
}

function pointAt(root: HTMLElement, offset: number): [Node, number] {
  const map = textMap(root);
  for (const m of map) {
    if (offset > m.start + m.len || offset < m.start) continue;
    if (m.node.nodeType === Node.TEXT_NODE) return [m.node, offset - m.start];
    // A soft break: before it, or after it (the next place in its parent).
    const parent = m.node.parentNode!, i = [...parent.childNodes].indexOf(m.node as ChildNode);
    return [parent, i + (offset - m.start)];
  }
  // Empty line or end: put the caret in the block holding that line.
  let at = 0;
  for (const block of root.childNodes) {
    const len = textMap(root).filter((m) => block.contains(m.node)).reduce((n, m) => n + m.len, 0);
    if (offset <= at + len) return [block, 0];
    at += len + 1;
  }
  return [root, root.childNodes.length];
}

/** The character offset under a screen point (null: not over the editor's text). */
function offsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null, off = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) { node = pos.offsetNode; off = pos.offset; } else {
    const r = document.caretRangeFromPoint?.(x, y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  }
  if (!node || !root.contains(node)) return null;
  return offsetOf(root, node, off);
}

/** The paragraphs' plain text. */
const parasOf = (lines: TextRun[][]) => lines.map((l) => l.map((r) => r.text).join(''));

/** Select [anchor → focus] (flat offsets) in the editor, keeping the direction. */
function selectFlat(root: HTMLElement, anchor: number, focus = anchor) {
  const [na, oa] = pointAt(root, anchor), [nf, of] = pointAt(root, focus);
  const s = window.getSelection();
  if (!s) return;
  if (s.setBaseAndExtent) s.setBaseAndExtent(na, oa, nf, of);
  else { const r = document.createRange(); r.setStart(na, oa); r.collapse(true); s.removeAllRanges(); s.addRange(r); s.extend?.(nf, of); }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** How the typing session starts (DeckCraft's text.edit): the caret at a clicked point, the word there selected, or everything selected. */
export interface EditStart {
  /** Screen point clicked (clientX, clientY): the caret goes there. */
  point?: [number, number];
  /** Double-click: select the word at `point`. */
  word?: boolean;
}

/** What the canvas does with the editor from outside: the input-method hand-off and word selection. */
export interface EditorControl {
  /** Typing on a selected box: show `text` in place of the box's text while an input method composes elsewhere. */
  show(text: string): void;
  /** …then take over: `text` replaces the box's text, the caret after it, and typing goes on here. */
  take(text: string): void;
  /** Select the word at a screen point (double-click). */
  wordAt(x: number, y: number): void;
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
  base: { fontSize: number; bold: boolean; italic: boolean; color: string; fontFamily?: string; underline?: boolean; strike?: boolean; highlight?: string };
  style: CSSProperties;
  onChange: (lines: TextRun[][]) => void;
  /** Typing ends (Esc: `escape`, focus moved away: no argument). */
  onDone: (how?: 'escape') => void;
  /** Selection only formats plain text (the slide's own lyrics keep one style per line). */
  plain?: boolean;
  /** Review › Language: the proofing language, and no spelling check. */
  lang?: string;
  noProof?: boolean;
  /** Where the caret goes when typing starts (default: the end of the text). */
  start?: EditStart;
  /** Typing on a selected box with an input method: the editor waits (unfocused) for `control.take`. */
  standby?: boolean;
  control?: { current: EditorControl | null };
  /** AutoFormat's automatic list: make the box a list (undefined: take it off); false when the box can't. */
  onAutoList?: (list: ListStyle | undefined) => boolean;
  /** Shift+Enter makes a soft line break (text boxes; the slide's own lyric text keeps one line per paragraph). */
  softBreaks?: boolean;
  /** 서식 복사 inside a box: its own formatting, and a way to change the box's (applied with the next commit of the text). */
  painter?: { source: () => Painted; setBox: (fn: (e: SlideElement) => SlideElement) => void };
}

/** The editable text box. Mounted for one typing session. */
export function RichTextEditor({ lines, base, style, onChange, onDone, plain, lang, noProof, start, standby, control, onAutoList, painter, softBreaks }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sel = useRef<[number, number]>([0, 0]);
  const latest = useRef({ onChange, onDone, base, onAutoList, painter });
  latest.current = { onChange, onDone, base, onAutoList, painter };
  /** Our own edits (AutoCorrect, word deletion) are not typing: their input events are not corrected again. */
  const busy = useRef(false);
  /** The list AutoFormat just started (Backspace right after puts the typed lead back), and the text it left. */
  const autoList = useRef<{ para: number; typed: string; text: string } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current!;
    render(root, lines.length ? lines : [[]]);
    const total = lines.reduce((n, l) => n + l.reduce((m, r) => m + r.text.length, 0), 0) + Math.max(0, lines.length - 1);
    sel.current = [total, total];
    if (standby) return;
    root.focus();
    // DeckCraft's text.edit: the caret where the text was clicked (a double-click selects the word
    // there); from the keyboard (Enter / F2) at the end of the text.
    const at = start?.point ? offsetAtPoint(root, start.point[0], start.point[1]) : null;
    if (at !== null && start?.word) {
      const paras = parasOf(lines);
      const [a, b] = wordRange(paras, toPos(paras, at));
      selectFlat(root, toOffset(paras, a), toOffset(paras, b));
    } else selectFlat(root, at ?? total);
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
      const cur = readLines(root);
      // A caret inside a word formats that word; between words, the whole text (DeckCraft's format_range).
      const [a, b] = formatSpan(cur.map((l) => l.map((r) => r.text).join('')).join('\n'), sel.current[0], sel.current[1]);
      const next = formatRange(cur, a, b, fn);
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
      spans: () => {
        if (document.activeElement === root) remember();
        const [a, b] = sel.current;
        const b0 = latest.current.base;
        const eff = (r: TextRun): RunFormat => ({ ...r, fontSize: r.fontSize ?? b0.fontSize, fontFamily: r.fontFamily ?? b0.fontFamily, bold: r.bold ?? b0.bold, italic: r.italic ?? b0.italic, color: r.color ?? b0.color });
        if (a === b) return [eff(runAt(readLines(root), a) ?? { text: '' })];
        const runs = sliceLines(readLines(root), a, b).flat().filter((r) => r.text);
        return runs.length ? runs.map(eff) : [eff(runAt(readLines(root), a) ?? { text: '' })];
      },
      apply: (patch) => reformat(() => patch),
      step: (dir) => reformat((r) => ({ fontSize: stepFontSize(r.fontSize ?? latest.current.base.fontSize, dir) })),
      currentLink: () => {
        if (document.activeElement === root) remember();
        return runAt(readLines(root), sel.current[0])?.link;
      },
      link: (url) => { if (sel.current[0] !== sel.current[1]) reformat(() => ({ link: url })); },
      pick: () => {
        if (document.activeElement === root) remember();
        const own = latest.current.painter?.source() ?? {};
        const r = runAt(readLines(root), sel.current[0]) ?? { text: '' };
        const b = latest.current.base;
        // What the characters look like where the selection starts: their own formatting over the box's.
        const text = { ...own.text, fontSize: r.fontSize ?? b.fontSize, bold: r.bold ?? b.bold, italic: r.italic ?? b.italic, underline: r.underline ?? b.underline, strike: r.strike ?? b.strike, color: r.color ?? b.color, fontFamily: r.fontFamily ?? b.fontFamily, highlight: r.highlight ?? b.highlight };
        return { text, baseline: r.baseline, para: own.para };
      },
      drop: (p) => {
        if (document.activeElement === root) remember();
        const [a, b] = sel.current;
        const cur = readLines(root);
        const total = cur.reduce((n, l) => n + l.reduce((m, r) => m + r.text.length, 0), 0) + Math.max(0, cur.length - 1);
        const painterApi = latest.current.painter;
        if (a === b) {
          // Nothing selected: the whole box takes it, as DeckCraft does when the selection is not a range.
          painterApi?.setBox((e) => applyFormat(e, textPart(p)));
          reformat(() => ({ fontSize: undefined, bold: undefined, italic: undefined, underline: undefined, strike: undefined, color: undefined, baseline: undefined, fontFamily: undefined, highlight: undefined }));
          return;
        }
        // Characters take the character formatting; the paragraph formatting only when the selection covers every paragraph.
        if (a <= 0 && b >= total && p.para) painterApi?.setBox((e) => applyFormat(e, { para: p.para }));
        const fmt = runFormatOf(p);
        reformat((r) => ({ ...Object.fromEntries(Object.keys(r).filter((k) => k !== 'text' && k !== 'link').map((k) => [k, undefined])), ...fmt }));
      },
    };
    if (!plain) active = api;
    notify();
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      if (active === api) active = null;
      notify();
    };
  }, [plain]);

  // A layout effect: the canvas hands text over right after mounting the editor (flushSync).
  useLayoutEffect(() => {
    if (!control) return;
    const root = ref.current!;
    // Typing on a selected box replaces its text with the first character's formatting (DeckCraft's type_text).
    const { text: _t, ...fmt } = lines.flat()[0] ?? { text: '' };
    const put = (text: string) => {
      render(root, text ? [[{ ...fmt, text }]] : [[]]);
      latest.current.onChange(readLines(root));
    };
    const ctl: EditorControl = {
      // Never touch the DOM while it has focus: an input method may be composing in it.
      show: (text) => { if (document.activeElement !== root) put(text); },
      take: (text) => {
        if (document.activeElement !== root) put(text);
        root.focus();
        selectFlat(root, text.length);
        notify();
      },
      wordAt: (x, y) => { if (!pickAt(x, y, 2)) root.focus(); },
    };
    control.current = ctl;
    return () => { if (control.current === ctl) control.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [control]);

  /** The live selection as flat offsets: where it is anchored and where the caret is. */
  const liveSel = (): { anchor: number; focus: number } | null => {
    const root = ref.current!;
    const s = window.getSelection();
    if (!s || !s.rangeCount || !s.anchorNode || !s.focusNode || !root.contains(s.anchorNode)) return null;
    return { anchor: offsetOf(root, s.anchorNode, s.anchorOffset), focus: offsetOf(root, s.focusNode, s.focusOffset) };
  };
  /** Replace [a, b) through the browser's own editing, so Ctrl+Z undoes it like typing. */
  const replaceFlat = (a: number, b: number, text: string) => {
    const root = ref.current!;
    selectFlat(root, a, b);
    busy.current = true;
    try {
      if (text) document.execCommand('insertText', false, text);
      else if (a !== b) document.execCommand('delete');
    } finally { busy.current = false; }
  };

  /** Double-click: the word at the point (DeckCraft's text.selectWord); triple-click: the paragraph with its mark. */
  const pickAt = (x: number, y: number, clicks: number): boolean => {
    const root = ref.current!;
    const at = offsetAtPoint(root, x, y);
    if (at === null) return false;
    const paras = parasOf(readLines(root));
    const p = toPos(paras, at);
    const [a, b] = clicks === 2 ? wordRange(paras, p) : paragraphRange(paras, p[0]);
    root.focus();
    selectFlat(root, toOffset(paras, a), toOffset(paras, b));
    return true;
  };

  /**
   * DeckCraft's text keys that the browser does differently: Ctrl+←/→ by PowerPoint's word stops,
   * Ctrl+↑/↓ by paragraph, Ctrl+Backspace / Ctrl+Delete by word with smart spacing (Option on the
   * Mac). Shift extends the selection. True when the key was handled.
   */
  const textKey = (e: RKeyboardEvent): boolean => {
    const word = isMac ? e.altKey && !e.metaKey && !e.ctrlKey : e.ctrlKey && !e.altKey && !e.metaKey;
    if (!word || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace', 'Delete'].includes(e.key)) return false;
    const root = ref.current!;
    const cur = liveSel();
    if (!cur) return false;
    let paras = parasOf(readLines(root));
    const lo = Math.min(cur.anchor, cur.focus), hi = Math.max(cur.anchor, cur.focus);
    const pos = (o: number) => toPos(paras, o);
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (e.shiftKey) return true;
      // From the start of a selection, leaving the rest of it (PowerPoint for Windows).
      const r = deleteWord(paras, pos(lo), e.key === 'Delete');
      for (const ed of r.edits) {
        replaceFlat(toOffset(paras, ed.from), toOffset(paras, ed.to), ed.text);
        paras = parasOf(readLines(root));
      }
      selectFlat(root, toOffset(paras, r.caret));
      return true;
    }
    // Ctrl+arrows with a selection go on from its start (left) or end (right).
    const at = pos(cur.focus);
    let to: Pos;
    if (e.key === 'ArrowLeft') to = wordMove(paras, pos(e.shiftKey ? cur.focus : lo), false);
    else if (e.key === 'ArrowRight') to = wordMove(paras, pos(e.shiftKey ? cur.focus : hi), true);
    else if (isMac) to = e.key === 'ArrowUp' ? [at[0], 0] : [at[0], paras[at[0]]?.length ?? 0];
    else to = e.key === 'ArrowUp' ? paraUp(paras, at) : paraDown(paras, at);
    const f = toOffset(paras, to);
    selectFlat(root, e.shiftKey ? cur.anchor : f, f);
    return true;
  };

  /** After a character was typed: smart quotes, AutoCorrect and AutoFormat's lists (DeckCraft's text.insert). */
  const afterTyping = (data: string) => {
    const root = ref.current!;
    const prefs = autoCorrectPrefs();
    const cur = liveSel();
    if (!cur || cur.anchor !== cur.focus) return;
    const lines = readLines(root);
    const paras = parasOf(lines);
    const [pi, ch] = toPos(paras, cur.focus);
    const line = paras[pi] ?? '';
    const typing = [...data].length === 1;
    if (typing && prefs.smartQuotes && (data === '"' || data === "'")) {
      const q = smartQuote(data, ch >= 2 ? line[ch - 2] : undefined);
      if (q !== data) { replaceFlat(cur.focus - 1, cur.focus, q); selectFlat(root, cur.focus); }
      return;
    }
    const act = autoCorrectAt(prefs, line, ch, typing);
    if (!act) return;
    const base = toOffset(paras, [pi, 0]);
    if (act.kind === 'replace') {
      replaceFlat(base + act.start, base + act.end, act.text);
      selectFlat(root, cur.focus + act.text.length - (act.end - act.start));
    } else if (act.kind === 'ordinal') {
      if (plain || runAt(lines, base + act.start)?.baseline === 'super') return;
      render(root, formatRange(lines, base + act.start, base + act.end, () => ({ baseline: 'super' })));
      selectFlat(root, cur.focus);
    } else if (paras.length === 1 && latest.current.onAutoList?.(act.list)) {
      // LightCast's lists belong to the whole box: a box of this one paragraph becomes the list.
      replaceFlat(base, base + act.end, '');
      autoList.current = { para: pi, typed: act.typed, text: parasOf(readLines(root)).join('\n') };
    }
  };

  const onInput = (e: FormEvent) => {
    const ev = e.nativeEvent as InputEvent;
    // Never while an input method composes (Korean), nor for our own edits.
    if (!busy.current && !ev.isComposing && ev.inputType === 'insertText' && ev.data) afterTyping(ev.data);
    latest.current.onChange(readLines(ref.current!));
  };

  const onMouseDown = (e: RMouseEvent) => {
    if (e.button !== 0 || e.detail < 2 || e.shiftKey) return;
    if (pickAt(e.clientX, e.clientY, Math.min(3, e.detail))) e.preventDefault();
  };

  /** Copy / cut the selected characters with their formatting (and the box's, where they have none). */
  const copyOut = (e: RClipboardEvent, cut: boolean) => {
    e.stopPropagation();
    const root = ref.current!;
    const s = window.getSelection();
    if (!s?.rangeCount || !root.contains(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    const x = offsetOf(root, r.startContainer, r.startOffset), y = offsetOf(root, r.endContainer, r.endOffset);
    const [a, b] = [Math.min(x, y), Math.max(x, y)];
    if (a === b) return;
    const { fontSize, bold, italic, color, fontFamily, underline, strike, highlight } = latest.current.base;
    const part = withBoxFormat(sliceLines(readLines(root), a, b), { fontSize, bold: bold || undefined, italic: italic || undefined, color, fontFamily, underline, strike, highlight });
    e.preventDefault();
    e.clipboardData.setData('text/plain', part.map((l) => l.map((q) => q.text).join('')).join('\n'));
    e.clipboardData.setData('text/html', runsHtml(part, (getComputedStyle(root).textAlign as 'left') || undefined));
    if (cut) document.execCommand('delete');
  };

  const onKeyDown = (e: RKeyboardEvent) => {
    e.stopPropagation();
    // The input method has the keys while it composes (Korean): nothing here may break its syllable.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const list = autoList.current;
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) autoList.current = null;
    if (e.key === 'Escape') { e.preventDefault(); latest.current.onDone('escape'); return; }
    // Backspace right after AutoFormat started a list puts the typed lead back.
    if (list && e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const cur = liveSel();
      const paras = parasOf(readLines(ref.current!));
      if (cur && cur.anchor === cur.focus && cur.focus === toOffset(paras, [list.para, 0]) && paras.join('\n') === list.text) {
        e.preventDefault();
        latest.current.onAutoList?.(undefined);
        replaceFlat(cur.focus, cur.focus, list.typed);
        return;
      }
    }
    // Shift+Enter: a soft line break (\v) inside the paragraph, not a new one.
    if (softBreaks && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const s = window.getSelection(), root = ref.current!;
      if (!s?.rangeCount || !root.contains(s.anchorNode)) return;
      const range = s.getRangeAt(0);
      range.deleteContents();
      const soft = softBreak();
      range.insertNode(soft);
      // At the end of a block the browser needs a second <br> to show the empty line the caret is on.
      const block = [...root.childNodes].find((b) => b.contains(soft)) as HTMLElement | undefined;
      if (block && endsWithSoft(block)) block.append(document.createElement('br'));
      range.setStartAfter(soft);
      range.collapse(true);
      s.removeAllRanges();
      s.addRange(range);
      onChange(readLines(root));
      return;
    }
    if (textKey(e)) return;
    // Tab types a tab (it goes to the box's next tab stop) instead of leaving the box.
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '\t'); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey || plain) return;
    const k = e.key.toLowerCase();
    const api = active;
    if (!api) return;
    // 서식 복사 / 붙여넣기 (Ctrl+Shift+C / V); without anything copied Ctrl+Shift+V stays the plain-text paste.
    if (e.shiftKey && k === 'c') { holdFormat(api.pick()); e.preventDefault(); return; }
    if (e.shiftKey && k === 'v' && heldFormat()) { api.drop(heldFormat()!); finishPainter(); e.preventDefault(); return; }
    const cur = api.current();
    if (k === 'b') api.apply({ bold: !cur.bold });
    else if (k === 'i') api.apply({ italic: !cur.italic });
    else if (k === 'u') api.apply({ underline: !cur.underline || undefined });
    // Ctrl+= subscript, Ctrl+Shift+= (Ctrl++) superscript, as in PowerPoint.
    else if (k === '=' && !e.shiftKey) api.apply({ baseline: cur.baseline === 'sub' ? undefined : 'sub' });
    else if (k === '+' || (k === '=' && e.shiftKey)) api.apply({ baseline: cur.baseline === 'super' ? undefined : 'super' });
    // Ctrl+Space: Clear All Formatting of the selected characters (the word at the caret).
    else if (k === ' ' && !e.shiftKey) api.apply({ fontSize: undefined, bold: undefined, italic: undefined, underline: undefined, color: undefined, strike: undefined, baseline: undefined, fontFamily: undefined, highlight: undefined });
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
      onInput={onInput}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => e.stopPropagation()}
      onCopy={(e) => copyOut(e, false)}
      onCut={(e) => copyOut(e, true)}
      onPaste={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const data = e.clipboardData;
        const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
        // The slide's own text keeps one style per line: plain text only. Elsewhere the formatting comes
        // along (LightCast's own runs exactly, PowerPoint / Word / web text as it was); Ctrl+Shift+V
        // gives the browser's plain text.
        const lines = plain ? null : pastedLines(data.getData('text/html'), data.getData(CLIP_TYPE));
        if (!lines) { document.execCommand('insertText', false, text); return; }
        const root = ref.current!;
        const s = window.getSelection();
        let [a, b] = sel.current;
        if (s?.rangeCount && root.contains(s.anchorNode)) {
          const r = s.getRangeAt(0);
          const x = offsetOf(root, r.startContainer, r.startOffset), y = offsetOf(root, r.endContainer, r.endOffset);
          [a, b] = [Math.min(x, y), Math.max(x, y)];
        }
        const next = insertLines(readLines(root), a, b, lines.map((l) => l.filter((r) => r.text)));
        render(root, next.lines);
        sel.current = [next.caret, next.caret];
        const [n, o] = pointAt(root, next.caret);
        const range = document.createRange();
        range.setStart(n, o);
        range.collapse(true);
        s?.removeAllRanges();
        s?.addRange(range);
        latest.current.onChange(next.lines);
        notify();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={() => {
        // The painter armed from the ribbon: selecting characters puts its formatting on them.
        const a = armedPainter(), api = active;
        if (!a || !api || plain || !heldFormat()) return;
        setTimeout(() => { if (api.hasSelection()) { api.drop(heldFormat()!); finishPainter(); } }, 0);
      }}
      onBlur={() => {
        // Focus moving to a ribbon or Format pane control keeps the session (and selection) alive.
        setTimeout(() => {
          const f = document.activeElement as HTMLElement | null;
          if (f && (f === ref.current || f.closest('.ribbon, .ppt-format, .ppt-menu, .rb-menu, .ce-rich, .ppt-dialog, .name-dialog'))) return;
          if (!ref.current?.isConnected) return;
          latest.current.onDone();
        }, 0);
      }}
    />
  );
}
