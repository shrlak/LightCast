// A 콘티 song whose 악보 gave no lyrics: searched on the internet by title and 작곡자, and the
// lyrics found checked against the 악보 before they go in (webPass + lyricsCheck).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContiDocument } from '../../../src/domain/recognition/utils/contiPdf';
import type { ContiInfo } from '../../../src/domain/recognition/utils/types';
import type { ParsedScore } from '../../../src/domain/recognition/ai/scoreParser';
import { DEFAULT_AI_SETTINGS } from '../../../src/domain/recognition/ai/aiSettings';
import { startContiJob } from '../../../src/domain/recognition/conti/contiSongs';
import { RecognitionRun } from '../../../src/domain/recognition/conti/songOutcomes';
import { runWebLyricsPass, type CheckAgainstScore } from '../../../src/domain/recognition/conti/webPass';
import { reviewNote } from '../../../src/ui/ppt/contiReview';
import type { RecognizedSong } from '../../../src/domain/recognition/conti';

const TITLE = '주 신실하심 놀라워';
const RIGHT = ['주 신실하심 놀라워', '매일 아침마다 새롭고', '주 크신 사랑 나를 붙드네', '나 주를 찬양하리', '', '후렴', '오 신실하신 주', '내 삶의 모든 순간 함께하시네'];
const OTHER = ['주 신실하심 놀라워라', '온 땅이 주를 찬양해', '하늘과 바다가 노래해', '영원히 높임 받으소서'];

function fakeDoc(info: ContiInfo, musicPages: number[]): ContiDocument {
  return {
    parsed: { info, numPages: 10, pageTexts: Array(10).fill(''), musicPages },
    renderPage: async (page: number) => `data:image/png;base64,page${page}`,
    destroy: () => undefined,
  };
}

const opts = { linesPerSlide: 4, confessionSong: '', notify: () => undefined, changed: () => undefined };

/** The shared proxy offers OTHER (unsure); this computer's search finds RIGHT on a blog. */
function stubWeb(proxyDecision: 'auto' | 'review' = 'review') {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    asked.push(input);
    if (input.startsWith('/api/recognition/lyrics?')) {
      return Response.json({ candidates: [{ id: 'proxy:1', title: TITLE, lines: OTHER, url: 'https://music.bugs.co.kr/track/9', host: 'bugs.co.kr', source: 'bugs', decision: proxyDecision, score: 0.7 }] });
    }
    if (input.startsWith('/api/song-lyrics/search?')) {
      return Response.json({ candidates: [{ id: 'search:https://blog.naver.com/a/1', url: 'https://blog.naver.com/a/1', host: 'blog.naver.com', source: 'naver', pageTitle: `${TITLE} 가사 - 마커스`, lines: RIGHT, score: 0.87 }] });
    }
    return new Response('{}', { status: 404 });
  });
  return asked;
}

function unreadSong(score: Partial<ParsedScore> = {}) {
  const messages: string[] = [];
  const job = startContiJob(fakeDoc({ songs: [{ title: TITLE, pageIndex: 4 }] }, [4]), [], DEFAULT_AI_SETTINGS, { ...opts, notify: (m) => messages.push(m) });
  const id = job.songs[0].id;
  const run = new RecognitionRun(job, [id], false);
  run.webQueue.set(id, {
    score: { title: TITLE, artist: '마커스', order: [], sections: [], ...score },
    engine: 'gemini',
    title: TITLE,
    unread: '가사를 읽지 못했습니다.',
    image: 'data:image/png;base64,page4',
  });
  return { job, id, run, messages };
}

afterEach(() => vi.unstubAllGlobals());

describe('a song whose 악보 gave no lyrics', () => {
  it('searches by title and 작곡자, and puts in the lyrics the 악보 confirms', async () => {
    const asked = stubWeb();
    const { job, id, run, messages } = unreadSong();
    const shown: string[][] = [];
    const check: CheckAgainstScore = async (entry, candidates) => {
      expect(entry.image).toBe('data:image/png;base64,page4');
      shown.push(candidates.map((c) => c.id));
      return { matchId: 'search:https://blog.naver.com/a/1', answered: 3, agreed: 2 };
    };
    await runWebLyricsPass(run, undefined, check);

    const proxy = new URLSearchParams(asked.find((u) => u.startsWith('/api/recognition/lyrics?'))!.split('?')[1]);
    expect(proxy.get('title')).toBe(TITLE);
    expect(proxy.get('artist')).toBe('마커스');
    const search = new URLSearchParams(asked.find((u) => u.startsWith('/api/song-lyrics/search?'))!.split('?')[1]);
    expect([search.get('title'), search.get('artist')]).toEqual([TITLE, '마커스']);
    // Both lookups' pages are shown to the models, the proxy's first.
    expect(shown).toEqual([['proxy:1', 'search:https://blog.naver.com/a/1']]);

    const song = job.songs[0];
    expect(song.sections.flatMap((s) => s.lines)).toEqual(RIGHT.filter((l) => l && l !== '후렴'));
    expect(song.sections.map((s) => s.label)).toEqual(['V', 'C']);
    expect(job.sources.get(id)).toBe('web');
    expect(job.webChecks.get(id)).toBe('confirmed');
    expect(job.outcomes.get(id)?.status).toBe('done');
    expect(messages.join(' ')).toContain('악보와 대조해 같은 곡임을 확인했습니다 (모델 2/3)');
  });

  it('puts nothing in when the 악보 confirms none, not even the proxy’s sure page', async () => {
    stubWeb('auto');
    const { job, id, run } = unreadSong();
    await runWebLyricsPass(run, undefined, async () => ({ matchId: null, answered: 2, agreed: 0 }));
    expect(job.songs[0].sections).toEqual([]);
    expect(job.webChecks.get(id)).toBe('unconfirmed');
    expect(job.webCandidates.get(id)?.map((c) => c.id)).toEqual(['proxy:1', 'search:https://blog.naver.com/a/1']);
    expect(job.outcomes.get(id)?.status).toBe('done');
  });

  it('falls back to the proxy’s sure page when no model could answer', async () => {
    stubWeb('auto');
    const { job, id, run } = unreadSong();
    await runWebLyricsPass(run, undefined, async () => null);
    expect(job.songs[0].sections.flatMap((s) => s.lines)).toEqual(OTHER);
    expect(job.webChecks.has(id)).toBe(false);
    expect(job.sources.get(id)).toBe('web');
  });

  it('says the song could not be read when the internet has nothing either', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ candidates: [] }));
    const { job, id, run } = unreadSong();
    await runWebLyricsPass(run, undefined, async () => { throw new Error('not asked'); });
    run.reportFailures();
    expect(job.outcomes.get(id)).toEqual({ status: 'error', message: '가사를 읽지 못했습니다. 웹에서도 가사를 찾지 못했습니다.' });
  });

  it('does not search the internet for a song whose 악보 was read', async () => {
    const asked = stubWeb();
    const { job, id, run } = unreadSong({ sections: [{ label: 'V', lines: ['주 신실하심 놀라워', '매일 아침마다 새롭고'] }] });
    await runWebLyricsPass(run, undefined, async () => { throw new Error('not asked'); });
    expect(asked.some((u) => u.startsWith('/api/song-lyrics/'))).toBe(false);
    expect(new URLSearchParams(asked[0].split('?')[1]).get('artist')).toBe('마커스');
    expect(job.sources.get(id)).toBe('models');
  });
});

describe('the review note', () => {
  const review = { reading: { sermonTitle: '', scripture: '', songs: [] }, index: 1, answers: [], notes: [] };
  const base: RecognizedSong = { id: 'a', draft: { title: TITLE, sections: [] }, needsReview: true, webCandidates: 0, pageImages: [], outcome: { status: 'done', engine: 'gemini' } };

  it('says the web’s lyrics were checked against the 악보', () => {
    const note = reviewNote({ ...base, draft: { title: TITLE, sections: [{ label: 'V', lines: ['a'] }] }, source: 'web', webCheck: 'confirmed' }, review);
    expect(note).toContain('AI가 악보와 대조해 같은 곡임을 확인했습니다');
  });

  it('points to the lyrics found when none could be confirmed', () => {
    const option = { id: 'x', host: 'blog.naver.com', url: 'https://blog.naver.com/a/1', title: TITLE, sections: [{ label: 'V', lines: ['a'] }], order: ['I', 'V'] };
    const note = reviewNote({ ...base, webCandidates: 2, webCheck: 'unconfirmed', webOptions: [option, { ...option, id: 'y' }] }, review);
    expect(note).toContain('가사를 읽지 못했습니다');
    expect(note).toContain('인터넷에서 가사 2개를 찾았지만 악보와 같은 곡인지 AI가 확인하지 못해 넣지 않았습니다');
    expect(note).toContain('‘웹에서 찾은 가사’');
  });
});
