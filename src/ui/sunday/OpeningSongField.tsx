import { useState } from 'react';
import type { MediaMeta, Presentation, Theme } from '../../domain/types';
import { findOpeningDeck, type SongPptCandidate } from '../../domain/sunday/openingSong';
import { fetchOpeningSong } from '../../domain/sunday/openingSongFetch';
import { SlideCanvas } from '../SlideCanvas';

interface Props {
  title: string;
  setTitle: (title: string) => void;
  /** The chosen sheet-music deck (in the library), or null. */
  deck: Presentation | null;
  setDeck: (deck: Presentation | null) => void;
  presentations: readonly Presentation[];
  theme: Theme;
  addMedia: (m: MediaMeta) => void;
  /** Store a new deck in the library. */
  create: (deck: Presentation) => void;
  notify: (msg: string) => void;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * 기도회 찬양: the song before the 기도회 (Front · 기도제목). Type the title and LightCast searches
 * "<제목> ppt", downloads the best-matching PowerPoint and keeps only the sheet music on white.
 */
export function OpeningSongField({ title, setTitle, deck, setDeck, presentations, theme, addMedia, create, notify }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SongPptCandidate[]>([]);
  const saved = title.trim() ? findOpeningDeck(presentations, title) : undefined;

  const find = async (opts: { pick?: SongPptCandidate; fresh?: boolean } = {}) => {
    const t = title.trim();
    if (!t || busy) return;
    setError(null);
    // The same song from an earlier week is already in the library.
    if (!opts.pick && !opts.fresh && saved) {
      setDeck(saved);
      return;
    }
    try {
      const result = await fetchOpeningSong(t, { addMedia, progress: setBusy, pick: opts.pick, candidates: opts.pick ? candidates : undefined });
      setCandidates(result.candidates);
      create(result.deck);
      setDeck(result.deck);
      notify(`기도회 찬양 “${t}”: 악보 ${result.deck.slides.length}장을 Front 앞에 넣었습니다`);
    } catch (e) {
      const found = (e as { candidates?: SongPptCandidate[] }).candidates;
      if (found) setCandidates(found);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const others = candidates.filter((c) => c.name !== deck?.scoreSheet?.file || c.page !== deck?.scoreSheet?.page);

  return (
    <div className="card stack opening-song">
      <strong>🙏 기도회 찬양 · Front 앞</strong>
      <p className="hint">매주 기도회(기도제목 슬라이드) 전에 부르는 찬양입니다. 제목을 넣고 찾기를 누르면 인터넷에서 “제목 ppt”를 검색해 위쪽 사이트의 PPT를 내려받고, 배경 없이 흰 바탕에 악보 · 가사 그림만 넣습니다.</p>
      <div className="row gap-s">
        <input value={title} placeholder="찬양 제목 (예: 주를 찾는 모든 자들이)" disabled={!!busy}
          onChange={(e) => { setTitle(e.target.value); setCandidates([]); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void find(); }} />
        <button className="primary" disabled={!title.trim() || !!busy} onClick={() => void find()}>🔎 PPT 찾기</button>
        {deck && <button disabled={!!busy} onClick={() => setDeck(null)}>✕ 빼기</button>}
      </div>
      {busy && <div className="muted small">⏳ {busy}</div>}
      {error && <div className="warn small">{error}</div>}
      {!deck && saved && !busy && <div className="muted small">라이브러리에 “{saved.title}” 악보 {saved.slides.length}장이 있습니다 — 찾기를 누르면 그것을 씁니다.</div>}
      {deck && (
        <>
          <div className="small">
            ✓ <strong>{deck.title}</strong> · 악보 {deck.slides.length}장
            {deck.scoreSheet && <> · “{deck.scoreSheet.file}” (<a href={deck.scoreSheet.page} target="_blank" rel="noreferrer">{host(deck.scoreSheet.page)}</a>)</>}
            {' '}<button className="mini-btn" disabled={!!busy} onClick={() => void find({ fresh: true })}>🔄 인터넷에서 다시 찾기</button>
          </div>
          <div className="opening-thumbs">
            {deck.slides.slice(0, 8).map((s) => <div key={s.id}><SlideCanvas slide={s} theme={theme} background={s.background ?? { kind: 'color', value: '#ffffff' }} /></div>)}
          </div>
        </>
      )}
      {others.length > 0 && (
        <details open={!deck}>
          <summary className="small">{deck ? '다른 곡이면 여기서 고르세요' : '찾은 PPT'} ({others.length})</summary>
          <ul className="opening-candidates">
            {others.map((c) => (
              <li key={c.url}>
                <button className="mini-btn" disabled={!!busy} title={c.url} onClick={() => void find({ pick: c })}>{c.name}</button>
                <span className="muted small">{Math.round(c.score * 100)}% · {c.format === 'ppt' ? '.ppt · ' : ''}{host(c.page)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
