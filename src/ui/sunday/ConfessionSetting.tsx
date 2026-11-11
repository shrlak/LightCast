import { useMemo, useState, type Dispatch } from 'react';
import type { Action } from '../../domain/reducer';
import type { Library } from '../../domain/types';
import { DEFAULT_CONFESSION_SONG } from '../../domain/defaults';
import { titleKey } from '../../domain/sunday/songs';
import { findConfessionSong, songSections } from '../../domain/templates/confession';
import { useAutosave } from '../hooks';

/**
 * This season's 공동체 고백송 (it changes every semester or year). Saving it rewrites the
 * 공동체 고백송 block of the library's 주일예배 Back deck, and every new service uses it;
 * one week can still use another song from the 주일예배 마법사.
 */
export function ConfessionSetting({ library, dispatch, onClose, notify }: { library: Library; dispatch: Dispatch<Action>; onClose: () => void; notify: (m: string) => void }) {
  const current = library.sunday.confessionSong.trim() || DEFAULT_CONFESSION_SONG;
  const [title, setTitle] = useState(current);
  const [query, setQuery] = useState('');

  const songs = useMemo(() => {
    const seen = new Set<string>();
    return library.presentations
      .filter((p) => p.folder === 'Songs' || p.online || (p.meta && 'key' in p.meta))
      .filter((p) => !seen.has(titleKey(p.title)) && (seen.add(titleKey(p.title)), true))
      .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  }, [library.presentations]);
  const q = titleKey(query);
  const matches = q ? songs.filter((p) => titleKey(p.title).includes(q)).slice(0, 40) : [];
  const chosen = findConfessionSong(library.presentations, title);
  const lines = chosen ? songSections(chosen).flat().length : 0;

  // Saved as soon as a song in the library is chosen (a title still being typed is not saved).
  useAutosave(title.trim(), (t) => {
    if (t === current) return;
    dispatch({ type: 'sunday/settings', patch: { confessionSong: t } });
    notify(`공동체 고백송을 “${t}”(으)로 바꿨습니다 — 주일예배 Back 슬라이드가 곧 바뀝니다`);
  }, { enabled: !!chosen });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal confession-modal" role="dialog" aria-label="공동체 고백송">
        <header className="modal-head">
          <h2>🙌 공동체 고백송</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="wizard-body stack">
          <p className="hint">학기마다 · 해마다 바뀌는 고백송을 여기서 정합니다. 고르면 주일예배 Back 슬라이드의 고백송 부분이 이 노래로 바뀌고, 앞으로 만드는 모든 주일예배에 들어갑니다. (한 주만 다른 노래를 쓰려면 주일예배 마법사에서 바꾸세요.)</p>
          <div className="confession-now">지금: <b>{current}</b></div>
          <label className="stack">새 고백송 찾기
            <input autoFocus value={query} placeholder="노래 제목으로 검색 (찬양 라이브러리)" onChange={(e) => setQuery(e.target.value)} />
          </label>
          {matches.length > 0 && (
            <div className="confession-list">
              {matches.map((p) => (
                <button key={p.id} className={titleKey(p.title) === titleKey(title) ? 'on' : ''} onClick={() => setTitle(p.title)}>
                  {p.title}{p.online ? ' ☁' : ''}
                </button>
              ))}
            </div>
          )}
          {q && !matches.length && <p className="muted small">라이브러리에 “{query}”이(가) 없습니다. 가사를 먼저 추가하거나 제목을 그대로 입력하세요.</p>}
          <label className="stack">선택한 고백송
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {chosen ? (
            <p className="fmt-flash">✓ 라이브러리에 있음 — 가사 {lines}줄로 Back 슬라이드를 만듭니다.</p>
          ) : (
            <p className="warn">라이브러리에서 이 노래를 찾지 못했습니다. 가사를 추가하기 전까지는 Back 슬라이드의 고백송이 바뀌지 않습니다.</p>
          )}
          <div className="row gap-s">
            <span className="muted small grow">라이브러리에 있는 노래를 고르면 자동으로 저장됩니다.</span>
            <button className="primary" onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
