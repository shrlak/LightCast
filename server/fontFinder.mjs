// /api/fonts/* — a font a presentation uses but this computer does not have, found on the internet and downloaded.
// The catalogue is Fontsource's list of free fonts (Google Fonts and other open-licence families), plus a few Korean
// families published elsewhere (Pretendard). A deck's font name is matched against it by name ("NanumMyeongjo",
// "나눔명조", "Noto Sans KR Bold" all find Nanum Myeongjo / Noto Sans KR). Google families are downloaded as whole TTF
// files from the Google Fonts CSS API (every Hangul glyph in one file, not the browser's slices); the others from the
// jsDelivr CDN. The app keeps the file like an imported font, so every window and — through the church cloud —
// every computer draws in it (src/domain/webFonts.ts).
//
// Only fonts the catalogue names are downloaded, only from the font hosts below, and never more than FILE_LIMIT.

const UA = 'LightCast font finder';
const CATALOG_URL = 'https://api.fontsource.org/v1/fonts';
const GOOGLE_CSS = 'https://fonts.googleapis.com/css2';
const FONTSOURCE_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
const FILE_HOSTS = new Set(['fonts.gstatic.com', 'cdn.jsdelivr.net']);
const FILE_LIMIT = 40 * 1024 * 1024;
const CATALOG_TTL = 12 * 60 * 60 * 1000;
const TIMEOUT = 20_000;
const FILE_TIMEOUT = 90_000;
/** Faces downloaded for one family when the deck names no weight: regular and bold, each with its italic. */
const MAX_FACES = 4;

/** Korean families published outside Fontsource / Google Fonts (open licence, files on jsDelivr's npm mirror). */
const PRETENDARD = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static';
const PRETENDARD_FACES = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
export const EXTRA_FONTS = [
  {
    id: 'pretendard', family: 'Pretendard', type: 'extra', license: 'OFL-1.1', source: 'Pretendard (GitHub orioncactus)', subsets: ['korean', 'latin'],
    weights: PRETENDARD_FACES.map(([w]) => w), styles: ['normal'],
    files: Object.fromEntries(PRETENDARD_FACES.map(([w, n]) => [`${w}-normal`, `${PRETENDARD}/Pretendard-${n}.otf`])),
  },
];

/** Korean (and other) names a deck uses for a family the catalogue lists under another name. Keys are `nameKey`s. */
const ALIASES = {
  나눔명조: 'Nanum Myeongjo', 나눔고딕: 'Nanum Gothic', 나눔고딕코딩: 'Nanum Gothic Coding',
  나눔손글씨붓: 'Nanum Brush Script', 나눔붓: 'Nanum Brush Script', nanumbrush: 'Nanum Brush Script',
  나눔손글씨펜: 'Nanum Pen Script', 나눔펜: 'Nanum Pen Script', nanumpen: 'Nanum Pen Script',
  본고딕: 'Noto Sans KR', sourcehansans: 'Noto Sans KR', sourcehansanskr: 'Noto Sans KR', sourcehansanskorean: 'Noto Sans KR',
  notosanscjkkr: 'Noto Sans KR', notosanscjk: 'Noto Sans KR', notosanskorean: 'Noto Sans KR',
  본명조: 'Noto Serif KR', sourcehanserif: 'Noto Serif KR', sourcehanserifkr: 'Noto Serif KR', sourcehanserifkorean: 'Noto Serif KR',
  notoserifcjkkr: 'Noto Serif KR', notoserifcjk: 'Noto Serif KR', notoserifkorean: 'Noto Serif KR',
  배달의민족주아: 'Jua', 배민주아: 'Jua', bmjua: 'Jua', 주아: 'Jua',
  배달의민족도현: 'Do Hyeon', 배민도현: 'Do Hyeon', bmdohyeon: 'Do Hyeon', 도현: 'Do Hyeon',
  검은고딕: 'Black Han Sans', 고운돋움: 'Gowun Dodum', 고운바탕: 'Gowun Batang', 독도: 'Dokdo', 동해독도: 'East Sea Dokdo',
  송명: 'Song Myung', 해바라기: 'Sunflower', 연성: 'Yeon Sung', 감자꽃: 'Gamja Flower', 개구: 'Gaegu', 귀여운폰트: 'Cute Font',
  하이멜로디: 'Hi Melody', 기랑해랑: 'Kirang Haerang', 가난한이야기: 'Poor Story', 싱글데이: 'Single Day', 스타일리시: 'Stylish',
  구기: 'Gugi', 함렛: 'Hahmlet', 동글: 'Dongle', 고딕a1: 'Gothic A1', 오르빗: 'Orbit', 흑백사진: 'Black And White Picture',
  베이글팻원: 'Bagel Fat One', 프리텐다드: 'Pretendard', pretendardvariable: 'Pretendard', pretendardstd: 'Pretendard',
  ibmplexsanskr: 'IBM Plex Sans KR', 아이비엠플렉스산스: 'IBM Plex Sans KR',
};

const WEIGHT_WORDS = [
  [/(hairline|thin)$/, 100], [/(extra|ultra)light$/, 200], [/light$/, 300], [/(regular|normal|book|roman)$/, 400],
  [/medium$/, 500], [/(semi|demi)bold$/, 600], [/(extra|ultra)bold$/, 800], [/bold$/, 700], [/(heavy|black)$/, 900],
];

/** A name as a lookup key: NFC, lower case, without spaces, dashes, underscores, dots and quotes. */
export const nameKey = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s_\-.'"’]+/g, '');

/**
 * A deck's font name split into the family key and the weight / italic its name says ("Noto Sans KR Bold Italic" →
 * notosanskr, 700, italic). Trailing "OTF" / "TTF" / "Std" are dropped too.
 */
export function parseFontName(name) {
  let key = nameKey(name);
  let weight = null;
  let italic = false;
  for (let changed = true; changed && key;) {
    changed = false;
    const tail = /(italic|oblique|otf|ttf|std)$/.exec(key);
    if (tail && key.length > tail[1].length + 1) {
      if (tail[1] === 'italic' || tail[1] === 'oblique') italic = true;
      key = key.slice(0, -tail[1].length);
      changed = true;
      continue;
    }
    if (weight !== null) continue;
    for (const [re, w] of WEIGHT_WORDS) {
      const m = re.exec(key);
      if (m && key.length > m[0].length + 1) { key = key.slice(0, -m[0].length); weight = w; changed = true; break; }
    }
  }
  return { key, weight, italic };
}

/** The catalogue entry a deck's font name means, or null. `catalog` is a list of { family, … } (Fontsource shape). */
export function matchFont(name, catalog) {
  const byKey = new Map();
  for (const e of [...EXTRA_FONTS, ...catalog]) if (e?.family && !byKey.has(nameKey(e.family))) byKey.set(nameKey(e.family), e);
  const look = (k) => (ALIASES[k] ? byKey.get(nameKey(ALIASES[k])) : undefined) ?? byKey.get(k);
  const whole = nameKey(name);
  const exact = look(whole);
  if (exact) return { entry: exact, weight: null, italic: false };
  const parsed = parseFontName(name);
  const entry = parsed.key && parsed.key !== whole ? look(parsed.key) : undefined;
  return entry ? { entry, weight: parsed.weight, italic: parsed.italic } : null;
}

const nearest = (list, w) => [...list].sort((a, b) => Math.abs(a - w) - Math.abs(b - w) || b - a)[0];

/** The faces to download: the weight the name asks for, else regular and bold (each with italic when the family has one). */
export function pickFaces(entry, want = {}) {
  const weights = (entry.weights ?? []).map(Number).filter((w) => w >= 1 && w <= 1000);
  if (!weights.length) return [];
  const hasItalic = (entry.styles ?? []).includes('italic');
  const out = [];
  const add = (weight, italic) => { if (!out.some((f) => f.weight === weight && f.italic === italic)) out.push({ weight, italic }); };
  if (want.weight) {
    const w = nearest(weights, want.weight);
    add(w, false);
    if (want.italic && hasItalic) add(w, true);
    return out;
  }
  for (const w of [nearest(weights, 400), nearest(weights, 700)]) { add(w, false); if (hasItalic) add(w, true); }
  return out.slice(0, MAX_FACES);
}

/** The @font-face rules of a Google Fonts CSS answer: weight, italic and file address of each. */
export function parseGoogleCss(css) {
  const out = [];
  for (const m of String(css).matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const url = /src:\s*url\((['"]?)(https:[^'")]+)\1\)/.exec(body)?.[2];
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
    const italic = /font-style:\s*italic/.test(body);
    if (url && weight) out.push({ weight, italic, url });
  }
  return out;
}

/** The Google Fonts CSS API address for these faces of a family (tuples sorted as the API requires). */
export function googleCssUrl(family, faces) {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  const anyItalic = faces.some((f) => f.italic);
  const spec = anyItalic
    ? `:ital,wght@${[...faces].sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight).map((f) => `${f.italic ? 1 : 0},${f.weight}`).join(';')}`
    : `:wght@${[...new Set(faces.map((f) => f.weight))].sort((a, b) => a - b).join(';')}`;
  return `${GOOGLE_CSS}?family=${fam}${spec}`;
}

/** The Fontsource CDN address of one face (non-Google families: their default subset as TTF). */
export const fontsourceUrl = (entry, face) =>
  `${FONTSOURCE_CDN}/${entry.id}@latest/${entry.defSubset ?? 'latin'}-${face.weight}-${face.italic ? 'italic' : 'normal'}.ttf`;

/** A human name for where a family comes from. */
export const sourceName = (entry) => (entry.type === 'google' ? 'Google Fonts' : entry.type === 'extra' ? entry.source : 'Fontsource');

// ── Network ────────────────────────────────────────────────────────────────────────────────────
let catalogCache = null; // { at, list }
let catalogLoading = null;

async function getText(url, timeout = TIMEOUT) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fontsource's list (kept for 12 hours; an old copy is used when the internet fails). */
export async function fontCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.list;
  catalogLoading ??= (async () => {
    try {
      const list = JSON.parse(await getText(CATALOG_URL));
      if (!Array.isArray(list)) throw new Error('bad catalogue');
      catalogCache = { at: Date.now(), list: list.filter((e) => e && typeof e.family === 'string' && typeof e.id === 'string') };
      return catalogCache.list;
    } catch (err) {
      if (catalogCache) return catalogCache.list;
      throw err;
    } finally { catalogLoading = null; }
  })();
  return catalogLoading;
}

async function download(url) {
  const host = new URL(url).hostname;
  if (!FILE_HOSTS.has(host)) throw new Error(`글꼴 서버가 아닙니다 (${host})`);
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(FILE_TIMEOUT), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!FILE_HOSTS.has(new URL(res.url || url).hostname)) throw new Error('다른 서버로 옮겨졌습니다');
  if (Number(res.headers.get('content-length')) > FILE_LIMIT) throw new Error('파일이 너무 큽니다');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > FILE_LIMIT) throw new Error('파일이 너무 큽니다');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Where each face of a match is downloaded from. */
async function faceUrls(entry, faces) {
  if (entry.type === 'extra') return faces.map((f) => ({ ...f, url: entry.files[`${f.weight}-${f.italic ? 'italic' : 'normal'}`] })).filter((f) => f.url);
  if (entry.type === 'google') {
    try {
      const rules = parseGoogleCss(await getText(googleCssUrl(entry.family, faces)));
      const found = faces.map((f) => ({ ...f, url: rules.find((r) => r.weight === f.weight && r.italic === f.italic)?.url })).filter((f) => f.url);
      if (found.length) return found;
    } catch { /* the CDN copy below */ }
    // Fontsource splits Korean / CJK families into many slices; only a family without them can come from there.
    if ((entry.subsets ?? []).some((s) => /korean|japanese|chinese/.test(s))) return [];
  }
  return faces.map((f) => ({ ...f, url: fontsourceUrl(entry, f) }));
}

/** Find a deck's font on the internet: the family, licence and the faces that would be downloaded. */
export async function findFont(name) {
  const m = matchFont(name, await fontCatalog());
  if (!m) return { query: name, match: null, reason: '무료 글꼴 목록(Google Fonts · Fontsource)에 없는 글꼴입니다. 상용 글꼴이면 직접 구해 가져와 주세요.' };
  const faces = pickFaces(m.entry, m);
  if (!faces.length) return { query: name, match: null, reason: '받을 수 있는 파일이 없습니다.' };
  return {
    query: name,
    match: { family: m.entry.family, source: sourceName(m.entry), license: m.entry.license ?? '', category: m.entry.category ?? '', faces },
  };
}

/** One face of a deck's font as file bytes. */
export async function fontFile(name, weight, italic) {
  const m = matchFont(name, await fontCatalog());
  if (!m) throw Object.assign(new Error('목록에 없는 글꼴입니다'), { status: 404 });
  const urls = await faceUrls(m.entry, [{ weight, italic }]);
  const face = urls[0];
  if (!face) throw Object.assign(new Error('이 굵기의 파일이 없습니다'), { status: 404 });
  return { bytes: await download(face.url), family: m.entry.family, source: sourceName(m.entry), license: m.entry.license ?? '', format: /\.otf$/i.test(face.url) ? 'otf' : 'ttf' };
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function fontFinderMiddleware(req, res, next) {
  if (!req.url?.startsWith('/api/fonts/')) return next?.();
  if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'LightCast 화면에서만 쓸 수 있습니다' });
  const url = new URL(req.url, 'http://local');
  const route = url.pathname.slice('/api/fonts/'.length);
  const name = (url.searchParams.get('family') ?? '').trim().slice(0, 120);
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  if (!name && (route === 'find' || route === 'file')) return send(res, 400, { error: '글꼴 이름이 없습니다' });
  try {
    if (route === 'find') return send(res, 200, await findFont(name));
    if (route === 'file') {
      const weight = Math.round(Number(url.searchParams.get('weight')) || 400);
      const italic = url.searchParams.get('italic') === '1';
      const f = await fontFile(name, weight, italic);
      res.writeHead(200, {
        'content-type': f.format === 'otf' ? 'font/otf' : 'font/ttf',
        'content-length': f.bytes.length,
        'x-font-family': encodeURIComponent(f.family),
        'x-font-source': encodeURIComponent(f.source),
        'x-font-license': encodeURIComponent(f.license),
        'x-font-format': f.format,
      });
      return res.end(f.bytes);
    }
    return send(res, 404, { error: 'Unknown fonts route' });
  } catch (err) {
    if (err?.status) return send(res, err.status, { error: err.message });
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    send(res, timedOut ? 504 : 502, { error: timedOut ? '인터넷 응답 시간 초과' : `인터넷에서 가져오지 못했습니다 (${err?.message ?? err})` });
  }
}
