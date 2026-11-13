import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs server module
import { speechProvider, speechStatus, transcribe, upstreamError } from '../server/speech.mjs';

const base = { speechBaseUrl: 'https://stt.example/v1', speechKey: '', speechModel: '', geminiKey: '' };
const audio = Buffer.from([1, 2, 3]);

describe('server speech route (mock fetch, no paid calls)', () => {
  it('reports whether it is configured without exposing keys', () => {
    expect(speechStatus(base)).toEqual({ configured: false, via: '', model: '' });
    const s = speechStatus({ ...base, speechKey: 'sk-secret' });
    expect(JSON.stringify(s)).not.toContain('sk-secret');
    expect(s).toMatchObject({ configured: true, via: 'https://stt.example/v1', model: 'whisper-1' });
    expect(speechProvider({ ...base, geminiKey: 'g' })).toBe('gemini');
  });

  it('asks for a key when none is set', async () => {
    await expect(transcribe(audio, 'audio/webm', 'ko-KR', base, async () => { throw new Error('must not be called'); })).rejects.toMatchObject({ code: 'no-key', status: 400 });
  });

  it('sends an OpenAI-compatible multipart request to the configured base URL', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const out = await transcribe(audio, 'audio/webm;codecs=opus', 'ko-KR', { ...base, speechKey: 'k', speechModel: 'm1' }, async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ text: ' 안녕  하세요 ' }), { status: 200 });
    });
    expect(out).toEqual({ text: '안녕 하세요' });
    expect(seen!.url).toBe('https://stt.example/v1/audio/transcriptions');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const form = seen!.init.body as FormData;
    expect(form.get('model')).toBe('m1');
    expect(form.get('language')).toBe('ko');
  });

  it('falls back to Gemini audio input with the Gemini key', async () => {
    let body: { contents: { parts: { inline_data?: { mime_type: string } }[] }[] } | null = null;
    const out = await transcribe(audio, 'audio/webm;codecs=opus', 'en-US', { ...base, geminiKey: 'g' }, async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello there' }] } }] }), { status: 200 });
    });
    expect(out.text).toBe('hello there');
    expect(body!.contents[0].parts[1].inline_data?.mime_type).toBe('audio/webm');
  });

  it('maps upstream failures to codes the page understands', async () => {
    expect(upstreamError(429)).toMatchObject({ code: 'quota', status: 429 });
    expect(upstreamError(401)).toMatchObject({ code: 'bad-key' });
    expect(upstreamError(500, 'boom')).toMatchObject({ code: 'upstream', status: 502 });
    await expect(transcribe(audio, 'audio/webm', 'ko-KR', { ...base, speechKey: 'k' }, async () => new Response('{}', { status: 429 }))).rejects.toMatchObject({ code: 'quota' });
    await expect(transcribe(audio, 'audio/webm', 'ko-KR', { ...base, speechKey: 'k' }, async () => { throw new TypeError('fetch failed'); })).rejects.toMatchObject({ code: 'offline' });
  });

  it('never puts the key in an error message', async () => {
    try {
      await transcribe(audio, 'audio/webm', 'ko-KR', { ...base, speechKey: 'sk-secret' }, async () => new Response('bad sk-secret', { status: 401 }));
    } catch (e) { expect((e as Error).message).not.toContain('sk-secret'); }
  });
});
