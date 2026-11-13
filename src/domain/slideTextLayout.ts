import type { Slide, Theme } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { stripChords } from './lyrics';
import { fitTextNode, type TextLayout } from './boundedTextLayout';
import { INDENT_PX, listMarkers, writingCss } from './textFormat';
import { isFrontSlide } from './frontLayout';

export function slideTextFrame(slide: Slide, theme: Theme) {
  const qr = !!slide.qr?.length;
  const pad = slide.lyricBody && qr ? Math.max(theme.padding, 300) : theme.padding;
  // Other slides keep their full, centred text area: QR codes are drawn over it in the corner.
  const box = { x: pad, y: theme.padding, w: Math.max(1, CANVAS_W - pad * 2), h: Math.max(1, CANVAS_H - theme.padding * 2) };
  const bounds = { x: slide.lyricBody && qr ? pad : 0, y: 0, w: slide.lyricBody && qr ? box.w : CANVAS_W, h: CANVAS_H };
  return { box, bounds, noWrap: theme.noWrap ?? theme.id === 'theme_tpl_lyrics' };
}

/** Export uses the same font-first bounded layout as the on-screen slide. */
export function fitSlideText(slide: Slide, theme: Theme): TextLayout {
  theme = { ...theme, fontSize: isFrontSlide(slide) ? theme.fontSize : slide.preferredFontSize ?? theme.fontSize };
  const { box, bounds, noWrap } = slideTextFrame(slide, theme);
  if (isFrontSlide(slide) || typeof document === 'undefined' || theme.autoFit === false) return { box, fontSize: theme.fontSize, wrap: false };
  const node = document.createElement('div');
  Object.assign(node.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', fontSize: `${theme.fontSize}px`, fontFamily: theme.fontFamily,
    fontWeight: String(theme.fontWeight), fontStyle: theme.italic ? 'italic' : 'normal', lineHeight: String(theme.lineHeight), letterSpacing: `${theme.letterSpacing ?? 0}px`,
    textTransform: theme.uppercase ? 'uppercase' : 'none', whiteSpace: theme.noWrap || theme.id === 'theme_tpl_lyrics' ? 'pre' : 'pre-wrap' });
  if (theme.indent) node.style.paddingLeft = `${theme.indent * INDENT_PX}px`;
  if (theme.columns && theme.columns > 1) { node.style.columnCount = String(theme.columns); node.style.columnGap = '1.2em'; }
  Object.assign(node.style, writingCss(theme));
  const lines = (parent: HTMLElement, text: string) => {
    const content = stripChords(text).split('\n'), markers = listMarkers(content, theme.list);
    content.forEach((line, i) => {
      const child = document.createElement('div'), bold = /^\*\*(.+)\*\*$/.exec(line);
      if (markers[i]) { const marker = document.createElement('span'); marker.className = theme.list === 'picture' ? 'list-marker list-picture' : 'list-marker'; if (theme.list !== 'picture') marker.textContent = markers[i]; child.append(marker); }
      child.append(document.createTextNode(bold?.[1] ?? (line || '\u00a0'))); if (bold) child.style.fontWeight = '800'; parent.append(child);
    });
  };
  if (slide.title) { const title = document.createElement('div'); title.textContent = slide.title; Object.assign(title.style, { fontSize: `${theme.fontSize * 0.72}px`, fontWeight: '800', marginBottom: `${theme.fontSize * 0.35}px` }); node.append(title); }
  if (slide.text) lines(node, slide.text);
  if (slide.subtext) { const sub = document.createElement('div'); Object.assign(sub.style, { fontSize: `${theme.fontSize * (theme.subScale ?? 0.62)}px`, marginTop: `${theme.fontSize * 0.35}px`, fontWeight: String(Math.min(theme.fontWeight, 500)) }); lines(sub, slide.subtext); node.append(sub); }
  document.body.append(node);
  try { return fitTextNode(node, box, bounds, theme.align, theme.vAlign, noWrap); } finally { node.remove(); }
}
