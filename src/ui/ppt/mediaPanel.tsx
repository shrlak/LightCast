// Video / Audio Format › Playback: a preview of the clip with its facts (DeckCraft media.info: length, picture
// size, file size), the poster frame taken from the preview's current frame (media.posterFrame) and
// bookmarks to add, remove and jump to.
import { useEffect, useRef, useState } from 'react';
import type { MediaPlayback, SlideElement } from '../../domain/types';
import { addBookmark, formatClock, probeMedia, removeBookmark, stepBookmark, type MediaProbe } from '../../domain/mediaMarks';
import { formatBytes } from '../../domain/filePrint';
import { getMedia } from '../../domain/media';
import { useMediaUrl } from '../hooks';

export function MediaPanel({ el, v, set }: { el: SlideElement; v: MediaPlayback; set: (patch: Partial<MediaPlayback>) => void }) {
  const audio = el.kind === 'audio';
  const url = useMediaUrl(el.mediaId);
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [probe, setProbe] = useState<MediaProbe | null | 'none'>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!url || !el.mediaId) return;
    let live = true;
    void getMedia(el.mediaId).then((b) => probeMedia(url, audio ? 'audio' : 'video', b?.size ?? 0)).then((r) => { if (live) setProbe(r ?? 'none'); });
    return () => { live = false; };
  }, [url, el.mediaId, audio]);
  const seek = (t: number) => { const m = ref.current; if (m) { m.currentTime = t; setNow(t); } };
  const marks = v.bookmarks ?? [];
  const prev = stepBookmark(marks, now, -1), next = stepBookmark(marks, now, 1);
  if (!url) return <p className="dlg-note">미디어를 불러오는 중…</p>;
  const Tag = audio ? 'audio' : 'video';
  return (
    <div className="media-panel">
      <Tag ref={ref as never} src={url} controls preload="metadata" className="media-preview" onTimeUpdate={(e) => setNow((e.target as HTMLMediaElement).currentTime)} onSeeked={(e) => setNow((e.target as HTMLMediaElement).currentTime)} />
      <small className="media-info" role="status">
        {probe === null ? '정보를 읽는 중…' : probe === 'none' ? '이 파일은 브라우저에서 재생 정보를 읽을 수 없습니다.' : `길이 ${formatClock(probe.duration)}${probe.width ? ` · ${probe.width}×${probe.height}` : ''}${probe.bytes ? ` · ${formatBytes(probe.bytes)}` : ''}`}
      </small>
      {!audio && (
        <div className="dlg-row">
          <button type="button" onClick={() => set({ poster: Math.round(now * 10) / 10 || undefined })}>현재 프레임을 포스터 프레임으로</button>
          <span>포스터 프레임: {v.poster ? `${formatClock(v.poster)} (${v.poster}초)` : '첫 장면'}</span>
          {!!v.poster && <button type="button" onClick={() => seek(v.poster!)}>이동</button>}
          {!!v.poster && <button type="button" onClick={() => set({ poster: undefined })}>없애기</button>}
        </div>
      )}
      <fieldset className="dlg-set">
        <legend>책갈피</legend>
        <div className="dlg-row">
          <input value={name} placeholder={`책갈피 ${marks.length + 1}`} aria-label="책갈피 이름" onChange={(e) => setName(e.target.value)} />
          <button type="button" onClick={() => { set({ bookmarks: addBookmark(marks, now, name) }); setName(''); }}>{formatClock(now)}에 책갈피 추가</button>
          <button type="button" disabled={!prev} onClick={() => prev && seek(prev.t)}>◀ 이전 책갈피</button>
          <button type="button" disabled={!next} onClick={() => next && seek(next.t)}>다음 책갈피 ▶</button>
        </div>
        {marks.length === 0 ? <small>책갈피가 없습니다.</small> : (
          <ul className="media-marks">
            {marks.map((b, i) => (
              <li key={`${b.t}-${i}`}>
                <button type="button" onClick={() => seek(b.t)} title="이 위치로 이동">🔖 {formatClock(b.t)} · {b.name}</button>
                <button type="button" aria-label={`${b.name} 지우기`} onClick={() => set({ bookmarks: removeBookmark(marks, i) })}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
