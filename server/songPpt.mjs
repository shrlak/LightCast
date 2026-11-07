// /api/song-ppt/* — the song sung before the 기도회 (ahead of the Front slides) found on the internet.
// Search "<제목> ppt" on Naver, open the top results (mostly Naver blog posts, whose attached files
// are listed in the page), and return the PowerPoint files whose names match the title best.
// The app then downloads the chosen file through /api/song-ppt/file and keeps only its sheet-music
// pictures on a white background (src/domain/sunday/openingSong.ts).
//
// The browser cannot read these sites itself (no CORS), so this local server does. It only answers
// this computer, only downloads files a search of its own returned, and never reaches private addresses.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PAGE_LIMIT = 3 * 1024 * 1024;
const FILE_LIMIT = 80 * 1024 * 1024;
const PAGE_TIMEOUT = 12_000;
const FILE_TIMEOUT = 90_000;
/** Result pages opened per search. */
const RESULT_PAGES = 10;

const SEARCH_URLS = (q) => [
  `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(q)}`,
];

export const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const PPT_NAME = /\.(pptx?|pps[xm]?)$/i;
const formatOf = (name) => (/\.pptx$|\.ppsx$/i.test(name) ? 'pptx' : 'ppt');

/** Hosts of search-engine furniture (menus, ads, maps…), never a result. */
const NOT_RESULTS = /(^|\.)(search\.naver\.com|help\.naver\.com|nid\.naver\.com|keep\.naver\.com|dict\.naver\.com|map\.naver\.com|shopping\.naver\.com|search\.shopping\.naver\.com|mkt\.naver\.com|ader\.naver\.com|adcr\.naver\.com|navercorp\.com|pstatic\.net|youtube\.com|youtu\.be|music\.bugs\.co\.kr|melon\.com|genie\.co\.kr|www\.naver\.com|naver\.com)$/i;

/**
 * Result links of a search page, in the order shown, without the engine's own menus and sites' home pages.
 * `keep` names hosts that are results here although they are furniture elsewhere (music sites, for lyrics).
 */
export function resultLinks(html, { keep } = {}) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    let url;
    try {
      url = new URL(decodeEntities(m[1]));
    } catch {
      continue;
    }
    if (/^(m\.)?blog\.naver\.com$/i.test(url.hostname)) {
      // A blog's front page is the "source" line above a result; only posts are results.
      if (!naverBlogPost(url.href)) continue;
    } else if (NOT_RESULTS.test(url.hostname) && !PPT_NAME.test(url.pathname) && !keep?.test(url.hostname)) continue;
    // A site's home page is the "source" line above a result, not the result.
    if (!url.search && /^\/([\w-]+\/)?$/.test(url.pathname)) continue;
    const key = url.href;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** blogId / logNo of a Naver blog post address, or null. */
export function naverBlogPost(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/^(m\.)?blog\.naver\.com$/.test(url.hostname)) return null;
  const path = /^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/.exec(url.pathname);
  if (path) return { blogId: path[1], logNo: path[2] };
  const blogId = url.searchParams.get('blogId');
  const logNo = url.searchParams.get('logNo');
  return blogId && logNo && /^\d+$/.test(logNo) ? { blogId, logNo } : null;
}

/** Files attached to a Naver blog post (PostView page): `aPostFiles[n] = JSON.parse('[{…}]')`. */
export function naverAttachments(html) {
  const files = [];
  for (const block of html.matchAll(/aPostFiles\[\d+\]\s*=\s*JSON\.parse\('([\s\S]*?)'(?:\.replace|\))/g)) {
    for (const obj of block[1].matchAll(/\{[^{}]*\}/g)) {
      const name = /"encodedAttachFileName"\s*:\s*"([^"]*)"/.exec(obj[0])?.[1];
      const url = /"encodedAttachFileUrl"\s*:\s*"([^"]*)"/.exec(obj[0])?.[1];
      const clean = name && decodeEntities(name).normalize('NFC');
      if (clean && url && /^https:\/\//.test(url) && PPT_NAME.test(clean)) files.push({ name: clean, url });
    }
  }
  return files;
}

const fileNameOf = (url) => {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    return last.normalize('NFC');
  } catch {
    return '';
  }
};

/**
 * PowerPoint links on any page: by the address (…/곡.pptx) or by the link text (게시판 첨부파일 “곡.ppt”).
 * `byText: false` (a search page, whose result titles often end in "ppt") takes addresses only.
 */
export function pageAttachments(html, pageUrl, { byText = true } = {}) {
  const files = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    let href;
    try {
      href = new URL(decodeEntities(m[1]), pageUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/.test(href)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' '))
      .replace(/새\s*창\s*(으로\s*)?열림|첨부\s*파일|다운로드|download/gi, ' ')
      .replace(/\s*\.\s*(pptx?)\s*$/i, '.$1')
      .replace(/\s+/g, ' ')
      .trim()
      .normalize('NFC');
    const fromUrl = fileNameOf(href);
    const fileUrl = /\.(pptx?)(?=[?&#]|$)/i.test(href) || /[?&]knm=[^&]*\.pptx?/i.test(href);
    const name = PPT_NAME.test(fromUrl) ? fromUrl : byText && PPT_NAME.test(text) ? text : fileUrl ? (text || fromUrl) : null;
    if (!name) continue;
    files.push({ name: PPT_NAME.test(name) ? name : `${name}.pptx`, url: href });
  }
  return files;
}

// ---- Matching a file name to the song title -------------------------------------------------

/** Words that say nothing about which song it is: "ppt", "악보", "가사", "(G)", "455장", "[CCM]" … */
export function compactTitle(s) {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(PPT_NAME, '')
    .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/새\s*찬송가|찬송가|\d+\s*장|pptx|ppt|파워포인트|악보|가사|찬양|ccm|wide|와이드|16\s*:\s*9|4\s*:\s*3|[a-g][#b]?\s*key|[a-g][#b]?코드/g, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

const bigrams = (s) => {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const x = bigrams(a), y = bigrams(b);
  let both = 0;
  for (const [k, n] of x) both += Math.min(n, y.get(k) ?? 0);
  return (2 * both) / (a.length - 1 + b.length - 1);
}

/** 0–1: how surely a file of this name is this song. */
export function titleScore(title, fileName) {
  const t = compactTitle(title), n = compactTitle(fileName);
  if (!t || !n) return 0;
  if (n === t) return 1;
  // A longer name that holds the title may be another song ("은혜" in "하루의 은혜").
  if (n.includes(t)) return 0.55 + 0.4 * (t.length / n.length);
  if (t.includes(n) && n.length >= 2) return 0.35 + 0.35 * (n.length / t.length);
  return 0.8 * dice(t, n);
}

/** Files named like the song, best first: name match, then the result's place in the search; .pptx before .ppt (which needs PowerPoint or LibreOffice to open). */
export function rankCandidates(title, found) {
  const best = new Map();
  for (const f of found) {
    const score = titleScore(title, f.name);
    const rank = score - 0.015 * Math.min(f.rank ?? 0, 20) + (formatOf(f.name) === 'pptx' ? 0.1 : 0);
    const c = { name: f.name, url: f.url, page: f.page, format: formatOf(f.name), score: Math.round(score * 100) / 100, rank };
    const have = best.get(f.url);
    if (!have || have.rank < rank) best.set(f.url, c);
  }
  return [...best.values()].filter((c) => c.score >= 0.3).sort((a, b) => b.rank - a.rank).map(({ rank: _, ...c }) => c);
}

// ---- Fetching, only from the public internet -------------------------------------------------

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return privateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublic(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('http(s) only');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error('private address');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) throw new Error('private address');
}

/** GET with redirects checked one by one, a size cap and a timeout. */
export async function fetchPublic(href, { limit, timeout, referer }) {
  let url = new URL(href);
  const signal = AbortSignal.timeout(timeout);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5', ...(referer ? { referer } : {}) } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > limit) throw new Error('too large');
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > limit) throw new Error('too large');
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks), url: url.href, type: res.headers.get('content-type') ?? '' };
  }
  throw new Error('too many redirects');
}

export const fetchText = async (href, referer) => (await fetchPublic(href, { limit: PAGE_LIMIT, timeout: PAGE_TIMEOUT, referer })).body.toString('utf8');

/** Attachments of one result page (a Naver blog post is read through its PostView page). */
async function attachmentsOf(page, get) {
  const post = naverBlogPost(page);
  if (post) {
    const html = await get(`https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(post.blogId)}&logNo=${post.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false`, 'https://blog.naver.com/');
    return naverAttachments(html);
  }
  if (PPT_NAME.test(fileNameOf(page))) return [{ name: fileNameOf(page), url: page }];
  return pageAttachments(await get(page), page);
}

/** Recently found files: the download route only fetches these. */
const known = new Map();
const remember = (c) => {
  known.set(c.url, { page: c.page, at: Date.now() });
  if (known.size > 500) known.delete(known.keys().next().value);
};

/**
 * Search "<title> ppt" and collect PowerPoint files from the top results, best match first.
 * `get(url, referer)` → page HTML (injected in tests).
 */
export async function findSongPpt(title, { get = fetchText, pages = RESULT_PAGES } = {}) {
  const query = `${title.trim()} ppt`;
  const found = [];
  const visited = new Set();
  let rank = 0;
  for (const searchUrl of SEARCH_URLS(query)) {
    const html = await get(searchUrl).catch(() => '');
    // A result may itself be the file (a tistory attachment shown in the results).
    for (const f of pageAttachments(html, searchUrl, { byText: false })) found.push({ ...f, page: searchUrl, rank: 0 });
    const links = resultLinks(html).filter((l) => !visited.has(l)).slice(0, pages);
    links.forEach((l) => visited.add(l));
    const lists = await Promise.all(links.map((l) => attachmentsOf(l, get).catch(() => [])));
    lists.forEach((files, i) => files.forEach((f) => found.push({ ...f, page: links[i], rank: rank + i })));
    rank += links.length;
    // The web results usually have it; the blog tab is searched only when they do not.
    if (rankCandidates(title, found).some((c) => c.score >= 0.75)) break;
  }
  const candidates = rankCandidates(title, found).slice(0, 12);
  candidates.forEach(remember);
  return { query, candidates };
}

/** Is this a PowerPoint file: a .pptx (zip) or an old .ppt (OLE compound file)? */
export function pptKind(buf) {
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'pptx';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'ppt';
  return null;
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export const loopback = (req) => {
  const ip = req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

export async function songPptMiddleware(req, res, next) {
  if (!req.url?.startsWith('/api/song-ppt/')) return next?.();
  if (req.headers['sec-fetch-site'] === 'cross-site' || !loopback(req)) return send(res, 403, { error: '이 컴퓨터에서만 찾을 수 있습니다' });
  const url = new URL(req.url, 'http://local');
  const route = url.pathname.slice('/api/song-ppt/'.length);
  try {
    if (route === 'search' && req.method === 'GET') {
      const title = (url.searchParams.get('title') ?? '').trim().slice(0, 120);
      if (!title) return send(res, 400, { error: '찬양 제목을 입력해 주세요' });
      return send(res, 200, await findSongPpt(title));
    }
    if (route === 'file' && req.method === 'GET') {
      const href = url.searchParams.get('url') ?? '';
      const entry = known.get(href);
      if (!entry) return send(res, 404, { error: '검색 결과에 없는 파일입니다 — 다시 찾아 주세요' });
      const file = await fetchPublic(href, { limit: FILE_LIMIT, timeout: FILE_TIMEOUT, referer: entry.page });
      const kind = pptKind(file.body);
      if (!kind) return send(res, 415, { error: 'PowerPoint 파일이 아닙니다 (로그인이 필요한 사이트일 수 있습니다)' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-ppt-format': kind });
      return res.end(file.body);
    }
    return send(res, 404, { error: 'Unknown song-ppt route' });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    send(res, timedOut ? 504 : 502, { error: timedOut ? '인터넷 응답 시간 초과' : `인터넷에서 가져오지 못했습니다 (${err.message})` });
  }
}
