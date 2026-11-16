// Caption translation for 자막 (second caption line in another language).
// POST /api/ai/translate-caption { text, target: 'en' | 'ko' | ... } -> { text }. GET /api/ai/translate-status.
// Same key handling as speech.mjs: the church's own Gemini key (or OpenRouter key) from aiConfig(); the keys stay on
// this side, never reach the page and are never logged. Without a key the answer is code 'no-key' and the page falls
// back to the original captions. (The older /api/ai/translate route translates song lyrics slides and is unchanged.)
import { aiConfig } from './aiProviders.mjs';

export const MAX_TEXT = 600;
const MAX_BODY = 8 * 1024;
const TIMEOUT_MS = 12_000;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const OPENROUTER_MODEL = 'google/gemma-4-31b-it:free';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Must match TRANSLATE_LANGS in src/domain/captionTranslate.ts. */
export const TARGET_NAMES = {
  en: 'English', ko: 'Korean', zh: 'Simplified Chinese', ja: 'Japanese', es: 'Spanish',
  vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', fr: 'French', ru: 'Russian',
};

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** 'gemini', 'openrouter', or null when no key is set. */
export function translateProvider(cfg = aiConfig()) {
  if (cfg.geminiKey) return 'gemini';
  if (cfg.openrouterKey) return 'openrouter';
  return null;
}

export function translateStatus(cfg = aiConfig()) {
  const provider = translateProvider(cfg);
  return { configured: provider !== null, via: provider ?? '', model: provider === 'gemini' ? GEMINI_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : '' };
}

export function upstreamError(status, text = '') {
  const detail = String(text).slice(0, 120).replace(/[\r\n]+/g, ' ');
  if (status === 401 || status === 403) return httpError(status, 'bad-key', '번역 키가 맞지 않습니다');
  if (status === 429) return httpError(429, 'quota', '번역 사용량 한도에 도달했습니다');
  return httpError(502, 'upstream', `번역 서버 오류 ${status}${detail ? ` · ${detail}` : ''}`);
}

const SYSTEM = (name) =>
  `You translate live church sermon captions into ${name}. Reply with ONLY the translation of the text: no quotes, no notes, no explanation. Keep names, Bible book names and verse numbers natural for ${name} readers. The text may be an unfinished sentence; translate what is there.`;

/** Strip quotes / code fences a model sometimes wraps around its answer. */
export function tidyReply(s) {
  return String(s ?? '').replace(/```[a-z]*/gi, '').replace(/\s+/g, ' ').trim().replace(/^["“「]+|["”」]+$/g, '').trim();
}

/** Translate one caption piece. `fetchImpl` is injectable so tests never call a paid service. */
export async function translateCaption(text, target, cfg = aiConfig(), fetchImpl = fetch) {
  const provider = translateProvider(cfg);
  if (!provider) throw httpError(400, 'no-key', '번역 키가 없습니다. 설정 › AI 에서 키를 넣어 주세요.');
  const name = Object.hasOwn(TARGET_NAMES, target) ? TARGET_NAMES[target] : null;
  if (!name) throw httpError(400, 'bad-target', 'unknown target language');
  const piece = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!piece) return { text: '' };
  if (piece.length > MAX_TEXT) throw httpError(413, 'too-large', 'text too long');
  let res;
  try {
    if (provider === 'gemini') {
      res = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM(name) }] }, contents: [{ role: 'user', parts: [{ text: piece }] }], generationConfig: { temperature: 0.1 } }),
      });
    } else {
      res = await fetchImpl(OPENROUTER_ENDPOINT, {
        method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.openrouterKey}`, 'HTTP-Referer': 'https://shrlak.github.io/ppt/', 'X-OpenRouter-Title': 'LightCast' },
        body: JSON.stringify({ model: OPENROUTER_MODEL, temperature: 0.1, messages: [{ role: 'system', content: SYSTEM(name) }, { role: 'user', content: piece }] }),
      });
    }
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw httpError(timedOut ? 504 : 502, 'offline', timedOut ? '번역 응답 시간 초과' : '번역 서버에 연결할 수 없습니다');
  }
  const raw = await res.text();
  if (!res.ok) throw upstreamError(res.status, raw);
  let json;
  try { json = JSON.parse(raw); } catch { throw httpError(502, 'upstream', '번역 서버 응답을 읽을 수 없습니다'); }
  let out;
  if (provider === 'gemini') out = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('');
  else {
    const c = json?.choices?.[0]?.message?.content;
    out = Array.isArray(c) ? c.map((x) => x?.text ?? '').join('') : c;
  }
  return { text: tidyReply(out) };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'too-large', 'body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(httpError(400, 'bad-json', 'JSON body required')); } });
    req.on('error', reject);
  });
}

/** Handles /api/ai/translate-caption and /api/ai/translate-status (called from aiMiddleware). */
export async function translateRoute(name, req, res, send) {
  if (name === 'translate-status') return send(res, 200, translateStatus());
  if (req.method !== 'POST') return send(res, 404, { error: 'Unknown AI endpoint' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Cross-site requests are not allowed' });
  try {
    const body = await readJson(req);
    send(res, 200, await translateCaption(body.text, body.target));
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    send(res, status, { error: err.message || 'translation failed', code: err.code ?? 'error' });
  }
}
