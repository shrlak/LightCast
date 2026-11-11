import { useEffect, useMemo, useState } from 'react';
import type { Presentation, Slide } from '../domain/types';
import { parseRefs, formatRef } from '../domain/bible/refs';
import { loadTranslation, searchBible, TRANSLATIONS, type SearchHit, type Translation } from '../domain/bible/data';
import { BIBLE_BOOKS } from '../domain/bible/books';
import { buildScripture } from '../domain/bible/slides';
import { uid } from '../domain/lyrics';
import { detectRefs } from '../domain/bible/detect';
import { loadVerseDefaults, saveVerseDefaults } from '../domain/bible/liveVerse';
import { useSpeechRefs } from './useSpeechRefs';

/** Translations available from the content server. */
export function loadTranslations(): Translation[] {
  return TRANSLATIONS;
}

interface Props {
  initialRefs?: string;
  onClose: () => void;
  onCreate: (p: Presentation, goLive: boolean) => void;
  /** Puts the verses straight into the selected 주일예배 playlist (church template design); resolves to its name. */
  service?: (info: { refs: string; sermonTitle: string; preacher: string; translations: string[]; versesPerSlide: number }) => Promise<string>;
}

/** Scripture slides: type references ("요3:16 롬8:28-30" or "John 3:16"), pick up to two translations. */
export function BibleModal({ initialRefs = '', onClose, onCreate, service }: Props) {
  const [input, setInput] = useState(initialRefs);
  const translations = TRANSLATIONS;
  const [defaults] = useState(loadVerseDefaults);
  const [chosen, setChosen] = useState<string[]>(defaults.translations);
  const [perSlide, setPerSlide] = useState(defaults.versesPerSlide);
  useEffect(() => saveVerseDefaults({ translations: chosen, versesPerSlide: perSlide }), [chosen.join(), perSlide]);
  const [heard, setHeard] = useState('');
  const speech = useSpeechRefs((recent) => setHeard(recent));
  const detected = useMemo(() => detectRefs(heard), [heard]);
  const [sermonTitle, setSermonTitle] = useState('');
  const [preacher, setPreacher] = useState('');
  const [placed, setPlaced] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const runSearch = async () => {
    const t = translations.find((x) => x.id === chosen[0]) ?? translations[0];
    try {
      setHits(searchBible(await loadTranslation(t), query));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addHit = (h: SearchHit) => {
    const token = `${BIBLE_BOOKS[h.bookIndex].abbrKo[0]}${h.chapter}:${h.verse}`;
    setInput((v) => (v.trim() ? `${v.trim()} ${token}` : token));
  };
  const addDetected = (compact: string) => setInput((v) => (parseRefs(v).refs.some((r) => formatRef(r) === formatRef(parseRefs(compact).refs[0])) ? v : v.trim() ? `${v.trim()} ${compact}` : compact));
  const { refs, invalid } = useMemo(() => parseRefs(input), [input]);
  const picked = chosen.map((id) => translations.find((t) => t.id === id)).filter(Boolean) as Translation[];

  useEffect(() => {
    if (!refs.length || !picked.length) {
      setSlides([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      buildScripture(refs, { translations: picked, versesPerSlide: perSlide, sermonTitle })
        .then((s) => { if (alive) { setSlides(s); setError(null); } })
        .catch((e: Error) => alive && setError(e.message));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, chosen.join(), perSlide, sermonTitle]);

  // With a 주일예배 open, every edit goes straight into its 성경 말씀 section (and the 설교 title slide).
  useEffect(() => {
    if (!service || !refs.length || !picked.length) return;
    let alive = true;
    setPlaced('예배에 넣는 중…');
    const t = setTimeout(() => {
      service({ refs: input, sermonTitle, preacher, translations: chosen, versesPerSlide: perSlide })
        .then((name) => alive && setPlaced(`✓ “${name}” 재생목록에 반영됨`))
        .catch((e: Error) => alive && setPlaced(`⚠ 예배에 넣지 못했습니다: ${e.message}`));
    }, 800);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, chosen.join(), perSlide, sermonTitle, preacher]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2)));

  const create = (live: boolean) => {
    const title = refs.map((r) => formatRef(r, picked[0]?.language ?? 'ko')).join(', ');
    onCreate({ id: uid('p'), title, slides, themeId: 'theme_scripture', folder: 'Scripture' }, live);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="성경">
        <header className="modal-head">
          <h2>📖 성경 말씀 · Bible</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="editor-body">
          <div className="editor-col">
            <label className="stack">성경 구절
              <input className="title-input" autoFocus placeholder="행1:8-10 요3:16 롬8:28  ·  로마서 5장 1-11절  ·  John 3:16; Ps 23" value={input} onChange={(e) => setInput(e.target.value)} />
            </label>
            <div className="muted small">
              {refs.map((r) => formatRef(r)).join(' · ') || 'Type one or more references'}
              {invalid.length > 0 && <span className="warn"> · not recognised: {invalid.join(', ')}</span>}
            </div>
            <label className="stack">설교 제목 (선택 — 제목 슬라이드를 넣습니다)
              <input value={sermonTitle} onChange={(e) => setSermonTitle(e.target.value)} />
            </label>
            {service && <label className="stack">설교자 (설교 첫 슬라이드)
              <input value={preacher} onChange={(e) => setPreacher(e.target.value)} />
            </label>}
            <div className="stack">
              <span>번역본 (2개까지 — 둘째 번역은 아래에 나옵니다)</span>
              <div className="row gap-xs wrap">
                {translations.map((t) => (
                  <button key={t.id} className={chosen.includes(t.id) ? 'active' : ''} onClick={() => toggle(t.id)}>
                    {chosen.indexOf(t.id) >= 0 ? `${chosen.indexOf(t.id) + 1}. ` : ''}{t.name}
                  </button>
                ))}
              </div>
              <p className="hint">☁ 쓸 때 온라인 서버에서 불러옵니다 — 이 컴퓨터에는 저장하지 않습니다.</p>
            </div>
            <label className="field-inline">슬라이드당 절 수
              <select value={perSlide} onChange={(e) => setPerSlide(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            {service && placed && <div className={placed.startsWith('⚠') ? 'warn' : 'hint'}>{placed}</div>}
            {error && <div className="warn">{error}</div>}
            <form className="stack" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
              <span>🔎 단어로 성경 찾기 (첫째로 고른 번역본에서)</span>
              <div className="row gap-xs"><input className="grow" placeholder="사랑 오래 참고 · shepherd" value={query} onChange={(e) => setQuery(e.target.value)} /><button type="submit">찾기</button></div>
            </form>
            <div className="stack bible-detect">
              <span>🎙 자동 인식 — 설교 원고를 붙여 넣거나 말하면 성경 구절을 찾아 줍니다</span>
              <div className="row gap-xs">
                <textarea className="grow" rows={2} placeholder="“오늘 본문은 요한복음 3장 16절입니다” …" value={heard} onChange={(e) => setHeard(e.target.value)} />
                <div className="stack">
                  <button className={speech.listening ? 'active' : ''} disabled={!speech.supported && !speech.listening} onClick={speech.listening ? speech.stop : speech.start}>{speech.listening ? '■ 듣는 중' : '🎙 듣기'}</button>
                  <button disabled={!heard} onClick={() => { speech.clear(); setHeard(''); }}>지우기</button>
                </div>
              </div>
              {speech.error && <div className="warn">{speech.error}</div>}
              {!speech.supported && <p className="hint">이 화면(앱)에서는 음성 인식이 되지 않을 수 있습니다. 목사님 태블릿의 무대 화면에서 말하면 인식됩니다.</p>}
              <div className="row gap-xs wrap">
                {detected.map((d) => <button key={d.compact} title="누르면 위 입력칸에 넣습니다" onClick={() => addDetected(d.compact)}>＋ {d.label}</button>)}
                {heard && !detected.length && <span className="muted small">찾은 구절이 없습니다</span>}
              </div>
            </div>
            {hits.length > 0 && (
              <ol className="preview-list search-hits">
                {hits.map((h) => (
                  <li key={`${h.bookIndex}-${h.chapter}-${h.verse}`} onClick={() => addHit(h)} title="클릭하면 이 구절을 넣습니다">
                    <span className="muted small">{BIBLE_BOOKS[h.bookIndex].nameKo} {h.chapter}:{h.verse}</span>
                    <div>{h.text}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="editor-col preview-col">
            <strong>슬라이드 {slides.length}장</strong>
            <ol className="preview-list">
              {slides.map((s) => (
                <li key={s.id}>
                  <span className="muted small">{s.title}</span>
                  <div className="pre">{s.text}</div>
                  {s.subtext && <div className="pre muted small">{s.subtext}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
        <footer className="modal-foot">
          <button onClick={onClose}>취소</button>
          <button disabled={!slides.length} onClick={() => create(false)}>라이브러리에 추가</button>
          <button className="primary" disabled={!slides.length} onClick={() => create(true)}>바로 띄우기</button>
        </footer>
      </div>
    </div>
  );
}
