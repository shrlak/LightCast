// 슬라이드 쇼 › 모니터: which display shows the audience slide show and which one the presenter view.
// Pure logic: the list of displays comes from Electron (screen.getAllDisplays over IPC) or, in a
// browser, from the Window Management API (getScreenDetails); see src/ui/useMonitors.ts.

export interface Monitor {
  /** Stable key: the Electron display id, or "left,top,width×height" in a browser. */
  id: string;
  label: string;
  primary: boolean;
  /** Position and size in screen pixels (browser only; needed to open a window there). */
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** What the person chose; null = automatic. */
export interface MonitorChoice { audience: string | null; presenter: string | null }
export const NO_CHOICE: MonitorChoice = { audience: null, presenter: null };

/** A saved choice read back from storage (anything else becomes "automatic"). */
export function normalizeChoice(raw: unknown): MonitorChoice {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ok = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length < 200 ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
  return { audience: ok(o.audience), presenter: ok(o.presenter) };
}

export interface ResolvedMonitors {
  audience: Monitor | null;
  presenter: Monitor | null;
  /** Korean lines for a notice: a chosen monitor that is gone, or that both roles landed on one. */
  notes: string[];
}

const nameOf = (m: Monitor) => m.label || m.id;

/**
 * The monitors to use. With a single monitor both stay null (the show runs on it, with the presenter
 * view in the editor). With more, an unset or disconnected audience choice becomes the first monitor
 * that is not the presenter's, and the presenter defaults to the main monitor; one monitor never gets
 * both roles while another exists.
 */
export function resolveMonitors(monitors: Monitor[], choice: MonitorChoice): ResolvedMonitors {
  const notes: string[] = [];
  if (monitors.length < 2) {
    if (choice.audience || choice.presenter) notes.push('모니터가 하나뿐이라 이 화면에서 쇼를 진행합니다.');
    return { audience: null, presenter: null, notes };
  }
  const find = (id: string | null) => monitors.find((m) => m.id === id) ?? null;
  let presenter = find(choice.presenter);
  let audience = find(choice.audience);
  if (choice.presenter && !presenter) notes.push('발표자 보기로 정한 모니터가 연결되어 있지 않아 기본 모니터로 바꿨습니다.');
  if (choice.audience && !audience) notes.push('청중 화면으로 정한 모니터가 연결되어 있지 않아 다른 모니터로 바꿨습니다.');
  presenter ??= monitors.find((m) => m.primary && m.id !== audience?.id) ?? monitors.find((m) => m.id !== audience?.id) ?? monitors[0];
  if (audience && audience.id === presenter.id) {
    // Both roles on one monitor: the audience yields, as the presenter view is the one being operated.
    notes.push(`청중 화면과 발표자 보기가 같은 모니터(${nameOf(audience)})입니다. 청중 화면을 다른 모니터로 옮겼습니다.`);
    audience = null;
  }
  audience ??= monitors.find((m) => m.id !== presenter!.id) ?? null;
  return { audience, presenter, notes };
}

/** Which monitors appeared or disappeared between two lists. */
export function diffMonitors(before: Monitor[], after: Monitor[]): { added: Monitor[]; removed: Monitor[] } {
  const had = new Set(before.map((m) => m.id));
  const has = new Set(after.map((m) => m.id));
  return { added: after.filter((m) => !had.has(m.id)), removed: before.filter((m) => !has.has(m.id)) };
}

/** The notice shown when the set of monitors changes while LightCast is open (null: nothing changed). */
export function changeNotice(before: Monitor[], after: Monitor[]): string | null {
  const { added, removed } = diffMonitors(before, after);
  if (removed.length) return `모니터 ${removed.map(nameOf).join(', ')} 연결이 끊어졌습니다. 쇼 설정 › 모니터에서 확인하세요.`;
  if (added.length) return `모니터 ${added.map(nameOf).join(', ')}이(가) 연결되었습니다. 쇼 설정 › 모니터에서 청중 화면과 발표자 보기를 고를 수 있습니다.`;
  return null;
}

/** Electron's display list as monitors. */
export function fromDesktop(displays: { id: number; label: string; primary: boolean }[]): Monitor[] {
  return displays.map((d) => ({ id: String(d.id), label: d.label, primary: d.primary }));
}

/** The Window Management API's screens (ScreenDetailed) as monitors; tolerant of missing fields. */
export function fromScreenDetails(screens: ArrayLike<{ label?: string; isPrimary?: boolean; left?: number; top?: number; width?: number; height?: number }>): Monitor[] {
  const out: Monitor[] = [];
  for (let i = 0; i < Math.min(screens.length, 16); i++) {
    const s = screens[i];
    const w = Number(s.width) || 0, h = Number(s.height) || 0, l = Number(s.left) || 0, t = Number(s.top) || 0;
    out.push({ id: `${l},${t},${w}x${h}`, label: `${s.label || `모니터 ${i + 1}`}${w && h ? ` (${w}×${h})` : ''}${s.isPrimary ? ' · 주 모니터' : ''}`, primary: !!s.isPrimary, left: l, top: t, width: w, height: h });
  }
  return out;
}

/** window.open features that place a popup on a monitor (browser, Window Management API). */
export function popupFeatures(m: Monitor | null): string {
  if (!m || m.left === undefined || m.top === undefined) return 'popup,width=960,height=540';
  return `popup,left=${m.left},top=${m.top},width=${m.width || 960},height=${m.height || 540}`;
}

const KEY = 'lightcast.showMonitors';
export function loadChoice(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): MonitorChoice {
  try {
    return normalizeChoice(JSON.parse(storage?.getItem(KEY) ?? 'null'));
  } catch { return NO_CHOICE; }
}
export function saveChoice(choice: MonitorChoice, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(choice)); } catch { /* storage unavailable */ }
}
