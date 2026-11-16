import { useMemo } from 'react';
import { formatStorageBytes } from '../domain/cloudStorage';
import { libraryBreakdown } from '../domain/libraryUsage';
import { PROTECTED_MESSAGE } from '../domain/materialProtection';
import type { Library } from '../domain/types';
import type { Action } from '../domain/reducer';

/** What fills the church server besides the media files: the library's presentations, 휴지통 and records, each clearable. */
export function CloudLibraryUsage({ library, dispatch }: { library: Library; dispatch: (a: Action) => void }) {
  const b = useMemo(() => libraryBreakdown(library), [library]);
  const top = b.presentations.slice(0, 15);
  const delPresentation = (id: string, title: string, protectedDeck: boolean) => {
    if (protectedDeck) { alert(PROTECTED_MESSAGE); return; }
    if (!confirm(`"${title}" 자료를 삭제할까요? 휴지통으로 가며, 휴지통을 비워야 서버 공간이 실제로 줄어듭니다.`)) return;
    dispatch({ type: 'presentation/delete', id });
  };
  return <section className="cloud-library-usage" aria-label="라이브러리 데이터 용량">
    <h4>라이브러리 데이터 용량 (미디어 파일 제외)</h4>
    <p className="hint">계정 옆의 %는 교회 서버(Cloudflare 무료 계정)의 저장 사용률입니다. 라이브러리 DB(자료·재생목록·미디어 파일)와 공용 자료·AI 기록 DB를 합친 값이며, 무료 한도 5 GB 대비 비율입니다. 미디어 파일은 위의 "서버 파일"에서, 그 밖의 데이터는 여기서 정리하세요.</p>
    <p className="small">라이브러리 데이터 합계 {formatStorageBytes(b.total)} = 자료 {formatStorageBytes(b.presentationsBytes)} · 휴지통 {formatStorageBytes(b.trashBytes)} ({b.trashCount}개) · 사용 기록 {formatStorageBytes(b.usageBytes)} ({b.usageCount}건) · 활동 기록 {formatStorageBytes(b.activityBytes)} ({b.activityCount}건) · 그 밖의 설정 {formatStorageBytes(b.otherBytes)}</p>
    <div className="row gap-s wrap">
      <button className="danger" disabled={!b.trashCount} onClick={() => { if (confirm(`휴지통 ${b.trashCount}개 (${formatStorageBytes(b.trashBytes)})를 비울까요? 되돌릴 수 없습니다.`)) dispatch({ type: 'trash/purge', ids: b.trashIds }); }}>휴지통 비우기 ({b.trashCount})</button>
      <button className="danger" disabled={!b.usageCount} onClick={() => { if (confirm(`사용 기록 ${b.usageCount}건 (${formatStorageBytes(b.usageBytes)})을 지울까요?`)) dispatch({ type: 'usage/clear' }); }}>사용 기록 지우기 ({b.usageCount})</button>
    </div>
    <div className="cloud-media-scroll"><table><thead><tr><th scope="col">자료 (큰 순서)</th><th scope="col">슬라이드</th><th scope="col">크기</th><th scope="col">삭제</th></tr></thead>
      <tbody>{top.map((p) => <tr key={p.id}><td>{p.title}{p.protectedDeck ? ' 🔒' : ''}</td><td>{p.slides}</td><td>{formatStorageBytes(p.bytes)}</td>
        <td><button className="danger" disabled={p.protectedDeck} title={p.protectedDeck ? '보호된 자료입니다' : undefined} onClick={() => delPresentation(p.id, p.title, p.protectedDeck)}>삭제</button></td></tr>)}</tbody>
    </table></div>
    {b.presentations.length > top.length && <p className="small">큰 자료 {top.length}개만 표시합니다 (전체 {b.presentations.length}개).</p>}
  </section>;
}
