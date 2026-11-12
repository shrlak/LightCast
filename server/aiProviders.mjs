// AI engines — the same setup as the church's PPT generator (shrlak/ppt):
// Gemini and OpenRouter free vision models, normally through the church's Cloudflare Worker
// (lyrics-ai-proxy), which holds the API keys and the admin-chosen model order (/settings).
// With your own GEMINI_API_KEY / OPENROUTER_API_KEY the calls go straight to Google / OpenRouter.
import { z } from 'zod';

export const DEFAULT_PROXY = 'https://lyrics-ai-proxy.spencerkim1235.workers.dev';
/** The Worker only answers requests from the church's site origin. */
export const DEFAULT_PROXY_ORIGIN = 'https://shrlak.github.io';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 150_000;

/** Fallback model order (the repo's catalog) when the Worker's /settings is unreachable. */
export const BUILTIN_ATTEMPTS = [
  { engine: 'gemini', model: 'gemini-3.6-flash' },
  { engine: 'gemini', model: 'gemini-3.5-flash' },
  { engine: 'gemini', model: 'gemini-3.5-flash-lite' },
  { engine: 'gemini', model: 'gemini-3.7-flash' },
  { engine: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' },
  { engine: 'openrouter', model: 'dots-studio/dots-3-note-preview:free' },
  { engine: 'openrouter', model: 'google/gemma-4-31b-it:free' },
];

let configProvider = () => ({});
/** The host app supplies proxy URL / keys (desktop settings); env vars are the fallback. */
export function setAiConfigProvider(fn) {
  configProvider = fn;
  attemptsCache = null;
}

export function aiConfig() {
  const c = configProvider() ?? {};
  return {
    proxyUrl: (c.proxyUrl || process.env.FREECAST_AI_PROXY || DEFAULT_PROXY).replace(/\/+$/, ''),
    proxyOrigin: c.proxyOrigin || process.env.FREECAST_AI_PROXY_ORIGIN || DEFAULT_PROXY_ORIGIN,
    geminiKey: c.geminiKey || process.env.GEMINI_API_KEY || '',
    openrouterKey: c.openrouterKey || process.env.OPENROUTER_API_KEY || '',
  };
}

let attemptsCache = null;
/** Model order: the Worker's admin settings (cached 10 min), else the built-in catalog. */
export async function attempts() {
  if (attemptsCache && Date.now() - attemptsCache.at < 600_000) return attemptsCache.list;
  const cfg = aiConfig();
  let list = BUILTIN_ATTEMPTS;
  try {
    const res = await fetch(`${cfg.proxyUrl}/settings`, { headers: { Origin: cfg.proxyOrigin }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const remote = (data.attempts ?? []).filter((a) => (a.engine === 'gemini' || a.engine === 'openrouter') && typeof a.model === 'string');
      if (remote.length) list = remote;
    }
  } catch {
    // offline or proxy down: use the built-in order
  }
  attemptsCache = { at: Date.now(), list };
  return list;
}

/**
 * Generic message parts: { type: 'text', text } | { type: 'image', mime, data(base64) }.
 */
function geminiBody(system, parts) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: parts.map((p) => (p.type === 'text' ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.data } })) }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  };
}

function openrouterBody(model, system, parts) {
  return {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: parts.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } })) },
    ],
  };
}

async function post(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 200)}`), { status: res.status });
  return JSON.parse(text);
}

async function callModel(attempt, system, parts) {
  const cfg = aiConfig();
  if (attempt.engine === 'gemini') {
    const url = cfg.geminiKey
      ? `${GEMINI_ENDPOINT}/${encodeURIComponent(attempt.model)}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`
      : `${cfg.proxyUrl}/gemini/${encodeURIComponent(attempt.model)}`;
    const json = await post(url, geminiBody(system, parts), cfg.geminiKey ? {} : { Origin: cfg.proxyOrigin });
    return (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('');
  }
  const json = cfg.openrouterKey
    ? await post(OPENROUTER_ENDPOINT, openrouterBody(attempt.model, system, parts), {
        Authorization: `Bearer ${cfg.openrouterKey}`, 'HTTP-Referer': 'https://shrlak.github.io/ppt/', 'X-OpenRouter-Title': 'LightCast',
      })
    : await post(`${cfg.proxyUrl}/openrouter`, openrouterBody(attempt.model, system, parts), { Origin: cfg.proxyOrigin });
  const content = json?.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((c) => c?.text ?? '').join('') : String(content ?? '');
}

/** Pull the JSON object out of a model reply (code fences, leading prose…). */
export function extractJson(text) {
  const clean = String(text).replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('no JSON in reply');
  }
}

/**
 * Ask the model pool for JSON matching `schema`. Tries each model in order and moves on when
 * one is rate-limited, down, or returns something that does not fit the schema.
 */
export async function askJson(schema, system, parts) {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const fullParts = [...parts, { type: 'text', text: `Reply with ONLY one JSON object (no markdown) matching this JSON Schema:\n${jsonSchema}` }];
  const errors = [];
  const hasImages = parts.some((p) => p.type === 'image');
  for (const attempt of await attempts()) {
    try {
      const reply = await callModel(attempt, system, fullParts);
      const parsed = schema.safeParse(extractJson(reply));
      if (parsed.success) return parsed.data;
      errors.push(`${attempt.model}: answer did not match the expected format`);
    } catch (e) {
      errors.push(`${attempt.model}: ${e.message}`);
      // A text-only request that the proxy rejects outright (e.g. bad origin) will fail everywhere.
      if (e.status === 403 && !hasImages && errors.length > 1) break;
    }
  }
  const err = new Error(`All AI models failed — ${errors.slice(-3).join(' · ')}`);
  err.status = 502;
  throw err;
}
