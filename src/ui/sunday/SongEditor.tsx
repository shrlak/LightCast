import { useMemo, useRef, useState, type Dispatch } from 'react';
import type { Action } from '../../domain/reducer';
import type { Library, Presentation } from '../../domain/types';
import { songToPresentation, findSong, titleKey, type SongDraft, type SongSection } from '../../domain/sunday/songs';
import { planSectionSlides } from '../../domain/sunday/slidePlanner';
import { deleteSharedSong, registerSharedSong } from '../../domain/online';
import { uid } from '../../domain/lyrics';
import { useAutosave } from '../hooks';
import { PROTECTED_MESSAGE } from '../../domain/materialProtection';
import { ProtectedMaterialNotice } from '../MaterialProtection';
import { AutoTextarea } from '../AutoTextarea';
import type { WebLyricsOption } from '../../domain/recognition/conti';
import { readScorePhotos, searchSongLyrics, type LyricsOption } from '../../domain/sunday/songLookup';

interface Part { id: string; label: string; text: string }

export const ADMIN_KEY = 'freecast.adminPassword';
/** The 관리자 password used before on this computer (kept so edits can reach the shared library without asking again). */
export const readAdmin = () => {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? sessionStorage.getItem(ADMIN_KEY) ?? '';
  } catch {
    return '';
  }
};
export const rememberAdmin = (password: string) => {
  try {
    localStorage.setItem(ADMIN_KEY, password);
  } catch {
    // storage blocked: ask again next time
  }
};

/** A song's parts for editing: its source as written, else rebuilt from its slides (each slide break a blank line). */
function partsOf(song: Presentation | null): Part[] {
  if (song?.songSource?.sections.length) return song.songSource.sections.map((s) => ({ id: uid('pt'), label: s.label, text: s.lines.join('\n') }));
  const parts: Part[] = [];
  for (const s of song?.slides ?? []) {
    if (s.group === 'Title' || !s.text.trim()) continue;
    const last = parts[parts.length - 1];
    if (last && last.label === s.group) last.text += `\n\n${s.text}`;
    else parts.push({ id: uid('pt'), label: s.group, text: s.text });
  }
  return parts.length ? parts : [{ id: uid('pt'), label: 'V1', text: '' }];
}

const orderOf = (song: Presentation | null) => song?.songSource?.order ?? song?.meta?.order ?? [];

/** One song read off a 콘티, shown for the operator to check before it goes into this week's 예배. */
export interface SongReview {
  draft: SongDraft;
  index: number;
  total: number;
  /** What to tell the operator about this reading (where it came from, what to look at). */
  note: string;
  warn: boolean;
  /** The song's 악보 page(s), to compare against. */
  pageImages: string[];
  /** The lyrics are 찬양 라이브러리's own: left as they were, there is nothing to save again. */
  fromLibrary?: boolean;
  /** Lyrics found on the web and not put in: the operator may, comparing them with the 악보. */
  webOptions?: WebLyricsOption[];
  onAccept: (draft: SongDraft) => void;
  onSkip: () => void;
  onCancel: () => void;
}

/**
 * 찬양 편집 · 등록, the way the ppt site's song card works: title, key, 진행 (I-V1-C-…), and the
 * lyrics by part — a line break is the next line, a blank line starts the next slide; each part is
 * split into slides of up to 4 lines (6 lines → 3 + 3). Edits save by themselves, with no password:
 * the song replaces its entry in this computer's 찬양 라이브러리 at once (one song per title, the
 * newest). Existing shared songs also save to the church library without a password;
 * 등록 registers a song there. Only deletion requires the administrator password.
 *
 * Checking a 콘티's songs (review), 확인 does it all at once: the song as checked goes into this
 * computer's 찬양 라이브러리 and the church's, into this week's 예배, and the next song comes up.
 */
export function SongEditor({ library, dispatch, song, onClose, notify, reloadOnline, review }: {
  library: Library; dispatch: Dispatch<Action>; song: Presentation | null; onClose: () => void; notify: (m: string) => void; reloadOnline: () => void;
  /** Checking a song read off a 콘티: 확인 puts it into this week's 예배 (see useServiceUploads). */
  review?: SongReview;
}) {
  const draft = review?.draft;
  const [title, setTitle] = useState(draft?.title ?? song?.title ?? '');
  const [key, setKey] = useState(draft ? draft.key ?? '' : song?.meta?.key ?? '');
  const [order, setOrder] = useState((draft ? draft.progression ?? [] : orderOf(song)).join('-'));
  const [parts, setParts] = useState<Part[]>(() =>
    draft?.sections.length ? draft.sections.map((s) => ({ id: uid('pt'), label: s.label, text: s.lines.join('\n') })) : partsOf(song));
  const [admin, setAdmin] = useState(readAdmin);
  const [saveState, setSaveState] = useState<string | null>(null);
  const localId = useRef<string | null>(song && !song.online ? song.id : null);
  const protectedSong = library.presentations.find((p) => p.protected && (p.id === song?.id || p.id === localId.current || titleKey(p.title) === titleKey(title)));
  // Saving makes the song this computer's own copy, so what `song` is changes mid-edit; these stay.
  const fromLibrary = useRef(!!song?.online);
  const libraryTitle = useRef(song?.title ?? '');
  const sharedSave = useRef<Promise<void> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const per = library.sunday.linesPerSlide;
  // 새 찬양에서 가사 찾기: AI 검색 결과 / 사진 읽기 상태.
  const [lookup, setLookupState] = useState<{ busy?: string; options?: LyricsOption[]; note?: string }>({});
  const setLookup = (v: { busy?: string; options?: LyricsOption[]; note?: string }) => setLookupState(v);
  const photoRef = useRef<HTMLInputElement>(null);

  const sections: SongSection[] = parts.map((p) => ({ label: p.label.trim() || 'V', lines: p.text.split('\n') }));
  const tokens = order.split(/[-–,\s]+/).map((t) => t.trim()).filter(Boolean);
  const plan = useMemo(() => planSectionSlides(sections, tokens.length ? tokens : undefined, per), [JSON.stringify(sections), order, per]); // eslint-disable-line react-hooks/exhaustive-deps
  const slideCount = plan.reduce((n, p) => n + p.slides.length, 0);
  const valid = !!title.trim() && slideCount > 0;

  const setPart = (id: string, patch: Partial<Part>) => setParts((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const entry = () => ({ title: title.trim(), key: key.trim() || undefined, sections: sections.map((s) => ({ ...s, lines: s.lines.map((l) => l.trimEnd()) })), order: tokens });

  /** This computer's copy (online songs become a local song of the same title). */
  const writeLocal = (e: ReturnType<typeof entry>) => {
    if (protectedSong) return;
    const p = songToPresentation({ title: e.title, key: e.key, sections: e.sections, progression: e.order.length ? e.order : undefined }, { themeId: 'theme_sunday', linesPerSlide: per, folder: song && !song.online ? song.folder ?? 'Songs' : 'Songs' });
    const withSource = { ...p, songSource: { sections: e.sections, order: e.order.length ? e.order : undefined } };
    const local = localId.current ?? findSong(library.presentations.filter((x) => !x.online), e.title)?.id ?? null;
    const { id: newId, ...patch } = withSource;
    const stamped = { ...patch, updatedAt: Date.now(), templateKey: undefined, slidesEdited: undefined };
    if (local) dispatch({ type: 'presentation/update', id: local, patch: stamped });
    else dispatch({ type: 'presentation/createMany', presentations: [{ ...withSource, updatedAt: stamped.updatedAt }] });
    // The edited copy is now the library's entry for this title; the older copies go.
    dispatch({ type: 'songs/dedupe' });
    localId.current = local ?? newId;
  };

  // A library song keeps its title in the shared library (a new title there would be a new song).
  const shared = fromLibrary.current && title.trim() === libraryTitle.current;
  const registered = useRef(false);
  useAutosave(entry(), (e) => {
    if (registered.current || protectedSong) return;
    // Always into this computer's library first — no password involved.
    writeLocal(e);
    if (shared) {
      setSaveState('저장 중…');
      const job = registerSharedSong(e)
        .then(() => setSaveState('✓ 찬양 라이브러리에 자동 저장됨 (교회 공유 라이브러리 포함)'))
        .catch((err: Error) => setSaveState(`✓ 찬양 라이브러리에 자동 저장됨 · 교회 공유 라이브러리에는 반영하지 못함 (${err.message})`));
      sharedSave.current = job;
    } else {
      setSaveState('✓ 찬양 라이브러리에 자동 저장됨');
    }
  }, { delay: 700, enabled: !review && !protectedSong && valid });

  /** Closing: the last edit is already saved; the shared library is re-read when it changed. */
  const done = () => {
    onClose();
    const job = sharedSave.current;
    if (job) job.then(reloadOnline);
  };

  const save = async (label: string, job: () => Promise<void>, requiresAdmin = false) => {
    if (protectedSong) return setError(PROTECTED_MESSAGE);
    if (requiresAdmin && !admin) return setError('관리자 비밀번호를 입력하세요 (삭제할 때만 필요합니다).');
    setBusy(label);
    setError(null);
    try {
      await job();
      registered.current = true;
      if (requiresAdmin) rememberAdmin(admin);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      return;
    }
    setBusy(null);
    reloadOnline();
    onClose();
  };

  /**
   * 확인: the song as checked into 찬양 라이브러리 — this computer's at once, the church's in the
   * background (a library song left as it was is not saved again) — then into this week's 예배,
   * and on to the next song. The church library being out of reach does not hold the 예배 up.
   */
  const confirmReview = () => {
    if (!review) return;
    const e = entry();
    const asRead = JSON.stringify([review.draft.title.trim(), review.draft.key ?? '', review.draft.sections.map((x) => ({ label: x.label, lines: x.lines.map((l) => l.trimEnd()) })), review.draft.progression ?? []]);
    const unchanged = JSON.stringify([e.title, e.key ?? '', e.sections, tokens]) === asRead;
    if (!protectedSong && !(review.fromLibrary && unchanged)) {
      writeLocal(e);
      registerSharedSong(e)
        .then(reloadOnline)
        .catch((err: Error) => notify(`“${e.title}”은(는) 이 컴퓨터의 찬양 라이브러리에만 저장했습니다 — 교회 공유 라이브러리에는 반영하지 못했습니다 (${err.message})`));
    }
    review.onAccept({ ...review.draft, title: e.title, key: e.key, sections: e.sections, progression: tokens.length ? tokens : undefined });
  };

  /** AI로 검색: lyrics for the typed title from the internet, listed for the operator to pick. */
  const searchOnline = async () => {
    const t = title.trim();
    if (!t || /^새 찬양/.test(t)) return setLookup({ note: '찬양 제목을 먼저 입력하세요.' });
    setLookup({ busy: '인터넷에서 가사 검색 중…' });
    try {
      const options = await searchSongLyrics(t);
      setLookup({ options, note: options.length ? undefined : '인터넷에서 가사를 찾지 못했습니다. 제목을 확인하거나 악보 사진을 올려 보세요.' });
    } catch (e) {
      setLookup({ note: (e as Error).message });
    }
  };

  /** 악보 사진 업로드: read the lyrics (and title, key, 진행) off photo(s) of the 악보 or of captured lyrics. */
  const readPhotos = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (photoRef.current) photoRef.current.value = '';
    if (!list.length) return;
    if (parts.some((p) => p.text.trim()) && !confirm('지금 입력된 가사를 사진에서 읽은 가사로 바꿀까요?')) return;
    setLookup({ busy: '사진 읽는 중…' });
    try {
      const r = await readScorePhotos(list, (m) => setLookup({ busy: m }));
      setParts(r.sections.map((x) => ({ id: uid('pt'), label: x.label, text: x.lines.join('\n') })));
      if (!title.trim() && r.title) setTitle(r.title);
      if (!key.trim() && r.key) setKey(r.key);
      if (!tokens.length && r.progression?.length) setOrder(r.progression.join('-'));
      setLookup({ note: `✓ 사진에서 ${r.sections.length}개 파트의 가사를 읽었습니다 — 악보와 맞는지 확인하세요.` });
    } catch (e) {
      setLookup({ note: (e as Error).message });
    }
  };

  /** Put a web page's lyrics in, part by part (the 진행 the 콘티 wrote stays). */
  const putWebOption = (option: Pick<WebLyricsOption, 'host' | 'sections' | 'order'> | LyricsOption) => {
    const typed = parts.some((p) => p.text.trim());
    if (typed && !confirm(`지금 입력된 가사를 ${option.host || '웹'}의 가사로 바꿀까요?`)) return;
    setParts(option.sections.map((x) => ({ id: uid('pt'), label: x.label, text: x.lines.join('\n') })));
    if (!tokens.length && option.order.length) setOrder(option.order.join('-'));
  };

  const register = () => save('등록 중…', async () => {
    await registerSharedSong(entry());
    writeLocal(entry());
    notify(`“${title.trim()}”을(를) 교회 찬양 라이브러리에 등록했습니다 — 주일예배 생성기와 모든 컴퓨터에서 보입니다`);
  });
  const remove = () => {
    if (!song || !confirm(`교회 찬양 라이브러리에서 “${song.title}”을(를) 삭제할까요? 모든 컴퓨터와 주일예배 생성기에서 사라집니다.`)) return;
    save('삭제 중…', async () => {
      await deleteSharedSong(song.title, admin);
      for (const p of library.presentations) if (titleKey(p.title) === titleKey(song.title)) dispatch({ type: 'presentation/delete', id: p.id });
      notify(`“${song.title}”을(를) 교회 찬양 라이브러리에서 삭제했습니다`);
    }, true);
  };
  const duplicate = !song && !review && title.trim() && findSong(library.presentations, title.trim());
  const close = review ? review.onCancel : done;

  if (protectedSong && !review) return <div className="modal-backdrop"><div className="modal" role="dialog" aria-label="보호된 찬양">
    <ProtectedMaterialNotice presentation={protectedSong} dispatch={dispatch} /><button onClick={close}>닫기</button>
  </div></div>;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => !review && e.target === e.currentTarget && done()}>
      <div className="modal song-editor" role="dialog" aria-label="찬양 편집">
        <header className="modal-head">
          <h2>🎵 {review ? `콘티 찬양 확인 ${review.index + 1}/${review.total}` : song ? '찬양 편집' : '새 찬양 등록'}</h2>
          <button className="icon-btn" onClick={close} aria-label="닫기">✕</button>
        </header>
        {review && <p className={review.warn ? 'warn song-review-note' : 'hint song-review-note'}>{review.note}</p>}
        <div className="song-editor-body">
          <div className="stack song-editor-form">
            <div className="row gap-s">
              <label className="stack grow">제목<input autoFocus={!song} value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !lookup.busy) { e.preventDefault(); searchOnline(); } }}
                placeholder="찬양 제목 (Enter: 인터넷에서 가사 검색)" /></label>
              <label className="stack" style={{ width: 80 }}>Key<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="G" /></label>
            </div>
            <div className="row gap-xs wrap small">
              <button className="mini-btn" disabled={!!lookup.busy || !title.trim()} onClick={searchOnline} title="인터넷에서 제목으로 가사를 검색합니다">✨ AI로 검색</button>
              <button className="mini-btn" disabled={!!lookup.busy} onClick={() => photoRef.current?.click()} title="악보 사진이나 가사를 캡처한 사진에서 가사를 인식합니다">📷 악보·가사 사진 업로드</button>
              <input ref={photoRef} type="file" accept="image/*,.wmf,.emf" multiple hidden onChange={(e) => readPhotos(e.target.files)} />
              {lookup.busy && <span className="muted">⏳ {lookup.busy}</span>}
              {lookup.note && <span className={lookup.note.startsWith('✓') ? 'ok' : 'warn'}>{lookup.note}</span>}
            </div>
            {lookup.options?.map((o) => (
              <div key={o.id} className="song-web-option">
                <div className="row gap-xs">
                  <span className="grow small"><b>{o.host || '웹'}</b>{o.title ? ` · ${o.title}` : ''}</span>
                  {o.url && <a className="small" href={o.url} target="_blank" rel="noreferrer">열기</a>}
                  <button className="mini-btn" onClick={() => { putWebOption(o); setLookup({}); }}>넣기</button>
                </div>
                <div className="muted small">{o.sections.flatMap((x) => x.lines).filter((l) => l.trim()).slice(0, 3).join(' / ')}</div>
              </div>
            ))}
            {duplicate && <p className="muted small">라이브러리에 같은 제목의 찬양이 이미 있습니다 — 등록하면 그 찬양을 바꿉니다.</p>}
            <label className="stack">진행 <span className="muted small">(예: I-V1-V2-PC-C-B-C · 각 파트는 한 번씩, 처음 나오는 순서대로 슬라이드가 됩니다)</span>
              <input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="I-V1-C-V2-C-B-C" />
            </label>
            <p className="hint">한 슬라이드에 최대 {per}줄. 줄바꿈은 다음 줄, <b>빈 줄은 다음 슬라이드</b>입니다. 6줄이면 3줄 + 3줄로 나눕니다.</p>
            {parts.map((p, i) => (
              <div key={p.id} className="song-part">
                <div className="row gap-xs">
                  <input className="song-part-label" value={p.label} onChange={(e) => setPart(p.id, { label: e.target.value })} title="파트 (V1, V2, PC, C, B, I, T …)" />
                  <span className="grow" />
                  <button className="mini-btn" disabled={i === 0} onClick={() => setParts((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>▲</button>
                  <button className="mini-btn" disabled={i === parts.length - 1} onClick={() => setParts((l) => { const n = [...l]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>▼</button>
                  <button className="mini-btn" onClick={() => setParts((l) => l.filter((x) => x.id !== p.id))}>✕</button>
                </div>
                <AutoTextarea rows={Math.max(3, p.text.split('\n').length + 1)} value={p.text} onChange={(e) => setPart(p.id, { text: e.target.value })} placeholder="가사 (빈 줄 = 다음 슬라이드)" />
              </div>
            ))}
            <button onClick={() => setParts((l) => [...l, { id: uid('pt'), label: ['V1', 'C', 'V2', 'B', 'PC', 'T'][l.length] ?? `P${l.length + 1}`, text: '' }])}>＋ 파트 추가</button>
          </div>
          <div className="song-editor-preview">
            {review?.pageImages.map((src, i) => <img key={i} className="song-review-page" src={src} alt={`악보 ${i + 1}`} />)}
            {!!review?.webOptions?.length && (
              <div className="song-web-options">
                <div className="small"><b>🌐 웹에서 찾은 가사</b> <span className="muted">— 악보와 같은 곡이면 ‘넣기’</span></div>
                {review.webOptions.map((option) => (
                  <div key={option.id} className="song-web-option">
                    <div className="row gap-xs">
                      <span className="grow small"><b>{option.host || '웹'}</b>{option.title ? ` · ${option.title}` : ''}</span>
                      {option.url && <a className="small" href={option.url} target="_blank" rel="noreferrer">열기</a>}
                      <button className="mini-btn" onClick={() => putWebOption(option)}>넣기</button>
                    </div>
                    <div className="muted small">{option.sections.flatMap((x) => x.lines).filter((l) => l.trim()).slice(0, 3).join(' / ')}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="muted small">미리보기 · 제목 슬라이드 + 가사 슬라이드 {slideCount}장</div>
            <div className="song-preview-slide title">{title || '제목'}</div>
            {plan.flatMap((part) => part.slides.map((lines, k) => (
              <div key={`${part.section.label}-${k}`} className="song-preview-slide">
                <span className="song-preview-label">{part.section.label}</span>
                {lines.map((l, j) => <div key={j}>{l}</div>)}
              </div>
            )))}
          </div>
        </div>
        <footer className="song-editor-foot">
          {error && <div className="warn">{error}</div>}
          {!review && fromLibrary.current && <label className="row gap-xs muted small" title="라이브러리에서 삭제할 때만 필요합니다">관리자 비밀번호 (삭제용)
            <input type="password" value={admin} onChange={(e) => setAdmin(e.target.value)} autoComplete="off" style={{ width: 150 }} />
          </label>}
          <span className="grow" />
          {review ? (
            <>
              <button disabled={!!busy} onClick={review.onSkip} title="이 곡은 예배에 넣지 않습니다">빼기</button>
              <button className="primary" disabled={!valid || !!busy} onClick={confirmReview}
                title={`찬양 라이브러리(이 컴퓨터 + 교회 공유)에 저장하고 예배에 넣은 뒤 ${review.index + 1 < review.total ? '다음 곡으로 넘어갑니다' : '콘티 확인을 마칩니다'}`}>확인</button>
            </>
          ) : (
            <>
              {fromLibrary.current && <button className="danger" disabled={!!busy} onClick={remove}>찬양 전체를 라이브러리에서 삭제…</button>}
              <span className={saveState?.startsWith('⚠') ? 'warn small' : 'muted small'}>{saveState ?? '편집하면 자동으로 저장됩니다'}</span>
              <button disabled={!valid || !!busy} onClick={register}>{busy ?? '교회 찬양 라이브러리에 등록'}</button>
              <button className="primary" onClick={done}>닫기</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
