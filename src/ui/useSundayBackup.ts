// Sunday 1:55 PM: if this Sunday's service is not playing as a slide show, the church computer (or else the open device
// opened most recently) saves it as a .pptx — on the desktop app into Downloads/LightCast without asking, in a browser
// as an ordinary download. The rules are in src/domain/sundayBackup.ts.
import { useEffect, useRef, type Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { Library } from '../domain/types';
import { getDevice } from '../domain/device';
import { desktop } from '../domain/desktop';
import { loadSession } from '../domain/cloud';
import { serverNow } from '../domain/serverClock';
import { exportPptxBytes } from '../domain/io/pptxExport';
import { BACKUP_ACTION, backupFileName, backupKey, presenceWindow, sundayBackupDecision } from '../domain/sundayBackup';

const DONE_KEY = 'lightcast.sundayBackup.done';
const readDone = () => { try { return localStorage.getItem(DONE_KEY); } catch { return null; } };
const writeDone = (v: string | null) => { try { if (v) localStorage.setItem(DONE_KEY, v); else localStorage.removeItem(DONE_KEY); } catch { /* this session only */ } };

export function useSundayBackup({ library, dispatch, showing, notify }: { library: Library; dispatch: Dispatch<Action>; showing: boolean; notify: (m: string) => void }) {
  const lib = useRef(library); lib.current = library;
  const show = useRef(showing); show.current = showing;
  const say = useRef(notify); say.current = notify;
  useEffect(() => {
    let busy = false;
    let saidOpen = 0;
    const tick = async () => {
      const t = serverNow();
      const now = new Date(t);
      if (!presenceWindow(now) || busy) return;
      const session = loadSession();
      const self = { ...getDevice(), lastSeen: t, account: session?.username ?? null };
      // "This device is open": every minute from 1:50, so each device sees the same open devices at 1:55.
      if (session && t - saidOpen > 60_000) { saidOpen = t; dispatch({ type: 'device/register', device: self }); }
      const decision = sundayBackupDecision({ now, serverNow: t, lib: lib.current, self, showingHere: show.current, shared: !!session, doneHere: readDone() === backupKey(now) });
      if (!decision.make) return;
      busy = true;
      writeDone(backupKey(now));
      try {
        const bytes = await exportPptxBytes(lib.current, { playlist: decision.playlist });
        const name = backupFileName(decision.playlist, now);
        let where = desktop?.saveDownload ? await desktop.saveDownload(name, bytes) : null;
        if (!where) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
          a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          where = `다운로드 폴더 (${name})`;
        }
        // Told to every device (synced activity), so none of them makes a second copy today.
        dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: serverNow(), action: BACKUP_ACTION, detail: decision.playlist.name, device: getDevice(), account: session?.username ?? null } });
        say.current(`오후 1시 55분: 이번 주일예배가 아직 발표 중이 아니어서 PPTX 사본을 저장했습니다 — ${where}`);
      } catch (e) {
        writeDone(null);
        say.current(`주일예배 PPTX 자동 저장에 실패했습니다 (${(e as Error).message}). 파일 → 내보내기로 저장하세요.`);
      } finally { busy = false; }
    };
    const timer = setInterval(() => void tick(), 15_000);
    void tick();
    return () => clearInterval(timer);
  }, [dispatch]);
}
