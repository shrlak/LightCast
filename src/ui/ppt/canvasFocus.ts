// The slide canvas as the editor window's one document: its single Tab stop and when it takes the
// keyboard back (DeckCraft 44c80663, c74671d7, d532ff66, 24bdb62f, redesigned for the browser).
//
// - Tab and Shift+Tab step through the slide's objects while there is one left (`tabHasWork`); past
//   the last one the canvas lets the browser move the keyboard on, so it never traps Tab.
// - A pointer press on a ribbon or Quick Access Toolbar button that does not hand the keyboard to
//   something else (a text field, a dialog, a menu) leaves the slide with it, so Delete, the arrow
//   keys and typing keep going to the slide.
// - When a dialog, menu or popup closes, or the focus leaves the canvas, a toolbar or an overlay for
//   nothing (a ribbon field committed with Enter), the canvas takes the keyboard back, and so does a
//   newly shown slide when nothing has it. A Tab pressed with nothing focused goes to the slide.
// - A text field, an open dialog or menu, and a touch screen (where the focus would raise the
//   on-screen keyboard) keep what they have.
import { useEffect, useRef, type RefObject } from 'react';

/** The part of a DOM element the decisions here read (so they can be tested without a DOM). */
export interface FocusNode {
  closest(selector: string): FocusNode | null;
  getAttribute(name: string): string | null;
  isContentEditable?: boolean;
}

const TEXT_FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** Dialogs, menus and popups: while one is up (and does not hold the canvas) it keeps the keyboard. */
export const OVERLAYS = '.modal-backdrop, [role="dialog"], [role="menu"], .ppt-menu, .rb-menu';
/** The toolbars whose pressed buttons leave the keyboard with the slide. */
const TOOLBARS = '.ribbon, .qat-btn';

/** A field the keyboard types into; the canvas's own hidden typing field is not one. */
export function isTextField(el: FocusNode | null | undefined): boolean {
  if (!el || el.closest('[data-ime-sink]')) return false;
  return !!el.isContentEditable || !!el.closest(TEXT_FIELD);
}

/**
 * Whether `el` is a toolbar control that, once pressed, leaves the keyboard with the slide: a ribbon
 * or QAT button, not a field and not a drop-down it has just opened.
 */
export function isToolbarControl(el: FocusNode | null | undefined): boolean {
  if (!el || !el.closest(TOOLBARS) || isTextField(el)) return false;
  return el.closest('[aria-expanded="true"]') === null;
}

/** Whether a dialog, menu or popup is up that does not itself hold the canvas `root`. */
export function overlayOpen(overlays: Iterable<{ contains(n: unknown): boolean }>, root: unknown): boolean {
  for (const o of overlays) if (!o.contains(root)) return true;
  return false;
}

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Keeps the keyboard with the slide canvas `root` (see the top of this file). `focus` gives the
 * canvas the keyboard; `tab(forward)` steps the selection and says whether the slide had an object
 * for it. Off while `enabled` is false (a read-only slide).
 */
export function useCanvasKeyboard(root: RefObject<HTMLElement | null>, focus: () => void, tab: (forward: boolean) => boolean, enabled: boolean): void {
  const latest = useRef({ focus, tab });
  latest.current = { focus, tab };
  useEffect(() => {
    if (!enabled) return;
    const doc = document;
    const shown = () => { const r = root.current; return !!r && r.isConnected && r.getClientRects().length > 0; };
    const covered = () => overlayOpen(doc.querySelectorAll(OVERLAYS), root.current);
    const nothingFocused = () => { const a = doc.activeElement; return !a || a === doc.body || a === doc.documentElement; };
    /** Gives the canvas the keyboard if nothing (or, after a toolbar press, that toolbar control) has it. */
    const reclaim = (afterPress: boolean) => {
      if (!shown() || covered()) return;
      const a = doc.activeElement as HTMLElement | null;
      if (nothingFocused() || (afterPress && isToolbarControl(a))) latest.current.focus();
    };
    // A slide newly shown takes the keyboard when nothing has it.
    if (!coarse()) reclaim(false);

    let pressed = false;
    const onDown = (e: PointerEvent) => { pressed = e.pointerType !== 'touch' && isToolbarControl(e.target as HTMLElement | null); };
    // After the press's own handlers ran (and any dialog, menu or field it opened took the keyboard).
    const onClick = () => { if (!pressed) return; pressed = false; requestAnimationFrame(() => reclaim(true)); };

    let frame = 0;
    const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!coarse()) reclaim(false); }); };
    // The focus left the canvas, a toolbar or an overlay for nothing.
    const onFocusOut = (e: FocusEvent) => {
      const from = e.target as HTMLElement | null;
      if (e.relatedTarget || !from?.closest) return;
      if (root.current?.contains(from) || from.closest(TOOLBARS) || from.closest(OVERLAYS)) later();
    };
    // A dialog, menu or popup that closed takes its focused control with it (no focusout is sent).
    let wasCovered = covered();
    let checking = 0;
    const observer = new MutationObserver(() => {
      if (checking) return;
      checking = requestAnimationFrame(() => {
        checking = 0;
        const now = covered();
        if (wasCovered && !now) later();
        wasCovered = now;
      });
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    // Tab with nothing focused goes to the slide while it has an object for it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !nothingFocused() || !shown() || covered()) return;
      if (!latest.current.tab(!e.shiftKey)) return;
      e.preventDefault();
      latest.current.focus();
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('click', onClick);
    doc.addEventListener('focusout', onFocusOut);
    window.addEventListener('keydown', onKey, true);
    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('keydown', onKey, true);
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(checking);
    };
  }, [enabled, root]);
}
