// The check before a 콘티's songs go into this week's 예배: each song read off the 콘티 (by the
// pipeline ported from the ppt site, domain/recognition/conti) is shown in the song editor once.
import type { ContiReading, RecognizedSong } from '../../domain/recognition/conti';
import type { SongDraft } from '../../domain/sunday/songs';

export interface ContiReview {
  reading: ContiReading;
  /** The song being checked. */
  index: number;
  /** Checked songs, by index; null = left out. */
  answers: (SongDraft | null)[];
  /** What reading the 콘티 found worth saying (pages paired, songs set apart …). */
  notes: string[];
}

/** What the editor says above a song: where its lyrics came from and what to look at. */
export function reviewNote(song: RecognizedSong, review: ContiReview): string {
  const out = song.outcome;
  let note: string;
  if (out?.status === 'error') note = `${out.message} 가사를 직접 입력하거나 이 곡을 빼 주세요.`;
  else if (!song.draft.sections.length) note = '가사를 읽지 못했습니다. 직접 입력하거나 이 곡을 빼 주세요.';
  else if (song.source === 'library') note = '찬양 라이브러리에 저장된 가사입니다. 진행은 콘티에 적힌 대로입니다.';
  else if (song.source === 'sheet') note = '코드 악보에서 그대로 읽은 가사입니다. 띄어쓰기와 줄 나눔을 확인해 주세요.';
  else if (song.source === 'web' && song.webCheck === 'confirmed') note = '악보에서 가사를 읽지 못해 인터넷에서 제목·작곡자로 찾은 가사를 넣었습니다. AI가 악보와 대조해 같은 곡임을 확인했습니다 — 파트와 진행을 악보와 비교해 주세요.';
  else if (song.source === 'web') note = 'AI가 악보에서 파트와 진행을 읽고, 웹에 공개된 가사로 맞췄습니다. 악보와 비교해 확인해 주세요.';
  else note = 'AI가 악보에서 읽은 가사입니다. 악보와 비교해 확인해 주세요.';
  if (song.needsReview && out?.status === 'done') note += ' 모델들이 서로 다르게 읽은 부분이 있어요.';
  if (song.webCandidates) {
    note += song.webCheck === 'unconfirmed'
      ? ` 인터넷에서 가사 ${song.webCandidates}개를 찾았지만 악보와 같은 곡인지 AI가 확인하지 못해 넣지 않았습니다.`
      : ` 웹에서 비슷한 가사 ${song.webCandidates}개를 찾았지만 확실하지 않아 쓰지 않았습니다.`;
    if (song.webOptions?.length) note += ' 오른쪽 ‘웹에서 찾은 가사’를 악보와 비교해 맞는 것을 넣을 수 있습니다.';
  }
  if (song.draft.postSermon) note += ' · 설교 후 찬양';
  if (review.index === 0 && review.notes.length) note += `\n${review.notes.join('\n')}`;
  return note;
}

const same = (a: SongDraft, b: SongDraft) =>
  JSON.stringify([a.title, a.key ?? '', a.sections, a.progression ?? []]) === JSON.stringify([b.title, b.key ?? '', b.sections, b.progression ?? []]);

/**
 * The songs to put into the 예배, in order. A library song the operator left as it was goes in as
 * the library's own presentation (no sections: useServiceUploads reuses it with this 진행).
 */
export function acceptedDrafts(review: ContiReview): SongDraft[] {
  return review.reading.songs.flatMap((song, i) => {
    const answer = review.answers[i];
    if (!answer) return [];
    return [song.source === 'library' && same(answer, song.draft) ? { ...answer, sections: [] } : answer];
  });
}
