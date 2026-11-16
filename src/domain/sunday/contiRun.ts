// The 콘티 being read, kept outside any screen. The 주일예배 마법사 has one tab per step, and a step's screen is
// thrown away when another tab is opened, so the progress, the result and the "already reading" state cannot live
// in it. Here they live for as long as the app runs: the reading goes on while another tab (or another part of the
// app) is open, the wizard shows its progress on every tab, and the result is put into the draft when it is done.
import { readConti, type ContiReading, type ReadContiOptions } from '../recognition/conti';

export interface ContiRun {
  id: number;
  fileName: string;
  status: 'running' | 'done' | 'error';
  /** What the reading is doing now (a line of the recognition's progress). */
  progress: string;
  startedAt: number;
  endedAt?: number;
  reading?: ContiReading;
  /** Notices the recognition gave on the way (a page it could not place, …). */
  notes: string[];
  error?: string;
  /** The wizard's songs when the reading started: the result replaces them only if nobody changed them since. */
  songsAtStart: string;
  /** The result is in the draft. */
  applied: boolean;
  /** The finish (or the failure) has been told to the operator. */
  announced: boolean;
}

export type ContiReader = (file: File, opts: ReadContiOptions) => Promise<ContiReading>;

export interface StartOptions extends Omit<ReadContiOptions, 'notify' | 'progress'> {
  /** JSON of the songs now in the wizard's draft. */
  songsAtStart: string;
  /** Told when the reading ends while no screen is showing it (nobody would see the result otherwise). */
  notifyLate?: (message: string) => void;
}

let current: ContiRun | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getContiRun = (): ContiRun | null => current;
export function subscribeContiRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const patch = (id: number, p: Partial<ContiRun>) => {
  if (!current || current.id !== id) return;
  current = { ...current, ...p };
  emit();
};

/** The line told when a reading is done. */
export function contiDoneMessage(run: ContiRun): string {
  const r = run.reading;
  if (!r) return '';
  const unread = r.songs.filter((s) => s.needsReview).length;
  return `콘티를 읽었습니다: ${r.songs.length}곡${unread ? ` (${unread}곡은 악보와 맞는지 확인하세요)` : ''}.${run.notes.length ? ` ${run.notes.join(' ')}` : ''}`;
}

/**
 * Starts reading a 콘티. Only one is read at a time: while one is running this returns null and changes nothing.
 * The returned run is the one shown by `getContiRun` (it is replaced by newer snapshots as it goes).
 */
export function startContiRun(file: File, opts: StartOptions, reader: ContiReader = readConti): ContiRun | null {
  if (current?.status === 'running') return null;
  const id = nextId++;
  const notes: string[] = [];
  current = { id, fileName: file.name, status: 'running', progress: '콘티 읽는 중…', startedAt: Date.now(), notes: [], songsAtStart: opts.songsAtStart, applied: false, announced: false };
  emit();
  const { songsAtStart: _s, notifyLate, ...readOpts } = opts;
  void reader(file, { ...readOpts, notify: (m) => { notes.push(m); }, progress: (m) => patch(id, { progress: m }) })
    .then(
      (reading) => patch(id, { status: 'done', reading, notes: [...notes], endedAt: Date.now(), progress: '' }),
      (e: unknown) => patch(id, { status: 'error', error: e instanceof Error ? e.message : String(e), notes: [...notes], endedAt: Date.now(), progress: '' }),
    )
    .then(() => {
      // No screen is watching (the wizard was closed): say it here, as the wizard would have.
      if (listeners.size || current?.id !== id || current.announced) return;
      const run = current;
      patch(id, { announced: true });
      notifyLate?.(run.status === 'done' ? `${contiDoneMessage(run)} 주일예배 마법사의 찬양 단계에서 확인하세요.` : `콘티 읽기에 실패했습니다: ${run.error ?? ''}`);
    });
  return current;
}

export const markContiApplied = (id: number) => patch(id, { applied: true, announced: true });
export const markContiAnnounced = (id: number) => patch(id, { announced: true });
/** Forget a finished reading (a failed one, or a result nobody wants). A running one stays. */
export function dismissContiRun(id: number) {
  if (current?.id === id && current.status !== 'running') { current = null; emit(); }
}

/** The wizard's songs are what they were when the reading started. */
export const songsUnchangedSince = (run: ContiRun, songsNow: string): boolean => run.songsAtStart === songsNow;

/** For tests: forget everything. */
export function resetContiRunForTests() { current = null; listeners.clear(); }
