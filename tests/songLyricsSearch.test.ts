import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { findSongLyrics, lineKind, lyricsBlock, lyricsQueries, pageLines, pageTitle, rankLyricPages, readLyricsPage } from '../server/songLyrics.mjs';

/** A Naver blog post (SmartEditor ONE): a paragraph per line, an empty one between stanzas. */
const p = (text: string) => `<p class="se-text-paragraph"><span>${text}</span></p>`;
const blogPost = (heading: string, body: string[]) => `<html><head><meta property="og:title" content="${heading}"/><title>${heading} : 네이버 블로그</title></head>
<body><div class="blog-menu">카테고리 · 이웃추가</div>
<div class="se-main-container"><div class="se-component se-text"><div class="se-module se-module-text">
${body.map((line) => p(line || '​')).join('\n')}
</div></div></div>
<div class="comment">댓글 3 · 공감 12</div></body></html>`;

const LYRICS = [
  '주 신실하심 놀라워',
  '매일 아침마다 새롭고',
  '주 크신 사랑 나를 붙드네',
  '나 주를 찬양하리',
  '',
  '후렴',
  '오 신실하신 주',
  '오 신실하신 주',
  '내 삶의 모든 순간 함께하시네',
];

describe('lyrics on the internet: reading a result page (server)', () => {
  it('searches with the 작곡자 first, then the title alone', () => {
    expect(lyricsQueries(' 주 신실하심 놀라워 ', '마커스')).toEqual(['주 신실하심 놀라워 마커스 찬양 가사', '주 신실하심 놀라워 찬양 가사']);
    expect(lyricsQueries('주 신실하심 놀라워')).toEqual(['주 신실하심 놀라워 찬양 가사']);
  });

  it('reads a blog post as lines, blank lines between stanzas kept once', () => {
    const lines = pageLines(blogPost('t', ['가사', '', '하나', '둘', '', '', '셋']));
    expect(lines).toEqual(['가사', '', '하나', '둘', '', '셋', '댓글 3 · 공감 12']);
    // Source newlines are spacing; <br><br> and &nbsp; paragraphs are empty lines; <xmp> keeps its own.
    expect(pageLines('<div>\n  하나\n  둘</div><p>&nbsp;</p><p>셋<br>넷<br><br>다섯</p><xmp>여섯\n\n일곱</xmp>')).toEqual(['하나 둘', '', '셋', '넷', '', '다섯', '여섯', '', '일곱']);
    expect(pageTitle(blogPost('[찬양 가사] 주 신실하심 놀라워 &amp; 마커스', []))).toBe('[찬양 가사] 주 신실하심 놀라워 & 마커스');
  });

  it('tells the words from the page around them', () => {
    expect(lineKind('주 신실하심 놀라워')).toBe('lyric');
    expect(lineKind('후렴')).toBe('weak');
    expect(lineKind('[1절]')).toBe('weak');
    expect(lineKind('G  D/F#  Em7  C')).toBe('chords');
    for (const noise of ['작사 작곡: 홍길동', '출처: https://x.kr', '#찬양 #가사', '찬양 가사', '댓글 3', 'Key: G · BPM 72', '이 블로그의 다른 글을 소개합니다 그리고 아주 긴 설명이 이어지는 문장입니다 정말로요 길어요']) {
      expect(lineKind(noise)).toBeNull();
    }
  });

  it('takes the block that reads like lyrics, without the title above it or the chords between', () => {
    const lines = ['찬양 가사 모음', '오늘 소개할 찬양은 마커스의 곡입니다 많이 불러주세요', '', '주 신실하심 놀라워', '', 'G D Em C', ...LYRICS, '', '작사/작곡: 누군가', '다른 이야기'];
    expect(lyricsBlock(lines, '주 신실하심 놀라워')).toEqual(LYRICS);
    // Too short to be a song.
    expect(lyricsBlock(['하나 둘', '셋 넷', '', '다섯'], '')).toEqual([]);
  });

  it('scores a page by its title, the words and the 작곡자', () => {
    const page = readLyricsPage(blogPost('[찬양 가사] 주 신실하심 놀라워 - 마커스워십', LYRICS), { url: 'https://blog.naver.com/a/1', title: '주 신실하심 놀라워', artist: '마커스' });
    expect(page).toMatchObject({ host: 'blog.naver.com', source: 'naver', lines: LYRICS });
    expect(page.score).toBeGreaterThanOrEqual(0.75);
    const other = readLyricsPage(blogPost('오늘의 묵상', ['전혀 다른 노래의 가사', '여기에 있는 줄들', '같은 제목이 아니고', '다른 곡입니다']), { url: 'https://blog.naver.com/b/2', title: '주 신실하심 놀라워', artist: '마커스' });
    expect(other.score).toBeLessThan(0.35);
    expect(readLyricsPage('<html><body><p>짧은 글</p></body></html>', { url: 'https://x.kr', title: 'x' })).toBeNull();
    // A copy of the same lyrics on another blog is kept once, at its better score.
    const ranked = rankLyricPages([{ ...page, id: 'a', score: 0.6 }, { ...page, id: 'b', score: 0.9 }, other]);
    expect(ranked.map((c: { id: string }) => c.id)).toEqual(['b']);
  });

  it('searches Naver, opens blog posts through PostView and music sites’ song pages', async () => {
    const asked: string[] = [];
    const pages: Record<string, string> = {
      'https://blog.naver.com/PostView.naver?blogId=worship&logNo=123&redirect=Dlog&widgetTypeCall=true&directAccess=false': blogPost('주 신실하심 놀라워 가사 - 마커스', LYRICS),
      'https://music.bugs.co.kr/track/1': `<html><head><title>주 신실하심 놀라워 / 마커스 - 벅스</title></head><body><div class="lyricsContainer"><xmp>${LYRICS.join('\n')}</xmp></div></body></html>`,
    };
    const get = async (url: string) => {
      asked.push(url);
      if (url.startsWith('https://search.naver.com/')) return '<a href="https://blog.naver.com/worship/123">post</a><a href="https://music.bugs.co.kr/track/1">bugs</a><a href="https://www.youtube.com/watch?v=1">video</a>';
      if (url in pages) return pages[url];
      throw new Error('not found');
    };
    const out = await findSongLyrics('주 신실하심 놀라워', '마커스', { get });
    expect(out.queries).toEqual(['주 신실하심 놀라워 마커스 찬양 가사']);
    expect(decodeURIComponent(asked[0])).toContain('주 신실하심 놀라워 마커스 찬양 가사');
    expect(asked.some((url) => url.includes('youtube'))).toBe(false);
    // Both pages print the same lyrics: one candidate.
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].lines).toEqual(LYRICS);
  });

  it('falls back to the title alone when the 작곡자 search finds nothing', async () => {
    const get = async (url: string) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      if (url.startsWith('https://search.naver.com/')) return query.includes('마커스') ? '' : '<a href="https://blog.naver.com/worship/9">post</a>';
      return blogPost('주 신실하심 놀라워 가사', LYRICS);
    };
    const out = await findSongLyrics('주 신실하심 놀라워', '마커스', { get });
    expect(out.queries).toEqual(['주 신실하심 놀라워 마커스 찬양 가사', '주 신실하심 놀라워 찬양 가사']);
    expect(out.candidates[0].lines).toEqual(LYRICS);
  });
});
