import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import type { MediaMeta, Slide } from '../../domain/types';
import type { SongDraft } from '../../domain/sunday/songs';
import { parsePrayerTopics, planPrayerSlides } from '../../domain/sunday/prayer';
import { announcementPages, parseAnnouncements } from '../../domain/sunday/announcements';
import { mdy, mmdd, serviceDate, upcomingSunday } from '../../domain/sunday/notice';
import { buildService } from '../../domain/sunday/service';
import { parseRefs, formatRef } from '../../domain/bible/refs';
import { buildScripture, loadScriptureChunks } from '../../domain/bible/slides';
import { findLiveService } from '../../domain/sunday/liveDeck';
import { withSharedSongs } from '../../domain/online';
import { saveRestorePoint } from '../../domain/restorePoints';
import { DEFAULT_CONFESSION_SONG } from '../../domain/defaults';
import { WIZARD_PARTS, type ServiceUploads, type WizardPart } from '../ppt/useServiceUploads';
import { exportPptx } from '../../domain/io/pptxExport';
import { qrDataUrl } from '../../domain/io/qr';
import { loadTranslations } from '../BibleModal';
import { filesToSlides } from '../importFiles';
import { SundaySongs, type CoverInfo } from './SundaySongs';
import { AutoTextarea } from '../AutoTextarea';
import { OpeningSongField } from './OpeningSongField';
import { songsInService, SUNDAY_STEPS } from '../../domain/sunday/wizardSteps';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  onClose: () => void;
  notify: (msg: string) => void;
  /** The week's playlist, when it exists, follows every change made here. */
  service: ServiceUploads;
  /** 단계별 수정: open on this step alone (no step tabs); omitted = the whole wizard. */
  only?: number;
}

interface Draft {
  date: string;
  notice: string;
  songs: SongDraft[];
  refs: string;
  sermonTitle: string;
  preacher: string;
  confession: string;
  sermonSlides: Slide[];
  prayer: string;
  announcements: string;
  extraSlides: Slide[];
  /** 기도회 찬양 (before the Front): the title typed and the sheet-music deck found for it. */
  openingTitle: string;
  openingDeckId: string | null;
}

const DRAFT_KEY = 'freecast.sundayDraft';
const STEPS = SUNDAY_STEPS.map((s) => s.label);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function emptyDraft(): Draft {
  return { date: iso(upcomingSunday(new Date())), notice: '', songs: [], refs: '', sermonTitle: '', preacher: '', confession: '', sermonSlides: [], prayer: '', announcements: '', extraSlides: [], openingTitle: '', openingDeckId: null };
}

function loadDraft(): Draft {
  try {
    const saved = { ...emptyDraft(), ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') } as Draft;
    // A draft of a Sunday that has passed is last week's: its 고백송, 광고 and songs must not carry over.
    return saved.date < iso(new Date()) ? emptyDraft() : saved;
  } catch {
    return emptyDraft();
  }
}

/** 주일예배 builder: 7 steps that become this Sunday's playlist (and an optional MMDD.pptx). */
export function SundayWizard({ state, dispatch, onClose, notify, service, only }: Props) {
  const [step, setStep] = useState(only ?? 0);
  const [single, setSingle] = useState(only !== undefined);
  // A draft with no songs (or 기도제목) of its own starts from what that week's service already has.
  const [d, setD] = useState<Draft>(() => {
    const draft = loadDraft();
    const songs = draft.songs.length ? draft.songs : songsInService(state.library, new Date(`${draft.date}T12:00:00`));
    const prayer = draft.prayer.trim() ? draft.prayer : state.library.sunday.prayerText ?? '';
    return { ...draft, songs, prayer };
  });
  const [busy, setBusy] = useState<string | null>(null);
  const sermonRef = useRef<HTMLInputElement>(null);
  const extraRef = useRef<HTMLInputElement>(null);
  const { sunday } = state.library;
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const date = useMemo(() => new Date(`${d.date}T12:00:00`), [d.date]);
  const translations = loadTranslations();
  const chosen = sunday.translations.map((id) => translations.find((t) => t.id === id)).filter(Boolean) as typeof translations;

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(d)), 300);
    return () => clearTimeout(t);
  }, [d]);

  const onCover = (c: CoverInfo) => setD((x) => ({
    ...x,
    date: c.date ? iso(serviceDate(c.date, new Date())) : x.date,
    refs: c.scripture || x.refs,
    sermonTitle: c.sermonTitle || x.sermonTitle,
    preacher: c.preacher || x.preacher,
    confession: c.confession || x.confession,
  }));

  // When that week's playlist already exists, every change goes straight into it (only the part that changed).
  const synced = useRef(d);
  const settingsSig = JSON.stringify([sunday.translations, sunday.versesPerSlide, sunday.linesPerSlide]);
  const syncedSettings = useRef(settingsSig);
  const latest = useRef({ d, settingsSig });
  latest.current = { d, settingsSig };
  const flush = () => {
    const { d, settingsSig } = latest.current;
    const prev = synced.current;
    const settingsChanged = syncedSettings.current !== settingsSig;
    synced.current = d;
    syncedSettings.current = settingsSig;
    if (prev.date !== d.date) return;
    const ids = (l: Slide[]) => l.map((x) => x.id).join();
    const parts: WizardPart[] = [];
    if (prev.openingDeckId !== d.openingDeckId) parts.push('opening');
    if (JSON.stringify(prev.songs) !== JSON.stringify(d.songs) || settingsChanged) parts.push('songs');
    if (prev.refs !== d.refs || prev.sermonTitle !== d.sermonTitle || prev.preacher !== d.preacher || settingsChanged) parts.push('scripture');
    if (ids(prev.sermonSlides) !== ids(d.sermonSlides)) parts.push('sermon');
    if (prev.prayer !== d.prayer) parts.push('prayer');
    if (prev.announcements !== d.announcements) parts.push('announcements');
    if (ids(prev.extraSlides) !== ids(d.extraSlides)) parts.push('extra');
    if (prev.confession !== d.confession) parts.push('confession');
    if (!parts.length) return;
    service.syncWizard(d, parts, prev.sermonSlides, new Date(`${d.date}T12:00:00`))
      .then((w) => w?.length && notify(w.join('; ')))
      .catch((e: Error) => notify(e.message));
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const t = setTimeout(() => flushRef.current(), 900);
    return () => clearTimeout(t);
  }, [d, settingsSig]);
  // Closed right after a change (e.g. ✓ 완료 in 단계별 수정): the change still goes in, and the draft is kept.
  useEffect(() => () => {
    flushRef.current();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(latest.current.d)); } catch { /* storage full or blocked */ }
  }, []);

  const refs = parseRefs(d.refs);
  const topics = parsePrayerTopics(d.prayer);
  const prayerPlan = planPrayerSlides(topics);
  const ann = parseAnnouncements(d.announcements);
  const annSlides = ann.reduce((n, a) => n + announcementPages(a).length, 0);
  const addMedia = (m: MediaMeta) => dispatch({ type: 'media/add', media: m });
  const live = findLiveService(state.library, date);
  const openingDeck = (d.openingDeckId && state.library.presentations.find((p) => p.id === d.openingDeckId)) || null;

  const importInto = async (files: FileList | null, key: 'sermonSlides' | 'extraSlides') => {
    if (!files?.length) return;
    setBusy('Importing…');
    try {
      await saveRestorePoint(state.library, 'import', Date.now(), `${d.date} 주일예배`);
      const slides = await filesToSlides(Array.from(files), addMedia, setBusy);
      if (!slides.length) throw new Error('슬라이드를 읽지 못했습니다. 기존 자료는 유지됩니다.');
      set({ [key]: key === 'sermonSlides' ? slides : [...d[key], ...slides] } as Partial<Draft>);
    } catch (e) {
      notify(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const build = async (thenExport: boolean) => {
    setBusy('Building the service…');
    try {
      await saveRestorePoint(state.library, 'import', Date.now(), `${d.date} 주일예배`);
      const scriptureSlides = refs.refs.length && chosen.length
        ? await buildScripture(refs.refs, { translations: chosen, versesPerSlide: sunday.versesPerSlide, sermonTitle: d.sermonTitle, preacher: d.preacher })
        : [];
      // The church .pptx templates (same as the ppt program) — never the old look: this throws when they cannot be loaded.
      const templates = await service.needTemplates();
      const chunks = refs.refs.length && chosen.length
        ? await loadScriptureChunks(refs.refs, { translations: chosen, versesPerSlide: sunday.versesPerSlide })
        : [];
      const library = { ...state.library, presentations: await withSharedSongs(state.library.presentations, [d.confession, sunday.confessionSong, DEFAULT_CONFESSION_SONG], sunday.linesPerSlide) };
      const built = buildService(library, {
        date, songs: d.songs, scriptureSlides, sermonSlides: d.sermonSlides, prayerTopics: topics,
        announcements: ann, extraSlides: d.extraSlides, confessionSong: d.confession,
        templates, scripture: { refs: refs.refs, chunks, sermonTitle: d.sermonTitle, preacher: d.preacher },
        openingSong: openingDeck,
      });
      // That week's playlist already exists: update it in place instead of adding a second one.
      const existing = findLiveService(state.library, date);
      // Everything goes in now; closing must not send it again.
      synced.current = d;
      syncedSettings.current = settingsSig;
      const syncWarnings = existing ? (await service.syncWizard(d, WIZARD_PARTS, [], date)) ?? [] : [];
      if (!existing) dispatch({ type: 'presentation/createMany', presentations: built.presentations, playlist: built.playlist });
      if (d.prayer.trim()) dispatch({ type: 'sunday/settings', patch: { prayerText: d.prayer.trim() } });
      if (thenExport) {
        setBusy('Writing PPTX…');
        const lib = { ...state.library, presentations: [...state.library.presentations, ...built.presentations] };
        await exportPptx(lib, { playlist: built.playlist }, `${mmdd(date)}.pptx`);
      }
      const warnings = existing ? syncWarnings : built.warnings;
      notify(`Playlist “${built.playlist.name}” ${existing ? 'updated' : 'created'}${warnings.length ? ` — ${warnings.join('; ')}` : ''}`);
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const slideList = (slides: Slide[], key: 'sermonSlides' | 'extraSlides') => (
    <ol className="file-list">
      {slides.map((s, i) => (
        <li key={s.id}>
          <span className="truncate">{i + 1}. {s.group}{s.title ? ` · ${s.title}` : ''}{s.text ? ` · ${s.text.slice(0, 40)}` : s.background ? ' · image' : ''}</span>
          <button className="mini-btn" disabled={i === 0} onClick={() => { const n = [...slides]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set({ [key]: n } as Partial<Draft>); }}>↑</button>
          <button className="mini-btn" disabled={i === slides.length - 1} onClick={() => { const n = [...slides]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set({ [key]: n } as Partial<Draft>); }}>↓</button>
          <button className="mini-btn" onClick={() => set({ [key]: slides.filter((_, k) => k !== i) } as Partial<Draft>)}>✕</button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal wizard" role="dialog" aria-label="주일예배 builder">
        <header className="modal-head">
          {single ? (
            <>
              <h2>{SUNDAY_STEPS[step].icon} 주일예배 · {mmdd(date)} · {STEPS[step]} 수정</h2>
              <div className="steps-nav">
                <button className="tab" title="모든 단계를 차례로 보는 주일예배 마법사로 바꿉니다" onClick={() => setSingle(false)}>📝 전체 마법사로</button>
              </div>
            </>
          ) : (
            <>
              <h2>⛪ 주일예배 · {mmdd(date)}</h2>
              <div className="steps-nav">
                {STEPS.map((s, i) => <button key={s} className={i === step ? 'tab active' : 'tab'} onClick={() => setStep(i)}>{i + 1}. {s}</button>)}
              </div>
            </>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="wizard-body">
          {busy && <div className="card busy">⏳ {busy}</div>}
          {step === 0 && (
            <SundaySongs songs={d.songs} setSongs={(songs) => set({ songs })} notice={d.notice} setNotice={(notice) => set({ notice })}
              library={state.library.presentations} linesPerSlide={sunday.linesPerSlide} confessionSong={d.confession || sunday.confessionSong}
              setLinesPerSlide={(n) => dispatch({ type: 'sunday/settings', patch: { linesPerSlide: n } })} onCover={onCover} notify={notify} />
          )}
          {step === 1 && (
            <div className="stack narrow">
              <label className="stack">본문 (예: 롬5:1-11 · 로마서 5장 1-11절 · 행1:8-10 요3:16)
                <input className="title-input" value={d.refs} onChange={(e) => set({ refs: e.target.value })} />
              </label>
              <div className="muted small">{refs.refs.map((r) => formatRef(r)).join(' · ') || '—'}{refs.invalid.length ? <span className="warn"> · not recognised: {refs.invalid.join(', ')}</span> : null}</div>
              <label className="stack">설교 제목<input value={d.sermonTitle} onChange={(e) => set({ sermonTitle: e.target.value })} /></label>
              <label className="stack">설교자<input value={d.preacher} onChange={(e) => set({ preacher: e.target.value })} /></label>
              <div className="row gap-xs wrap">
                <span>번역본 (최대 2개):</span>
                {translations.map((t) => (
                  <button key={t.id} className={sunday.translations.includes(t.id) ? 'active' : ''}
                    onClick={() => dispatch({ type: 'sunday/settings', patch: { translations: sunday.translations.includes(t.id) ? sunday.translations.filter((x) => x !== t.id) : [...sunday.translations, t.id].slice(-2) } })}>{t.name}</button>
                ))}
              </div>
              <label className="field-inline">슬라이드당 절 수
                <select value={sunday.versesPerSlide} onChange={(e) => dispatch({ type: 'sunday/settings', patch: { versesPerSlide: Number(e.target.value) } })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
              </label>
              <p className="hint">More translations (개역개정, ESV, NASB…) can be imported from the 📖 Bible window.</p>
            </div>
          )}
          {step === 2 && (
            <div className="stack narrow">
              <p>설교 PPT (.pptx, .ppt) or PDF — its slides go right after the scripture. Skip if there is none.</p>
              <button className="primary" onClick={() => sermonRef.current?.click()}>설교 파일 올리기</button>
              <input ref={sermonRef} type="file" accept=".pptx,.ppt,.pptm,.ppsx,.pps,.potx,.pdf,image/*,.wmf,.emf,.svgz" multiple hidden onChange={(e) => { importInto(e.target.files, 'sermonSlides'); e.target.value = ''; }} />
              {slideList(d.sermonSlides, 'sermonSlides')}
            </div>
          )}
          {step === 3 && (
            <div className="stack">
              <OpeningSongField title={d.openingTitle} setTitle={(openingTitle) => set({ openingTitle })}
                deck={openingDeck} setDeck={(deck) => set({ openingDeckId: deck?.id ?? null, ...(deck ? { openingTitle: deck.title } : {}) })}
                presentations={state.library.presentations} theme={state.library.themes.find((t) => t.id === 'theme_classic') ?? state.library.themes[0]}
                addMedia={addMedia} create={(deck) => dispatch({ type: 'presentation/createMany', presentations: [deck] })} notify={notify} />
              <div className="two-col">
                <AutoTextarea rows={16} placeholder={'1. 회개와 마음의 정결\n- 지난 한 주간 …\n- …\n\n2. 예배를 위한 기도\n- …'} value={d.prayer} onChange={(e) => set({ prayer: e.target.value })} />
                <div className="stack">
                  <strong>기도제목 {topics.length}개 → 기도 준비 슬라이드 {prayerPlan.length || 1}장</strong>
                  {prayerPlan.map((g, i) => <div key={i} className="card small">{i + 1}장: {g.map((t) => t.title).join(' · ')}</div>)}
                  <p className="hint">Numbered lines start a topic; lines under it become ● points. Up to 3 topics per slide, spread evenly. Empty = the template's placeholder slide.</p>
                </div>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="two-col">
              <AutoTextarea rows={16} placeholder={'1. <새가족 환영>\n오늘 처음 오신 분들을 환영합니다!\n\n2. <여름수련회 안내>\n- 장소: …\n- 신청: https://forms.gle/…'} value={d.announcements} onChange={(e) => set({ announcements: e.target.value })} />
              <div className="stack">
                <strong>광고 {ann.length}개 → 슬라이드 {annSlides}장</strong>
                {ann.map((a, i) => announcementPages(a).map((pg, k, all) => (
                  <div key={`${i}-${k}`} className="card small ann-preview">
                    <div><strong>{i + 1}. {a.title}{all.length > 1 ? ` (${k + 1}/${all.length})` : ''}</strong><div className="pre">{pg.body.join('\n')}</div></div>
                    {pg.links.map((l) => <img key={l} src={qrDataUrl(l)} alt={l} title={l} />)}
                  </div>
                )))}
                <p className="hint">“1. &lt;제목&gt;” 또는 “1. 제목”으로 광고가 시작되고 번호는 순서대로 다시 매깁니다. 광고 안의 “1. 일시 / 2. 장소” 같은 번호 목록과 들여쓴 줄은 그 광고의 내용으로 남습니다. 광고 안에서 빈 줄을 넣으면 그 뒤는 같은 제목의 새 슬라이드로 넘어갑니다. 링크는 글에서 빠지고 슬라이드 위 QR 코드가 되며, 슬라이드에서 옮기거나 크기를 바꾸거나 지울 수 있습니다.</p>
              </div>
            </div>
          )}
          {step === 5 && (
            <div className="stack narrow">
              <p>추가 자료: PDF (one slide per page), images, PPTX. They go after the Back/End slides, in this order.</p>
              <button onClick={() => extraRef.current?.click()}>＋ Add files</button>
              <input ref={extraRef} type="file" accept=".pdf,.pptx,.ppt,.pptm,.ppsx,.pps,.potx,image/*,.wmf,.emf,.svgz" multiple hidden onChange={(e) => { importInto(e.target.files, 'extraSlides'); e.target.value = ''; }} />
              {slideList(d.extraSlides, 'extraSlides')}
            </div>
          )}
          {step === 6 && (
            <div className="stack narrow">
              <label className="field-inline">예배 날짜 (일요일)<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /> <span className="muted">{mdy(date)} → playlist “{mmdd(date)} 주일예배”, file {mmdd(date)}.pptx</span></label>
              <label className="field-inline">공동체 고백 song<input value={d.confession} placeholder={sunday.confessionSong || 'title from the library'} onChange={(e) => set({ confession: e.target.value })} /></label>
              <div className="form-grid">
                {(['frontId', 'prayerId', 'backId'] as const).map((k) => (
                  <label key={k}>{k === 'frontId' ? 'Front slides' : k === 'prayerId' ? '기도 slide' : 'Back / End slides'}
                    <select value={sunday[k] ?? ''} onChange={(e) => dispatch({ type: 'sunday/settings', patch: { [k]: e.target.value || null } })}>
                      <option value="">없음</option>
                      {state.library.presentations.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <ol className="order-preview">
                <li>기도회 찬양: {openingDeck ? `${openingDeck.title} (악보 ${openingDeck.slides.length}장)` : '—'}</li>
                <li>Front (기도제목 {topics.length}개, 날짜 {mdy(date)})</li>
                <li>찬양: {d.songs.filter((s) => !s.postSermon).map((s) => s.title).join(', ') || '—'} → 기도</li>
                <li>성경 말씀: {refs.refs.map((r) => formatRef(r)).join(', ') || '—'} {d.sermonTitle && `· “${d.sermonTitle}”`}</li>
                <li>설교: {d.sermonSlides.length} slides → 기도</li>
                <li>설교 후 찬양: {d.songs.filter((s) => s.postSermon).map((s) => s.title).join(', ') || '—'}</li>
                <li>광고: {ann.length}개 ({annSlides}장)</li>
                <li>Back / End (공동체 고백: {d.confession || sunday.confessionSong || '—'})</li>
                <li>추가 자료: {d.extraSlides.length}장</li>
              </ol>
              <div className="row gap-s">
                <button className="primary" disabled={!!busy} onClick={() => build(false)}>재생목록 만들기</button>
                <button disabled={!!busy} onClick={() => build(true)}>Create + download {mmdd(date)}.pptx</button>
                <button className="danger" onClick={() => confirm('이번 주 작성 내용을 지울까요?') && setD(emptyDraft())}>처음부터 다시</button>
              </div>
            </div>
          )}
        </div>
        {single ? (
          <footer className="modal-foot">
            <span className="muted small grow">
              {live ? `바꾼 내용은 “${live.name}”에 바로 들어갑니다` : `${mmdd(date)} 주일예배 재생목록이 아직 없습니다 — 바꾼 내용은 초안에 저장되고, 만들 때 들어갑니다`}
            </span>
            {!live && step !== STEPS.length - 1 && <button disabled={!!busy} onClick={() => build(false)}>재생목록 만들기</button>}
            <button className="primary" disabled={!!busy} onClick={onClose}>✓ 완료</button>
          </footer>
        ) : (
          <footer className="modal-foot">
            <span className="muted small grow">작성 내용은 자동으로 저장됩니다</span>
            <button disabled={step === 0} onClick={() => setStep(step - 1)}>이전</button>
            <button className="primary" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>다음</button>
          </footer>
        )}
      </div>
    </div>
  );
}
