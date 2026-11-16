import { useMemo, useState } from 'react';
import { cloudApi, loadSession } from '../domain/cloud';
import { isCloudFontId } from '../domain/fontSync';
import { buildServerFileRows, isUsed } from '../domain/cloudFiles';
import { purgeTrash } from '../domain/trash';
import { dropMediaFiles, purgeTrashEverywhere } from '../domain/serverMediaDrop';
import { formatStorageBytes } from '../domain/cloudStorage';
import { libraryBreakdown } from '../domain/libraryUsage';
import { PROTECTED_MESSAGE } from '../domain/materialProtection';
import type { Library } from '../domain/types';
import type { Action } from '../domain/reducer';

/** What fills the church server besides the media files: the library's presentations, 휴지통 and records, each clearable. */
export function CloudLibraryUsage({ library, dispatch }: { library: Library; dispatch: (a: Action) => void }) {
  const b = useMemo(() => libraryBreakdown(library), [library]);
  const top = b.presentations.slice(0, 15);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  /** One click: 휴지통, 사용 기록, and every server file nothing lists any more. */
  const cleanAll = async () => {
    const token = loadSession()?.token;
    setBusy('서버 파일을 확인하는 중…'); setDone('');
    try {
      const after = purgeTrash(library, b.trashIds);
      let orphans: { id: string; size: number }[] = [];
      let remoteKnown = false;
      if (token) {
        const [items, remote] = await Promise.all([cloudApi.listMedia(token), cloudApi.getLibrary(token)]);
        remoteKnown = true;
        orphans = buildServerFileRows(items.filter((i) => !isCloudFontId(i.id)), after, remote?.data ?? null).filter((r) => !isUsed(r)).map((r) => ({ id: r.id, size: r.size }));
      }
      const bytes = orphans.reduce((n, o) => n + o.size, 0);
      setBusy('');
      const lines = [`휴지통 ${b.trashCount}개(그 항목만 쓰던 미디어 포함), 사용 기록 ${b.usageCount}건${remoteKnown ? `, 라이브러리가 쓰지 않는 서버 파일 ${orphans.length}개 (${formatStorageBytes(bytes)})` : ''}를 지울까요?`, '', '슬라이드·자료·글꼴·보호된 자료는 지우지 않습니다. 되돌릴 수 없습니다.'];
      if (!confirm(lines.join('\n'))) return;
      setBusy('정리하는 중…');
      const failed = await purgeTrashEverywhere(library, b.trashIds, dispatch);
      if (b.usageCount) dispatch({ type: 'usage/clear' });
      failed.push(...await dropMediaFiles(orphans.map((o) => o.id)));
      setDone(failed.length ? `정리했지만 서버에서 지우지 못한 파일이 ${failed.length}개 있습니다. 서버 파일 목록에서 다시 시도하세요.` : '정리했습니다. 용량 새로고침을 누르면 사용률이 갱신됩니다.');
    } catch (e) {
      setDone(`정리에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(''); }
  };
  const delPresentation = (id: string, title: string, protectedDeck: boolean) => {
    if (protectedDeck) { alert(PROTECTED_MESSAGE); return; }
    if (!confirm(`"${title}" 자료를 삭제할까요? 휴지통으로 가며, 휴지통을 비워야 서버 공간이 실제로 줄어듭니다.`)) return;
    dispatch({ type: 'presentation/delete', id });
  };
  return <section className="cloud-library-usage" aria-label="라이브러리 데이터 용량">
    <h4>라이브러리 데이터 용량 (미디어 파일 제외)</h4>
    <p className="hint">계정 옆의 %는 교회 서버(Cloudflare 무료 계정)의 저장 사용률입니다. 라이브러리 DB(자료·재생목록·미디어 파일)와 공용 자료·AI 기록 DB를 합친 값이며, 무료 한도 5 GB 대비 비율입니다. 미디어 파일은 위의 "서버 파일"에서, 그 밖의 데이터는 여기서 정리하세요.</p>
    {busy && <p role="status">{busy}</p>}
    {done && !busy && <p role="status">{done}</p>}
    <p className="small">라이브러리 데이터 합계 {formatStorageBytes(b.total)} = 자료 {formatStorageBytes(b.presentationsBytes)} · 휴지통 {formatStorageBytes(b.trashBytes)} ({b.trashCount}개) · 사용 기록 {formatStorageBytes(b.usageBytes)} ({b.usageCount}건) · 활동 기록 {formatStorageBytes(b.activityBytes)} ({b.activityCount}건) · 그 밖의 설정 {formatStorageBytes(b.otherBytes)}</p>
    <div className="row gap-s wrap">
      <button className="danger" disabled={!!busy} onClick={() => void cleanAll()}>불필요한 것 모두 정리</button>
      <button className="danger" disabled={!b.trashCount} onClick={() => { if (confirm(`휴지통 ${b.trashCount}개 (${formatStorageBytes(b.trashBytes)})를 비울까요? 그 항목만 쓰던 미디어 파일도 서버에서 지워지며 되돌릴 수 없습니다.`)) void purgeTrashEverywhere(library, b.trashIds, dispatch); }}>휴지통 비우기 ({b.trashCount})</button>
      <button className="danger" disabled={!b.usageCount} onClick={() => { if (confirm(`사용 기록 ${b.usageCount}건 (${formatStorageBytes(b.usageBytes)})을 지울까요?`)) dispatch({ type: 'usage/clear' }); }}>사용 기록 지우기 ({b.usageCount})</button>
    </div>
    <div className="cloud-media-scroll"><table><thead><tr><th scope="col">자료 (큰 순서)</th><th scope="col">슬라이드</th><th scope="col">크기</th><th scope="col">삭제</th></tr></thead>
      <tbody>{top.map((p) => <tr key={p.id}><td>{p.title}{p.protectedDeck ? ' 🔒' : ''}</td><td>{p.slides}</td><td>{formatStorageBytes(p.bytes)}</td>
        <td><button className="danger" disabled={p.protectedDeck} title={p.protectedDeck ? '보호된 자료입니다' : undefined} onClick={() => delPresentation(p.id, p.title, p.protectedDeck)}>삭제</button></td></tr>)}</tbody>
    </table></div>
    {b.presentations.length > top.length && <p className="small">큰 자료 {top.length}개만 표시합니다 (전체 {b.presentations.length}개).</p>}
  </section>;
}
