// File › Info: the document's numbers, as DeckCraft's file.info reports them (slides, hidden slides,
// sections) plus words, objects, the size of its pictures and media, last-modified time and author.
import { useEffect, useMemo, useState } from 'react';
import { docStats, formatBytes, mediaIdsOf } from '../../domain/filePrint';
import { getMedia } from '../../domain/media';
import type { Ed } from './editor';

/** Total size of the presentation's media (pictures, video, audio) as stored on this computer. */
function useMediaBytes(ids: string[]): { bytes: number; missing: number } | null {
  const key = ids.join('|');
  const [r, setR] = useState<{ key: string; bytes: number; missing: number } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(ids.map((id) => getMedia(id).catch(() => undefined))).then((blobs) => {
      if (live) setR({ key, bytes: blobs.reduce((n, b) => n + (b?.size ?? 0), 0), missing: blobs.filter((b) => !b).length });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return r && r.key === key ? r : null;
}

export function InfoStats({ ed }: { ed: Ed }) {
  const p = ed.p;
  const stats = useMemo(() => (p ? docStats(p) : null), [p]);
  const ids = useMemo(() => (p ? mediaIdsOf(p) : []), [p]);
  const size = useMediaBytes(ids);
  if (!p || !stats) return null;
  const when = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—';
  const rows: [string, string][] = [
    ['슬라이드', `${stats.slides}장`],
    ['숨겨진 슬라이드', `${stats.hidden}장`],
    ['구역', `${stats.sections}개`],
    ['단어 수', `${stats.words.toLocaleString()}개 (노트 ${stats.noteWords.toLocaleString()}개)`],
    ['애니메이션 · 화면 전환', `${stats.animations}개 · ${stats.transitions}개`],
    ['메모', `${stats.comments}개`],
    ['그림 · 비디오 · 오디오', `${stats.pictures} · ${stats.videos} · ${stats.audios}`],
    ['미디어 크기', ids.length ? (size ? `${formatBytes(size.bytes)} (파일 ${ids.length - size.missing}개${size.missing ? `, 찾을 수 없음 ${size.missing}개` : ''})` : '계산 중…') : '없음'],
    ['마지막으로 수정한 날짜', when],
    ['작성자', p.properties?.author || '—'],
    ['보호', p.protected ? '보호됨' : '아니요'],
    ...(p.folder ? [['폴더', p.folder] as [string, string]] : []),
  ];
  return (
    <dl className="bs-stats" aria-label="문서 정보">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
