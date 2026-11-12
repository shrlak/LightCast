// Insert tab rules (area: pictures-insert): date formats, equation, links, action buttons, symbols.
import { describe, expect, it } from 'vitest';
import { DATE_FORMATS, SYMBOL_GROUPS, actionButtonAction, dateFieldText, formatDateField, linkDisplay, linkPatch, linkSeed, prettyEquation } from '../src/domain/insertTools';

describe('Date & Time', () => {
  const d = new Date(2026, 9, 9, 20, 5, 7);
  it('formats Korean and English dates', () => {
    expect(formatDateField('ko1', d)).toBe('2026-10-09');
    expect(formatDateField('ko2', d)).toBe('2026년 10월 9일 금요일');
    expect(formatDateField('ko10', d)).toBe('오후 8:05');
    expect(formatDateField('en2', d)).toBe('Friday, October 9, 2026');
    expect(formatDateField('en9', d)).toBe('8:05 PM');
    expect(formatDateField('nope', d)).toBe('2026-10-09');
    expect(DATE_FORMATS.filter((f) => f.lang === 'ko')).toHaveLength(13);
  });
  it('an updating date is a field, a fixed one is its text', () => {
    expect(dateFieldText('ko1', true, d)).toBe('{date:ko1}');
    expect(dateFieldText('ko1', false, d)).toBe('2026-10-09');
  });
});

describe('Equation', () => {
  it('turns linear form into display text like DeckCraft', () => {
    expect(prettyEquation('a^2+b^2=c^2')).toBe('a²+b²=c²');
    expect(prettyEquation('x^n*y')).toBe('xⁿ·y');
    expect(prettyEquation('sqrt(2)<=pi')).toBe('√(2)≤π');
    expect(prettyEquation('a+-b != c')).toBe('a±b ≠ c');
    expect(prettyEquation('x^10')).toBe('x¹⁰');
  });
});

describe('Insert Hyperlink', () => {
  const f = { url: 'https://', email: '', subject: '', slideId: 's2', tip: '' };
  it('builds web, slide and e-mail links', () => {
    expect(linkPatch('web', { ...f, url: 'example.com', tip: ' 안내 ' })).toEqual({ href: 'https://example.com', action: undefined, tooltip: '안내' });
    expect(linkPatch('web', f)).toBeNull();
    expect(linkPatch('slide', f)).toEqual({ href: undefined, action: { kind: 'slide', slideId: 's2' }, tooltip: undefined });
    expect(linkPatch('email', { ...f, email: 'mailto:a@b.kr', subject: 'hi there' })?.href).toBe('mailto:a@b.kr?subject=hi%20there');
    expect(linkPatch('email', f)).toBeNull();
  });
  it('reads an existing link back into the dialog', () => {
    expect(linkSeed({ href: 'mailto:a@b.kr?subject=x' }).mode).toBe('email');
    expect(linkSeed({ href: 'mailto:a@b.kr?subject=x' }).subject).toBe('x');
    expect(linkSeed({ action: { kind: 'slide', slideId: 's9' } })).toMatchObject({ mode: 'slide', slideId: 's9' });
    expect(linkSeed({ href: 'https://a.kr', tooltip: 't' })).toMatchObject({ mode: 'web', url: 'https://a.kr', tip: 't' });
    expect(linkSeed(undefined).url).toBe('https://');
  });
  it('shows the address or the slide title when nothing was selected', () => {
    expect(linkDisplay('web', { url: ' https://a.kr ', email: '', slideId: '' }, [])).toBe('https://a.kr');
    expect(linkDisplay('slide', { url: '', email: '', slideId: 's' }, [{ id: 's', group: '', text: '', title: '환영' }])).toBe('환영');
    expect(linkDisplay('slide', { url: '', email: '', slideId: 's' }, [{ id: 's', group: '', text: '' }])).toBe('슬라이드 1');
  });
});

describe('Action buttons and symbols', () => {
  it('action buttons carry DeckCraft\'s default actions', () => {
    expect(actionButtonAction('actionButtonBackPrevious')).toEqual({ kind: 'prev' });
    expect(actionButtonAction('actionButtonHome')).toEqual({ kind: 'first' });
    expect(actionButtonAction('actionButtonReturn')).toEqual({ kind: 'lastViewed' });
    expect(actionButtonAction('actionButtonMovie')).toEqual({ kind: 'playMedia' });
    expect(actionButtonAction('actionButtonInformation')).toBeUndefined();
    expect(actionButtonAction('rect')).toBeUndefined();
  });
  it('the symbol dialog has DeckCraft\'s groups', () => {
    expect(SYMBOL_GROUPS.map(([g]) => g)).toEqual(expect.arrayContaining(['문장 부호', '통화', '수학', '그리스 문자', '화살표', '도형']));
    expect(SYMBOL_GROUPS.every(([, c]) => c.length > 5)).toBe(true);
  });
});
