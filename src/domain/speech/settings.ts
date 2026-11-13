// Speech settings (provider, language), choosing the provider, and the plain-Korean wording for every status.
import { SpeechError, type ProviderKind, type ProviderPref, type SpeechLang, type SpeechStatus } from './types';

export interface SpeechSettings { provider: ProviderPref; lang: SpeechLang }
export const DEFAULT_SPEECH: SpeechSettings = { provider: 'auto', lang: 'ko-KR' };
export const SPEECH_KEY = 'lightcast.speech';
export const PROVIDER_CHOICES: { id: ProviderPref; label: string; hint: string }[] = [
  { id: 'auto', label: '자동', hint: '데스크톱 앱은 클라우드(설정되어 있을 때), 브라우저는 브라우저 음성 인식을 씁니다.' },
  { id: 'browser', label: '브라우저', hint: '크롬·엣지·사파리의 음성 인식. 데스크톱 앱에는 들어 있지 않습니다.' },
  { id: 'cloud', label: '클라우드', hint: '마이크 소리를 2~3초씩 잘라 음성 인식 서버로 보냅니다. API 키가 필요합니다.' },
];

export function parseSpeechSettings(raw: string | null | undefined): SpeechSettings {
  try {
    const o = JSON.parse(raw ?? '{}') as Partial<SpeechSettings>;
    return { provider: o.provider === 'browser' || o.provider === 'cloud' ? o.provider : 'auto', lang: o.lang === 'en-US' ? 'en-US' : 'ko-KR' };
  } catch { return { ...DEFAULT_SPEECH }; }
}

export interface Env {
  /** The browser has the Web Speech API. */
  browser: boolean;
  /** The LightCast server has a speech-to-text key; null while still unknown. */
  cloud: boolean | null;
  desktopApp: boolean;
}

/**
 * Which provider runs. 자동: the desktop app prefers the cloud (when configured), a browser prefers its own;
 * the other one is the fallback. A forced choice is never swapped silently. null: nothing can run.
 */
export function resolveProvider(pref: ProviderPref, env: Env): ProviderKind | null {
  const cloudOk = env.cloud !== false;
  if (pref === 'browser') return env.browser ? 'browser' : null;
  if (pref === 'cloud') return cloudOk ? 'cloud' : null;
  if (env.desktopApp) return env.cloud === true ? 'cloud' : env.browser ? 'browser' : env.cloud === null ? 'cloud' : null;
  return env.browser ? 'browser' : env.cloud === true ? 'cloud' : null;
}

/** Why nothing can run right now (with how to turn it on), or null when something can. */
export function unavailableError(pref: ProviderPref, env: Env): SpeechError | null {
  if (resolveProvider(pref, env)) return null;
  if (pref === 'browser') return new SpeechError('unsupported', env.desktopApp
    ? '이 데스크톱 앱에는 브라우저 음성 인식이 들어 있지 않습니다. 설정에서 제공자를 "클라우드"로 바꾸고 음성 인식 키를 넣어 주세요.'
    : '이 브라우저는 음성 인식을 지원하지 않습니다. 크롬, 엣지 또는 사파리를 쓰거나 제공자를 "클라우드"로 바꿔 주세요.');
  return new SpeechError('no-key', env.desktopApp
    ? '자막을 쓰려면 음성 인식 키가 필요합니다. 설정 › AI 에서 "음성 인식(자막)" 키를 넣어 주세요. 크롬이나 엣지로 LightCast를 열어도 키 없이 쓸 수 있습니다.'
    : '이 브라우저는 음성 인식을 지원하지 않고, 클라우드 음성 인식도 설정되어 있지 않습니다. 크롬, 엣지 또는 사파리를 쓰세요.');
}

/** Plain-Korean message for an error. */
export function speechErrorMessage(e: SpeechError): string {
  switch (e.kind) {
    case 'mic-denied': return '마이크 사용이 막혀 있습니다. 컴퓨터(또는 브라우저) 설정에서 LightCast의 마이크를 허용해 주세요.';
    case 'no-mic': return '마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해 주세요.';
    case 'no-key': return e.message && e.message !== 'no-key' ? e.message : '음성 인식 키가 없습니다. 설정 › AI 에서 키를 넣어 주세요.';
    case 'bad-key': return '음성 인식 키가 맞지 않습니다. 설정 › AI 에서 키를 다시 확인해 주세요.';
    case 'offline': return '인터넷에 연결되어 있지 않습니다. 연결되면 자동으로 다시 시도합니다.';
    case 'quota': return '음성 인식 사용량 한도에 도달했습니다. 잠시 뒤 자동으로 다시 시도합니다.';
    case 'network': return '음성 인식 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
    case 'unsupported': return e.message && e.message !== 'unsupported' ? e.message : '이 환경에서는 음성 인식을 쓸 수 없습니다.';
    default: return `음성 인식 오류${e.message && e.message !== 'unknown' ? `: ${e.message}` : ''}`;
  }
}

/** One line for the settings card: what is happening now. */
export function speechStatusText(s: SpeechStatus, resolved: ProviderKind | null): string {
  const via = (k: ProviderKind | null) => (k === 'cloud' ? '클라우드' : k === 'browser' ? '브라우저' : '');
  if (s.state === 'error' && s.error) {
    const wait = s.retryInMs ? ` (${Math.ceil(s.retryInMs / 1000)}초 뒤 다시 시도)` : '';
    return `${speechErrorMessage(s.error)}${wait}`;
  }
  if (s.state === 'listening') return `듣는 중 · ${via(s.provider)}`;
  if (s.state === 'starting') return `마이크를 여는 중 · ${via(s.provider)}`;
  return resolved ? `준비됨 · ${via(resolved)}` : '사용할 수 없음';
}
