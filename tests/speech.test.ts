import { describe, expect, it, vi } from 'vitest';
import { ChunkMeter, dedupeOverlap, isLoud, isPhantom, shouldCutChunk } from '../src/domain/speech/audioChunks';
import { backoffMs, withRetry } from '../src/domain/speech/retry';
import { SpeechService } from '../src/domain/speech/service';
import { CloudSpeechProvider, type AudioChunk, type Mic } from '../src/domain/speech/cloudProvider';
import { BrowserSpeechProvider, type RecognitionLike } from '../src/domain/speech/browserProvider';
import { parseSpeechSettings, resolveProvider, speechErrorMessage, speechStatusText, unavailableError } from '../src/domain/speech/settings';
import { SpeechError, type ProviderHandlers, type ProviderKind, type SpeechLang, type SpeechProvider } from '../src/domain/speech/types';
import { applyCaption, captionText, emptyCaption } from '../src/domain/captions';

/** A provider the test drives by hand. */
class MockProvider implements SpeechProvider {
  started = 0; stopped = 0; h!: ProviderHandlers; lang?: SpeechLang;
  constructor(readonly kind: ProviderKind = 'cloud') {}
  start(lang: SpeechLang, h: ProviderHandlers) { this.started++; this.lang = lang; this.h = h; }
  stop() { this.stopped++; }
}

function makeService(opts: { kind?: ProviderKind | null; lang?: SpeechLang } = {}) {
  const made: MockProvider[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  const cfg = { kind: opts.kind === undefined ? 'cloud' as ProviderKind | null : opts.kind, lang: opts.lang ?? 'ko-KR' as SpeechLang };
  const svc = new SpeechService({
    resolve: () => cfg.kind,
    lang: () => cfg.lang,
    create: (k) => { const p = new MockProvider(k); made.push(p); return p; },
    setTimeout: (fn, ms) => { const t = { fn, ms, id: timers.length + 1 }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  return { svc, made, timers, cfg };
}

describe('SpeechService (one recognizer for everyone)', () => {
  it('starts one provider for many subscribers and stops after the last leaves', () => {
    const { svc, made } = makeService();
    const a = vi.fn(); const b = vi.fn();
    const ua = svc.subscribe({ onPiece: a });
    const ub = svc.subscribe({ onPiece: b });
    expect(made).toHaveLength(1);
    made[0].h.listening();
    expect(svc.getStatus().state).toBe('listening');
    made[0].h.piece('안녕', false);
    expect(a).toHaveBeenCalledWith('안녕', false);
    expect(b).toHaveBeenCalledWith('안녕', false);
    ua();
    expect(made[0].stopped).toBe(0);
    ub();
    expect(made[0].stopped).toBe(1);
    expect(svc.getStatus().state).toBe('idle');
  });

  it('restarts with the new language and provider', () => {
    const { svc, made, cfg } = makeService();
    svc.subscribe({ onPiece: () => undefined });
    cfg.lang = 'en-US';
    svc.reconfigure();
    expect(made).toHaveLength(2);
    expect(made[0].stopped).toBe(1);
    expect(made[1].lang).toBe('en-US');
    svc.reconfigure();
    expect(made).toHaveLength(2);
    cfg.kind = 'browser';
    svc.reconfigure();
    expect(made[2].kind).toBe('browser');
  });

  it('ignores late callbacks from a stopped provider', () => {
    const { svc, made, cfg } = makeService();
    const l = vi.fn();
    svc.subscribe({ onPiece: l });
    cfg.lang = 'en-US';
    svc.reconfigure();
    made[0].h.piece('old', true);
    expect(l).not.toHaveBeenCalled();
  });

  it('retries a temporary error with a growing wait and resets after speech', () => {
    const { svc, made, timers } = makeService();
    svc.subscribe({ onPiece: () => undefined });
    made[0].h.error(new SpeechError('offline'));
    expect(svc.getStatus()).toMatchObject({ state: 'error', retryInMs: 1000 });
    timers[0].fn(); timers.length = 0;
    expect(made).toHaveLength(2);
    made[1].h.error(new SpeechError('network'));
    expect(svc.getStatus().retryInMs).toBe(2000);
    timers[0].fn(); timers.length = 0;
    made[2].h.piece('hi', true);
    made[2].h.error(new SpeechError('network'));
    expect(svc.getStatus().retryInMs).toBe(1000);
  });

  it('does not retry a fatal error and keeps it visible after stopping', () => {
    const { svc, made, timers } = makeService();
    const un = svc.subscribe({ onPiece: () => undefined });
    made[0].h.error(new SpeechError('mic-denied'));
    expect(timers).toHaveLength(0);
    expect(svc.getStatus()).toMatchObject({ state: 'error', retryInMs: null });
    un();
    expect(svc.getStatus().error?.kind).toBe('mic-denied');
    svc.subscribe({ onPiece: () => undefined });
    expect(made).toHaveLength(2);
    expect(svc.getStatus().state).toBe('starting');
  });

  it('says so when no provider can run', () => {
    const { svc, made } = makeService({ kind: null });
    svc.subscribe({ onPiece: () => undefined });
    expect(made).toHaveLength(0);
    expect(svc.getStatus().error?.kind).toBe('unsupported');
  });

  it('a retry call restarts at once', () => {
    const { svc, made, timers } = makeService();
    svc.subscribe({ onPiece: () => undefined });
    made[0].h.error(new SpeechError('quota'));
    expect(svc.getStatus().retryInMs).toBe(10_000);
    svc.retry();
    expect(timers).toHaveLength(0);
    expect(made).toHaveLength(2);
  });
});

describe('cloud provider with a mock microphone and transcriber', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function setup(texts: (string | SpeechError)[], loud: boolean[] = []) {
    let i = 0;
    let closed = false;
    const mic: Mic = {
      record: async () => { await flush(); if (closed) return null; const k = i++; return { blob: `chunk${k}`, loud: loud[k] ?? true } as AudioChunk; },
      close: () => { closed = true; },
    };
    const sent: string[] = [];
    const attempts: Record<string, number> = {};
    const provider = new CloudSpeechProvider({
      openMic: async () => mic,
      transcribe: async (c) => {
        const k = c.blob as string;
        sent.push(k);
        attempts[k] = (attempts[k] ?? 0) + 1;
        const t = texts[Number(k.slice(5))];
        if (t === undefined) { await flush(); return ''; }
        if (t instanceof SpeechError) throw t;
        return t;
      },
      sleep: async () => undefined,
    });
    const pieces: [string, boolean][] = [];
    const errors: SpeechError[] = [];
    let listening = 0;
    provider.start('ko-KR', { piece: (t, f) => pieces.push([t, f]), listening: () => listening++, error: (e) => errors.push(e) });
    return { provider, pieces, errors, sent, attempts, listening: () => listening };
  }

  it('turns chunks into ordered final pieces, dropping phantoms and repeated words', async () => {
    const r = setup(['오늘 말씀은', '감사합니다.', '오늘 말씀은 요한복음 3장']);
    for (let n = 0; n < 8; n++) await flush();
    r.provider.stop();
    expect(r.listening()).toBe(1);
    expect(r.pieces).toEqual([['오늘 말씀은', true], ['요한복음 3장', true]]);
    expect(r.pieces.every(([, f]) => f)).toBe(true);
  });

  it('skips silent chunks without sending them', async () => {
    const r = setup(['a b', 'c d', 'e f'], [false, true, false]);
    for (let n = 0; n < 8; n++) await flush();
    r.provider.stop();
    expect(r.sent).toContain('chunk1');
    expect(r.sent).not.toContain('chunk0');
    expect(r.sent).not.toContain('chunk2');
  });

  it('retries a network failure for the chunk, then gives up with an error', async () => {
    const r = setup([new SpeechError('network')]);
    for (let n = 0; n < 8; n++) await flush();
    r.provider.stop();
    expect(r.attempts.chunk0).toBe(3);
    expect(r.errors[0]?.kind).toBe('network');
  });

  it('reports a quota or key error at once without retrying', async () => {
    const r = setup([new SpeechError('bad-key')]);
    for (let n = 0; n < 6; n++) await flush();
    r.provider.stop();
    expect(r.attempts.chunk0).toBe(1);
    expect(r.errors[0]?.kind).toBe('bad-key');
  });

  it('reports a blocked microphone', async () => {
    const errors: SpeechError[] = [];
    new CloudSpeechProvider({ openMic: async () => { throw new SpeechError('mic-denied'); }, transcribe: async () => '' })
      .start('ko-KR', { piece: () => undefined, listening: () => undefined, error: (e) => errors.push(e) });
    await flush();
    expect(errors[0]?.kind).toBe('mic-denied');
  });

  it('closes the microphone on stop', async () => {
    const r = setup([]);
    await flush();
    r.provider.stop();
    await flush();
    expect(r.errors).toHaveLength(0);
  });
});

describe('chunk scheduling', () => {
  it('cuts at 3 s, or at a pause after 1.5 s of speech, never earlier', () => {
    expect(shouldCutChunk({ elapsedMs: 3000, silentMs: 0, heardSpeech: true })).toBe(true);
    expect(shouldCutChunk({ elapsedMs: 1400, silentMs: 600, heardSpeech: true })).toBe(false);
    expect(shouldCutChunk({ elapsedMs: 1600, silentMs: 500, heardSpeech: true })).toBe(true);
    expect(shouldCutChunk({ elapsedMs: 2000, silentMs: 2000, heardSpeech: false })).toBe(false);
  });
  it('meters levels over time', () => {
    const m = new ChunkMeter();
    let cut = false;
    for (let t = 0; t < 1600 && !cut; t += 100) cut = m.sample(0.1, 100);
    expect(cut).toBe(false);
    for (let t = 0; t < 400; t += 100) cut = m.sample(0.001, 100);
    expect(cut).toBe(true);
    expect(isLoud(0.1)).toBe(true);
    expect(isLoud(0.001)).toBe(false);
  });
  it('removes repeated words and phantom phrases', () => {
    expect(dedupeOverlap('오늘 말씀은 요한복음', '말씀은 요한복음 3장')).toBe('3장');
    expect(dedupeOverlap('안녕하세요', '여러분 반갑습니다')).toBe('여러분 반갑습니다');
    expect(dedupeOverlap('a', 'a b')).toBe('a b');
    expect(isPhantom('감사합니다.')).toBe(true);
    expect(isPhantom('')).toBe(true);
    expect(isPhantom('오늘 감사합니다 여러분')).toBe(false);
  });
  it('merges chunk finals into the caption text', () => {
    let s = applyCaption(emptyCaption(), '안녕하세요', true, 1000);
    s = applyCaption(s, '여러분', true, 2500);
    expect(captionText(s)).toBe('안녕하세요 여러분');
  });
});

describe('retry / backoff', () => {
  it('doubles up to 30 s, quota waits at least 10 s', () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffMs(n))).toEqual([1000, 2000, 4000, 8000, 30_000]);
    expect(backoffMs(0, true)).toBe(10_000);
    expect(backoffMs(5, true)).toBe(30_000);
  });
  it('retries only what is retryable', async () => {
    const sleeps: number[] = [];
    const o = { retries: 2, sleep: async (ms: number) => { sleeps.push(ms); }, isRetryable: (e: unknown) => (e as Error).message === 'again' };
    let n = 0;
    await expect(withRetry(async () => { if (++n < 3) throw new Error('again'); return 'ok'; }, o)).resolves.toBe('ok');
    expect(sleeps).toEqual([1000, 2000]);
    n = 0;
    await expect(withRetry(async () => { n++; throw new Error('fatal'); }, o)).rejects.toThrow('fatal');
    expect(n).toBe(1);
  });
});

describe('browser provider', () => {
  it('passes interim and final pieces and reports errors', () => {
    let inst!: RecognitionLike;
    class Fake implements RecognitionLike {
      lang = ''; continuous = false; interimResults = false;
      onresult: RecognitionLike['onresult'] = null; onerror: RecognitionLike['onerror'] = null; onend: RecognitionLike['onend'] = null;
      constructor() { inst = this; }
      start() {} stop() {} abort() {}
    }
    const pieces: [string, boolean][] = [];
    const errors: SpeechError[] = [];
    const p = new BrowserSpeechProvider(() => Fake);
    p.start('en-US', { piece: (t, f) => pieces.push([t, f]), listening: () => undefined, error: (e) => errors.push(e) });
    expect(inst.lang).toBe('en-US');
    inst.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'hel' } }] });
    inst.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'hello' } }] });
    expect(pieces).toEqual([['hel', false], ['hello', true]]);
    inst.onerror?.({ error: 'not-allowed' });
    expect(errors[0].kind).toBe('mic-denied');
    expect(() => new BrowserSpeechProvider(() => null).start('ko-KR', { piece: () => undefined, listening: () => undefined, error: () => undefined })).toThrow();
  });
});

describe('settings and provider choice', () => {
  const env = (o: Partial<{ browser: boolean; cloud: boolean | null; desktopApp: boolean }> = {}) => ({ browser: false, cloud: false as boolean | null, desktopApp: false, ...o });
  it('auto: the desktop app prefers the cloud, browsers their own recognizer', () => {
    expect(resolveProvider('auto', env({ desktopApp: true, cloud: true }))).toBe('cloud');
    expect(resolveProvider('auto', env({ desktopApp: true, cloud: false }))).toBeNull();
    expect(resolveProvider('auto', env({ desktopApp: true, cloud: null }))).toBe('cloud');
    expect(resolveProvider('auto', env({ browser: true, cloud: true }))).toBe('browser');
    expect(resolveProvider('auto', env({ cloud: true }))).toBe('cloud');
    expect(resolveProvider('auto', env({ browser: true, desktopApp: true, cloud: false }))).toBe('browser');
  });
  it('a forced provider is never swapped', () => {
    expect(resolveProvider('browser', env({ cloud: true }))).toBeNull();
    expect(resolveProvider('cloud', env({ browser: true, cloud: false }))).toBeNull();
  });
  it('explains what is missing and how to enable it', () => {
    expect(unavailableError('auto', env({ desktopApp: true }))?.message).toContain('설정 › AI');
    expect(unavailableError('auto', env({ browser: true }))).toBeNull();
  });
  it('parses stored settings safely', () => {
    expect(parseSpeechSettings('not json')).toEqual({ provider: 'auto', lang: 'ko-KR' });
    expect(parseSpeechSettings('{"provider":"cloud","lang":"en-US"}')).toEqual({ provider: 'cloud', lang: 'en-US' });
    expect(parseSpeechSettings('{"provider":"x"}').provider).toBe('auto');
  });
  it('words every error and status in Korean', () => {
    for (const k of ['mic-denied', 'no-mic', 'no-key', 'bad-key', 'offline', 'quota', 'network', 'unsupported', 'unknown'] as const) expect(speechErrorMessage(new SpeechError(k))).toMatch(/[가-힣]/);
    expect(speechStatusText({ state: 'error', provider: 'cloud', error: new SpeechError('offline'), retryInMs: 2000 }, 'cloud')).toContain('2초 뒤');
    expect(speechStatusText({ state: 'listening', provider: 'cloud', error: null, retryInMs: null }, 'cloud')).toBe('듣는 중 · 클라우드');
  });
});
