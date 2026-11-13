// The app-wide speech service, wired to the real browser: Web Speech, or the microphone + the LightCast server's
// /api/ai/transcribe route (the "cloud" provider). Everything that listens (captions, Bible listener, PastorStage,
// FollowDock) subscribes here, so there is one microphone and one recognizer, whoever asks.
import { useEffect, useSyncExternalStore } from 'react';
import { ChunkMeter } from '../domain/speech/audioChunks';
import { BrowserSpeechProvider, browserRecognitionCtor } from '../domain/speech/browserProvider';
import { CloudSpeechProvider, type AudioChunk, type Mic } from '../domain/speech/cloudProvider';
import { SpeechService } from '../domain/speech/service';
import { parseSpeechSettings, resolveProvider, SPEECH_KEY, unavailableError, type Env, type SpeechSettings } from '../domain/speech/settings';
import { SpeechError, type ProviderKind, type SpeechLang, type SpeechStatus } from '../domain/speech/types';
import { desktop } from '../domain/desktop';

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────
const readSettings = (): SpeechSettings => {
  try { return parseSpeechSettings(localStorage.getItem(SPEECH_KEY)); } catch { return parseSpeechSettings(null); }
};
let settings = readSettings();
const settingsSubs = new Set<() => void>();
export const getSpeechSettings = (): SpeechSettings => settings;
export function setSpeechSettings(patch: Partial<SpeechSettings>): void {
  const next = { ...settings, ...patch };
  if (next.provider === settings.provider && next.lang === settings.lang) return;
  settings = next;
  try { localStorage.setItem(SPEECH_KEY, JSON.stringify(settings)); } catch { /* kept for this session only */ }
  settingsSubs.forEach((f) => f());
  speechService.reconfigure();
}
export const useSpeechSettings = (): SpeechSettings => useSyncExternalStore((f) => { settingsSubs.add(f); return () => settingsSubs.delete(f); }, getSpeechSettings);

// ── Is the cloud provider configured? (asked of the local server) ────────────────────────────────
export interface CloudInfo { configured: boolean; via: string; model: string }
let cloud: CloudInfo | null = null;
const cloudSubs = new Set<() => void>();
export const getCloudInfo = (): CloudInfo | null => cloud;
export async function refreshCloudInfo(): Promise<CloudInfo | null> {
  try {
    const r = await fetch('/api/ai/speech-status');
    cloud = r.ok ? await r.json() as CloudInfo : { configured: false, via: '', model: '' };
  } catch { cloud = { configured: false, via: '', model: '' }; }
  cloudSubs.forEach((f) => f());
  speechService.reconfigure();
  return cloud;
}
export function useCloudInfo(): CloudInfo | null {
  const info = useSyncExternalStore((f) => { cloudSubs.add(f); return () => cloudSubs.delete(f); }, getCloudInfo);
  useEffect(() => { if (getCloudInfo() === null) void refreshCloudInfo(); }, []);
  return info;
}

const env = (): Env => ({ browser: browserRecognitionCtor() !== null, cloud: cloud ? cloud.configured : null, desktopApp: !!desktop });

/** Which provider would run now, or null. */
export const currentProvider = (): ProviderKind | null => resolveProvider(settings.provider, env());
/** Can speech recognition run at all here (the old speechSupported). */
export const speechAvailable = (): boolean => currentProvider() !== null;
/** Why not, in Korean, or null. */
export const speechUnavailableReason = (): string | null => unavailableError(settings.provider, env())?.message ?? null;

// ── Cloud provider: microphone, chunks, upload ───────────────────────────────────────────────────
const SAMPLE_MS = 100;

async function openMic(): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new SpeechError('unsupported', '이 환경에서는 마이크 녹음을 쓸 수 없습니다.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new SpeechError(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-mic' : 'mic-denied');
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  let closed = false;
  let cancel: (() => void) | null = null;
  const rms = () => { analyser.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
  return {
    record: () => new Promise<AudioChunk | null>((resolve) => {
      if (closed) { resolve(null); return; }
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts: Blob[] = [];
      const meter = new ChunkMeter();
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.onstop = () => { clearInterval(timer); cancel = null; resolve(closed ? null : { blob: new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' }), loud: meter.heardSpeech }); };
      const timer = setInterval(() => { if (meter.sample(rms(), SAMPLE_MS) && rec.state === 'recording') rec.stop(); }, SAMPLE_MS);
      cancel = () => { if (rec.state === 'recording') rec.stop(); };
      rec.start();
    }),
    close: () => { closed = true; cancel?.(); stream.getTracks().forEach((t) => t.stop()); void ctx.close().catch(() => undefined); },
  };
}

async function transcribe(chunk: AudioChunk, lang: SpeechLang): Promise<string> {
  const blob = chunk.blob as Blob;
  let res: Response;
  try {
    res = await fetch(`/api/ai/transcribe?lang=${encodeURIComponent(lang)}`, { method: 'POST', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
  } catch {
    throw new SpeechError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'network');
  }
  const data = await res.json().catch(() => ({})) as { text?: string; error?: string; code?: string };
  if (res.ok) return data.text ?? '';
  if (data.code === 'no-key') throw new SpeechError('no-key', data.error);
  if (data.code === 'bad-key' || res.status === 401 || res.status === 403) throw new SpeechError('bad-key');
  if (data.code === 'quota' || res.status === 429) throw new SpeechError('quota');
  if (data.code === 'offline') throw new SpeechError('offline');
  throw new SpeechError(res.status >= 500 ? 'network' : 'unknown', data.error);
}

// ── The service ──────────────────────────────────────────────────────────────────────────────────
export const speechService = new SpeechService({
  resolve: currentProvider,
  lang: () => settings.lang,
  unavailable: () => unavailableError(settings.provider, env()) ?? new SpeechError('unsupported'),
  create: (kind) => (kind === 'cloud' ? new CloudSpeechProvider({ openMic, transcribe }) : new BrowserSpeechProvider()),
});

let lastStatus: SpeechStatus = speechService.getStatus();
speechService.watch((s) => { lastStatus = s; });
export const useSpeechStatus = (): SpeechStatus => useSyncExternalStore((f) => speechService.watch(f), () => lastStatus);
