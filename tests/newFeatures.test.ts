import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Library, Presentation, Slide } from '../src/domain/types';
import { followKey, matchScore, suggestSlide, shouldAutoAdvance } from '../src/domain/lyricFollow';
import { ccliCsv, ccliReport, incompleteRows, songsWithoutCreditLine } from '../src/domain/ccli';
import { keyDistance, keyFlowIssues, recommendSongs, songStats } from '../src/domain/songStats';
import { buildTemplatePack, importTemplatePack, parseTemplatePack } from '../src/domain/templatePack';
import { isSong } from '../src/domain/templates/fill';
import { featureEnabled, loadFeatures, setFeature } from '../src/domain/features';

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-10-25T12:00:00').getTime();
const slide = (id: string, text: string, extra: Partial<Slide> = {}): Slide => ({ id, group: 'Verse', text, ...extra });
const song = (id: string, title: string, lines: string[], meta: Presentation['meta'] = {}): Presentation => ({
  id, title, themeId: 'theme_classic', folder: 'Songs', meta, slides: lines.map((l, i) => slide(`${id}_${i}`, l)),
});
function library(songs: Presentation[], usage: Library['usage'] = [], playlistIds: string[] = []): Library {
  const lib = createSeedLibrary();
  return {
    ...lib, presentations: [...lib.presentations.filter((p) => !isSong(p)), ...songs], usage,
    playlists: [{ id: 'pl', name: '주일예배', items: playlistIds.map((p) => ({ id: `i_${p}`, presentationId: p })) }],
  };
}
const used = (p: Presentation, daysAgo: number) => ({ at: NOW - daysAgo * DAY, presentationId: p.id, title: p.title, ccli: p.meta?.ccli });

describe('가사 따라가기', () => {
  const a = song('a', '주님의 은혜', ['주님의 은혜 넘치네 내 영혼 노래하리', '이 땅에 소망 없어도 주를 찬양하리', '나의 모든 날 주께 맡기며', '끝까지 따라가리 주의 길']);
  const lib = library([a]);
  it('ignores spacing, punctuation and chord marks', () => {
    expect(followKey('[G]주님의 **은혜**, 넘치네!')).toBe('주님의은혜넘치네');
  });
  it('scores the same words high and unrelated words low', () => {
    expect(matchScore('이 땅에 소망 없어도 주를 찬양하리', a.slides[1].text)).toBeGreaterThan(0.9);
    expect(matchScore('오늘 점심은 무엇을 먹을까요', a.slides[1].text)).toBeLessThan(0.3);
    expect(matchScore('', a.slides[1].text)).toBe(0);
  });
  it('suggests the next slide once its words are sung, with an earlier tail ignored', () => {
    const heard = '주님의 은혜 넘치네 내 영혼 노래하리 이 땅에 소망 없어도 주를 찬양하리';
    const s = suggestSlide(lib, { presentationId: 'a', seq: 0 }, heard);
    expect(s).toMatchObject({ seq: 1, ahead: 1 });
    expect(s!.score).toBeGreaterThan(0.75);
  });
  it('stays quiet while the current slide is still being sung, or with too little to go on', () => {
    expect(suggestSlide(lib, { presentationId: 'a', seq: 0 }, '주님의 은혜 넘치네 내 영혼 노래하리')).toBeNull();
    expect(suggestSlide(lib, { presentationId: 'a', seq: 0 }, '이 땅에')).toBeNull();
    expect(suggestSlide(lib, null, '이 땅에 소망 없어도 주를 찬양하리')).toBeNull();
  });
  it('looks at most three slides ahead and skips disabled ones', () => {
    const far = song('f', '먼 곡', ['하나 둘 셋 넷 다섯', '여섯 일곱 여덟', '아홉 열 열하나', '열둘 열셋 열넷 열다섯', '완전히 다른 가사입니다 정말로']);
    expect(suggestSlide(library([far]), { presentationId: 'f', seq: 0 }, '완전히 다른 가사입니다 정말로')).toBeNull();
    const off = { ...a, slides: a.slides.map((s, i) => (i === 1 ? { ...s, disabled: true } : s)) };
    expect(suggestSlide(library([off]), { presentationId: 'a', seq: 0 }, '이 땅에 소망 없어도 주를 찬양하리')).toBeNull();
  });
  it('advances by itself only on a strong match to the very next slide, and not twice in a row', () => {
    const strong = { seq: 1, score: 0.9, ahead: 1 };
    expect(shouldAutoAdvance(strong, 0, 10000)).toBe(true);
    expect(shouldAutoAdvance(strong, 9000, 10000)).toBe(false);
    expect(shouldAutoAdvance({ seq: 1, score: 0.6, ahead: 1 }, 0, 10000)).toBe(false);
    expect(shouldAutoAdvance({ seq: 2, score: 0.9, ahead: 2 }, 0, 10000)).toBe(false);
    expect(shouldAutoAdvance(null, 0, 10000)).toBe(false);
  });
});

describe('CCLI 보고', () => {
  const a = song('a', '주님의 은혜', ['가사'], { ccli: '1234567', author: '김작곡', copyright: '예수전도단' });
  const b = song('b', '새 노래', ['가사'], { ccli: '7654321' });
  const lib = library([a, b], [used(a, 40), used(a, 10), used(a, 3), used(b, 3), { at: NOW - DAY, presentationId: 'p_welcome', title: 'Welcome' }]);
  it('counts songs only, most used first, within the dates', () => {
    expect(ccliReport(lib).map((r) => [r.title, r.count])).toEqual([['주님의 은혜', 3], ['새 노래', 1]]);
    expect(ccliReport(lib, '2026-10-20', '2026-10-25').map((r) => [r.title, r.count]).sort()).toEqual([['새 노래', 1], ['주님의 은혜', 1]].sort());
    expect(ccliReport(lib, '2027-01-01')).toEqual([]);
  });
  it('keeps a deleted song that the log recorded with a CCLI number', () => {
    const gone = library([], [{ at: NOW, presentationId: 'x', title: '지운 곡', ccli: '999' }]);
    expect(ccliReport(gone)).toMatchObject([{ title: '지운 곡', ccli: '999', count: 1 }]);
  });
  it('writes a CSV Excel reads, quoting commas and quotes', () => {
    const csv = ccliCsv(ccliReport(library([song('c', '곡, "특별"', ['x'], { ccli: '1' })], [used(song('c', '', []), 1)])));
    expect(csv.startsWith('﻿"곡 제목"')).toBe(true);
    expect(csv).toContain('"곡, ""특별"""');
  });
  it('lists songs missing details, and songs with details but no credit line', () => {
    expect(incompleteRows(ccliReport(lib)).map((r) => r.title)).toEqual(['새 노래']);
    expect(songsWithoutCreditLine(lib).map((p) => p.id)).toEqual(['a', 'b']);
    expect(songsWithoutCreditLine({ ...lib, presentations: lib.presentations.map((p) => ({ ...p, showCopyright: true })) })).toEqual([]);
  });
});

describe('찬양 통계와 추천', () => {
  const a = song('a', 'A곡', ['x'], { key: 'G' }), b = song('b', 'B곡', ['x'], { key: 'G' }), c = song('c', 'C곡', ['x'], { key: 'C' }), d = song('d', 'D곡', ['x'], { key: 'F#' });
  const lib = library([a, b, c, d], [used(a, 100), used(a, 90), used(a, 80), used(a, 70), used(b, 3), used(c, 60)]);
  it('counts total and recent plays and the weeks since', () => {
    const s = Object.fromEntries(songStats(lib, NOW, 8).map((x) => [x.id, x]));
    expect(s.a).toMatchObject({ total: 4, recent: 0, weeksSince: 10 });
    expect(s.b).toMatchObject({ total: 1, recent: 1, weeksSince: 0 });
    expect(s.d).toMatchObject({ total: 0, lastAt: null, weeksSince: null });
  });
  it('recommends rested favourites first, never songs sung lately or already in the set', () => {
    expect(recommendSongs(lib, NOW).map((r) => r.stat.id)).toEqual(['a', 'c', 'd']);
    expect(recommendSongs(lib, NOW, { exclude: ['a'] }).map((r) => r.stat.id)).toEqual(['c', 'd']);
    expect(recommendSongs(lib, NOW, { limit: 1 })).toHaveLength(1);
    expect(recommendSongs(lib, NOW)[2].reason).toContain('한 번도');
  });
  it('flags songs in the same key back to back and big key jumps', () => {
    expect(keyDistance('G', 'D')).toBe(5);
    expect(keyDistance('C', 'F#')).toBe(6);
    expect(keyDistance('G', 'nonsense')).toBeNull();
    const set = library([a, b, c, d], [], ['a', 'b', 'c', 'd']);
    expect(keyFlowIssues(set, 'pl').map((i) => [i.from, i.to, i.kind])).toEqual([['A곡', 'B곡', 'same'], ['C곡', 'D곡', 'far']]);
    expect(keyFlowIssues(set, 'missing')).toEqual([]);
  });
});

describe('슬라이드 템플릿 마켓 (실험 기능)', () => {
  const lib = createSeedLibrary();
  const front = lib.presentations.find((p) => p.folder === 'Templates')!;
  it('exports a pack without files that only exist on this computer', () => {
    const local: Presentation = { ...front, id: 'loc', protected: true, slides: [slide('s', 'x', { background: { kind: 'media', mediaId: 'm', mediaType: 'image' }, actions: [{ type: 'audio', mediaId: 'a' }] })] };
    const pack = buildTemplatePack({ ...lib, presentations: [...lib.presentations, local] }, ['loc'], ' 우리 교회 ', NOW);
    expect(pack.name).toBe('우리 교회');
    expect(pack.mediaDropped).toBe(1);
    expect(JSON.stringify(pack)).not.toContain('"mediaId"');
    expect(pack.presentations[0].protected).toBeUndefined();
    expect(pack.themes.map((t) => t.id)).toEqual([front.themeId]);
  });
  it('round-trips through JSON and rejects anything else', () => {
    const pack = buildTemplatePack(lib, [front.id], 'p', NOW);
    expect(parseTemplatePack(JSON.parse(JSON.stringify(pack)))).toEqual(pack);
    expect(parseTemplatePack({ kind: 'other' })).toBeNull();
    expect(parseTemplatePack({ ...pack, presentations: [] })).toBeNull();
    expect(parseTemplatePack({ ...pack, presentations: [{ id: 1 }] })).toBeNull();
    expect(parseTemplatePack(null)).toBeNull();
  });
  it('imports as new decks in their own folder and never overwrites an existing theme', () => {
    const pack = buildTemplatePack(lib, [front.id], 'p', NOW);
    const clash = { ...pack, themes: pack.themes.map((t) => ({ ...t, fontFamily: 'Other' })) };
    const same = importTemplatePack(lib, pack);
    expect(same.themes).toEqual([]);
    expect(same.presentations[0]).toMatchObject({ title: front.title, themeId: front.themeId, folder: 'Templates/가져온 템플릿' });
    expect(same.presentations[0].id).not.toBe(front.id);
    expect(same.presentations[0].slides[0].id).not.toBe(front.slides[0].id);
    const changed = importTemplatePack(lib, clash);
    expect(changed.themes).toHaveLength(1);
    expect(changed.themes[0].id).not.toBe(front.themeId);
    expect(changed.presentations[0].themeId).toBe(changed.themes[0].id);
  });
});

describe('실험 기능 스위치', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('starts off, turns on and off, and ignores junk', () => {
    const s = store();
    expect(featureEnabled('templateMarket', s)).toBe(false);
    setFeature('templateMarket', true, s);
    expect(featureEnabled('templateMarket', s)).toBe(true);
    setFeature('templateMarket', false, s);
    expect(featureEnabled('templateMarket', s)).toBe(false);
    s.setItem('freecast.features', '[1,2]');
    expect(loadFeatures(s)).toEqual({});
    s.setItem('freecast.features', 'not json');
    expect(loadFeatures(s)).toEqual({});
    s.setItem('freecast.features', '{"templateMarket":"yes","unknown":true}');
    expect(loadFeatures(s)).toEqual({});
  });
});
