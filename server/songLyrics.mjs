// /api/song-lyrics/search — a song's lyrics found on the internet, for a 콘티 song whose 악보 the AI
// could not read the lyrics off. Search "<제목> <작곡자> 찬양 가사" on Naver (then "<제목> 찬양 가사"),
// open the top results (Naver blog posts are read through their PostView page; lyric pages of music
// sites such as Bugs, Melon and Genie too), take the block of each page that reads like lyrics, and
// return the pages most likely to be this song, best first.
//
// Nothing here decides that a page IS the song: several worship songs share a title. The app checks
// each page's lyrics against the 악보 itself (src/domain/recognition/ai/lyricsCheck.ts) before it
// uses one, and the operator sees the song again before it goes into the 예배.
//
// Same rules as the PPT search (songPpt.mjs): only this computer may ask, and only public
// addresses are ever fetched.
import { compactTitle, decodeEntities, fetchText, loopback, naverBlogPost, resultLinks, titleScore } from './songPpt.mjs';

/** Result pages opened per search. */
const RESULT_PAGES = 8;
/** Pages returned, best first. */
const MAX_CANDIDATES = 4;
/** A block needs this many lyric lines to be a song's lyrics. */
const MIN_LYRIC_LINES = 4;
/** The longest a line of lyrics runs; longer lines are prose. */
const MAX_LINE = 48;
/** No further search is started this long after the first: the app is waiting on the answer. */
const SEARCH_BUDGET_MS = 20_000;

const SEARCH_URLS = (q) => [
  `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(q)}`,
];

/** Music sites' song pages carry the lyrics: they are results here, though not for a PPT. */
const LYRIC_SITES = /(^|\.)(music\.bugs\.co\.kr|melon\.com|genie\.co\.kr)$/i;

/** What to search: with the 작곡자 when the 악보 printed one, then the title alone. */
export function lyricsQueries(title, artist) {
  const t = title.trim();
  const a = artist?.trim();
  return a ? [`${t} ${a} 찬양 가사`, `${t} 찬양 가사`] : [`${t} 찬양 가사`];
}

/** The part of a page that holds its text: a blog post's body, else the whole page. */
function mainContent(html) {
  for (const marker of [/class="[^"]*\bse-main-container\b/, /id="postViewArea"/, /id="pLyrics"/, /id="d_video_summary"/, /class="[^"]*\blyricsContainer\b/]) {
    const at = html.search(marker);
    if (at >= 0) return html.slice(html.lastIndexOf('<', at));
  }
  return html;
}

/** The page's own title: og:title, else <title>. */
export function pageTitle(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i.exec(html);
  const raw = og?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  return decodeEntities(raw).replace(/\s+/g, ' ').trim().normalize('NFC');
}

const INVISIBLE = /[\u200b-\u200d\ufeff\u00ad\u2060]/g;
const BLOCK = '\u0001';
const BREAK = '\u0002';

/**
 * A page as lines of text: a line per <br> and per paragraph, an empty paragraph (or <br><br>) an
 * empty line, runs of empty lines kept as one. Newlines in the HTML source are only spacing,
 * except inside <pre>/<xmp>, where music sites keep their lyrics.
 */
export function pageLines(html) {
  const marked = mainContent(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|head|button|select|nav|footer)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(pre|xmp)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => `${BLOCK}${inner.replace(/\r?\n/g, BREAK)}${BLOCK}`)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/<br\s*\/?>/gi, BREAK)
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section|article|dd|dt|header)\b[^>]*>/gi, BLOCK)
    .replace(/<[^>]+>/g, '');
  const text = decodeEntities(marked.replace(/&nbsp;/gi, '\u00a0'));
  const out = [];
  for (const segment of text.split(BLOCK)) {
    // Only the spacing between two tags: no paragraph there.
    if (/^[ \f]*$/.test(segment)) continue;
    for (const raw of segment.split(BREAK)) {
      const line = raw.replace(INVISIBLE, '').replace(/[\s\u3000]+/g, ' ').trim().normalize('NFC');
      if (!line && (!out.length || out[out.length - 1] === '')) continue;
      out.push(line);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** A line that is only a part heading: "1절", "[후렴]", "Verse 2:", "C", "PC". */
const HEADING = /^[[(<{【]?\s*(\d\s*절|절|후렴구?|간주|전주|후주|브릿지|브리지|프리\s*코러스|verse|chorus|bridge|pre[- ]?chorus|intro|outro|refrain|tag|v\d?|c\d?|b\d?|pc\d?)\s*\d{0,2}\s*[\])>}】]?\s*[:.]?\s*$/i;

/** Lines on a page that are about the song or the site, never its words. */
const NOISE = /https?:|www\.|\.com\b|\.kr\b|작사|작곡|편곡|출처|저작권|copyright|ⓒ|©|공감하기|공감\s*\d|댓글|구독|이웃추가|서로이웃|블로그|카테고리|태그|#|\bkey\b|bpm|tempo|템포|악보|다운로드|ppt|mp3|ccli|이미지|동영상|youtube|유튜브|광고|로그인|검색|메뉴|더보기|공유하기|신고하기|다음글|이전글|글쓰기|좋아요\s*\d|조회수|재생목록|앨범|발매|장르|전체듣기|바로가기/i;

/** A line of chords alone ("G  D/F#  Em7  C"), printed above the words on a chord sheet. */
const CHORDS = /^(?:[A-G](?:#|b)?(?:maj|min|m|sus|dim|aug|add)?\d*(?:\/[A-G](?:#|b)?)?[\s|\-]*)+$/;

/** A line that only says what follows: "가사", "[찬양 가사]", "Lyrics :". */
const LABEL_ONLY = /^[[(【<]?\s*(찬양\s*|ccm\s*)?(가사|lyrics?|원곡|곡\s*정보|정보|소개|묵상|나눔|영상|듣기)(\s*모음)?\s*[\])】>]?\s*:?$/i;

/**
 * A sentence of the post around the lyrics: "오늘 소개할 찬양은 … 곡입니다 많이 불러주세요". Lyrics
 * end lines with "합니다" too, but in short lines without a full stop.
 */
const PROSE = /(입니다|습니다|해요|에요|예요|세요|네요|군요|어요|아요|죠)[.!~,]?(\s|$)/;
const isProse = (line) => (line.length > 15 && /\.$/.test(line)) || (line.length > 20 && PROSE.test(line));

/**
 * 'lyric' (Korean words), 'weak' (a heading, or an English line inside the lyrics), 'chords' (a
 * chord line, passed over) or null (anything else, which ends a block of lyrics).
 */
export function lineKind(line) {
  if (!line || line.length > MAX_LINE) return null;
  if (HEADING.test(line)) return 'weak';
  if (CHORDS.test(line)) return 'chords';
  if (NOISE.test(line) || LABEL_ONLY.test(line) || isProse(line)) return null;
  const hangul = (line.match(/[가-힣]/g) ?? []).length;
  const letters = (line.match(/\p{L}/gu) ?? []).length;
  if (hangul >= 2 && hangul >= letters * 0.5) return 'lyric';
  if (letters >= 6 && /^[A-Za-z][A-Za-z ,.'’!?()-]*$/.test(line)) return 'weak';
  return null;
}

/**
 * The block of a page that reads like a song's lyrics: the longest run of lyric lines (blank lines
 * and headings may sit between them, anything else ends the run). The song's title printed above
 * its lyrics, set apart by a blank line, is not one of them.
 */
export function lyricsBlock(lines, title = '') {
  let best = null;
  let current = null;
  const close = () => {
    if (current && current.lyric >= MIN_LYRIC_LINES && (!best || current.lyric > best.lyric)) best = current;
    current = null;
  };
  for (const line of lines) {
    const kind = line === '' ? 'blank' : lineKind(line);
    if (kind === 'chords') continue;
    if (!kind) {
      close();
      continue;
    }
    if (!current) {
      if (kind === 'blank') continue;
      current = { lines: [], lyric: 0 };
    }
    current.lines.push(line);
    if (kind === 'lyric') current.lyric += 1;
  }
  close();
  if (!best) return [];
  const out = [...best.lines];
  const trim = () => {
    while (out.length && (out[0] === '' || (lineKind(out[0]) === 'weak' && !HEADING.test(out[0])))) out.shift();
    while (out.length && (out[out.length - 1] === '' || lineKind(out[out.length - 1]) === 'weak')) out.pop();
  };
  trim();
  if (title && out.length > 2 && out[1] === '' && titleScore(title, out[0]) >= 0.75) {
    out.shift();
    trim();
  }
  return out;
}

const compact = (s) => compactTitle(s ?? '');

/** 0–1: how likely this page is the song's lyrics, from its title, the words around them and the 작곡자. */
export function pageScore({ title, artist, pageTitle: heading, text, lyrics }) {
  const t = compact(title);
  const byHeading = heading ? titleScore(title, heading) : 0;
  const inText = t.length >= 2 && compact(text).includes(t) ? 0.7 : 0;
  const inLyrics = t.length >= 2 && compact(lyrics.join('')).includes(t) ? 1 : 0;
  const a = compact(artist);
  const byArtist = a.length >= 2 && compact(`${heading} ${text}`).includes(a) ? 1 : 0;
  const score = 0.6 * Math.max(byHeading, inText) + (a ? 0.2 * byArtist + 0.2 * inLyrics : 0.4 * inLyrics);
  return Math.round(score * 100) / 100;
}

/** The lyrics of one result page with its title, or null. */
export function readLyricsPage(html, { url, title, artist }) {
  const lines = pageLines(html);
  const lyrics = lyricsBlock(lines, title);
  if (lyrics.filter((line) => lineKind(line) === 'lyric').length < MIN_LYRIC_LINES) return null;
  const heading = pageTitle(html);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^(www|m)\./, '');
    } catch {
      return '';
    }
  })();
  const score = pageScore({ title, artist, pageTitle: heading, text: lines.join(' '), lyrics });
  return { id: `search:${url}`, url, host, source: host.endsWith('naver.com') ? 'naver' : host, pageTitle: heading, lines: lyrics, score };
}

/** Two pages printing the same lyrics (blogs copy each other): kept once. */
const lyricKey = (lines) => lines.join('').replace(/[^0-9a-z가-힣]+/gi, '').slice(0, 120);

/** Pages most likely to be this song, best first; each set of lyrics once. */
export function rankLyricPages(found) {
  const byLyrics = new Map();
  for (const page of found) {
    const key = lyricKey(page.lines);
    const have = byLyrics.get(key);
    if (!have || have.score < page.score) byLyrics.set(key, page);
  }
  return [...byLyrics.values()].filter((page) => page.score >= 0.35).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

/** One result page's HTML (a Naver blog post through its PostView page, which holds the text). */
async function resultPage(link, get) {
  const post = naverBlogPost(link);
  if (post) return get(`https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(post.blogId)}&logNo=${post.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false`, 'https://blog.naver.com/');
  return get(link);
}

/**
 * Search the song's lyrics and read them off the top results.
 * `get(url, referer)` → page HTML (injected in tests).
 */
export async function findSongLyrics(title, artist, { get = fetchText, pages = RESULT_PAGES, budgetMs = SEARCH_BUDGET_MS } = {}) {
  const found = [];
  const visited = new Set();
  const queries = lyricsQueries(title, artist);
  const searched = [];
  const stopAt = Date.now() + budgetMs;
  for (const query of queries) {
    if (Date.now() > stopAt) break;
    searched.push(query);
    for (const searchUrl of SEARCH_URLS(query)) {
      if (Date.now() > stopAt) break;
      const html = await get(searchUrl).catch(() => '');
      const links = resultLinks(html, { keep: LYRIC_SITES }).filter((link) => !visited.has(link)).slice(0, pages);
      links.forEach((link) => visited.add(link));
      const read = await Promise.all(links.map(async (link) => {
        try {
          return readLyricsPage(await resultPage(link, get), { url: link, title, artist });
        } catch {
          return null;
        }
      }));
      for (const page of read) if (page) found.push(page);
      // The web results usually have it; the blog tab and the plainer query only when they do not.
      if (rankLyricPages(found).some((page) => page.score >= 0.75)) return { queries: searched, candidates: rankLyricPages(found) };
    }
  }
  return { queries: searched, candidates: rankLyricPages(found) };
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function songLyricsMiddleware(req, res, next) {
  if (!req.url?.startsWith('/api/song-lyrics/')) return next?.();
  if (req.headers['sec-fetch-site'] === 'cross-site' || !loopback(req)) return send(res, 403, { error: '이 컴퓨터에서만 찾을 수 있습니다' });
  const url = new URL(req.url, 'http://local');
  const route = url.pathname.slice('/api/song-lyrics/'.length);
  if (route !== 'search' || req.method !== 'GET') return send(res, 404, { error: 'Unknown song-lyrics route' });
  const title = (url.searchParams.get('title') ?? '').trim().slice(0, 120);
  const artist = (url.searchParams.get('artist') ?? '').trim().slice(0, 80);
  if (!title) return send(res, 400, { error: '찬양 제목을 입력해 주세요' });
  try {
    send(res, 200, await findSongLyrics(title, artist));
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    send(res, timedOut ? 504 : 502, { error: timedOut ? '인터넷 응답 시간 초과' : `인터넷에서 가져오지 못했습니다 (${err.message})` });
  }
}
