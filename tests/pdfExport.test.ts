import { describe, expect, it } from 'vitest';
import { pdfFileName } from '../src/domain/io/pdfName';

describe('pdfFileName', () => {
  it('names the file after the presentation and what was exported', () => {
    expect(pdfFileName('주일예배', 'slides')).toBe('주일예배.pdf');
    expect(pdfFileName('주일예배', 'handout')).toBe('주일예배 유인물.pdf');
    expect(pdfFileName('주일예배', 'notes')).toBe('주일예배 노트.pdf');
  });
  it('drops characters a file name cannot hold and falls back when nothing is left', () => {
    expect(pdfFileName('a/b:c*?', 'slides')).toBe('a b c.pdf');
    expect(pdfFileName('  ', 'notes')).toBe('LightCast 노트.pdf');
    expect(pdfFileName(undefined, 'slides')).toBe('LightCast.pdf');
  });
});
