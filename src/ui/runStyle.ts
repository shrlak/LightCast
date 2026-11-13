import type { CSSProperties } from 'react';
import type { TextRun } from '../domain/types';
import { softToNewline } from '../domain/textFormat';
import { nearestWeight } from '../domain/fontWeight';

/** A run's own character formatting, over its text box's (size, weight, slant, lines, colour, raised / lowered). */
export const runStyle = (r: TextRun): CSSProperties => ({
  fontSize: r.baseline ? `${r.fontSize ? r.fontSize * 0.62 : 0.62 * 100}${r.fontSize ? 'px' : '%'}` : r.fontSize,
  verticalAlign: r.baseline === 'super' ? 'super' : r.baseline === 'sub' ? 'sub' : undefined,
  fontWeight: r.weight !== undefined ? nearestWeight(r.weight) : r.bold === undefined ? undefined : r.bold ? 800 : 400,
  fontStyle: r.italic === undefined ? undefined : r.italic ? 'italic' : 'normal',
  textDecoration: [(r.underline || r.link) && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
  // A link is drawn in the theme's hyperlink colour (set as --link-color on the text box), as PowerPoint does.
  color: r.link ? 'var(--link-color, #0563c1)' : r.color,
  fontFamily: r.fontFamily,
  backgroundColor: r.highlight,
});

/** What a run's characters draw: a soft line break (Shift+Enter, \v) is a line break inside the paragraph. */
export const runText = softToNewline;

/** The theme's hyperlink colour for text of colour `text`: PowerPoint's blue on light, a lighter blue on dark text boxes. */
export function linkColorFor(text: string | undefined, theme?: string): string {
  if (theme) return theme;
  const m = /^#?([0-9a-f]{6})/i.exec(text ?? '#ffffff');
  if (!m) return '#8ab4f8';
  const n = parseInt(m[1], 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.5 ? '#8ab4f8' : '#0563c1';
}
