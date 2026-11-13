import { describe, expect, it } from 'vitest';
import { choseong, commandId, commandLabel, dedupeCommands, scoreText, searchCommands, withMenuCommands, type CommandEntry } from '../src/domain/commandSearch';

const e = (tab: string, group: string, label: string, keywords?: string[]): CommandEntry => ({ id: commandId(tab, group, label), label, tab, group, keywords });
const ENTRIES = [
  e('홈', '클립보드', '붙여넣기', ['paste']), e('홈', '단락', '글머리 기호'), e('홈', '단락', '번호 매기기'), e('홈', '글꼴', '굵게', ['bold']),
  e('삽입', '표', '표'), e('삽입', '이미지', '그림'), e('삽입', '텍스트', '텍스트 상자'), e('전환', '미리 보기', '미리 보기'), e('검토', '언어', '맞춤법 검사'),
];

describe('어떤 작업을 원하시나요? command search', () => {
  it('takes the leading consonants of Korean text', () => {
    expect(choseong('글머리 기호')).toBe('ㄱㅁㄹ ㄱㅎ');
    expect(choseong('Bold 굵게')).toBe('Bold ㄱㄱ');
  });

  it('finds Korean labels by prefix, inside and by initials', () => {
    expect(searchCommands(ENTRIES, '글머')[0].label).toBe('글머리 기호');
    expect(searchCommands(ENTRIES, '기호')[0].label).toBe('글머리 기호');
    expect(searchCommands(ENTRIES, 'ㄱㅁㄹ')[0].label).toBe('글머리 기호');
    expect(searchCommands(ENTRIES, 'ㅁㅊㅂ')[0].label).toBe('맞춤법 검사');
  });

  it('finds a command while its last syllable is half typed', () => {
    expect(searchCommands(ENTRIES, '글머ㄹ')[0].label).toBe('글머리 기호');
  });

  it('finds English names (keywords), ignoring case and spaces', () => {
    expect(searchCommands(ENTRIES, 'Paste')[0].label).toBe('붙여넣기');
    expect(searchCommands(ENTRIES, 'BOLD')[0].label).toBe('굵게');
    expect(searchCommands(ENTRIES, '텍스트상자')[0].label).toBe('텍스트 상자');
  });

  it('ranks a label that starts with the query above one that only contains it', () => {
    const r = searchCommands([e('홈', 'a', '가운데 표'), e('삽입', 'b', '표 삽입')], '표');
    expect(r[0].label).toBe('표 삽입');
  });

  it('can be told the tab: "삽입 표"', () => {
    expect(searchCommands(ENTRIES, '삽입 표')[0].tab).toBe('삽입');
  });

  it('returns nothing for an empty query or no match, and at most `limit`', () => {
    expect(searchCommands(ENTRIES, '  ')).toEqual([]);
    expect(searchCommands(ENTRIES, 'zzzzqq')).toEqual([]);
    expect(searchCommands(ENTRIES, '기', 1)).toHaveLength(1);
  });

  it('scores an exact label best', () => {
    expect(scoreText('굵게', '굵게')).toBeGreaterThan(scoreText('굵게 하기', '굵게'));
  });

  it('makes a button label from its text or tool tip, without shortcut and explanation', () => {
    expect(commandLabel('붙여넣기 ▾')).toBe('붙여넣기');
    expect(commandLabel('', '실행 취소 (Ctrl+Z)')).toBe('실행 취소');
    expect(commandLabel(null, '검색 — 가사 · 성경 · 광고 (Ctrl+K)')).toBe('검색');
  });

  it('lists a command that appears twice only once', () => {
    expect(dedupeCommands([e('홈', 'a', '굵게'), e('홈', 'a', '굵게'), e('홈', 'b', '굵게')])).toHaveLength(2);
  });

  it('adds 그림 글머리 기호 (a drop-down command) to the ribbon entries, once', () => {
    const all = withMenuCommands(ENTRIES);
    const hit = searchCommands(all, '그림 글머리')[0];
    expect(hit.label).toBe('그림 글머리 기호');
    expect(hit.via).toBe('글머리 기호');
    expect(withMenuCommands(all).filter((x) => x.label === '그림 글머리 기호')).toHaveLength(1);
    expect(searchCommands(all, 'picture bullet')[0].label).toBe('그림 글머리 기호');
  });
});
