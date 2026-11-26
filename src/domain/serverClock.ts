// The church server's clock as this computer sees it. Every edit is stamped with the time the server would give it,
// so when two devices change the same thing before they sync, the later edit wins however wrong either device's own
// clock is (as Google Docs orders edits by the server, not by each computer).
//
// The Worker's answers carry an HTTP Date header (whole seconds), passed on by the local server as
// `x-lightcast-server-date` (server/cloud.mjs). The answer was made at some moment T between sending the request and
// receiving the answer, and T is in [Date, Date + 1 s). So each answer bounds the offset (server − this computer):
//   offset ∈ [Date − receivedAt, Date + 1000 − sentAt]
// Intersecting the bounds of recent answers narrows the offset to about one round trip. When the bounds stop
// overlapping (this computer's clock was changed, or it slept), the old samples are dropped and it starts again.

export const SERVER_DATE_HEADER = 'x-lightcast-server-date';
const KEY = 'lightcast.serverClock';
/** Samples older than this no longer narrow the offset (clocks drift). */
const SAMPLE_LIFE = 15 * 60_000;
const MAX_SAMPLES = 40;

interface Sample { lo: number; hi: number; at: number }

export interface ServerClock {
  /** One answer: local send / receive times (ms) and the server's Date header (ms, whole seconds). */
  observe(sentAt: number, receivedAt: number, serverDate: number): void;
  /** Server time minus this computer's time (ms); 0 until the server was reached once. */
  offset(): number;
  /** The server's time now (ms), never going backwards on this computer. */
  now(): number;
  /** How sure the offset is (ms either side), Infinity before any answer. */
  uncertainty(): number;
  reset(): void;
}

export function createServerClock(local: () => number = () => Date.now(), storage: Pick<Storage, 'getItem' | 'setItem'> | null = null, mono?: () => number): ServerClock {
  let samples: Sample[] = [];
  let est = 0;
  let spread = Infinity;
  let last = -Infinity;
  // This computer's clock set forward or back (by the person, or by an NTP correction): seen against a clock that only
  // runs forward, and the offsets already learnt are moved by as much, instead of being wrong until they expire.
  let anchor: { local: number; mono: number } | null = null;
  const follow = () => {
    if (!mono) return;
    const now = { local: local(), mono: mono() };
    if (anchor) {
      const jump = (now.local - anchor.local) - (now.mono - anchor.mono);
      if (Math.abs(jump) > 50) {
        samples = samples.map((x) => ({ lo: x.lo - jump, hi: x.hi - jump, at: x.at + jump }));
        est -= jump;
        last = -Infinity;
      }
    }
    anchor = now;
  };
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null') as { offset?: unknown } | null;
    if (saved && typeof saved.offset === 'number' && Number.isFinite(saved.offset) && Math.abs(saved.offset) < 366 * 86_400_000) est = saved.offset;
  } catch { /* no saved offset */ }
  const recompute = () => {
    let lo = -Infinity, hi = Infinity;
    for (const s of samples) { lo = Math.max(lo, s.lo); hi = Math.min(hi, s.hi); }
    if (lo > hi) {
      // The newest answer disagrees with the older ones: this computer's clock moved. Start again from it.
      samples = samples.slice(-1);
      lo = samples[0].lo; hi = samples[0].hi;
    }
    est = Math.round((lo + hi) / 2);
    spread = (hi - lo) / 2;
    try { storage?.setItem(KEY, JSON.stringify({ offset: est })); } catch { /* this session only */ }
  };
  return {
    observe(sentAt, receivedAt, serverDate) {
      if (![sentAt, receivedAt, serverDate].every(Number.isFinite) || receivedAt < sentAt || receivedAt - sentAt > 60_000) return;
      follow();
      const now = local();
      samples = [...samples.filter((s) => now - s.at < SAMPLE_LIFE), { lo: serverDate - receivedAt, hi: serverDate + 1000 - sentAt, at: now }].slice(-MAX_SAMPLES);
      recompute();
    },
    offset: () => est,
    uncertainty: () => spread,
    now() {
      follow();
      const t = Math.round(local() + est);
      // Never backwards for small corrections (two edits in a row keep their order); a big correction is taken at once.
      if (t >= last || last - t > 2000) last = t;
      return last;
    },
    reset() { samples = []; est = 0; spread = Infinity; last = -Infinity; },
  };
}

const browserStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

/** This window's clock of the church server. */
export const serverClock = createServerClock(() => Date.now(), browserStorage(), typeof performance !== 'undefined' ? () => performance.now() : undefined);

/** The church server's time now (ms): what every edit is stamped with. */
export const serverNow = (): number => serverClock.now();

/** Read the server's Date from an answer of the cloud proxy and learn from it. */
export function learnServerTime(res: { headers: { get(name: string): string | null } }, sentAt: number, receivedAt: number, clock: ServerClock = serverClock): void {
  const raw = res.headers.get(SERVER_DATE_HEADER);
  if (!raw) return;
  const t = Date.parse(raw);
  if (Number.isFinite(t)) clock.observe(sentAt, receivedAt, t);
}
