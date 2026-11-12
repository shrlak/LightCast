// Crash recovery. LightCast saves every edit to this computer at once and takes restore points
// every 10 minutes, so nothing has to be "recovered" by hand — but after a crash or a power cut
// the operator should be told, and pointed at the restore points in case the last save did not land.
const KEY = 'freecast.session';
/** A heartbeat older than this, with no clean exit recorded, means the last run ended badly. */
export const STALE_MS = 30_000;
export const BEAT_MS = 5_000;

export interface SessionMark { at: number; closed: boolean; saveFailed?: boolean }

/** Did the run that wrote `prev` end without closing (crash, power cut, killed)? Another window's live heartbeat does not count. */
export function endedBadly(prev: SessionMark | null, now: number): boolean {
  return !!prev && !prev.closed && now - prev.at > STALE_MS;
}

function read(): SessionMark | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.at === 'number' ? { at: v.at, closed: !!v.closed, saveFailed: !!v.saveFailed } : null;
  } catch {
    return null;
  }
}
function write(m: SessionMark) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage blocked: no recovery notice, the app carries on */ }
}

/** The library could not be written to this computer (storage full or blocked). */
export function noteSaveFailed(failed: boolean) {
  const m = read();
  if (m && !!m.saveFailed !== failed) write({ ...m, saveFailed: failed });
}

/** Start of a run: reports how the last one ended, then keeps a heartbeat until the page closes. Returns the stop function. */
export function beginSession(onPrevious: (r: { crashed: boolean; saveFailed: boolean }) => void): () => void {
  const prev = read();
  const crashed = endedBadly(prev, Date.now());
  if (crashed) onPrevious({ crashed, saveFailed: !!prev?.saveFailed });
  const beat = () => write({ at: Date.now(), closed: false, saveFailed: crashed ? !!prev?.saveFailed : read()?.saveFailed });
  beat();
  const timer = setInterval(beat, BEAT_MS);
  const close = () => write({ at: Date.now(), closed: true, saveFailed: read()?.saveFailed });
  window.addEventListener('pagehide', close);
  return () => { clearInterval(timer); window.removeEventListener('pagehide', close); close(); };
}
