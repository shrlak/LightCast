// The page's side of caption translation: one request per piece to the local server (/api/ai/translate-caption).
// The server holds the keys; this file never sees or logs one.
import { TranslateError, type TranslateErrorCode, type TranslateLang } from '../domain/captionTranslate';

const CODES: TranslateErrorCode[] = ['no-key', 'bad-key', 'quota', 'offline'];

export async function translateCaptionApi(text: string, target: TranslateLang, fetchImpl: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl('/api/ai/translate-caption', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, target }) });
  } catch {
    throw new TranslateError('offline');
  }
  const data = (await res.json().catch(() => ({}))) as { text?: unknown; code?: unknown; error?: unknown };
  if (!res.ok) throw new TranslateError(CODES.includes(data.code as TranslateErrorCode) ? (data.code as TranslateErrorCode) : 'error', String(data.error ?? res.status));
  return typeof data.text === 'string' ? data.text : '';
}
