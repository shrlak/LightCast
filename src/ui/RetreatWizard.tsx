import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Action, AppState } from '../domain/reducer';
import type { Slide } from '../domain/types';
import {
  BLOCK_LABELS, buildMeeting, defaultRetreat, lyricSlides, meetingFileName, newBlock,
  type BlockKind, type Meeting, type RetreatBlock, type RetreatDraft,
} from '../domain/retreat';
import { findSong, titleKey } from '../domain/sunday/songs';
import { parseRefs, formatRef } from '../domain/bible/refs';
import { buildScripture } from '../domain/bible/slides';
import { renderPdf, blobToBase64 } from '../domain/io/pdf';
import { exportPptx } from '../domain/io/pptxExport';
import { putMedia } from '../domain/media';
import { uid } from '../domain/lyrics';
import { ai } from '../domain/ai';
import { defaultRetreatLook, withTheme } from '../domain/motion';
import { RetreatLookEditor } from './RetreatLookEditor';
import { loadTranslations } from './BibleModal';
import { AutoTextarea } from './AutoTextarea';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  onClose: () => void;
  notify: (msg: string) => void;
}

const KEY = 'freecast.retreatDraft';
const STEPS = ['수련회 정보·콘티', '집회 순서', '생성'] as const;

function nextFriday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load(): RetreatDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved?.meetings) return saved;
  } catch {
    // fall through
  }
  return defaultRetreat(nextFriday());
}

/** 수련회 builder: one playlist (and PPTX) per meeting, built from an ordered list of blocks. */
export function RetreatWizard({ state, dispatch, onClose, notify }: Props) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<RetreatDraft>(() => {
    const saved = load();
    return saved.look ? saved : { ...saved, look: state.library.retreat ?? defaultRetreatLook(saved.theme) };
  });
  const look = d.look ?? defaultRetreatLook(d.theme);
  const [busy, setBusy] = useState<string | null>(null);
  const [readSongs, setReadSongs] = useState<{ title: string; lyrics: string }[]>([]);
  const pdfRef = useRef<HTMLInputElement>(null);
  const translations = loadTranslations();
  const lib = state.library.presentations;

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(KEY, JSON.stringify(d)), 300);
    return () => clearTimeout(t);
  }, [d]);

  const set = (patch: Partial<RetreatDraft>) => setD((x) => ({ ...x, ...patch }));
  const setMeeting = (id: string, patch: Partial<Meeting>) => setD((x) => ({ ...x, meetings: x.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const setBlock = (m: Meeting, id: string, patch: Partial<RetreatBlock>) =>
    setMeeting(m.id, { blocks: m.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as RetreatBlock) : b)) });
  const moveBlock = (m: Meeting, i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= m.blocks.length) return;
    const next = [...m.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setMeeting(m.id, { blocks: next });
  };

  /** Lyrics for a title: songs read from the 콘티 first, then the library. */
  const songFor = (title: string) => {
    const read = readSongs.find((s) => titleKey(s.title) === titleKey(title));
    if (read) return { title, text: read.lyrics };
    const linked = findSong(lib, title);
    return linked ? { title, text: '', presentationId: linked.id } : { title, text: '' };
  };

  const readConti = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      setBusy('Rendering PDF pages…');
      const pages: { page: number; data: string; text: string }[] = [];
      for (const f of Array.from(files)) {
        for (const p of await renderPdf(f, { scale: 1.5, maxPages: 30, quality: 0.8 })) {
          pages.push({ page: pages.length + 1, data: await blobToBase64(p.blob), text: p.text });
        }
      }
      setBusy(`AI is reading ${pages.length} pages…`);
      const r = await ai.retreat(pages.slice(0, 40));
      setReadSongs(r.songs);
      let assigned = 0;
      setD((x) => ({
        ...x,
        meetings: x.meetings.map((m) => {
          const col = r.meetings.find((c) => titleKey(c.name).includes(titleKey(m.name).slice(0, 4)) || titleKey(m.name).includes(titleKey(c.name).slice(0, 4)));
          if (!col) return m;
          const blocks = [...m.blocks];
          const wi = blocks.findIndex((b) => b.kind === 'worship');
          if (wi < 0) return m;
          assigned++;
          const w = blocks[wi] as Extract<RetreatBlock, { kind: 'worship' }>;
          blocks[wi] = { ...w, songs: col.songs.map((t) => {
            const read = r.songs.find((s) => titleKey(s.title) === titleKey(t));
            if (read) return { title: t, text: read.lyrics };
            const linked = findSong(lib, t);
            return linked ? { title: t, text: '', presentationId: linked.id } : { title: t, text: '' };
          }) };
          return { ...m, blocks };
        }),
      }));
      notify(`콘티 read: ${r.meetings.length} meetings, ${r.songs.length} songs with lyrics${assigned ? `, filled ${assigned} meetings` : ''}.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
      if (pdfRef.current) pdfRef.current.value = '';
    }
  };

  const setPoster = async (m: Meeting, file: File | undefined) => {
    if (!file) return;
    const id = uid('m');
    await putMedia(id, file);
    dispatch({ type: 'media/add', media: { id, name: file.name, type: 'image' } });
    setMeeting(m.id, { posterMediaId: id });
  };

  const build = async (m: Meeting, pptx: boolean) => {
    setBusy(`Building ${m.name}…`);
    try {
      const picked = d.translations.map((id) => translations.find((t) => t.id === id)).filter(Boolean) as typeof translations;
      const scripture = new Map<string, Slide[]>();
      for (const b of m.blocks) {
        if (b.kind !== 'scripture') continue;
        const { refs } = parseRefs(b.refs);
        if (refs.length && picked.length) scripture.set(b.id, await buildScripture(refs, { translations: picked, versesPerSlide: 1 }));
      }
      const built = buildMeeting(state.library, { ...d, look }, m, scripture);
      // Keep the retreat's look in the library, so 수련회 배경 can change it later for every deck.
      if (JSON.stringify(state.library.retreat) !== JSON.stringify(look)) dispatch({ type: 'retreat/look', look });
      dispatch({ type: 'presentation/createMany', presentations: built.presentations, playlist: built.playlist });
      if (pptx) {
        const merged = { ...state.library, presentations: [...state.library.presentations, ...built.presentations] };
        await exportPptx(merged, { playlist: built.playlist }, meetingFileName(m));
      }
      notify(`“${built.playlist.name}” created${built.warnings.length ? ` — ${built.warnings.join('; ')}` : ''}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const blockEditor = (m: Meeting, b: RetreatBlock, i: number) => (
    <div key={b.id} className="card">
      <div className="row gap-xs">
        <strong className="grow">{i + 1}. {BLOCK_LABELS[b.kind]}</strong>
        <button className="mini-btn" onClick={() => moveBlock(m, i, -1)}>↑</button>
        <button className="mini-btn" onClick={() => moveBlock(m, i, 1)}>↓</button>
        <button className="mini-btn" onClick={() => setMeeting(m.id, { blocks: m.blocks.filter((x) => x.id !== b.id) })}>✕</button>
      </div>
      {b.kind === 'worship' && (
        <div className="stack">
          <input placeholder="구분 장 제목 (찬양, 찬양집회…)" value={b.heading} onChange={(e) => setBlock(m, b.id, { heading: e.target.value })} />
          {b.songs.map((song, k) => {
            const linked = song.presentationId ? lib.find((p) => p.id === song.presentationId) : undefined;
            const upd = (patch: Partial<typeof song>) => setBlock(m, b.id, { songs: b.songs.map((x, n) => (n === k ? { ...x, ...patch } : x)) });
            return (
              <div key={k} className="song-card stack">
                <div className="row gap-xs">
                  <span className="song-num">{k + 1}</span>
                  <input className="grow plain strong" value={song.title} onChange={(e) => upd({ title: e.target.value })} onBlur={(e) => !song.text && !song.presentationId && upd(songFor(e.target.value))} />
                  <button className="mini-btn" onClick={() => setBlock(m, b.id, { songs: b.songs.filter((_, n) => n !== k) })}>✕</button>
                </div>
                {linked ? (
                  <span className="ok small">📚 Library: {linked.title} <button className="mini-btn" onClick={() => upd({ presentationId: undefined })}>edit here</button></span>
                ) : (
                  <>
                    <AutoTextarea rows={4} placeholder="가사 (빈 줄 = 다음 슬라이드)" value={song.text} onChange={(e) => upd({ text: e.target.value })} />
                    <span className="muted small">{lyricSlides(song.text, d.linesPerSlide).length}장</span>
                  </>
                )}
              </div>
            );
          })}
          <button onClick={() => setBlock(m, b.id, { songs: [...b.songs, { title: '새 찬양', text: '' }] })}>＋ 곡</button>
        </div>
      )}
      {b.kind === 'scripture' && (
        <>
          <input placeholder="본문 (예: 요15:1-8, 로마서 8장 28-30절)" value={b.refs} onChange={(e) => setBlock(m, b.id, { refs: e.target.value })} />
          <span className="muted small">{parseRefs(b.refs).refs.map((r) => formatRef(r)).join(' · ') || '—'} · one verse per slide</span>
        </>
      )}
      {b.kind === 'sermonTitle' && (
        <div className="row gap-xs">
          <input className="grow" placeholder="설교 제목" value={b.title} onChange={(e) => setBlock(m, b.id, { title: e.target.value })} />
          <input placeholder="설교자" value={b.preacher} onChange={(e) => setBlock(m, b.id, { preacher: e.target.value })} />
        </div>
      )}
      {b.kind === 'prayer' && <input value={b.title} onChange={(e) => setBlock(m, b.id, { title: e.target.value })} />}
      {b.kind === 'announcements' && (
        <>
          <input value={b.heading} onChange={(e) => setBlock(m, b.id, { heading: e.target.value })} />
          <AutoTextarea rows={5} placeholder={'1. <제목>\n내용…\n- 신청: https://…'} value={b.text} onChange={(e) => setBlock(m, b.id, { text: e.target.value })} />
        </>
      )}
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal wizard" role="dialog" aria-label="수련회 builder">
        <header className="modal-head">
          <h2>⛺ 수련회 · {d.name}</h2>
          <div className="steps-nav">
            {STEPS.map((s, i) => <button key={s} className={i === step ? 'tab active' : 'tab'} onClick={() => setStep(i)}>{i + 1}. {s}</button>)}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="wizard-body">
          {busy && <div className="card busy">⏳ {busy}</div>}
          {step === 0 && (
            <div className="stack narrow">
              <label className="stack">수련회 이름<input className="title-input" value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <div className="row gap-s">
                <label className="stack grow">부제<input value={d.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
                <label className="stack grow">주제 (theme)<input value={d.theme} placeholder="예: 빛으로 나아가라" onChange={(e) => set({ theme: e.target.value, look: withTheme(look, e.target.value) })} /></label>
              </div>
              <div className="card stack">
                <h3>움직이는 배경</h3>
                <p className="hint">주제를 넣으면 어울리는 움직이는 배경이 자동으로 골라집니다. 종류·색·속도는 바꿀 수 있고, 만든 뒤에도 <b>수련회 배경</b>에서 주제를 바꾸면 모든 수련회 슬라이드가 한 번에 바뀝니다.</p>
                <RetreatLookEditor look={look} theme={state.library.themes.find((t) => t.id === 'theme_bold') ?? state.library.themes[0]} showTheme={false}
                  onChange={(l) => set({ look: l, theme: l.theme })} />
              </div>
              <div className="card stack">
                <h3>찬양 콘티 (PDF, several files OK)</h3>
                <p className="hint">AI finds the song table and puts each column's songs into the matching meeting, and reads lyrics from any sheet music. Library songs are used as they are.</p>
                <button className="primary" disabled={!!busy} onClick={() => pdfRef.current?.click()}>콘티 PDF 올리기</button>
                <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => readConti(e.target.files)} />
                {readSongs.length > 0 && <span className="muted small">악보에서 읽은 곡: {readSongs.map((s) => s.title).join(', ')}</span>}
              </div>
              <div className="row gap-s wrap">
                <label className="field-inline">한 장에 가사 줄
                  <select value={d.linesPerSlide} onChange={(e) => set({ linesPerSlide: Number(e.target.value) })}>{[2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select>
                </label>
                <span>설교말씀 번역본:</span>
                {translations.map((t) => (
                  <button key={t.id} className={d.translations.includes(t.id) ? 'active' : ''}
                    onClick={() => set({ translations: d.translations.includes(t.id) ? d.translations.filter((x) => x !== t.id) : [...d.translations, t.id].slice(-2) })}>{t.name}</button>
                ))}
              </div>
              <p className="hint">주일 폐회예배 uses the ⛪ 주일예배 builder (same design as Sunday).</p>
              <button className="danger" onClick={() => confirm('Start a new retreat? This clears the current draft.') && setD(defaultRetreat(nextFriday()))}>새 수련회 시작</button>
            </div>
          )}
          {step === 1 && (
            <div className="stack">
              {d.meetings.map((m) => (
                <details key={m.id} className="card meeting" open>
                  <summary className="row gap-s">
                    <input className="plain strong" value={m.name} onChange={(e) => setMeeting(m.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()} />
                    <input type="date" value={m.date} onChange={(e) => setMeeting(m.id, { date: e.target.value })} onClick={(e) => e.stopPropagation()} />
                    <label className="small" onClick={(e) => e.stopPropagation()}>설교 포스터 <input type="file" accept="image/*,.wmf,.emf" onChange={(e) => setPoster(m, e.target.files?.[0])} /></label>
                    {m.posterMediaId && <span className="ok small">✓ poster</span>}
                    <button className="mini-btn danger" onClick={(e) => { e.preventDefault(); setD((x) => ({ ...x, meetings: x.meetings.filter((y) => y.id !== m.id) })); }}>집회 삭제</button>
                  </summary>
                  <div className="stack">
                    {m.blocks.map((b, i) => blockEditor(m, b, i))}
                    <select value="" onChange={(e) => e.target.value && setMeeting(m.id, { blocks: [...m.blocks, newBlock(e.target.value as BlockKind)] })}>
                      <option value="">＋ 순서 추가…</option>
                      {(Object.keys(BLOCK_LABELS) as BlockKind[]).map((k) => <option key={k} value={k}>{BLOCK_LABELS[k]}</option>)}
                    </select>
                  </div>
                </details>
              ))}
              <button onClick={() => setD((x) => ({ ...x, meetings: [...x.meetings, { id: uid('mt'), name: '새 집회', date: x.meetings[x.meetings.length - 1]?.date ?? nextFriday(), blocks: [newBlock('title'), newBlock('worship')] }] }))}>＋ 집회 추가</button>
            </div>
          )}
          {step === 2 && (
            <div className="stack narrow">
              {d.meetings.map((m) => (
                <div key={m.id} className="card row gap-s wrap">
                  <strong className="grow">{m.name} <span className="muted small">{m.date} · {m.blocks.map((b) => BLOCK_LABELS[b.kind]).join(' → ')}</span></strong>
                  <button disabled={!!busy} onClick={() => build(m, false)}>재생목록 만들기</button>
                  <button className="primary" disabled={!!busy} onClick={() => build(m, true)}>+ {meetingFileName(m)}.pptx</button>
                </div>
              ))}
              <button disabled={!!busy} onClick={async () => { for (const m of d.meetings) await build(m, false); }}>재생목록 모두 만들기</button>
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <span className="muted small grow">작성 내용은 자동으로 저장됩니다</span>
          <button disabled={step === 0} onClick={() => setStep(step - 1)}>이전</button>
          <button className="primary" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>다음</button>
        </footer>
      </div>
    </div>
  );
}
