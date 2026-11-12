import type { TextRun } from '../domain/types';
import { runStyle, runText } from './runStyle';

/** A run of text with its own formatting; a link carries its address for the slide show to open on a click. */
export function RunSpan({ r }: { r: TextRun }) {
  return <span style={runStyle(r)} {...(r.link ? { 'data-link': r.link, title: r.link } : {})}>{runText(r.text)}</span>;
}
