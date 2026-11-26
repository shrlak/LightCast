// DeckCraft 9db2fa0..5b7b22d: the slide canvas as one Tab stop that keeps the keyboard (44c80663,
// c74671d7, d532ff66, 24bdb62f) and Alt+1..9 for the Quick Access Toolbar (0d8d4b75). Excel's `?` placeholders (3791ce11) are tested in the engine's
// vendored `deckcraft/model/src/numfmt.rs`.
import { describe, expect, it } from 'vitest';
import { qatShortcut, qatShortcutLabel } from '../src/domain/qat';
import { cycleSelection, tabHasWork } from '../src/domain/shapeOps';
import type { SlideElement } from '../src/domain/types';
import { isTextField, isToolbarControl, overlayOpen, type FocusNode } from '../src/ui/ppt/canvasFocus';

const el = (id: string, more: Partial<SlideElement> = {}) => ({ id, kind: 'shape', x: 0, y: 0, w: 10, h: 10, ...more }) as SlideElement;

describe('Tab has work on the slide only while an object is left (tab_has_work)', () => {
  const els = [el('a'), el('b', { groupId: 'g' }), el('c', { groupId: 'g' }), el('h', { hidden: true }), el('d')];
  it('forward: from nothing, and up to the last object', () => {
    expect(tabHasWork(els, [], true)).toBe(true);
    expect(tabHasWork(els, ['a'], true)).toBe(true);
    expect(tabHasWork(els, ['c'], true)).toBe(true); // a group member: the group counts once
    expect(tabHasWork(els, ['d'], true)).toBe(false); // the last: Tab leaves the slide
  });
  it('backward: from nothing, and down to the first object', () => {
    expect(tabHasWork(els, [], false)).toBe(true);
    expect(tabHasWork(els, ['d'], false)).toBe(true);
    expect(tabHasWork(els, ['a'], false)).toBe(false);
  });
  it('an empty slide (or only hidden and master objects) has nothing for Tab', () => {
    expect(tabHasWork([], [], true)).toBe(false);
    expect(tabHasWork([el('h', { hidden: true }), el('m', { master: true } as Partial<SlideElement>)], [], false)).toBe(false);
  });
  it('cycling is unchanged where Tab has work', () => {
    expect(cycleSelection(els, ['a'], true)).toBe('b');
    expect(cycleSelection(els, ['b'], true)).toBe('d');
    expect(cycleSelection(els, ['d'], false)).toBe('b');
  });
});

/** A tiny element tree: each node has a tag, attributes and a parent; `closest` matches the selectors used. */
type Node = FocusNode & { parent?: Node };
function node(tag: string, attrs: Record<string, string> = {}, parent?: Node, editable = false): Node {
  const matches = (n: Node, sel: string) => sel.split(',').map((s) => s.trim()).some((s) => {
    if (s.startsWith('.')) return (n.getAttribute('class') ?? '').split(' ').includes(s.slice(1));
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
    if (attr) return n.getAttribute(attr[1]) !== null && (attr[2] === undefined || n.getAttribute(attr[1]) === attr[2]);
    return s === tag;
  });
  const n: Node = {
    parent,
    isContentEditable: editable,
    getAttribute: (name) => attrs[name] ?? null,
    closest(sel) { for (let c: Node | undefined = n; c; c = c.parent) if (matches(c, sel)) return c; return null; },
  };
  return n;
}

describe('which presses leave the keyboard with the slide', () => {
  const ribbon = node('div', { class: 'ribbon pp' });
  it('a ribbon or QAT button does', () => {
    expect(isToolbarControl(node('button', {}, ribbon))).toBe(true);
    expect(isToolbarControl(node('span', {}, node('button', {}, ribbon)))).toBe(true);
    expect(isToolbarControl(node('button', { class: 'qat-btn' }))).toBe(true);
  });
  it('a ribbon field, a drop-down it opened, and anything outside the toolbars do not', () => {
    expect(isToolbarControl(node('input', {}, ribbon))).toBe(false);
    expect(isToolbarControl(node('select', {}, ribbon))).toBe(false);
    expect(isToolbarControl(node('button', { 'aria-expanded': 'true' }, ribbon))).toBe(false);
    expect(isToolbarControl(node('button', { 'aria-expanded': 'false' }, ribbon))).toBe(true);
    expect(isToolbarControl(node('button', {}, node('div', { class: 'slides-panel' })))).toBe(false);
    expect(isToolbarControl(null)).toBe(false);
  });
  it("text fields keep the keyboard; the canvas's own typing field is not one", () => {
    expect(isTextField(node('textarea'))).toBe(true);
    expect(isTextField(node('div', {}, undefined, true))).toBe(true);
    expect(isTextField(node('textarea', { 'data-ime-sink': '' }))).toBe(false);
    expect(isTextField(node('button'))).toBe(false);
  });
});

describe('a dialog or menu keeps the keyboard unless it holds the canvas', () => {
  const root = {};
  const holding = { contains: (n: unknown) => n === root };
  const other = { contains: () => false };
  it('works out whether one covers the slide', () => {
    expect(overlayOpen([], root)).toBe(false);
    expect(overlayOpen([holding], root)).toBe(false); // 슬라이드별 편집: the canvas is inside its dialog
    expect(overlayOpen([holding, other], root)).toBe(true);
  });
});

describe('Alt+1..9 presses the Quick Access Toolbar buttons (0d8d4b75)', () => {
  const key = (code: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    ({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...mods });
  it('Alt+digit is the button at that position, by key position on any layout', () => {
    expect(qatShortcut(key('Digit1'), false)).toBe(0);
    expect(qatShortcut(key('Digit9'), false)).toBe(8);
    expect(qatShortcut(key('Digit0'), false)).toBeNull();
    expect(qatShortcut(key('Numpad1'), false)).toBeNull(); // Alt+numpad stays character entry
  });
  it('needs Alt alone, and leaves macOS Option+digit to type', () => {
    expect(qatShortcut(key('Digit1', { altKey: false }), false)).toBeNull();
    expect(qatShortcut(key('Digit1', { ctrlKey: true }), false)).toBeNull();
    expect(qatShortcut(key('Digit1', { shiftKey: true }), false)).toBeNull();
    expect(qatShortcut(key('Digit1'), true)).toBeNull();
  });
  it('the tooltip names the shortcut for the first nine buttons', () => {
    expect(qatShortcutLabel(0, false)).toBe('Alt+1');
    expect(qatShortcutLabel(8, false)).toBe('Alt+9');
    expect(qatShortcutLabel(9, false)).toBe('');
    expect(qatShortcutLabel(0, true)).toBe('');
  });
});
