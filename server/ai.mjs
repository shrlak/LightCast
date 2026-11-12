// AI endpoints for LightCast. The browser never sees an API key: requests go to this local
// server, which asks the church's Gemini / OpenRouter model pool (see aiProviders.mjs).
import { z } from 'zod';
import { aiConfig, askJson, attempts, setAiConfigProvider } from './aiProviders.mjs';

export { setAiConfigProvider };
const MAX_BODY = 40 * 1024 * 1024;

const ServiceInfo = z.object({
  date: z.string().describe('Service date as YYYY-MM-DD if printed, else empty'),
  scripture: z.string().describe('Sermon passage as printed, e.g. 로마서 5장 1-11절; empty if none'),
  sermonTitle: z.string(),
  preacher: z.string(),
  confession: z.string().describe('공동체 고백 song title if named, else empty'),
});
const NoticeResult = ServiceInfo.extend({
  songs: z.array(z.object({ title: z.string(), key: z.string() })),
  prayerTopics: z.array(z.object({ title: z.string(), points: z.array(z.string()) })),
  announcements: z.array(z.object({ title: z.string(), body: z.array(z.string()), links: z.array(z.string()) })),
});
const RetreatResult = z.object({
  meetings: z.array(z.object({
    name: z.string().describe('Meeting/column name as printed, e.g. 금요일 오후 예배'),
    songs: z.array(z.string()).describe('Song titles in order; drop songs marked with X in front; join titles split over two lines; remove * marks'),
  })),
  songs: z.array(z.object({ title: z.string(), lyrics: z.string().describe('Lyrics as printed; blank line between parts; no chords') })),
});
const TranslateResult = z.object({ lines: z.array(z.object({ id: z.string(), text: z.string() })) });
const AssistResult = z.object({
  title: z.string(),
  slides: z.array(z.object({
    group: z.string().describe('Short label such as Verse 1, Chorus, Point 1, 광고'),
    title: z.string().describe('Optional bold heading; empty string for none'),
    text: z.string().describe('Main slide text, at most ~4 short lines, newline-separated'),
    subtext: z.string().describe('Optional smaller second line (translation etc.); empty for none'),
  })),
});

/** Same call shape as before: content parts in, schema-checked JSON out. */
function ask(schema, system, content) {
  const parts = content.map((c) => (c.type === 'image' ? { type: 'image', mime: c.source.media_type, data: c.source.data } : { type: 'text', text: c.text }));
  return askJson(schema, system, parts);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const str = (v, max = 200000) => (typeof v === 'string' && v.length <= max ? v : null);

const handlers = {
  /** Read a pasted KakaoTalk notice (and optionally prayer topics / announcements) into structured data. */
  async notice(body) {
    const text = str(body.text, 50000);
    if (!text) throw httpError(400, 'text required');
    return ask(
      NoticeResult,
      'You extract structured data from Korean church service notices for a presentation app. Answer only with the requested JSON. Keep the original wording; do not invent anything that is not in the text.',
      [{ type: 'text', text: `Extract songs (in order, with keys), date, scripture, sermon title, preacher, 공동체 고백 song, prayer topics and announcements from:\n\n${text}` }],
    );
  },

  /** Read retreat 콘티 PDFs: the song table per meeting, plus lyrics from any sheet music pages. */
  async retreat(body) {
    const pages = Array.isArray(body.pages) ? body.pages.slice(0, 40) : null;
    if (!pages?.length) throw httpError(400, 'pages[] required');
    const content = [];
    for (const p of pages) {
      const data = str(p?.data, 8_000_000);
      if (!data || !Number.isInteger(p.page)) throw httpError(400, 'each page needs {page, data}');
      content.push({ type: 'text', text: `Page ${p.page}${p.text ? ` (embedded text: ${String(p.text).slice(0, 2000)})` : ''}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
    }
    content.push({ type: 'text', text: 'These pages are a Korean church retreat (수련회) 콘티: a table listing songs per meeting (금요일 저녁예배, 토요일 오전 특강, 토요일 저녁예배, 기도회, 찬양집회, 주일 예배 …) and possibly sheet music. Return each meeting column with its songs in order, and for every song whose sheet music appears, its lyrics exactly as printed (these are the church\'s own sheets).' });
    return ask(RetreatResult, 'You read scanned worship set lists and sheet music for a church presentation app. Answer only with the requested JSON.', content);
  },

  /** Translate lyric slides line by line (e.g. Korean → English) for a second-language line. */
  async translate(body) {
    const slides = Array.isArray(body.slides) ? body.slides.slice(0, 200) : null;
    const target = str(body.target, 40) ?? 'English';
    if (!slides?.length) throw httpError(400, 'slides[] required');
    const list = slides.map((s) => ({ id: String(s.id), text: String(s.text ?? '').slice(0, 2000) }));
    return ask(
      TranslateResult,
      'You translate worship song lyrics for projection. Keep each slide\'s line breaks, keep it singable and faithful, and use common published English wording for well-known hymns where it exists.',
      [{ type: 'text', text: `Song: ${str(body.title, 300) ?? ''}\nTranslate every slide into ${target}. Return one entry per id.\n\n${JSON.stringify(list)}` }],
    );
  },

  /** Free-form: turn a request or pasted text into a ready presentation. */
  async assist(body) {
    const prompt = str(body.prompt, 50000);
    if (!prompt) throw httpError(400, 'prompt required');
    return ask(
      AssistResult,
      'You create projection slides for church services and live events. Slides are read from a distance: short lines, at most about four lines per slide, no markdown. Write in the language of the request unless asked otherwise. Do not reproduce copyrighted song lyrics from memory; if asked for a copyrighted song, return slides with the title and the note to paste the lyrics.',
      [{ type: 'text', text: prompt }],
    );
  },
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(httpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Connect-style middleware: handles /api/ai/*, passes everything else on. */
export async function aiMiddleware(req, res, next) {
  const url = new URL(req.url ?? '/', 'http://local');
  if (!url.pathname.startsWith('/api/ai/')) return next?.();
  const name = url.pathname.slice('/api/ai/'.length);
  if (name === 'status') {
    const cfg = aiConfig();
    const list = await attempts();
    return send(res, 200, {
      model: list[0]?.model ?? 'gemini',
      models: list.map((a) => `${a.engine}:${a.model}`),
      via: cfg.geminiKey || cfg.openrouterKey ? 'own keys' : cfg.proxyUrl,
      configured: true,
    });
  }
  if (name === 'usage') {
    // Today's per-model counts kept by the church Worker (shared with the ppt site, whose keys it holds).
    const cfg = aiConfig();
    try {
      const r = await fetch(`${cfg.proxyUrl}/usage`, { headers: { Origin: cfg.proxyOrigin }, signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      return send(res, r.ok ? 200 : 502, r.ok ? { ...data, via: cfg.proxyUrl, ownKeys: !!(cfg.geminiKey || cfg.openrouterKey) } : { error: data.error ?? `Worker ${r.status}` });
    } catch (err) {
      return send(res, 502, { error: `AI 서버에 연결할 수 없습니다: ${err.message}` });
    }
  }
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
  if (!handler || req.method !== 'POST') return send(res, 404, { error: 'Unknown AI endpoint' });
  try {
    send(res, 200, await handler(await readJson(req)));
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    send(res, status, { error: err.message || 'AI request failed' });
  }
}
