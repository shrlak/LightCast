// /api/recognition/* → the church Worker, for the 콘티 recognition pipeline ported from the ppt site
// (src/domain/recognition). The site calls the Worker from the browser; here the calls go through
// this local server so the Worker sees its allowed origin and no API key is ever in the app.
// With the operator's own GEMINI_API_KEY / OPENROUTER_API_KEY (desktop settings or env), the model
// calls go straight to Google / OpenRouter instead, as the site does with a personal key.
import { aiConfig } from './aiProviders.mjs';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_BODY = 60 * 1024 * 1024;
const TIMEOUT_MS = 150_000;

/** Worker routes the pipeline uses; nothing else is forwarded. */
const ROUTES = [
  { method: 'POST', path: /^gemini\/[\w.\-:]+$/ },
  { method: 'POST', path: /^openrouter$/ },
  { method: 'GET', path: /^settings$/ },
  { method: 'GET', path: /^lyrics$/ },
  { method: 'GET', path: /^learning\/(models|memory)$/ },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Where a route goes, and with which headers: the provider with an own key, else the Worker. */
export function recognitionTarget(route, search, cfg = aiConfig()) {
  if (route.startsWith('gemini/') && cfg.geminiKey) {
    const model = decodeURIComponent(route.slice('gemini/'.length));
    return { url: `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`, headers: {} };
  }
  if (route === 'openrouter' && cfg.openrouterKey) {
    return {
      url: OPENROUTER_ENDPOINT,
      headers: { Authorization: `Bearer ${cfg.openrouterKey}`, 'HTTP-Referer': 'https://shrlak.github.io/ppt/', 'X-OpenRouter-Title': 'LightCast' },
    };
  }
  return { url: `${cfg.proxyUrl}/${route}${search}`, headers: { Origin: cfg.proxyOrigin } };
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function recognitionMiddleware(req, res, next) {
  if (!req.url?.startsWith('/api/recognition/')) return next?.();
  if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Cross-site requests are not allowed' });
  const url = new URL(req.url, 'http://local');
  const route = url.pathname.slice('/api/recognition/'.length);
  if (!ROUTES.some((r) => r.method === req.method && r.path.test(route))) return send(res, 404, { error: 'Unknown recognition route' });
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const target = recognitionTarget(route, url.search);
    const headers = { ...target.headers, accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    const upstream = await fetch(target.url, { method: req.method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const out = { 'content-type': upstream.headers.get('content-type') ?? 'application/json' };
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) out['retry-after'] = retryAfter;
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    // The pipeline reads a 5xx as "busy, try again" and a timeout as such.
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    send(res, err.status ?? (timedOut ? 504 : 502), { error: timedOut ? 'AI 서버 응답 시간 초과' : `AI 서버에 연결할 수 없습니다 (${err.message})` });
  }
}
