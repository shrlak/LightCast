import { describe, expect, it } from 'vitest';
import { LEGACY_POWERPOINT_FILE, POWERPOINT_FILE } from '../src/ui/importFiles';

describe('PowerPoint file names LightCast opens', () => {
  it('accepts .pptx and .ppt, and the show, macro and template variants', () => {
    for (const n of ['a.pptx', 'a.PPT', 'b.ppsx', 'b.pps', 'c.pptm', 'c.ppsm', 'd.potx', 'd.potm', 'd.pot', '찬양 1.PPTX']) expect(POWERPOINT_FILE.test(n), n).toBe(true);
  });
  it('rejects other files', () => {
    for (const n of ['a.pdf', 'a.odp', 'a.pptx.txt', 'pptx', 'a.docx', 'a.png']) expect(POWERPOINT_FILE.test(n), n).toBe(false);
  });
  it('treats only the binary formats as legacy', () => {
    for (const n of ['a.ppt', 'a.pps', 'a.POT']) expect(LEGACY_POWERPOINT_FILE.test(n), n).toBe(true);
    for (const n of ['a.pptx', 'a.ppsx', 'a.potx', 'a.pptm']) expect(LEGACY_POWERPOINT_FILE.test(n), n).toBe(false);
  });
});
