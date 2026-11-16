import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
// @ts-expect-error plain ESM server module
import { attachRelay } from '../server/relay.mjs';
// @ts-expect-error plain ESM server module
import { translateCaption, translateProvider, translateStatus, tidyReply, TARGET_NAMES } from '../server/translate.mjs';
import { captionMessage, parseCaptionMessage } from '../src/domain/captions';
import {
  bandLines, CaptionTranslator, FATAL_PAUSE_MS, INTERIM_DEBOUNCE_MS, INTERIM_MIN_GAP_MS, MAX_PENDING_FINALS, sameLanguage, TRANSLATE_LANGS,
  TranslateError, TranslationCache, translatedText, translateStatusText, type TranslateStatus,
} from '../src/domain/captionTranslate';
import { translateCaptionApi } from '../src/ui/captionTranslateApi';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('CaptionTranslator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const make = (translate = vi.fn(async (t: string) => `[${t}]`)) => {
    let status: TranslateStatus = { state: 'off' };
    const tr = new CaptionTranslator({ translate, onChange: (_t, s) => { status = s; } });
    return { tr, translate, status: () => status };
  };

  it('translates finals in order and appends them', async () => {
    let release: (() => void) | null = null;
    const translate = vi.fn((t: string) => new Promise<string>((res) => { release = () => res(`<${t}>`); }));
    const { tr } = make(translate);
    tr.setTarget('en');
    tr.pushFinal('하나');
    tr.pushFinal('둘');
    await flush();
    expect(translate).toHaveBeenCalledTimes(1); // one at a time
    release!(); await flush();
    release!(); await flush();
    expect(translate.mock.calls.map((c) => c[0])).toEqual(['하나', '둘']);
    expect(translatedText(tr.current)).toBe('<하나> <둘>');
  });

  it('does nothing while off, and starts over when the language changes', async () => {
    const { tr, translate } = make();
    tr.pushFinal('안녕');
    await flush();
    expect(translate).not.toHaveBeenCalled();
    tr.setTarget('en');
    tr.pushFinal('안녕'); await flush();
    expect(translatedText(tr.current)).toBe('[안녕]');
    tr.setTarget('ja');
    expect(translatedText(tr.current)).toBe('');
  });

  it('caches: the same sentence is asked for once', async () => {
    const { tr, translate } = make();
    tr.setTarget('en');
    tr.pushFinal('아멘'); await flush();
    tr.reset();
    tr.pushFinal('아멘'); await flush();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translatedText(tr.current)).toBe('[아멘]');
  });

  it('debounces and throttles interim text', async () => {
    const { tr, translate } = make();
    tr.setTarget('en');
    tr.pushInterim('안'); tr.pushInterim('안녕'); tr.pushInterim('안녕하'); tr.pushInterim('안녕하세요');
    vi.advanceTimersByTime(INTERIM_DEBOUNCE_MS - 1);
    expect(translate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await flush();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenLastCalledWith('안녕하세요', 'en');
    expect(translatedText(tr.current)).toBe('[안녕하세요]');
    // a new interim right away waits until the minimum gap has passed
    tr.pushInterim('안녕하세요 여러분');
    vi.advanceTimersByTime(INTERIM_MIN_GAP_MS - 10);
    expect(translate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20); await flush();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('replaces the interim translation by the final one', async () => {
    const { tr } = make();
    tr.setTarget('en');
    tr.pushInterim('주님'); vi.advanceTimersByTime(INTERIM_DEBOUNCE_MS); await flush();
    expect(tr.current.interim).toBe('[주님]');
    tr.pushFinal('주님 감사합니다'); await flush();
    expect(tr.current).toEqual({ finals: '[주님 감사합니다]', interim: '' });
  });

  it('ignores an interim answer that arrives after the words became final', async () => {
    let release: (() => void) | null = null;
    const translate = vi.fn((t: string) => (t === '주님' ? new Promise<string>((res) => { release = () => res('late'); }) : Promise.resolve(`[${t}]`)));
    const { tr } = make(translate);
    tr.setTarget('en');
    tr.pushInterim('주님'); vi.advanceTimersByTime(INTERIM_DEBOUNCE_MS); await flush();
    tr.pushFinal('주님 사랑'); await flush();
    release!(); await flush();
    expect(tr.current).toEqual({ finals: '[주님 사랑]', interim: '' });
  });

  it('keeps only the newest pending finals when the service is slow', async () => {
    const releases: (() => void)[] = [];
    const translate = vi.fn((t: string) => new Promise<string>((res) => { releases.push(() => res(t)); }));
    const { tr } = make(translate);
    tr.setTarget('en');
    for (let i = 0; i < MAX_PENDING_FINALS + 4; i++) tr.pushFinal(`p${i}`);
    await flush();
    while (releases.length) { releases.shift()!(); await flush(); }
    // p0 was already in flight; of the rest only the newest MAX_PENDING_FINALS were kept
    expect(translate.mock.calls.length).toBe(1 + MAX_PENDING_FINALS);
    expect(translate.mock.calls.at(-1)![0]).toBe(`p${MAX_PENDING_FINALS + 3}`);
  });

  it('degrades to original-only with a status, and pauses after a key problem', async () => {
    const translate = vi.fn(async () => { throw new TranslateError('no-key'); });
    const { tr, status } = make(translate);
    tr.setTarget('en');
    tr.pushFinal('하나'); await flush();
    expect(status()).toEqual({ state: 'error', code: 'no-key' });
    expect(translatedText(tr.current)).toBe('');
    expect(translateStatusText(status())).toContain('원문만');
    tr.pushFinal('둘'); await flush();
    expect(translate).toHaveBeenCalledTimes(1); // paused: not hammering the service
    vi.advanceTimersByTime(FATAL_PAUSE_MS + 1);
    tr.pushFinal('셋'); await flush();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('keeps going after an offline error and recovers', async () => {
    let fail = true;
    const translate = vi.fn(async (t: string) => { if (fail) throw new TranslateError('offline'); return `[${t}]`; });
    const { tr, status } = make(translate);
    tr.setTarget('en');
    tr.pushFinal('하나'); await flush();
    expect(status()).toEqual({ state: 'error', code: 'offline' });
    fail = false;
    tr.pushFinal('둘'); await flush();
    expect(status()).toEqual({ state: 'ok' });
    expect(translatedText(tr.current)).toBe('[둘]');
  });
});

describe('translation helpers', () => {
  it('evicts the least recently used cache entry', () => {
    const c = new TranslationCache(2);
    c.set('en', 'a', 'A'); c.set('en', 'b', 'B');
    c.get('en', 'a');
    c.set('en', 'c', 'C');
    expect(c.get('en', 'b')).toBeUndefined();
    expect(c.get('en', 'a')).toBe('A');
    expect(c.get('ja', 'a')).toBeUndefined();
  });
  it('lists the requested languages and the server knows every one', () => {
    const labels = TRANSLATE_LANGS.map((l) => l.label);
    for (const l of ['English', '한국어', '中文', '日本語', 'Español', 'Tiếng Việt', 'ภาษาไทย']) expect(labels).toContain(l);
    for (const l of TRANSLATE_LANGS) expect(TARGET_NAMES[l.id]).toBe(l.name);
  });
  it('does not translate into the language being spoken', () => {
    expect(sameLanguage('ko-KR', 'ko')).toBe(true);
    expect(sameLanguage('en-US', 'ko')).toBe(false);
  });
  it('chooses the band lines, falling back to the original', () => {
    expect(bandLines('안녕', 'Hello', false)).toEqual({ original: '안녕', translation: 'Hello' });
    expect(bandLines('안녕', 'Hello', true)).toEqual({ original: '', translation: 'Hello' });
    expect(bandLines('안녕', '', true)).toEqual({ original: '안녕', translation: '' });
    expect(bandLines('안녕', undefined, false)).toEqual({ original: '안녕', translation: '' });
  });
});

describe('caption message with a translation', () => {
  it('adds tr only when there is one', () => {
    expect(captionMessage('안녕', true, 'md', 2)).toEqual({ type: 'caption', text: '안녕', final: true, size: 'md', lines: 2 });
    expect(captionMessage('안녕', true, 'md', 2, '  Hello ', true)).toMatchObject({ tr: 'Hello', trOnly: true });
    expect(captionMessage('안녕', true, 'md', 2, '   ', true)).not.toHaveProperty('tr');
    expect(captionMessage('안녕', true, 'md', 2, 'Hello')).not.toHaveProperty('trOnly');
  });
  it('validates and trims tr from the network', () => {
    expect(parseCaptionMessage({ type: 'caption', text: 'a', tr: ' b ' })).toMatchObject({ tr: 'b' });
    expect(parseCaptionMessage({ type: 'caption', text: 'a', tr: 5 })).not.toHaveProperty('tr');
    expect(parseCaptionMessage({ type: 'caption', text: 'a', trOnly: true })).not.toHaveProperty('trOnly');
    const long = parseCaptionMessage({ type: 'caption', text: 'a', tr: 'x'.repeat(900) }) as { tr: string };
    expect(long.tr.length).toBe(400);
  });
});

describe('relay caption with tr', () => {
  it('passes a validated, trimmed tr to viewers only', async () => {
    const server = http.createServer();
    const relay = attachRelay(server);
    const sockets: WebSocket[] = [];
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No port');
      const connect = async () => { const ws = new WebSocket(`ws://127.0.0.1:${address.port}/freecast-ws`); sockets.push(ws); await once(ws, 'open'); return ws; };
      const got: Record<string, unknown>[] = [];
      const viewer = await connect(); viewer.on('message', (r) => { const m = JSON.parse(String(r)); if (m.type === 'caption') got.push(m); });
      viewer.send(JSON.stringify({ type: 'hello', role: 'viewer' }));
      const host = await connect();
      host.send(JSON.stringify({ type: 'hello', role: 'host' }));
      await new Promise((r) => setTimeout(r, 100));
      host.send(JSON.stringify({ type: 'caption', text: '안녕', final: true, tr: `  ${'y'.repeat(500)}  `, trOnly: true }));
      host.send(JSON.stringify({ type: 'caption', text: '안녕', tr: 42, trOnly: true }));
      host.send(JSON.stringify({ type: 'caption', text: '안녕' }));
      await new Promise((r) => setTimeout(r, 200));
      expect(got).toHaveLength(3);
      expect((got[0].tr as string).length).toBe(400);
      expect(got[0].trOnly).toBe(true);
      expect(got[1]).not.toHaveProperty('tr');
      expect(got[1]).not.toHaveProperty('trOnly');
      expect(got[2]).not.toHaveProperty('tr');
    } finally {
      sockets.forEach((s) => s.terminate());
      for (const client of relay.clients) client.terminate();
      await new Promise<void>((resolve) => relay.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('server translate route (mock fetch, no paid calls)', () => {
  const none = { geminiKey: '', openrouterKey: '' };
  it('reports status without exposing keys', () => {
    expect(translateStatus(none)).toMatchObject({ configured: false });
    const s = translateStatus({ ...none, geminiKey: 'AIza-secret' });
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(s.configured).toBe(true);
    expect(translateProvider({ ...none, openrouterKey: 'o' })).toBe('openrouter');
  });
  it('asks for a key when none is set and never calls out', async () => {
    await expect(translateCaption('안녕', 'en', none, async () => { throw new Error('must not be called'); })).rejects.toMatchObject({ code: 'no-key', status: 400 });
  });
  it('rejects unknown targets and over-long text', async () => {
    const f = async () => new Response('{}');
    await expect(translateCaption('안녕', 'xx', { ...none, geminiKey: 'g' }, f)).rejects.toMatchObject({ code: 'bad-target' });
    await expect(translateCaption('가'.repeat(700), 'en', { ...none, geminiKey: 'g' }, f)).rejects.toMatchObject({ code: 'too-large' });
    expect(await translateCaption('   ', 'en', { ...none, geminiKey: 'g' }, f)).toEqual({ text: '' });
  });
  it('calls Gemini with the key in the URL only and returns the tidy text', async () => {
    let seen: { url: string; body: { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] } } | null = null;
    const out = await translateCaption(' 주님  감사합니다 ', 'ja', { ...none, geminiKey: 'g-key' }, async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '"主よ、感謝します"\n' }] } }] }));
    });
    expect(out).toEqual({ text: '主よ、感謝します' });
    expect(seen!.url).toContain('generativelanguage.googleapis.com');
    expect(seen!.url).toContain('key=g-key');
    expect(seen!.body.systemInstruction.parts[0].text).toContain('Japanese');
    expect(seen!.body.contents[0].parts[0].text).toBe('주님 감사합니다');
    expect(JSON.stringify(seen!.body)).not.toContain('g-key');
  });
  it('uses OpenRouter with a bearer header when only that key exists', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const out = await translateCaption('안녕', 'en', { ...none, openrouterKey: 'or-key' }, async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }));
    });
    expect(out.text).toBe('Hello');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer or-key');
    expect(String(seen!.init.body)).not.toContain('or-key');
  });
  it('maps upstream failures to codes and logs no key', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cfg = { ...none, geminiKey: 'g-key' };
    await expect(translateCaption('안녕', 'en', cfg, async () => new Response('{}', { status: 429 }))).rejects.toMatchObject({ code: 'quota' });
    await expect(translateCaption('안녕', 'en', cfg, async () => new Response('{}', { status: 403 }))).rejects.toMatchObject({ code: 'bad-key' });
    await expect(translateCaption('안녕', 'en', cfg, async () => new Response('boom', { status: 500 }))).rejects.toMatchObject({ code: 'upstream', status: 502 });
    await expect(translateCaption('안녕', 'en', cfg, async () => { throw new TypeError('fetch failed'); })).rejects.toMatchObject({ code: 'offline' });
    expect(JSON.stringify([spy.mock.calls, log.mock.calls])).not.toContain('g-key');
    spy.mockRestore(); log.mockRestore();
  });
  it('tidies a model reply', () => {
    expect(tidyReply('```text\n“Hello there”\n```')).toBe('Hello there');
  });
});

describe('page translate client', () => {
  it('returns text, and maps failures to TranslateError codes', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ text: 'Hi' }), { status: 200 })) as unknown as typeof fetch;
    expect(await translateCaptionApi('안녕', 'en', ok)).toBe('Hi');
    const noKey = (async () => new Response(JSON.stringify({ code: 'no-key', error: 'x' }), { status: 400 })) as unknown as typeof fetch;
    await expect(translateCaptionApi('안녕', 'en', noKey)).rejects.toMatchObject({ code: 'no-key' });
    const down = (async () => { throw new TypeError('x'); }) as unknown as typeof fetch;
    await expect(translateCaptionApi('안녕', 'en', down)).rejects.toMatchObject({ code: 'offline' });
    const weird = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(translateCaptionApi('안녕', 'en', weird)).rejects.toMatchObject({ code: 'error' });
  });
});
