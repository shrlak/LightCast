import { describe, expect, it } from 'vitest';
import { parsePro6, rtfToText } from '../src/domain/io/songFormats';

// DeckCraft c355c063 (craft-rtf tokenizer for RTF input), ported to the ProPresenter 6 RTF reader.
const B = '\\';
/** An RTF Unicode control word for UTF-16 unit `n`. */
const u = (n: number) => `${B}u${n}`;
const FIRST = 52395, LINE = 51460, GA = 44032;

describe('rtfToText', () => {
  it('reads Unicode control words as Hangul and skips their uc fallback', () => {
    expect(rtfToText(`{${B}rtf1${B}ansi{${B}fonttbl{${B}f0 Arial;}}${B}f0 ${u(FIRST)}?${u(LINE)}? ${B}uc2${u(LINE)}${B}'c1${B}'d6 end}`)).toBe('첫줄 줄 end');
  });

  it('counts a hex escape or a control symbol as one fallback character and stops the skip at a group boundary', () => {
    expect(rtfToText(`{${B}rtf1 ${u(GA)}${B}'3f A}`)).toBe('가 A');
    expect(rtfToText(`{${B}rtf1 ${B}uc3${u(GA)}{x}yz}`)).toBe('가xyz');
    expect(rtfToText(`{${B}rtf1 ${u(GA)}${B}{B}`)).toBe('가B');
  });

  it('reads negative UTF-16 values, surrogate pairs and uc0', () => {
    expect(rtfToText(`{${B}rtf1${B}uc0 ${u(-10179)}${u(-8704)} ${u(-21504)}}`)).toBe('😀가');
  });

  it('skips starred destinations anywhere and decodes cp1252', () => {
    expect(rtfToText(`{${B}rtf1 {${B}*${B}generator Cocoa;}{${B}stylesheet{${B}s1 heading 1;}}Caf${B}'e9 ${B}'93hi${B}'94${B}par next${B}line line}`)).toBe('Café “hi”\nnext\nline');
  });

  it('keeps escaped braces and backslashes', () => {
    expect(rtfToText(`{${B}rtf1 a${B}${B}b ${B}{c${B}}}`)).toBe(`a${B}b {c}`);
  });

  it('reads Hangul RTFData from a ProPresenter 6 slide without PlainText', () => {
    const rtf = `{${B}rtf1${B}ansi${B}ansicpg949${B}uc1{${B}fonttbl{${B}f0 Malgun Gothic;}}${B}f0 ${u(FIRST)}?${u(LINE)}?${B}par Second}`;
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(rtf)));
    const xml = `<RVPresentationDocument CCLISongTitle="T"><RVSlideGrouping name="Verse 1"><RVDisplaySlide><NSString rvXMLIvarName="RTFData">${b64}</NSString></RVDisplaySlide></RVSlideGrouping></RVPresentationDocument>`;
    expect(parsePro6(xml, 'x').slides).toEqual([{ group: 'Verse 1', text: '첫줄\nSecond' }]);
  });
});
