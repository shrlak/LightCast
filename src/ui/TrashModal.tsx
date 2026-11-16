import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Action, AppState } from '../domain/reducer';
import { TRASH_DAYS } from '../domain/trash';
import { deleteAllTargets, selectAllState, selectedVisible, toggleOne, toggleSelectAll, visibleTrash } from '../domain/trashSelection';

export function TrashModal({ state, dispatch, onClose }: { state: AppState; dispatch: Dispatch<Action>; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const entries = visibleTrash(state.library.trash, query, Date.now());
  const chosen = selectedVisible(entries, selected);
  const allState = selectAllState(entries, selected);
  // The 모두 선택 box shows a dash when part of the list is selected.
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = allState === 'some'; }, [allState]);
  const searching = query.trim() !== '';
  const purge = (ids: string[], question: string) => {
    if (!ids.length || !confirm(question)) return;
    dispatch({ type: 'trash/purge', ids });
    setSelected(new Set());
  };
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="modal trash-modal" role="dialog" aria-modal="true" aria-label="휴지통" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header className="modal-head"><h2>휴지통</h2><button aria-label="닫기" onClick={onClose}>✕</button></header>
      <p>삭제한 찬양·자료·슬라이드를 {TRASH_DAYS}일 동안 미디어와 함께 보관합니다. 필요한 항목만 복원할 수 있으며, 보관 기간에는 서버 저장 공간을 사용합니다.</p>
      <input autoFocus aria-label="휴지통 검색" placeholder="찬양·자료 제목 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      {entries.length > 0 && (
        <div className="row gap-s wrap trash-bulk" role="toolbar" aria-label="휴지통 여러 항목 처리">
          <label className="row gap-xs">
            <input ref={allBox} type="checkbox" aria-label="모두 선택" checked={allState === 'all'} onChange={() => setSelected(toggleSelectAll(entries, selected))} />
            <span>모두 선택 ({chosen.length}/{entries.length})</span>
          </label>
          <span className="grow" />
          <button disabled={!chosen.length} onClick={() => { for (const id of chosen) dispatch({ type: 'trash/restore', id }); setSelected(new Set()); }}>선택 항목 복원</button>
          <button className="danger" disabled={!chosen.length}
            onClick={() => purge(chosen, `선택한 ${chosen.length}개 항목과 다른 곳에서 사용하지 않는 전용 미디어를 영구 삭제할까요? 되돌릴 수 없습니다.`)}>선택 항목 영구 삭제</button>
          <button className="danger"
            onClick={() => purge(deleteAllTargets(entries), searching
              ? `검색된 ${entries.length}개 항목과 다른 곳에서 사용하지 않는 전용 미디어를 모두 영구 삭제할까요? 되돌릴 수 없습니다.`
              : `휴지통의 ${entries.length}개 항목과 다른 곳에서 사용하지 않는 전용 미디어를 모두 영구 삭제할까요? 되돌릴 수 없습니다.`)}>
            {searching ? `검색된 ${entries.length}개 모두 삭제` : '모두 삭제 (휴지통 비우기)'}
          </button>
        </div>
      )}
      <div className="feature-scroll">{entries.map((e) => <article className="trash-row" key={e.id}>
        <input type="checkbox" aria-label={`${e.presentation.title} 선택`} checked={selected.has(e.id)} onChange={() => setSelected(toggleOne(selected, e.id))} />
        <div className="grow"><strong>{e.presentation.title}</strong><div className="muted small">{e.kind === 'slides' ? `슬라이드 ${e.slides?.length ?? 0}장` : '찬양·자료 전체'} · {new Date(e.deletedAt).toLocaleString()} · {Math.ceil((e.expiresAt - Date.now()) / 86400000)}일 후 자동 삭제</div>
          {e.slides && <p className="small">{e.slides.map((s) => s.slide.text || s.slide.label || s.slide.group).join(' / ').slice(0, 180)}</p>}</div>
        {e.slides && e.slides.length > 1 && <details className="trash-pages"><summary>슬라이드별 복원</summary>{e.slides.map((s) => <div className="row gap-s" key={s.seq}><span className="grow">{s.seq + 1} · {(s.slide.text || s.slide.label || s.slide.group).slice(0, 60)}</span><button onClick={() => dispatch({ type: 'trash/restore', id: e.id, seq: s.seq })}>이 슬라이드 복원</button></div>)}</details>}
        <button onClick={() => dispatch({ type: 'trash/restore', id: e.id })}>{e.slides && e.slides.length > 1 ? '모두 복원' : '복원'}</button>
        <button className="danger" onClick={() => { if (confirm('이 항목과 다른 곳에서 사용하지 않는 전용 미디어를 영구 삭제할까요?')) dispatch({ type: 'trash/purge', ids: [e.id] }); }}>영구 삭제</button>
      </article>)}{!entries.length && <p className="empty">휴지통이 비어 있습니다.</p>}</div>
      <footer className="modal-foot"><span className="muted small grow">복원하면 현재의 다른 편집 내용은 유지됩니다.</span><button onClick={onClose}>닫기</button></footer>
    </section>
  </div>;
}
