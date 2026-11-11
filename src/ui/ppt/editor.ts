// What the ribbon, the task panes and the slide editor share: the presentation and slide being
// edited, the objects selected on it, the active tool, view options and task pane.
import { useSyncExternalStore, type Dispatch } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import type { Presentation, Slide, SlideElement, SlideStyle, Theme } from '../../domain/types';
import type { Commands } from './commands';
import type { CanvasTool, ViewOptions } from './CanvasEditor';
import { SLIDE_TEXT } from './CanvasEditor';
import { expandSelection } from '../../domain/editOps';
import { patchElement } from '../../domain/templates/convert';
import { slideTheme } from '../SlideCanvas';
import { activeTextEditor, onTextSelection } from '../RichTextEditor';
import { changeCase, type CaseKind } from '../../domain/textFormat';
import { sizeOf, textValue, CLEAR_TEXT_FORMAT } from './ElementFormat';
import type { TextFormatValue } from './TextFormatPanel';

export type TaskPane = 'format' | 'animation' | 'selection' | 'comments' | 'accessibility' | 'designer' | null;

export interface Ed {
  state: AppState;
  dispatch: Dispatch<Action>;
  cmd: Commands;
  p: Presentation | null;
  slide: Slide | null;
  theme: Theme | null;
  elements: SlideElement[];
  /** Selected object ids as clicked (SLIDE_TEXT for the slide's own text). */
  sel: string[];
  setSel: (ids: string[]) => void;
  /** The selected objects with every member of their groups. */
  selEls: SlideElement[];
  canEdit: boolean;
  updateSlide: (patch: Partial<Slide>) => void;
  updatePres: (patch: Partial<Presentation>) => void;
  setElements: (fn: (els: SlideElement[]) => SlideElement[]) => void;
  /** Put a new object on the slide and select it. */
  addElement: (el: SlideElement) => void;
  tool: CanvasTool | null;
  setTool: (t: CanvasTool | null) => void;
  view: ViewOptions;
  setView: (v: ViewOptions) => void;
  pane: TaskPane;
  setPane: (p: TaskPane) => void;
  /** Slide zoom (null: fit to the window). */
  zoom: number | null;
  setZoom: (z: number | null) => void;
  notesOpen: boolean;
  setNotesOpen: (on: boolean) => void;
  /** Home › Slides › Section: name a new section starting at the selected slides. */
  makeSection: () => void;
}

export const selectedEls = (els: SlideElement[], sel: string[]) => {
  const ids = expandSelection(els, sel.filter((s) => s !== SLIDE_TEXT));
  return els.filter((e) => ids.includes(e.id));
};

const RUN_KEYS = new Set(['fontSize', 'bold', 'italic', 'underline', 'color']);

let tick = 0;
onTextSelection(() => { tick++; });
/** Re-render when the selection inside the text being typed changes. */
export const useTextSelectionTick = () => useSyncExternalStore(onTextSelection, () => tick, () => 0);

/**
 * Where Home › Font / Paragraph act, as in PowerPoint: on the characters selected in the text being
 * typed (size, bold, italic, underline, colour), else on the selected text boxes and shapes, else
 * on the slide's own text.
 */
export function textTarget(ed: Ed): { value: TextFormatValue; onChange: (p: Partial<TextFormatValue>) => void; onChangeCase: (k: CaseKind) => void; onClear: () => void; label: string } | null {
  const { slide, p, theme } = ed;
  if (!slide || !p || !theme || !ed.canEdit) return null;
  const editor = activeTextEditor();
  const texty = ed.selEls.filter((e) => e.kind === 'text' || e.kind === 'shape' || e.kind === 'table' || e.kind === 'chart');
  const patchEls = (fn: (e: SlideElement) => Partial<SlideElement>) => ed.setElements((els) => els.map((e) => (texty.some((t) => t.id === e.id) ? patchElement(e, fn(e)) : e)));
  const toEl = ({ fontSize, ...rest }: Partial<TextFormatValue>): Partial<SlideElement> => ({ ...rest, ...(fontSize === undefined ? {} : { fontSize }) });

  if (texty.length) {
    const first = texty[0];
    const base = textValue(first);
    let value = base;
    if (editor && editor.hasSelection()) {
      const c = editor.current();
      value = { ...base, fontSize: c.fontSize ?? base.fontSize, bold: !!c.bold, italic: !!c.italic, underline: !!c.underline, color: (c.color ?? base.color).slice(0, 7) };
    }
    return {
      value,
      label: texty.length > 1 ? `개체 ${texty.length}개` : first.kind === 'text' ? '텍스트 상자' : '도형',
      onChange: (patch) => {
        const keys = Object.keys(patch);
        // Part of the text selected: the size, weight, slant, underline or colour go to those characters only.
        if (editor && editor.hasSelection() && keys.every((k) => RUN_KEYS.has(k))) {
          editor.apply({ ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}), ...(patch.bold !== undefined ? { bold: patch.bold } : {}), ...(patch.italic !== undefined ? { italic: patch.italic } : {}), ...(patch.underline !== undefined ? { underline: patch.underline || undefined } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) });
          return;
        }
        patchEls(() => toEl(patch));
      },
      onChangeCase: (k) => patchEls((e) => ({ text: changeCase(e.text ?? '', k) })),
      onClear: () => patchEls(() => CLEAR_TEXT_FORMAT),
    };
  }
  const t = slideTheme(theme, slide);
  const st = slide.style ?? {};
  const setStyle = (patch: SlideStyle) => {
    const next: SlideStyle = { ...st, ...patch };
    for (const k of Object.keys(next) as (keyof SlideStyle)[]) if (next[k] === undefined || next[k] === theme[k as keyof Theme]) delete next[k];
    ed.updateSlide({ style: Object.keys(next).length ? next : undefined, ...(patch.fontSize !== undefined ? { maximizeFont: false, preferredFontSize: undefined } : {}) });
  };
  // A slide whose words are all in text boxes formats those boxes.
  const boxes = ed.elements.filter((e) => e.kind === 'text');
  if (!slide.text.trim() && !slide.title && !slide.subtext && boxes.length) {
    const patchAll = (fn: (e: SlideElement) => Partial<SlideElement>) => ed.setElements((els) => els.map((e) => (e.kind === 'text' ? patchElement(e, fn(e)) : e)));
    return {
      value: textValue(boxes[0]), label: '모든 텍스트 상자',
      onChange: (patch) => patchAll(() => toEl(patch)),
      onChangeCase: (k) => patchAll((e) => ({ text: changeCase(e.text ?? '', k) })),
      onClear: () => patchAll(() => CLEAR_TEXT_FORMAT),
    };
  }
  return {
    label: '슬라이드 텍스트',
    value: {
      fontFamily: t.fontFamily, fontSize: t.fontSize, bold: t.fontWeight >= 700, italic: !!t.italic, underline: !!t.underline,
      strike: !!t.strike, shadow: t.shadow, letterSpacing: t.letterSpacing ?? 0, color: t.color, highlight: t.highlight,
      align: t.align, vAlign: t.vAlign, lineHeight: t.lineHeight, list: t.list, indent: t.indent ?? 0, columns: t.columns ?? 1,
      vertical: !!t.vertical, autoFit: t.autoFit !== false,
    },
    onChange: ({ bold, ...rest }) => setStyle({ ...rest, ...(bold === undefined ? {} : { fontWeight: bold ? 700 : 400 }) }),
    onChangeCase: (k) => ed.updateSlide({ text: changeCase(slide.text, k), ...(slide.title ? { title: changeCase(slide.title, k) } : {}), ...(slide.subtext ? { subtext: changeCase(slide.subtext, k) } : {}) }),
    onClear: () => ed.updateSlide({ style: undefined, preferredFontSize: undefined }),
  };
}

export { sizeOf };
