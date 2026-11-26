import type { DeviceIdentity } from './types';
import { desktop } from './desktop';

const KEY = 'freecast.device.v1';
let cached: DeviceIdentity | null = null;
export function getDevice(): DeviceIdentity {
  if (cached) return { ...cached };
  let saved: Partial<DeviceIdentity> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* Start a local identity when storage is unavailable. */ }
  const platform = /Windows/i.test(navigator.userAgent) ? 'Windows' : /Mac/i.test(navigator.userAgent) ? 'macOS' : /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : /Linux/i.test(navigator.userAgent) ? 'Linux' : 'Browser';
  cached = {
    id: typeof saved.id === 'string' && saved.id ? saved.id : crypto.randomUUID(),
    name: typeof saved.name === 'string' && saved.name.trim() ? saved.name : `${platform} 기기`,
    userName: typeof saved.userName === 'string' ? saved.userName : '',
    platform, appVersion: typeof saved.appVersion === 'string' ? saved.appVersion : undefined,
    ...(typeof saved.church === 'boolean' ? { church: saved.church } : {}),
  };
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* Identity lasts for this session. */ }
  return { ...cached };
}
export async function initializeDevice(): Promise<DeviceIdentity> {
  getDevice();
  if (desktop) {
    const info = await desktop.info();
    cached = { ...getDevice(), platform: info.platform, appVersion: info.version, computerName: info.computerName };
    try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* Session only. */ }
  }
  return getDevice();
}
const PROFILE_KEY = 'freecast.device.profileSaved';

/**
 * Whether this computer's name and user were ever registered. A computer someone gave a user name
 * before this flag existed counts as registered.
 */
export function deviceProfileSaved(): boolean {
  try { if (localStorage.getItem(PROFILE_KEY) === '1') return true; } catch { /* storage blocked */ }
  return !!getDevice().userName.trim();
}

export function saveDeviceProfile(name: string, userName: string): DeviceIdentity {
  if (!name.trim() || name.trim().length > 60 || userName.trim().length > 60) throw new Error('기기 이름은 1–60자, 기기 사용자 이름은 60자 이내로 입력하세요.');
  const next = { ...getDevice(), name: name.trim(), userName: userName.trim() };
  localStorage.setItem(KEY, JSON.stringify(next));
  try { localStorage.setItem(PROFILE_KEY, '1'); } catch { /* storage blocked */ }
  cached = next;
  return { ...next };
}
/** Mark this computer as the church computer (or not): it makes the Sunday 1:55 PM copy (sundayBackup.ts). */
export function saveChurchDevice(on: boolean): DeviceIdentity {
  const next = { ...getDevice(), church: on };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* this session only */ }
  cached = next;
  return { ...next };
}
export const deviceLabel = (d?: DeviceIdentity | null): string => d ? `${d.name}${d.userName ? ` · ${d.userName}` : ''}` : '기기 정보 없음 (이전 버전 기록)';
