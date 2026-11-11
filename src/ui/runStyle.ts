import type { CSSProperties } from 'react';
import type { TextRun } from '../domain/types';

/** A run's own character formatting, over its text box's (size, weight, slant, lines, colour, raised / lowered). */
export const runStyle = (r: TextRun): CSSProperties => ({
  fontSize: r.baseline ? `${r.fontSize ? r.fontSize * 0.62 : 0.62 * 100}${r.fontSize ? 'px' : '%'}` : r.fontSize,
  verticalAlign: r.baseline === 'super' ? 'super' : r.baseline === 'sub' ? 'sub' : undefined,
  fontWeight: r.bold === undefined ? undefined : r.bold ? 800 : 400,
  fontStyle: r.italic === undefined ? undefined : r.italic ? 'italic' : 'normal',
  textDecoration: [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
  color: r.color,
});
