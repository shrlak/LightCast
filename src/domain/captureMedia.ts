// Insert › Audio › Record Audio (오디오 녹음) and Insert › Screenshot (화면 캡처): the pure parts —
// file names, recorder formats, error wording and the elements that are put on the slide.
import type { SlideElement } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { naturalSize } from './pictureFormat';

/** Recorder formats in order of preference (Chromium / Electron: webm-opus; Safari: mp4). */
export const RECORDER_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

export function pickRecorderMime(isSupported: ((mime: string) => boolean) | undefined): string {
  if (!isSupported) return '';
  return RECORDER_MIMES.find((m) => { try { return isSupported(m); } catch { return false; } }) ?? '';
}

export function audioExtension(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('aac')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** A name typed by the user as a safe file stem (no path or reserved characters), '' when nothing is left. */
export function cleanClipName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
}

/** `녹음 20260102-030405.webm`, or the typed name with the right extension. */
export function recordingFileName(typed: string, mime: string, now: Date): string {
  const ext = audioExtension(mime);
  const stem = cleanClipName(typed).replace(/\.(webm|ogg|m4a|mp4|wav)$/i, '') || `녹음 ${stamp(now)}`;
  return `${stem}.${ext}`;
}

export const screenshotFileName = (now: Date) => `화면 캡처 ${stamp(now)}.png`;

/** 0:07 / 12:03 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The audio object for a recording: the same as an inserted audio file (speaker icon, plays when the slide appears). */
export function recordedAudioElement(id: string, mediaId: string, name: string): SlideElement {
  return { id, kind: 'audio', mediaId, x: 660, y: 480, w: 120, h: 120, name, playback: { autoplay: true } };
}

/** The picture object for a capture: shrunk to at most 1200 x 900, enlarged to at least half the slide, centred. */
export function screenshotElement(id: string, mediaId: string, name: string, imgW: number, imgH: number): SlideElement {
  let w = 1000, h = 600;
  if (imgW > 0 && imgH > 0) {
    const nat = naturalSize({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, imgW, imgH, Math.min(CANVAS_W, 1200), Math.min(CANVAS_H, 900));
    w = nat.w; h = nat.h;
    if (w < CANVAS_W / 2) {
      const k = (CANVAS_W / 2) / w;
      w = Math.round(w * k); h = Math.round(h * k);
    }
  }
  return { id, kind: 'image', mediaId, fit: 'contain', x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w, h, name };
}

export type CaptureKind = 'microphone' | 'screen';

export const unsupportedMessage = (kind: CaptureKind) =>
  kind === 'microphone' ? '이 환경에서는 오디오 녹음을 지원하지 않습니다.' : '이 환경에서는 화면 캡처를 지원하지 않습니다.';

/** A clear Korean message for a getUserMedia / getDisplayMedia / MediaRecorder failure. */
export function captureErrorMessage(err: unknown, kind: CaptureKind): string {
  const name = typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : '';
  const what = kind === 'microphone' ? '마이크' : '화면';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return kind === 'microphone'
        ? '마이크 사용이 허용되지 않았습니다. 시스템 설정(개인 정보 보호 › 마이크)에서 LightCast를 허용한 뒤 다시 시도하세요.'
        : '화면 캡처가 허용되지 않았거나 취소되었습니다. 시스템 설정(개인 정보 보호 › 화면 녹화)에서 LightCast를 허용한 뒤 다시 시도하세요.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return kind === 'microphone' ? '사용할 수 있는 마이크가 없습니다. 마이크를 연결한 뒤 다시 시도하세요.' : '캡처할 화면이나 창을 찾을 수 없습니다.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return `${what}를 사용할 수 없습니다. 다른 프로그램이 사용 중인지 확인하세요.`;
    case 'NotSupportedError':
      return unsupportedMessage(kind);
    default:
      return `${what}를 사용하지 못했습니다${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
  }
}

export interface MediaEnv { mediaDevices?: { getUserMedia?: unknown; getDisplayMedia?: unknown }; MediaRecorder?: unknown }

export function canRecordAudio(env: MediaEnv): boolean {
  return typeof env.mediaDevices?.getUserMedia === 'function' && typeof env.MediaRecorder === 'function';
}
export function canCaptureScreen(env: MediaEnv): boolean {
  return typeof env.mediaDevices?.getDisplayMedia === 'function';
}
