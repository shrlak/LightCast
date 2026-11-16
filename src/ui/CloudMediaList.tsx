import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloudApi } from '../domain/cloud';
import { isCloudFontId } from '../domain/fontSync';
import { formatStorageBytes } from '../domain/cloudStorage';
import { deleteMedia, forgetMediaUrl } from '../domain/media';
import {
  DEFAULT_VIEW, KIND_LABEL, buildServerFileRows, deleteQuestion, isUsed, planDelete, selectAllState, selectedIn, toggleOne, toggleSelectAll,
  totals, viewRows, type FileKind, type ServerFileRow, type SortKey, type StatusFilter,
} from '../domain/cloudFiles';
import type { Library } from '../domain/types';
import type { Action } from '../domain/reducer';

const PAGE = 50;

/** Every file the church server holds (fonts have their own list below), with search, filters, and delete (one, many, or all unused). */
export function CloudMediaList({ token, library, dispatch }: { token: string; library: Library; dispatch: (a: Action) => void }) {
  const [items, setItems] = useState<{ id: string; size: number; type?: string }[] | null>(null);
  const [remote, setRemote] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const libRef = useRef(library);
  libRef.current = library;

  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const [list, lib] = await Promise.all([cloudApi.listMedia(token), cloudApi.getLibrary(token)]);
        if (active) { setItems(list.filter((i) => !isCloudFontId(i.id))); setRemote(lib?.data ?? null); setError(''); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '조회에 실패했습니다.');
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    }
    void load();
    // not while deleting: the list would jump under the running delete
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, refresh]);

  const rows = useMemo(() => {
    try { return items ? buildServerFileRows(items, library, remote) : null; } catch { return null; }
  }, [items, library, remote]);
  const shown = useMemo(() => (rows ? viewRows(rows, view) : []), [rows, view]);
  const sum = useMemo(() => totals(rows ?? []), [rows]);
  const sel = selectedIn(shown, selected);
  const state = selectAllState(shown, selected);
  const busy = progress !== null;
  const setV = (p: Partial<typeof view>) => { setView((v) => ({ ...v, ...p })); setLimit(PAGE); };

  /** Delete these files after asking: the unused ones from the server, the library's ones from the library and this computer too. */
  const remove = useCallback(async (targets: ServerFileRow[]) => {
    const plan = planDelete(targets);
    const question = deleteQuestion(plan, formatStorageBytes);
    if (!question) { setResult(plan.skipped.length ? `지울 수 있는 파일이 없습니다. ${plan.skipped.map((s) => `${s.row.name}: ${s.reason}`).join(' / ')}` : ''); return; }
    if (!confirm(question)) return;
    const todo = [...plan.serverOnly, ...plan.withLibrary];
    const failed: string[] = [];
    let done = 0;
    for (const row of todo) {
      setProgress(`${done + 1}/${todo.length} 삭제 중… ${row.name}`);
      try {
        if (row.inLibrary) { dispatch({ type: 'media/remove', id: row.id }); forgetMediaUrl(row.id); await deleteMedia(row.id).catch(() => undefined); }
        await cloudApi.deleteMedia(token, row.id);
        done++;
        setItems((cur) => cur && cur.filter((x) => x.id !== row.id));
        setSelected((s) => { const n = new Set(s); n.delete(row.id); return n; });
      } catch (e) {
        failed.push(`${row.name} (${e instanceof Error ? e.message : '실패'})`);
      }
    }
    setProgress(null);
    setResult(`${done}개를 삭제했습니다.${failed.length ? ` 실패 ${failed.length}개: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' …' : ''}` : ''}${plan.skipped.length ? ` 건너뜀 ${plan.skipped.length}개.` : ''}`);
    setRefresh((n) => n + 1);
  }, [dispatch, token]);

  return <section className="cloud-media-list" aria-label="서버 파일 목록">
    <div className="row"><h4 className="grow">서버 파일</h4><button disabled={loading || busy} onClick={() => setRefresh((n) => n + 1)}>{loading ? '조회 중…' : '파일 목록 새로고침'}</button></div>
    <p className="hint">서버에 저장된 모든 파일입니다(글꼴은 아래 목록). 라이브러리에서 쓰는 파일을 지우면 서버뿐 아니라 라이브러리와 이 컴퓨터에서도 지워지며, 사용하는 배경은 비워집니다. 보호된 자료가 쓰는 파일과 다른 컴퓨터의 라이브러리에만 있는 파일은 지울 수 없습니다.</p>
    {error && <p role="alert">파일 목록 조회 실패: {error}{rows && ' · 이전 조회 결과를 표시합니다.'}</p>}
    {rows ? rows.length ? <>
      <p className="small" data-testid="cloud-file-totals">전체 {sum.count}개 · {formatStorageBytes(sum.bytes)} · 사용하지 않는 파일 {sum.unusedCount}개 ({formatStorageBytes(sum.unusedBytes)})</p>
      <div className="row gap-s wrap cloud-file-filters" role="search">
        <input type="search" aria-label="서버 파일 검색" placeholder="파일 이름·자료 제목 검색" value={view.query} onChange={(e) => setV({ query: e.target.value })} />
        <select aria-label="종류" value={view.kind} onChange={(e) => setV({ kind: e.target.value as FileKind | 'all' })}>
          <option value="all">모든 종류</option>{(Object.keys(KIND_LABEL) as FileKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select aria-label="사용 여부" value={view.status} onChange={(e) => setV({ status: e.target.value as StatusFilter })}>
          <option value="all">사용 여부 전체</option><option value="unused">사용하지 않음</option><option value="used">사용 중</option>
        </select>
        <select aria-label="정렬" value={view.sort} onChange={(e) => setV({ sort: e.target.value as SortKey })}>
          <option value="size">큰 순서</option><option value="name">이름순</option><option value="kind">종류순</option>
        </select>
      </div>
      <div className="row gap-s wrap cloud-file-bulk" role="toolbar" aria-label="서버 파일 여러 개 처리">
        <label><input type="checkbox" checked={state === 'all'} ref={(el) => { if (el) el.indeterminate = state === 'some'; }} disabled={busy || !shown.length} onChange={() => setSelected(toggleSelectAll(shown, selected))} /> 모두 선택</label>
        <button className="danger" disabled={busy || !sel.length} onClick={() => void remove(sel)}>선택 항목 삭제 ({sel.length})</button>
        <button className="danger" disabled={busy || !sum.unusedCount} onClick={() => void remove((rows ?? []).filter((r) => !isUsed(r)))}>사용하지 않는 파일 모두 삭제 ({sum.unusedCount})</button>
      </div>
      <p className="small">{shown.length}개 표시{shown.length !== sum.count ? ` (전체 ${sum.count}개 중)` : ''}{sel.length ? ` · ${sel.length}개 선택` : ''}</p>
      {progress && <p role="status">{progress}</p>}
      {result && !progress && <p role="status">{result}</p>}
      {shown.length ? <div className="cloud-media-scroll"><table><thead><tr><th scope="col">선택</th><th scope="col">파일명</th><th scope="col">종류</th><th scope="col">크기</th><th scope="col">사용처</th><th scope="col">삭제</th></tr></thead>
        <tbody>{shown.slice(0, limit).map((r) => <tr key={r.id} data-file-id={r.id}>
          <td><input type="checkbox" aria-label={`${r.name} 선택`} checked={selected.has(r.id)} disabled={busy} onChange={() => setSelected(toggleOne(selected, r.id))} /></td>
          <td title={r.id}>{r.name}</td><td>{KIND_LABEL[r.kind]}</td><td>{formatStorageBytes(r.size)}</td>
          <td className="small">{r.protectedFile ? '보호된 자료가 사용' : r.usedBy.length ? r.usedBy.slice(0, 2).join(', ') + (r.usedBy.length > 2 ? ` 외 ${r.usedBy.length - 2}개` : '') : r.inLibrary ? '보관함에만 있음' : r.listedElsewhere ? '다른 컴퓨터 라이브러리' : '사용 안 함'}</td>
          <td><button className="danger" disabled={busy || r.protectedFile || r.listedElsewhere} title={r.protectedFile ? '보호된 자료가 쓰는 파일입니다' : r.listedElsewhere ? '먼저 동기화하세요' : undefined} onClick={() => void remove([r])}>삭제</button></td>
        </tr>)}</tbody>
      </table></div> : <p>조건에 맞는 파일이 없습니다.</p>}
      {limit < shown.length && <button onClick={() => setLimit((n) => n + PAGE)}>{PAGE}개 더 보기 ({shown.length - limit}개 남음)</button>}
    </> : <p>서버에 저장된 미디어가 없습니다.</p> : !error && <p role="status">서버 파일을 조회하고 있습니다…</p>}
  </section>;
}
