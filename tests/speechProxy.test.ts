// 자막 without keys on this computer: speech goes to the church's AI Worker (as the other AI features do), and under
// 자동 a browser engine that cannot reach its speech server (the desktop app's) hands over to it.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs server module
import { proxyModels, speechProvider, speechStatus, transcribe } from '../server/speech.mjs';
import { SpeechService } from '../src/domain/speech/service';
import { SpeechError, type ProviderKind, type SpeechProvider } from '../src/domain/speech/types';
import { speechFallback } from '../src/ui/speechService';

const cfg = { speechBaseUrl: 'https://stt.example/v1', speechKey: '', speechModel: '', geminiKey: '', proxyUrl: 'https://proxy.example', proxyOrigin: 'https://site.example' };
const audio = Buffer.from([1, 2, 3]);
const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }] }), { status: 200 });

describe('speech through the AI Worker', () => {
  it('is configured whenever the Worker is', () => {
    expect(speechProvider(cfg)).toBe('proxy');
    expect(speechStatus(cfg)).toMatchObject({ configured: true, via: 'https://proxy.example' });
    expect(speechProvider({ ...cfg, geminiKey: 'g' })).toBe('gemini');
    expect(speechProvider({ ...cfg, proxyUrl: '' })).toBeNull();
  });

  it('asks the next model when one is busy, and sends the clip with the site origin', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const out = await transcribe(audio, 'audio/webm;codecs=opus', 'ko-KR', cfg, async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return calls.length === 1 ? new Response('{"error":{"code":503}}', { status: 503 }) : reply('  주의 백성   일어나라 ');
    }, ['busy-model', 'good-model']);
    expect(out).toEqual({ text: '주의 백성 일어나라' });
    expect(calls.map((c) => c.url)).toEqual(['https://proxy.example/gemini/busy-model', 'https://proxy.example/gemini/good-model']);
    expect((calls[1].init.headers as Record<string, string>).Origin).toBe('https://site.example');
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'audio/webm', data: audio.toString('base64') });
  });

  it('stops at a key or quota problem, and says why when every model fails', async () => {
    await expect(transcribe(audio, 'audio/webm', 'ko-KR', cfg, async () => new Response('{}', { status: 429 }), ['a', 'b'])).rejects.toMatchObject({ code: 'quota' });
    let n = 0;
    await expect(transcribe(audio, 'audio/webm', 'ko-KR', cfg, async () => { n++; throw new TypeError('fetch failed'); }, ['a', 'b'])).rejects.toMatchObject({ code: 'offline' });
    expect(n).toBe(2);
  });

  it('asks the lighter (faster) models first', async () => {
    const order = async () => [{ engine: 'gemini', model: 'g-flash' }, { engine: 'openrouter', model: 'x' }, { engine: 'gemini', model: 'g-flash-lite' }];
    const models: string[] = await proxyModels({ ...cfg, speechModel: '' }, order);
    expect(models[0]).toBe('g-flash-lite');
    expect(models).toContain('g-flash');
    expect(models).not.toContain('x');
    expect(await proxyModels(cfg, async () => { throw new Error('offline'); })).toEqual(['gemini-3.5-flash']);
    expect(await proxyModels({ ...cfg, speechModel: 'my-model' })).toEqual(['my-model']);
  });
});

describe('자동: from the browser engine to the cloud', () => {
  it('only when the browser engine cannot reach its server and the cloud is not known to be off', () => {
    const net = new SpeechError('network');
    expect(speechFallback('browser', net, 'auto', { configured: true, via: '', model: '' })).toBe('cloud');
    expect(speechFallback('browser', net, 'auto', null)).toBe('cloud');
    expect(speechFallback('browser', net, 'browser', { configured: true, via: '', model: '' })).toBeNull();
    expect(speechFallback('browser', new SpeechError('mic-denied'), 'auto', { configured: true, via: '', model: '' })).toBeNull();
    expect(speechFallback('browser', net, 'auto', { configured: false, via: '', model: '' })).toBeNull();
    expect(speechFallback('cloud', net, 'auto', { configured: true, via: '', model: '' })).toBeNull();
  });

  it('the service switches providers at once and keeps listening', () => {
    const started: ProviderKind[] = [];
    const make = (kind: ProviderKind): SpeechProvider => ({
      kind,
      start: (_lang, h) => { started.push(kind); if (kind === 'browser') h.error(new SpeechError('network')); else h.listening(); },
      stop: () => undefined,
    });
    const s = new SpeechService({ resolve: () => 'browser', create: make, lang: () => 'ko-KR', fallback: (k, e) => speechFallback(k, e, 'auto', null), setTimeout: () => 0, clearTimeout: () => undefined });
    s.subscribe({ onPiece: () => undefined });
    expect(started).toEqual(['browser', 'cloud']);
    expect(s.getStatus()).toMatchObject({ state: 'listening', provider: 'cloud' });
  });
});
