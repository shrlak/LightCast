// Review › 버전 기록: the saved restore points of this presentation, a selected one set side by side
// with the current version, restoring one slide or the whole version.
import { useEffect, useMemo, useState } from 'react';
import type { Library, Presentation } from '../../domain/types';
import { libraryOf, listRestorePoints, saveRestorePoint, type RestorePoint } from '../../domain/restorePoints';
import { alignSlides, changedCount, removeAdded, restoreSlide, restoreVersion, summary, type VersionRow } from '../../domain/versionHistory';
import { MATCH_BASIS_LABEL, MATCH_BASIS_SHORT, VERSION_BASIS_LABEL, basisSummary, findVersion } from '../../domain/slideMatch';
import { resolveBackground } from '../../domain/autoBackground';
import { SlideCanvas } from '../SlideCanvas';
import { Dialog } from './dialogs';
import type { Ed } from './editor';

const KIND = { auto: '자동 저장', manual: '직접 저장', safety: '복원 직전', import: '자료 가져오기 전', show: '발표 시작 전', sync: '동기화 전' } as const;

function Thumb({ lib, pres, row, side }: { lib: Library; pres: Presentation; row: VersionRow; side: 'old' | 'cur' }) {
  const s = side === 'old' ? row.old : row.cur;
  if (!s) return <div className="vh-thumb vh-none">{side === 'old' ? '이때는 없었음' : '현재 없음'}</div>;
  const theme = lib.themes.find((t) => t.id === pres.themeId) ?? lib.themes[0];
  return (
    <div className="vh-thumb">
      <SlideCanvas slide={s} theme={theme} background={resolveBackground(s, pres)} bgEffect={pres.bgEffect} />
    </div>
  );
}

/** 버전 기록 (DeckCraft has no counterpart; PowerPoint's 버전 기록 pane): restore points of this presentation. */
export function VersionHistoryDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const [points, setPoints] = useState<RestorePoint[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  useEffect(() => { void listRestorePoints().then(setPoints).catch(() => setPoints([])); }, []);

  // Each snapshot read once; those without this presentation are left out.
  const versions = useMemo(() => (points ?? []).map((pt) => {
    const lib = libraryOf(pt);
    // By id; a presentation re-imported from the same file has new ids, so it is looked for by import source, then by text.
    const link = p ? findVersion(lib, p) : null;
    const old = link?.pres;
    return { pt, lib, old, basis: link?.basis ?? 'id', rows: p && old ? alignSlides(p, old) : [] };
  }).filter((v) => v.old), [points, p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rows are recomputed against the live presentation for the selected version.
  const sel = versions.find((v) => v.pt.id === pick) ?? null;
  const rows = useMemo(() => (p && sel?.old ? alignSlides(p, sel.old) : []), [p, sel]);
  if (!p) return null;

  const safety = () => saveRestorePoint(ed.state.library, 'safety', Date.now(), '버전 기록에서 복원 직전').catch(() => undefined);
  const restoreOne = async (row: VersionRow) => {
    if (!sel?.old || !ed.canEdit) return;
    await safety();
    ed.updatePres({ slides: row.status === 'added' ? removeAdded(p, row.id) : restoreSlide(p, sel.old, row.old?.id ?? row.id, row.cur?.id) });
    ed.cmd.notify(row.status === 'added' ? '이 슬라이드를 뺐습니다' : '슬라이드를 이 버전으로 되돌렸습니다');
  };
  const restoreAll = async () => {
    if (!sel?.old || !ed.canEdit) return;
    if (!confirm(`${new Date(sel.pt.at).toLocaleString()} 버전으로 이 프레젠테이션 전체를 되돌릴까요? 지금 상태는 "복원 직전" 복원 지점으로 먼저 저장됩니다.`)) return;
    await safety();
    const next = restoreVersion(p, sel.old);
    ed.updatePres({ ...next });
    ed.cmd.notify('이 버전으로 되돌렸습니다');
    onClose();
  };
  const saveNow = async () => {
    await saveRestorePoint(ed.state.library, 'manual', Date.now(), `${p.title} 버전`).catch(() => undefined);
    setPoints(await listRestorePoints().catch(() => []));
  };
  const shown = onlyChanged ? rows.filter((r) => r.status !== 'same') : rows;
  const label = { changed: '변경됨', removed: '삭제됨', added: '새로 생김', same: '같음' } as const;

  return (
    <Dialog title={`버전 기록 — ${p.title}`} onClose={onClose}>
      <div className="vh">
        <div className="vh-list">
          <button type="button" onClick={saveNow}>지금 버전 저장</button>
          {points === null ? <p className="dlg-note">불러오는 중…</p> : !versions.length ? <p className="dlg-note">이 프레젠테이션의 저장된 버전이 아직 없습니다. LightCast가 자동으로 저장해 둡니다.</p> : (
            <ul>
              {versions.map(({ pt, rows: r, basis }) => (
                <li key={pt.id}>
                  <button type="button" className={pick === pt.id ? 'on' : ''} onClick={() => setPick(pt.id)}>
                    <b>{new Date(pt.at).toLocaleString()}</b>
                    <small>{KIND[pt.kind]}{pt.label ? ` · ${pt.label}` : ''}</small>
                    <small>{summary(r)}</small>
                    {basis !== 'id' && <small className="vh-basis">{VERSION_BASIS_LABEL[basis]}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="vh-compare">
          {!sel ? <p className="dlg-note">왼쪽에서 버전을 고르면 현재와 나란히 비교합니다.</p> : (
            <>
              <div className="vh-bar">
                <label className="rb-check"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> 바뀐 슬라이드만</label>
                <span className="dlg-note">{summary(rows)}</span>
                {rows.some((r) => r.basis && r.basis !== 'id') && <span className="dlg-note vh-basis" title="슬라이드를 짝지은 방법">짝짓기: {basisSummary(rows.filter((r) => r.basis).map((r) => ({ basis: r.basis! })))}</span>}
                <button type="button" className="primary" disabled={!ed.canEdit || !changedCount(rows) || !!p.protected} onClick={restoreAll}>이 버전으로 모두 복원</button>
              </div>
              <div className="vh-head"><b>{new Date(sel.pt.at).toLocaleString()} 버전</b><b>현재 버전</b></div>
              <div className="vh-rows">
                {!shown.length && <p className="dlg-note">바뀐 슬라이드가 없습니다.</p>}
                {shown.map((row) => (
                  <div key={row.id} className={`vh-row ${row.status}`}>
                    <div><Thumb lib={ed.state.library} pres={sel.old!} row={row} side="old" /><small>{row.oldNo ? `슬라이드 ${row.oldNo}` : ''}</small></div>
                    <div className="vh-mid"><span className="vh-tag">{label[row.status]}</span>
                      {row.basis && row.basis !== 'id' && <small className="vh-basis" title={MATCH_BASIS_LABEL[row.basis]}>연결: {MATCH_BASIS_SHORT[row.basis]}</small>}
                      {row.status !== 'same' && <button type="button" disabled={!ed.canEdit || !!p.protected} onClick={() => void restoreOne(row)}>{row.status === 'added' ? '빼기' : '이 슬라이드 복원'}</button>}
                    </div>
                    <div><Thumb lib={ed.state.library} pres={p} row={row} side="cur" /><small>{row.curNo ? `슬라이드 ${row.curNo}` : ''}</small></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
