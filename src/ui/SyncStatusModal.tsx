import { useEffect, useState, type Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { Library, MediaMeta, Presentation } from '../domain/types';
import { describePending, conflictActions, type ConflictChoice, type ConflictRecord } from '../domain/syncStatus';
import { missingLocalMedia } from '../domain/offlineMedia';
import { stripChords } from '../domain/lyrics';
import type { CloudSync } from './useCloudSync';

const STATE_LABEL = { off: '로그인 안 됨', syncing: '동기화 중…', synced: '동기화됨', error: '동기화 오류', offline: '오프라인' } as const;
const STATE_ICON = { off: '○', syncing: '⟳', synced: '✓', error: '⚠', offline: '⏸' } as const;

const preview = (p: Presentation | undefined) => {
  if (!p) return '(없음)';
  const first = p.slides.map((s) => stripChords(s.text).trim()).find(Boolean) ?? '';
  return `슬라이드 ${p.slides.length}장${first ? ` · ${first.split('\n')[0].slice(0, 40)}` : ''}`;
};

function ConflictCard({ c, library, onChoose }: { c: ConflictRecord; library: Library; onChoose: (choice: ConflictChoice) => void }) {
  const mine = library.presentations.find((p) => p.id === c.localId);
  const theirs = library.presentations.find((p) => p.id === c.copyId);
  return (
    <article className="card sync-conflict">
      <strong>{c.title}</strong>
      <div className="sync-versions">
        <div><span className="muted small">이 컴퓨터</span><div>{preview(mine)}</div></div>
        <div><span className="muted small">다른 기기</span><div>{preview(theirs)}</div></div>
      </div>
      <div className="row gap-xs wrap">
        <button className="primary" onClick={() => onChoose('mine')}>내 것 유지</button>
        <button onClick={() => onChoose('theirs')}>다른 기기 것으로 바꾸기</button>
        <button onClick={() => onChoose('both')}>둘 다 유지</button>
      </div>
    </article>
  );
}

/**
 * ☁ 동기화 상태: whether this computer is in step with the church server, what is waiting while offline,
 * which media still has to be downloaded to work without internet, and presentations two computers changed at once.
 */
export function SyncStatusModal({ cloud, library, dispatch, onClose, onAccount, notify }: {
  cloud: CloudSync; library: Library; dispatch: Dispatch<Action>; onClose: () => void; onAccount: () => void; notify: (m: string) => void;
}) {
  const { status } = cloud;
  const [missing, setMissing] = useState<MediaMeta[] | null>(null);
  useEffect(() => {
    let alive = true;
    void missingLocalMedia(library).then((m) => alive && setMissing(m)).catch(() => alive && setMissing(null));
    return () => { alive = false; };
  }, [library.media, status.lastSync]);

  const choose = (c: ConflictRecord, choice: ConflictChoice) => {
    for (const action of conflictActions(c, library, choice)) dispatch(action);
    cloud.dismissConflict(c.id);
    notify(choice === 'mine' ? `“${c.title}”: 이 컴퓨터의 것을 남겼습니다` : choice === 'theirs' ? `“${c.title}”: 다른 기기의 것으로 바꿨습니다 (실행 취소 가능)` : `“${c.title}”: 둘 다 남겼습니다`);
  };

  const state = status.session ? status.state : 'off';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal sync-modal" role="dialog" aria-modal="true" aria-label="동기화 상태" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <header className="modal-head"><h2>☁ 동기화 상태</h2><button autoFocus aria-label="닫기" onClick={onClose}>✕</button></header>
        <div className="feature-scroll stack">
          <div className={`sync-state sync-${state}`} role="status">
            <span className="sync-icon" aria-hidden="true">{STATE_ICON[state]}</span>
            <div>
              <strong>{STATE_LABEL[state]}</strong>
              <div className="muted small">
                {status.session ? `${status.session.username} · ${status.lastSync ? `마지막 동기화 ${new Date(status.lastSync).toLocaleString()}` : '아직 동기화 전'}` : '로그인하면 슬라이드가 교회 서버에 저장되어 다른 기기에서도 열립니다.'}
              </div>
            </div>
          </div>

          {state === 'offline' && <p>인터넷이 없어도 LightCast의 모든 기능을 그대로 쓸 수 있습니다. 고친 내용은 이 컴퓨터에 먼저 저장되고, 연결되면 <b>자동으로</b> 올라갑니다 (예배 중에는 건드리지 않습니다).</p>}
          {state === 'error' && <p role="alert">동기화 오류: {status.message} — 이 컴퓨터의 내용은 그대로 안전합니다. 잠시 뒤 자동으로 다시 시도합니다.</p>}
          {state === 'syncing' && status.message && <p className="muted small">{status.message}</p>}
          {!status.session && <button className="primary" onClick={onAccount}>로그인 · 계정 만들기</button>}

          {status.session && (
            <section className="card">
              <h3>보내지 못한 변경</h3>
              {state === 'offline' || state === 'error'
                ? <p>{status.pending ? describePending(status.pending) : '확인 중…'}</p>
                : <p>{state === 'syncing' ? '보내는 중…' : '모두 동기화됨'}</p>}
            </section>
          )}

          {status.session && (
            <section className="card">
              <h3>오프라인 준비 (미디어)</h3>
              {missing === null ? <p className="muted">확인 중…</p>
                : missing.length === 0 ? <p>✓ 쓰는 그림·영상·음악이 모두 이 컴퓨터에 저장되어 있어 인터넷 없이 재생됩니다 ({library.media.length}개).</p>
                  : <>
                    <p>⚠ 이 컴퓨터에 아직 없는 미디어 {missing.length}개 — 인터넷이 없으면 재생되지 않습니다.</p>
                    <ul className="small">{missing.slice(0, 8).map((m) => <li key={m.id}>{m.name}</li>)}{missing.length > 8 && <li>… 외 {missing.length - 8}개</li>}</ul>
                    <button disabled={state === 'offline' || state === 'syncing'} onClick={cloud.syncNow}>{state === 'offline' ? '인터넷 연결 후 내려받기' : '지금 내려받기'}</button>
                  </>}
            </section>
          )}

          {cloud.conflicts.length > 0 && (
            <section className="stack">
              <h3>두 기기에서 동시에 고친 프레젠테이션 ({cloud.conflicts.length})</h3>
              <p className="hint">둘 다 남겨 두었습니다. 어느 쪽을 쓸지 고르세요. 다른 기기 것으로 바꾸어도 실행 취소(⌘Z)로 되돌릴 수 있습니다.</p>
              {cloud.conflicts.map((c) => <ConflictCard key={c.id} c={c} library={library} onChoose={(choice) => choose(c, choice)} />)}
            </section>
          )}
        </div>
        <footer className="modal-foot">
          <span className="muted small grow">이 컴퓨터가 항상 먼저입니다 — 서버는 백업과 다른 기기와의 공유를 위한 것입니다</span>
          <button onClick={onClose}>닫기</button>
          {status.session && <button className="primary" disabled={state === 'syncing'} onClick={cloud.syncNow}>지금 동기화</button>}
        </footer>
      </section>
    </div>
  );
}
