import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Presentation, Slide } from '../src/domain/types';
import { spellCheck, spellLoaded, spellSuggest } from '../src/engine';
import { KO_RULES, koFix, koMisspellings } from '../src/domain/koSpelling';
import { changeWord, dictionaryReady, installDictionary, isMisspelled, misspellings, suggestionsFor } from '../src/domain/spelling';

const file = (name: string) => readFileSync(fileURLToPath(new URL(`../public/dict/${name}`, import.meta.url)), 'utf8');
installDictionary('en_US', file('en_US.aff'), file('en_US.dic'));

const s = (id: string, more: Partial<Slide> = {}): Slide => ({ id, group: 'G', text: '', ...more });
const pres = (slides: Slide[]): Presentation => ({ id: 'p', title: 'P', themeId: 't', slides } as unknown as Presentation);

describe('engine spell checker with the bundled en_US dictionary', () => {
  it('is loaded', () => {
    expect(dictionaryReady('en_US')).toBe(true);
    expect(spellLoaded()).toContain('en_us');
  });
  it('accepts real words, affixed forms and capitalised sentence starts', () => {
    const good = ['Jesus', 'worship', 'Psalms', 'running', 'unhappiness', 'grace', 'receive', 'The', 'Lord', 'hallelujah', "don't", 'don’t', 'churches', 'blessed'];
    expect(spellCheck('en_US', good)).toEqual([]);
  });
  it('reports misspellings and suggests corrections', () => {
    expect(spellCheck('en_US', ['I', 'recieve', 'grace', 'teh', 'wrship'])).toEqual([1, 3, 4]);
    expect(spellSuggest('en_US', 'recieve', 5)).toContain('receive');
    expect(spellSuggest('en_US', 'Recieve', 5)).toContain('Receive');
    expect(spellSuggest('en_US', 'wrship', 5)).toContain('worship');
  });
  it('does not judge words of another script', () => {
    expect(spellCheck('en_US', ['은혜', 'благодать', 'recieve'])).toEqual([2]);
  });
  it('isMisspelled picks the checker by script and language', () => {
    expect(isMisspelled('recieve', 'en-US', undefined)).toBe(true);
    expect(isMisspelled('recieve', 'ko-KR', undefined)).toBe(true);
    expect(isMisspelled('recieve', undefined, undefined)).toBe(true);
    expect(isMisspelled('receive', 'en-US', undefined)).toBe(false);
    // Hangul is never sent to a dictionary (the rule spans judge it).
    const host = { isMisspelled: () => true, spellSuggestions: () => ['x'] };
    expect(isMisspelled('되요', 'ko-KR', host)).toBe(false);
    // French text: no bundled dictionary, so the desktop's checker (or none) decides.
    expect(isMisspelled('bonjour', 'fr-FR', undefined)).toBe(false);
    expect(isMisspelled('bonjour', 'fr-FR', host)).toBe(true);
    expect(isMisspelled('благодатъ', 'ru-RU', host)).toBe(true);
  });
});

describe('Korean misspelling rules', () => {
  it('has a good number of rules', () => {
    expect(KO_RULES.length).toBeGreaterThanOrEqual(60);
    for (const r of KO_RULES) expect(r.wrong).not.toBe(r.right);
  });
  it('finds the wrong forms with their particles and endings', () => {
    const fix = (t: string) => koMisspellings(t).map((h) => `${h.word}→${h.suggestions[0]}`);
    expect(fix('되요')).toEqual(['되요→돼요']);
    expect(fix('그건 안되요.')).toEqual(['안되요→안 돼요']);
    expect(fix('정말 되요?')).toEqual(['되요→돼요']);
    expect(fix('잘되요')).toEqual(['되요→돼요']);
    expect(fix('몇일이 지났다')).toEqual(['몇일→며칠']);
    expect(fix('몇 일 동안')).toEqual(['몇 일→며칠']);
    expect(fix('정말 어의없네')).toEqual(['어의없→어이없']);
    expect(fix('왠만하면 금새 끝나요')).toEqual(['왠만→웬만', '금새→금세']);
    expect(fix('설겆이를 할께요')).toEqual(['설겆이→설거지', '할께→할게']);
    expect(fix('먹을께')).toEqual(['을께→을게']);
    expect(fix('역활, 희안하다, 오랫만에, 일일히, 깨끗히, 곰곰히')).toEqual(['역활→역할', '희안→희한', '오랫만→오랜만', '일일히→일일이', '깨끗히→깨끗이', '곰곰히→곰곰이']);
    expect(fix('김치찌게 어떻해 바램 내노라하는 구지 웬지 됬다 뵈요 예기를')).toEqual(['김치찌게→김치찌개', '어떻해→어떡해', '바램→바람', '내노라→내로라', '구지→굳이', '웬지→왠지', '됬→됐', '뵈요→봬요', '예기→얘기']);
    expect(fix('성경귀절과 귀절')).toEqual(['성경귀절→성경 구절', '귀절→구절']);
    expect(fix('감사했읍니다')).toEqual(['읍니다→습니다']);
  });
  it('leaves right forms alone', () => {
    for (const t of ['되어요', '돼요', '왠지', '안 돼요', '며칠', '하나님께 예배드리다', '찬양대', '형제들께', '살찌게', '예기치 못한', '구지봉', '웬만하면', '이것은 문장입니다', '갑시다', '되었다', '했습니다', '할게요', '오랫동안']) {
      expect(koMisspellings(t), t).toEqual([]);
    }
  });
  it('koFix gives the fix of a whole form', () => {
    expect(koFix('되요')).toBe('돼요');
    expect(koFix('되어요')).toBeNull();
  });
});

describe('Spelling over a presentation', () => {
  const deck = pres([
    s('a', { title: 'Worship 되요', elements: [
      { id: 'b', kind: 'text', text: 'I recieve 되요 grace', x: 0, y: 0, w: 1, h: 1 },
      { id: 'q', kind: 'text', text: 'recieve 안되요', noProof: true, x: 0, y: 0, w: 1, h: 1 },
      { id: 'f', kind: 'text', text: 'bonjour mon ami', lang: 'fr-FR', x: 0, y: 0, w: 1, h: 1 },
      { id: 'k', kind: 'text', text: 'FreeCast를 써서 Psalms를 띄워요', x: 0, y: 0, w: 1, h: 1 },
    ] }),
    s('b', { text: '그건 안되요. 몇일이 지나도', lang: 'ko-KR', notes: 'teh 설겆이' }),
  ]);
  const check = (w: string, lang?: string) => isMisspelled(w, lang, undefined);
  const hits = misspellings(deck, check);
  it('finds English and Korean misspellings in reading order, skipping noProof text', () => {
    expect(hits.map((h) => `${h.slideId}:${h.field}:${h.word}`)).toEqual(['a:title:되요', 'a:el:recieve', 'a:el:되요', 'a:el:FreeCast', 'b:text:안되요', 'b:text:몇일', 'b:notes:teh', 'b:notes:설겆이']);
    expect(hits.find((h) => h.word === '안되요')?.suggestions).toEqual(['안 돼요']);
  });
  it('suggests from the dictionary, the rule, or nothing', () => {
    expect(suggestionsFor(hits[1], undefined)).toContain('receive');
    expect(suggestionsFor(hits[2], undefined)).toEqual(['돼요']);
  });
  it('changes a Korean span exactly, including one that grows a space', () => {
    const one = changeWord(deck.slides, hits[4], '안 돼요');
    expect(one[1].text).toBe('그건 안 돼요. 몇일이 지나도');
    const days = changeWord(deck.slides, hits[5], '며칠');
    expect(days[1].text).toBe('그건 안되요. 며칠이 지나도');
    const box = changeWord(deck.slides, hits[2], '돼요');
    expect(box[0].elements![0].text).toBe('I recieve 돼요 grace');
    expect(box[0].title).toBe('Worship 되요');
  });
  it('Change All changes every occurrence the rule finds (not 되어요), keeping noProof boxes', () => {
    const d = pres([s('c', { text: '되요 되어요 잘되요', elements: [{ id: 'e', kind: 'text', text: '정말 되요?', x: 0, y: 0, w: 1, h: 1, paragraphs: [{ text: '정말 되요?' }] } as never] })]);
    const h = misspellings(d, check);
    const all = changeWord(d.slides, h[0], '돼요', true);
    expect(all[0].text).toBe('돼요 되어요 잘돼요');
    expect(all[0].elements![0].text).toBe('정말 돼요?');
    expect(all[0].elements![0].paragraphs![0].text).toBe('정말 돼요?');
  });
});
