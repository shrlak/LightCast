// The 콘티 reading (domain/sunday/contiRun) as seen from the wizard's screens, and putting its result in the draft.
import { useSyncExternalStore } from 'react';
import { contiDoneMessage, getContiRun, markContiApplied, subscribeContiRun, type ContiRun } from '../../domain/sunday/contiRun';
import type { SongDraft } from '../../domain/sunday/songs';
import type { CoverInfo } from './SundaySongs';

/** The 콘티 being read (or the last one read), re-rendering the screen when it changes. */
export const useContiRun = (): ContiRun | null => useSyncExternalStore(subscribeContiRun, getContiRun, () => null);

/** A finished reading whose result is not in the draft yet. */
export const contiResultWaiting = (run: ContiRun | null): run is ContiRun & { reading: NonNullable<ContiRun['reading']> } =>
  !!run && run.status === 'done' && !run.applied && !!run.reading;

/** Put a finished reading's songs and cover (date, 본문, 설교 제목) into the draft. */
export function applyContiRun(run: ContiRun, to: { setSongs: (songs: SongDraft[]) => void; onCover: (info: CoverInfo) => void; notify: (message: string) => void }) {
  const r = run.reading;
  if (!r || run.applied) return;
  to.setSongs(r.songs.map((s) => s.draft));
  to.onCover({ date: r.date, scripture: r.scripture, sermonTitle: r.sermonTitle });
  markContiApplied(run.id);
  to.notify(contiDoneMessage(run));
}
