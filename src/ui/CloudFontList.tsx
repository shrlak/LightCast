// 서버 글꼴: the imported fonts the church cloud holds (the library's font list + font files nobody lists any more).
import { useEffect, useState } from 'react';
import { cloudApi } from '../domain/cloud';
import { formatStorageBytes } from '../domain/cloudStorage';
import { isCloudFontId, totalFontBytes } from '../domain/fontSync';
import { weightLabel } from '../domain/fontWeight';
import type { CloudSync } from './useCloudSync';

export function CloudFontList({ cloud, token }: { cloud: CloudSync; token: string }) {
  const [sizes, setSizes] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const listed = cloud.cloudFonts;
  useEffect(() => {
    let alive = true;
    cloudApi.listMedia(token)
      .then((items) => alive && (setSizes(new Map(items.filter((i) => isCloudFontId(i.id)).map((i) => [i.id, i.size]))), setError('')))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '조회에 실패했습니다.'));
    return () => { alive = false; };
  }, [token, refresh, listed]);
  const ids = new Set(listed.map((f) => f.id));
  const orphans = sizes ? [...sizes].filter(([id]) => !ids.has(id)) : [];
  const remove = async (id: string, label: string, size: number, orphan: boolean) => {
    const msg = orphan
      ? `서버에서 쓰지 않는 글꼴 파일 "${label}" (${formatStorageBytes(size)})을(를) 삭제할까요? 되돌릴 수 없습니다.`
      : `서버에서 글꼴 "${label}" (${formatStorageBytes(size)})을(를) 삭제할까요? 다른 기기에서도 다음 동기화 때 이 글꼴이 지워지고, 이 컴퓨터의 글꼴도 지워집니다. 되돌릴 수 없습니다.`;
    if (!confirm(msg)) return;
    setRemoving(id);
    try {
      if (orphan) await cloudApi.deleteMedia(token, id); else await cloud.removeFont(id);
      setRefresh((n) => n + 1); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '삭제에 실패했습니다.'); }
    finally { setRemoving(null); }
  };
  const status = cloud.status.fonts;
  return <section className="cloud-media-list cloud-font-list" aria-label="서버 글꼴">
    <div className="row"><h4 className="grow">서버 글꼴</h4><button onClick={() => setRefresh((n) => n + 1)}>새로고침</button></div>
    <p className="hint">가져온 글꼴 중 동기화가 켜진 것이 교회 서버에 저장되어 다른 컴퓨터로 전달됩니다(같은 파일은 한 번만 저장). 여기서 지우면 모든 기기에서 지워집니다. 글꼴별 · 전체 동기화 설정은 설정 › 글꼴에 있습니다.</p>
    {error && <p role="alert">글꼴 목록 조회 실패: {error}</p>}
    {listed.length || orphans.length ? <>
      <p className="small">글꼴 {listed.length}개 · {formatStorageBytes(totalFontBytes(listed))}{status ? ` · 마지막 동기화: 올림 ${status.uploaded} · 받음 ${status.downloaded}` : ''}</p>
      <div className="cloud-media-scroll"><table><thead><tr><th scope="col">글꼴</th><th scope="col">굵기</th><th scope="col">크기</th><th scope="col">상태</th><th scope="col">삭제</th></tr></thead>
        <tbody>
          {listed.map((f) => <tr key={f.id}><td title={f.id}>{f.family}</td><td>{weightLabel(f.weight)}{f.italic ? ' · 기울임' : ''}</td><td>{formatStorageBytes(f.bytes)}</td>
            <td className="small">{sizes ? (sizes.has(f.id) ? '서버에 있음' : '올리는 중/대기') : '확인 중…'}</td>
            <td><button className="danger" disabled={removing !== null} onClick={() => void remove(f.id, f.family, f.bytes, false)}>{removing === f.id ? '삭제 중…' : '삭제'}</button></td></tr>)}
          {orphans.map(([id, size]) => <tr key={id}><td title={id}>(목록에 없는 글꼴 파일)</td><td>—</td><td>{formatStorageBytes(size)}</td><td className="small">쓰지 않음</td>
            <td><button className="danger" disabled={removing !== null} onClick={() => void remove(id, id.slice(0, 14), size, true)}>삭제</button></td></tr>)}
        </tbody></table></div>
    </> : <p>서버에 저장된 글꼴이 없습니다.</p>}
  </section>;
}
