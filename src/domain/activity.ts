import type { ActivityEntry, Library } from './types';
import type { Action, AppState } from './reducer';

export const ACTIVITY_LIMIT = 2000;
const SKIP = new Set(['trash/expire', 'library/merge', 'library/cloudReset', 'online/songs', 'songs/dedupe', 'services/finish', 'device/register', 'activity/record', 'usage/clear']);
const LABELS: Record<string, string> = {
  'presentation/create': '프레젠테이션 추가', 'presentation/createMany': '자료 가져오기', 'presentation/update': '프레젠테이션 수정', 'presentation/delete': '프레젠테이션 삭제',
  'presentation/protect': '자료 보호 설정',
  'trash/restore': '휴지통 복원', 'trash/purge': '휴지통 영구 삭제',
  'slide/update': '슬라이드 수정', 'slide/delete': '슬라이드 삭제', 'media/add': '미디어 추가', 'media/remove': '미디어 삭제', 'sunday/settings': '예배 설정 수정',
  'playlist/retention': '예배 자동 삭제 설정', 'playlist/set': '예배 순서 수정', 'playlist/create': '재생목록 추가', 'playlist/rename': '재생목록 이름 변경', 'playlist/delete': '재생목록 삭제',
  'theme/upsert': '테마 수정', 'theme/delete': '테마 삭제', 'screen/upsert': '출력 화면 설정', 'screen/delete': '출력 화면 삭제',
  'playlist/addItem': '예배 순서 추가', 'playlist/removeItem': '예배 순서 제거', 'playlist/move': '예배 순서 이동', 'playlist/duplicate': '재생목록 복제',
  'timer/upsert': '타이머 설정', 'timer/delete': '타이머 삭제', 'timer/op': '타이머 조작', 'prop/upsert': '소품 수정', 'prop/delete': '소품 삭제',
  'macro/upsert': '매크로 수정', 'macro/delete': '매크로 삭제', 'macro/run': '매크로 실행', 'template/upsert': '메시지 양식 수정', 'template/delete': '메시지 양식 삭제',
  'look/save': '화면 구성 저장', 'look/delete': '화면 구성 삭제', 'look/apply': '화면 구성 적용', 'stageLayout/upsert': '무대 화면 설정', 'stageLayout/delete': '무대 화면 삭제',
  'schedule/upsert': '예약 설정', 'schedule/delete': '예약 삭제', 'arrangement/upsert': '찬양 진행 수정', 'arrangement/delete': '찬양 진행 삭제', 'arrangement/select': '찬양 진행 선택', 'library/logo': '로고 설정', 'media/markers': '미디어 구간 수정',
  'library/replace': '라이브러리 복원·가져오기', undo: '실행 취소', redo: '다시 실행', 'show/start': '발표 시작', 'show/end': '발표 종료', 'account/login': '로그인', 'account/logout': '로그아웃', 'app/open': '앱 접속', 'device/profile': '기기 이름 등록', 'live/go': '발표 사용', 'live/next': '발표 사용',
};
export const actionLabel = (action: string): string => LABELS[action] ?? '설정 변경';
export function mergeActivity(a: ActivityEntry[] = [], b: ActivityEntry[] = []): ActivityEntry[] {
  const entries = new Map([...a, ...b].map((e) => [e.id, e]));
  return [...entries.values()].sort((x, y) => x.at - y.at || x.id.localeCompare(y.id)).slice(-ACTIVITY_LIMIT);
}
export function newestModification(a?: ActivityEntry, b?: ActivityEntry): ActivityEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.at > b.at || (a.at === b.at && a.id > b.id) ? a : b;
}
/**
 * An edit a person made on this computer (stamped, attributed): not sync, not an automatic refresh that every
 * computer makes by itself (template refresh, generated theme, hidden background, weekly cleanup).
 */
export function isPersonalEdit(before: AppState, after: AppState, a: Action): boolean {
  if (!a.actor || !a.eventId || a.occurredAt == null || after.library === before.library || SKIP.has(a.type)) return false;
  return !(a.type === 'presentation/replaceMany' || (a.type === 'presentation/update' && 'templateKey' in a.patch) || (a.type === 'theme/upsert' && a.theme.generated) || (a.type === 'media/add' && a.media.backgroundHidden));
}

/** Apply attribution after the pure reducer; sync and automated template refreshes never become local edits. */
export function attributeChange(before: AppState, after: AppState, a: Action): AppState {
  if (!isPersonalEdit(before, after, a)) return after;
  const usageOnly = a.type.startsWith('live/');
  if (usageOnly && after.library.usage === before.library.usage) return after;
  const target = 'presentationId' in a ? a.presentationId : 'id' in a ? a.id : undefined;
  const p = before.library.presentations.find((p) => p.id === target) ?? after.library.presentations.find((p) => p.id === target) ?? before.library.trash?.find((e) => e.id === target)?.presentation;
  const detail = (usageOnly ? after.library.usage.at(-1)?.title : undefined) ?? p?.title ?? ('presentation' in a ? a.presentation.title : 'media' in a ? a.media.name : 'playlist' in a && a.playlist ? a.playlist.name : 'name' in a ? String(a.name) : actionLabel(a.type));
  const entry: ActivityEntry = { id: a.eventId!, at: a.occurredAt!, action: a.type, detail, device: a.actor!, account: a.account ?? null };
  const history = mergeActivity(before.library.activity, after.library.activity);
  const last = history.at(-1);
  // Coalesce repeated text edits without flooding the activity list on every keystroke.
  const repeated = a.type === 'slide/update' || a.type === 'presentation/update' || a.type === 'sunday/settings';
  const activity = repeated && last?.action === entry.action && last.device.id === entry.device.id && last.detail === entry.detail && entry.at >= last.at && entry.at - last.at < 5000
    ? mergeActivity(history.filter((e) => e.id !== last.id), [entry]) : mergeActivity(history, [entry]);
  const library: Library = { ...after.library, activity, ...(usageOnly ? {} : { lastModified: entry }) };
  if (a.type === 'undo' || a.type === 'redo' || a.type === 'library/replace') library.devices = before.library.devices;
  if (usageOnly) library.usage = after.library.usage.map((u) => before.library.usage.includes(u) ? u : { ...u, device: a.actor!, account: a.account });
  return { ...after, library };
}

export function isDeviceIdentity(v: unknown): v is import('./types').DeviceIdentity {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return ['id', 'name', 'userName', 'platform'].every((key) => typeof d[key] === 'string');
}
export function isActivityEntry(v: unknown): v is ActivityEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.at === 'number' && Number.isFinite(e.at) && typeof e.action === 'string' && typeof e.detail === 'string' && isDeviceIdentity(e.device) && (e.account === null || typeof e.account === 'string');
}

export function mergeDevices(a: import('./types').DeviceRegistration[] = [], b: import('./types').DeviceRegistration[] = []): import('./types').DeviceRegistration[] {
  const result = new Map<string, import('./types').DeviceRegistration>();
  for (const d of [...a, ...b]) {
    const old = result.get(d.id);
    if (!old || d.lastSeen > old.lastSeen || (d.lastSeen === old.lastSeen && JSON.stringify(d) > JSON.stringify(old))) result.set(d.id, d);
  }
  return [...result.values()].sort((x, y) => x.id.localeCompare(y.id));
}
