import { describe, expect, it } from 'vitest';
import { applyCaption, captionExpired, captionMessage, captionText, captionUnavailableReason, emptyCaption, parseCaptionMessage, textWidth, wrapCaption, CAPTION_FADE_MS } from '../src/domain/captions';

describe('captions', () => {
  it('merges interim and final speech', () => {
    let s = applyCaption(emptyCaption(), '안녕', false, 1000);
    expect(captionText(s)).toBe('안녕');
    s = applyCaption(s, '안녕하세요', false, 1100);
    expect(captionText(s)).toBe('안녕하세요');
    s = applyCaption(s, '안녕하세요', true, 1200);
    s = applyCaption(s, '여러분', false, 1300);
    expect(captionText(s)).toBe('안녕하세요 여러분');
  });
  it('starts over after a pause', () => {
    let s = applyCaption(emptyCaption(), 'hello', true, 1000);
    expect(captionExpired(s, 1000 + CAPTION_FADE_MS - 1)).toBe(false);
    expect(captionExpired(s, 1000 + CAPTION_FADE_MS)).toBe(true);
    s = applyCaption(s, 'again', true, 1000 + CAPTION_FADE_MS + 5);
    expect(captionText(s)).toBe('again');
    expect(captionExpired(emptyCaption(), 5)).toBe(true);
  });
  it('counts Korean as double width', () => {
    expect(textWidth('가a')).toBe(3);
  });
  it('wraps and keeps the newest lines', () => {
    expect(wrapCaption('aaa bbb ccc ddd', 7, 2)).toEqual(['aaa bbb', 'ccc ddd']);
    expect(wrapCaption('aaa bbb ccc ddd eee', 7, 2)).toEqual(['ccc ddd', 'eee']);
    expect(wrapCaption('aaa bbb ccc', 7, 1)).toEqual(['ccc']);
    expect(wrapCaption('', 7, 2)).toEqual([]);
  });
  it('cuts a word wider than the line', () => {
    expect(wrapCaption('abcdefghij', 4, 5)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapCaption('가나다라마', 4, 5)).toEqual(['가나', '다라', '마']);
  });
  it('parses network messages defensively', () => {
    expect(parseCaptionMessage({ type: 'caption', off: true })).toEqual({ type: 'caption', off: true });
    expect(parseCaptionMessage({ type: 'caption', text: 5 })).toBeNull();
    expect(parseCaptionMessage(null)).toBeNull();
    expect(parseCaptionMessage({ type: 'caption', text: 'x'.repeat(900), size: 'huge', lines: 7 })).toMatchObject({ size: 'md', lines: 2, final: false });
    expect(parseCaptionMessage(captionMessage('hi', true, 'lg', 1))).toEqual({ type: 'caption', text: 'hi', final: true, size: 'lg', lines: 1 });
  });
  it('explains missing support', () => {
    expect(captionUnavailableReason(true, true)).toBeNull();
    expect(captionUnavailableReason(false, true)).toContain('데스크톱');
    expect(captionUnavailableReason(false, false)).toContain('브라우저');
  });
});
