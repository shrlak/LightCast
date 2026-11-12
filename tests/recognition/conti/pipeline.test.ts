// The 콘티 pipeline glue ported from the ppt site's LyricsGenerator (domain/recognition/conti):
// models and the web are mocked, so this pins down what LightCast does with their answers.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContiDocument } from '../../../src/domain/recognition/utils/contiPdf';
import type { ContiInfo, LibraryEntry } from '../../../src/domain/recognition/utils/types';
import type { ParsedScore } from '../../../src/domain/recognition/ai/scoreParser';
import { DEFAULT_AI_SETTINGS } from '../../../src/domain/recognition/ai/aiSettings';
import { EMPTY_MEMORY } from '../../../src/domain/recognition/learning/onlineLearning';

const batch = vi.hoisted(() => ({ titles: [] as ParsedScore[], lyrics: [] as ParsedScore[], calls: [] as { mode: string; images: string[]; hints?: (string | undefined)[] }[] }));
vi.mock('../../../src/domain/recognition/ai/adaptiveRecognition', () => ({
  recognizeAdaptiveBatch: async (images: string[], _s: unknown, mode: 'titles' | 'full', hints?: (string | undefined)[]) => {
    batch.calls.push({ mode, images, hints });
    const scores = (mode === 'titles' ? batch.titles : batch.lyrics).slice(0, images.length);
    while (scores.length < images.length) scores.push({ order: [], sections: [] });
    return { scores, engine: 'gemini', observations: scores.map(() => []), confidence: scores.map(() => 0.9), titleConfidence: scores.map(() => 1), needsReview: scores.map(() => false), exhaustedModels: [] };
  },
}));
// No web lookups in tests: the 악보's reading is settled as read (normalized).
vi.mock('../../../src/domain/recognition/lyrics/webLyrics', async (load) => ({
  ...(await load<typeof import('../../../src/domain/recognition/lyrics/webLyrics')>()),
  hasWebLyricsLookup: () => false,
}));

const { startContiJob } = await import('../../../src/domain/recognition/conti/contiSongs');
const { recognizeSongs } = await import('../../../src/domain/recognition/conti/recognizeSongs');
const { songToDraft, parseContiDate } = await import('../../../src/domain/recognition/conti/index');
const { acceptedDrafts, reviewNote } = await import('../../../src/ui/ppt/contiReview');

function fakeDoc(info: ContiInfo, musicPages: number[]): ContiDocument {
  return {
    parsed: { info, numPages: 10, pageTexts: Array(10).fill(''), musicPages },
    renderPage: async (page: number) => `data:image/png;base64,page${page}`,
    destroy: () => undefined,
  };
}

const saved: LibraryEntry = { title: '주를 찾는 모든 자들이', key: 'E', sections: [{ label: 'V', lines: ['주를 찾는 모든 자들이'] }, { label: 'C', lines: ['주는 나의 도움'] }], order: ['V', 'C'], verification: 'verified' };
const settings = { ...DEFAULT_AI_SETTINGS, postSermonSong: '', excludedTitles: ['예배 전 준비 찬양'] };
const opts = { linesPerSlide: 4, confessionSong: '우리는 주의 움직이는 교회', notify: () => undefined, changed: () => undefined };

beforeEach(() => {
  batch.titles = [];
  batch.lyrics = [];
  batch.calls = [];
});

describe('startContiJob (the site’s handleFile, Sunday)', () => {
  const cover: ContiInfo = {
    date: '2026.10.18',
    songs: [
      { title: '주를 찾는 모든 자들이', key: 'E', order: ['V', 'V', 'C', 'V', 'C', 'C'], pageIndex: 4 },
      { title: '임재', key: 'G', pageIndex: 5 },
      { title: '우리는 주의 움직이는 교회', pageIndex: 6 },
      { title: '영접송', pageIndex: 7 },
    ],
  };

  it('loads a library title at once, in the 진행 the conti wrote', () => {
    const job = startContiJob(fakeDoc(cover, [4, 5, 6, 7, 8]), [saved], settings, opts);
    const first = job.songs[0];
    expect(first.title).toBe('주를 찾는 모든 자들이');
    expect(first.order).toEqual(['V', 'V', 'C', 'V', 'C', 'C']);
    expect(first.orderFromConti).toBe(true);
    expect(first.sections.map((s) => s.label)).toEqual(['V', 'C']);
    expect(job.outcomes.get(first.id)).toEqual({ status: 'done', engine: 'library' });
    expect(job.sources.get(first.id)).toBe('library');
  });

  it('sets the 공동체 고백송 apart and sings the song after it after the sermon', () => {
    const job = startContiJob(fakeDoc(cover, [4, 5, 6, 7, 8]), [saved], settings, opts);
    expect(job.songs.map((s) => s.title)).toEqual(['주를 찾는 모든 자들이', '임재', '영접송']);
    expect(job.songs[2].postSermon).toBe(true);
    // The 고백송's page is nobody's, and p.8 is no listed song's: it is only read for its title.
    expect(job.spares).toEqual([8]);
    expect(job.listedOrder).toBe(true);
  });

  it('leaves out a song on the exclusion list', () => {
    const job = startContiJob(fakeDoc({ songs: [{ title: '예배 전 준비 찬양', pageIndex: 4 }, { title: '임재', pageIndex: 5 }] }, [4, 5]), [], settings, opts);
    expect(job.songs.map((s) => s.title)).toEqual(['임재']);
  });
});

describe('recognizeSongs (the site’s recognizeSongsBatch)', () => {
  const cover: ContiInfo = { songs: [{ title: '임재', key: 'G', pageIndex: 4 }, { title: '새 노래', pageIndex: 5 }] };

  it('pairs pages by the titles read off them, then reads only the pages the library cannot answer', async () => {
    // p.4 prints 새 노래, p.5 prints 임재 (the cover listed them the other way round).
    batch.titles = [{ pageType: 'score', title: '새 노래', order: [], sections: [] }, { pageType: 'score', title: '임재', order: [], sections: [] }];
    batch.lyrics = [{ pageType: 'score', title: '새 노래', order: ['I', 'V', 'C'], sections: [{ label: 'V', lines: ['새 노래로 주께 노래해'] }, { label: 'C', lines: ['할렐루야'] }] }];
    const library: LibraryEntry[] = [{ title: '임재', sections: [{ label: 'V1', lines: ['하늘의 문을 여소서'] }], order: ['I', 'V1'], verification: 'verified' }];
    const job = startContiJob(fakeDoc(cover, [4, 5]), library, settings, opts);
    await recognizeSongs(job, job.songs, { settings, reliabilities: [], memory: EMPTY_MEMORY });

    const [imjae, newSong] = job.songs;
    expect(imjae.pageIndex).toBe(5);
    expect(imjae.sections[0].lines).toEqual(['하늘의 문을 여소서']);
    expect(job.sources.get(imjae.id)).toBe('library');
    expect(newSong.pageIndex).toBe(4);
    expect(newSong.order).toEqual(['I', 'V', 'C']);
    expect(newSong.sections.map((s) => s.label)).toEqual(['V', 'C']);
    expect(job.sources.get(newSong.id)).toBe('models');
    // Only the unanswered page went to the lyrics pass, hinted with the cover's title.
    const lyricsCall = batch.calls.find((c) => c.mode === 'full');
    expect(lyricsCall?.images).toEqual(['data:image/png;base64,page4']);
    expect(lyricsCall?.hints).toEqual(['새 노래']);
  });

  it('drops a page the models found to be no 악보, keeping its sermon info', async () => {
    batch.titles = [{ pageType: 'non_score', sermonTitle: '주의 이름을 부르는 자', order: [], sections: [] }, { pageType: 'score', title: '임재', order: [], sections: [] }];
    const library: LibraryEntry[] = [{ title: '임재', sections: [{ label: 'V', lines: ['하늘의 문을 여소서'] }], order: [], verification: 'verified' }];
    const job = startContiJob(fakeDoc({ songs: [] }, [4, 5]), library, settings, opts);
    expect(job.songs).toHaveLength(2);
    await recognizeSongs(job, job.songs, { settings, reliabilities: [], memory: EMPTY_MEMORY });
    expect(job.songs.map((s) => s.title)).toEqual(['임재']);
    expect(job.info.sermonTitle).toBe('주의 이름을 부르는 자');
  });

  it('says why a song could not be read when neither the batch nor the rescue read it', async () => {
    batch.titles = [{ pageType: 'score', order: [], sections: [] }];
    const job = startContiJob(fakeDoc({ songs: [] }, [4]), [], settings, opts);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 400 }));
    await recognizeSongs(job, job.songs, { settings: { ...settings, attempts: [] }, reliabilities: [], memory: EMPTY_MEMORY });
    vi.unstubAllGlobals();
    expect(job.outcomes.get(job.songs[0].id)?.status).toBe('error');
  });
});

describe('drafts and review', () => {
  it('turns a recognized song into a SongDraft, without an instrumental-only 진행', () => {
    const song = { id: 'a', title: ' 임재 ', key: 'G', sections: [{ label: 'V1', lines: ['하늘의 문을 여소서'] }], order: ['I', 'V1'], linesPerSlide: 4, pageIndex: 5, extraPages: [6], postSermon: true };
    expect(songToDraft(song)).toEqual({ title: '임재', key: 'G', sections: [{ label: 'V1', lines: ['하늘의 문을 여소서'] }], progression: ['I', 'V1'], postSermon: true, pages: [5, 6] });
    expect(songToDraft({ ...song, order: ['I'] }).progression).toBeUndefined();
  });

  it('reads the dates a cover or a file name writes', () => {
    expect(parseContiDate('2026.10.18')).toEqual({ year: 2026, month: 10, day: 18 });
    expect(parseContiDate('10/18/26')).toEqual({ year: 2026, month: 10, day: 18 });
    expect(parseContiDate(undefined)).toBeUndefined();
  });

  it('puts an unchanged library song in as the library’s own, an edited one as edited, and leaves skipped ones out', () => {
    const lib = { id: '1', draft: { title: '임재', sections: [{ label: 'V', lines: ['a'] }], progression: ['I', 'V'] }, source: 'library' as const, needsReview: false, webCandidates: 0, pageImages: [] };
    const read = { id: '2', draft: { title: '새 노래', sections: [{ label: 'V', lines: ['b'] }] }, source: 'models' as const, needsReview: true, webCandidates: 0, pageImages: [] };
    const review = { reading: { sermonTitle: '', scripture: '', songs: [lib, read, { ...read, id: '3' }] }, index: 0, notes: ['note'], answers: [lib.draft, { ...read.draft, title: '새 노래 (고침)' }, null] };
    expect(acceptedDrafts(review)).toEqual([{ ...lib.draft, sections: [] }, { ...read.draft, title: '새 노래 (고침)' }]);
    const edited = { ...review, answers: [{ ...lib.draft, sections: [{ label: 'V', lines: ['a!'] }] }] };
    expect(acceptedDrafts(edited)[0].sections).toHaveLength(1);
    expect(reviewNote(lib, review)).toContain('찬양 라이브러리');
    expect(reviewNote(lib, review)).toContain('note');
    expect(reviewNote(read, { ...review, index: 1 })).toMatch(/악보와 비교/);
  });
});
