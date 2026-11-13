// Speech-to-text for 자막 (live captions) in the desktop app, which has no Web Speech API.
// POST /api/ai/transcribe?lang=ko-KR with one short audio chunk as the raw body -> { text }.
// Provider-agnostic: an OpenAI-compatible /audio/transcriptions service (own base URL, key and model), else Gemini
// with the church's own Gemini key. Keys stay on this side; they are never sent to the page and never logged.
import { aiConfig } from './aiProviders.mjs';

export const MAX_AUDIO = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** Which service answers: 'openai' (own speech key), 'gemini' (Gemini key), or null (not configured). */
export function speechProvider(cfg = aiConfig()) {
  if (cfg.speechKey) return 'openai';
  if (cfg.geminiKey) return 'gemini';
  return null;
}

export function speechStatus(cfg = aiConfig()) {
  const provider = speechProvider(cfg);
  return {
    configured: provider !== null,
    via: provider === 'openai' ? cfg.speechBaseUrl : provider === 'gemini' ? 'gemini' : '',
    model: provider === 'openai' ? (cfg.speechModel || 'whisper-1') : provider === 'gemini' ? (cfg.speechModel || DEFAULT_GEMINI_MODEL) : '',
  };
}

const LANG_NAMES = { 'ko-KR': 'Korean', 'en-US': 'English' };
const extFor = (mime) => (/mp4|m4a|aac/.test(mime) ? 'mp4' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm');

/** Map an upstream HTTP status to a code the page understands. */
export function upstreamError(status, text = '') {
  const detail = String(text).slice(0, 120).replace(/[\r\n]+/g, ' ');
  if (status === 401 || status === 403) return httpError(status, 'bad-key', '음성 인식 키가 맞지 않습니다');
  if (status === 429) return httpError(429, 'quota', '음성 인식 사용량 한도에 도달했습니다');
  return httpError(502, 'upstream', `음성 인식 서버 오류 ${status}${detail ? ` · ${detail}` : ''}`);
}

/** Transcribe one chunk. `fetchImpl` is injectable so tests never call a paid service. */
export async function transcribe(audio, mime, lang, cfg = aiConfig(), fetchImpl = fetch) {
  const provider = speechProvider(cfg);
  if (!provider) throw httpError(400, 'no-key', '음성 인식 키가 없습니다. 설정 › AI 에서 키를 넣어 주세요.');
  if (!audio.length) return { text: '' };
  const code = String(lang).slice(0, 2);
  let res;
  try {
    if (provider === 'openai') {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mime }), `chunk.${extFor(mime)}`);
      form.append('model', cfg.speechModel || 'whisper-1');
      if (code === 'ko' || code === 'en') form.append('language', code);
      form.append('response_format', 'json');
      form.append('temperature', '0');
      res = await fetchImpl(`${cfg.speechBaseUrl}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.speechKey}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } else {
      const model = cfg.speechModel || DEFAULT_GEMINI_MODEL;
      const body = {
        contents: [{ role: 'user', parts: [
          { text: `Transcribe this short ${LANG_NAMES[lang] ?? 'Korean'} speech clip exactly as spoken. Reply with only the transcript text. If there is no speech, reply with nothing.` },
          { inline_data: { mime_type: mime.split(';')[0], data: Buffer.from(audio).toString('base64') } },
        ] }],
        generationConfig: { temperature: 0 },
      };
      res = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw httpError(timedOut ? 504 : 502, 'offline', timedOut ? '음성 인식 응답 시간 초과' : '음성 인식 서버에 연결할 수 없습니다');
  }
  const raw = await res.text();
  if (!res.ok) throw upstreamError(res.status, raw);
  let json;
  try { json = JSON.parse(raw); } catch { throw httpError(502, 'upstream', '음성 인식 서버 응답을 읽을 수 없습니다'); }
  const text = provider === 'openai' ? json?.text : (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('');
  return { text: String(text ?? '').replace(/\s+/g, ' ').trim() };
}

function readAudio(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_AUDIO) { reject(httpError(413, 'too-large', 'Audio chunk too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Handles /api/ai/transcribe and /api/ai/speech-status (called from aiMiddleware). */
export async function speechRoute(name, req, res, url, send) {
  if (name === 'speech-status') return send(res, 200, speechStatus());
  if (req.method !== 'POST') return send(res, 404, { error: 'Unknown AI endpoint' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Cross-site requests are not allowed' });
  try {
    const mime = String(req.headers['content-type'] ?? 'audio/webm').split(',')[0].trim();
    if (!/^audio\/[\w.+-]+(;.*)?$/i.test(mime)) throw httpError(415, 'bad-type', 'audio body required');
    const lang = url.searchParams.get('lang') === 'en-US' ? 'en-US' : 'ko-KR';
    send(res, 200, await transcribe(await readAudio(req), mime, lang));
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    send(res, status, { error: err.message || 'transcription failed', code: err.code ?? 'error' });
  }
}
