// The Sunday 1:55 PM copy: five minutes before the service, if this Sunday's service is not already playing as a slide
// show, one computer saves it as a .pptx (Downloads/LightCast on the desktop app), so a copy that opens in PowerPoint is
// ready should anything go wrong. Which computer: the church computer when it is open; otherwise the open device that
// was opened most recently. Every open device says it is open shortly before (its `lastSeen` in the synced device list),
// so each one works out the same choice by itself. Pure logic; the timer and the export are in src/ui/useSundayBackup.ts.
import type { ActivityEntry, DeviceRegistration, Library, Playlist } from './types';
import { mmdd } from './sunday/notice';

/** When the copy is made (local time on Sundays), and until when a computer that was asleep at 1:55 still makes it. */
export const BACKUP_AT = { hour: 13, minute: 55 };
export const BACKUP_UNTIL = { hour: 14, minute: 25 };
/** Open devices say so from this many minutes before. */
export const PRESENCE_LEAD_MIN = 5;
/** A device that said it is open within this long is counted as open. */
export const PRESENT_FOR = 3 * 60_000;
export const BACKUP_ACTION = 'backup/sundayPptx';

const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();
const at = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: number, b: Date) => dayKey(new Date(a)) === dayKey(b);

/** Sunday, between 1:55 and 2:25 PM. */
export const backupWindow = (now: Date): boolean => now.getDay() === 0 && minutes(now) >= at(BACKUP_AT) && minutes(now) < at(BACKUP_UNTIL);
/** Sunday, the few minutes before 1:55 and the backup window: open devices say they are open. */
export const presenceWindow = (now: Date): boolean => now.getDay() === 0 && minutes(now) >= at(BACKUP_AT) - PRESENCE_LEAD_MIN && minutes(now) < at(BACKUP_UNTIL);
export const backupKey = (now: Date): string => dayKey(now);

/** This Sunday's service: the playlist the 주일예배 마법사 made for today ("1129 주일예배"). */
export function todaysService(lib: Library, now: Date): Playlist | null {
  const name = `${mmdd(now)} 주일예배`;
  return lib.playlists.find((p) => p.name.trim() === name && p.items.length > 0) ?? null;
}

/** A device is the church computer when marked so, or when its name says so (교회 · 본당 · 예배실 · church · sanctuary). */
export function isChurchDevice(d: Pick<DeviceRegistration, 'name' | 'computerName'> & { church?: boolean }): boolean {
  if (d.church === true) return true;
  if (d.church === false) return false;
  return /교회|본당|예배실|방송실|church|sanctuary/i.test(`${d.name ?? ''} ${d.computerName ?? ''}`);
}

/**
 * A slide show running on any device today: its last 발표 시작 (show/start) has no 발표 종료 after it. Shows started more
 * than four hours ago without an end (a computer that was switched off mid-show) do not count.
 */
export function showRunningSomewhere(activity: ActivityEntry[] | undefined, now: number): boolean {
  const last = new Map<string, ActivityEntry>();
  for (const e of activity ?? []) {
    if ((e.action !== 'show/start' && e.action !== 'show/end') || now - e.at > 4 * 3_600_000 || e.at > now + 60_000) continue;
    const prev = last.get(e.device.id);
    if (!prev || e.at >= prev.at) last.set(e.device.id, e);
  }
  return [...last.values()].some((e) => e.action === 'show/start');
}

/** The copy was already made today, on any device. */
export const backupDoneToday = (activity: ActivityEntry[] | undefined, now: Date): boolean =>
  (activity ?? []).some((e) => e.action === BACKUP_ACTION && sameDay(e.at, now));

/**
 * Which device makes the copy: the church computer among the open ones (the most recently seen if several), otherwise
 * the open device opened most recently. `self` is always counted as open. Ties go by id, the same on every device.
 */
export function backupDevice(devices: DeviceRegistration[] | undefined, activity: ActivityEntry[] | undefined, self: DeviceRegistration, now: number): string {
  const open = new Map<string, DeviceRegistration>();
  for (const d of devices ?? []) if (now - d.lastSeen <= PRESENT_FOR && d.lastSeen <= now + 60_000) open.set(d.id, d);
  open.set(self.id, { ...(open.get(self.id) ?? self), ...self, lastSeen: Math.max(self.lastSeen, open.get(self.id)?.lastSeen ?? 0) });
  const list = [...open.values()];
  const opened = new Map<string, number>();
  for (const e of activity ?? []) if (e.action === 'app/open') opened.set(e.device.id, Math.max(opened.get(e.device.id) ?? 0, e.at));
  const church = list.filter((d) => isChurchDevice(d));
  const pool = church.length ? church : list;
  const score = (d: DeviceRegistration) => (church.length ? d.lastSeen : opened.get(d.id) ?? d.lastSeen);
  pool.sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool[0].id;
}

export interface BackupCheck {
  now: Date;
  /** Server time (ms) — the same clock on every device. */
  serverNow: number;
  lib: Library;
  self: DeviceRegistration;
  /** A slide show is running on this computer. */
  showingHere: boolean;
  /** Signed in to the church server (other devices can be seen); without it this computer decides alone. */
  shared: boolean;
  /** This computer already made today's copy. */
  doneHere: boolean;
}

export type BackupDecision = { make: true; playlist: Playlist } | { make: false; why: 'not-time' | 'done' | 'showing' | 'no-service' | 'other-device' };

/** Whether this computer makes the Sunday copy now. */
export function sundayBackupDecision(c: BackupCheck): BackupDecision {
  if (!backupWindow(c.now)) return { make: false, why: 'not-time' };
  if (c.doneHere || (c.shared && backupDoneToday(c.lib.activity, c.now))) return { make: false, why: 'done' };
  if (c.showingHere || showRunningSomewhere(c.lib.activity, c.serverNow)) return { make: false, why: 'showing' };
  const playlist = todaysService(c.lib, c.now);
  if (!playlist) return { make: false, why: 'no-service' };
  if (c.shared && backupDevice(c.lib.devices, c.lib.activity, c.self, c.serverNow) !== c.self.id) return { make: false, why: 'other-device' };
  return { make: true, playlist };
}

/** The file name: "1129 주일예배 (자동 저장 13시55분).pptx". */
export const backupFileName = (playlist: Playlist, now: Date): string =>
  `${playlist.name.trim()} (자동 저장 ${String(now.getHours()).padStart(2, '0')}시${String(now.getMinutes()).padStart(2, '0')}분).pptx`;
