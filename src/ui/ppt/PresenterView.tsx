import { useEffect, useState, type Dispatch } from 'react';
import { liveActionFor } from '../../domain/showActions';
import { SHOW_ALL_EVENT } from '../../domain/showScreen';
import { AllSlidesGrid, PointerSurface, ShowHelp, ShowToolbar, pointerKey, usePointerState, type ShowControl } from './showScreen';
import { sendLaser } from './showTools';
import { openOutput } from '../outputWindows';
import { toggleCaptions, useCaptionSettings } from './captionTools';
import type { Action, AppState } from '../../domain/reducer';
import { sequence } from '../../domain/arrangement';
import { slideAt, nextCursor } from '../../domain/live';
import { SlideCanvas } from '../SlideCanvas';
import { liveCanvasProps } from '../liveProps';
import { SlideDesigner } from '../SlideDesigner';
import { useNow } from '../hooks';
import { SlideFormat } from './SlideFormat';
import { CanvasEditor } from './CanvasEditor';
import type { Commands } from './commands';
import { resolveBackground } from '../../domain/autoBackground';
import { CaptionHost } from './captionTools';
import { NarrationHost } from './showTools';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  cmd: Commands;
}

const NOTES_KEY = 'lightcast.presenterNotesSize';
const loadNotesSize = () => { try { const n = Number(localStorage.getItem(NOTES_KEY)); return n >= 10 && n <= 60 ? n : 20; } catch { return 20; } };

/** h:mm:ss of a span of seconds, as PowerPoint's presenter view timer. */
export const presenterClock = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/**
 * 발표자 보기, laid out as PowerPoint's: the top bar (디스플레이 설정, 슬라이드 쇼 마침), the timer with pause and
 * reset and the time of day, the current slide (write and point on it), the tool row (펜 및 레이저 포인터 도구,
 * 모든 슬라이드 보기, 슬라이드 확대, 자막, 검정 화면, 기타 슬라이드 쇼 옵션) and ◀ 슬라이드 n/N ▶; on the right the next
 * slide and the notes with 텍스트 크게 / 작게. Editing a slide while presenting (LightCast) is under ⋯ › 슬라이드 편집.
 */
export function PresenterView({ state, dispatch, cmd }: Props) {
  const now = useNow(1000);
  const [timer, setTimer] = useState({ base: 0, since: Date.now() as number | null });
  const [mode, setMode] = useState<'slides' | 'all'>('slides');
  const [help, setHelp] = useState(false);
  const [notesSize, setNotesSize] = useState(loadNotesSize);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<{ presId: string; slideId: string; seq: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const [designing, setDesigning] = useState(false);
  const [selEl, setSelEl] = useState<string | null>(null);
    const ps = usePointerState();
  const caps = useCaptionSettings();
  const { live, cursor } = state;
  const lib = state.library;
  const p = cursor ? lib.presentations.find((x) => x.id === cursor.presentationId) ?? null : null;
  const seqLen = p ? sequence(p).length : 0;
  const next = cursor ? nextCursor(state, cursor) : null;
  const nextSlide = next ? slideAt(lib, next) : undefined;
  const nextPres = next ? lib.presentations.find((x) => x.id === next.presentationId) : null;
  const nextTheme = (nextPres && lib.themes.find((t) => t.id === nextPres.themeId)) || live.theme;
  const elapsed = Math.floor((timer.base + (timer.since === null ? 0 : now - timer.since)) / 1000);

  useEffect(() => { try { localStorage.setItem(NOTES_KEY, String(notesSize)); } catch { /* kept for this show only */ } }, [notesSize]);
  // G / − on the keyboard (from this window or the audience one) opens 모든 슬라이드 보기; Ctrl+P/L/I/E/A/H pick the pointer; F1 is help.
  useEffect(() => {
    const all = () => setMode('all');
    const key = (e: KeyboardEvent) => {
      if (pointerKey(e, psRef)) return;
      if (e.key === 'F1') { e.preventDefault(); setHelp(true); }
    };
    const psRef = ps;
    window.addEventListener(SHOW_ALL_EVENT, all);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener(SHOW_ALL_EVENT, all); window.removeEventListener('keydown', key); };
  }, [ps]);
  // The laser follows this window's pointer onto the audience screens.
  useEffect(() => { if (ps.pointer !== 'laser') sendLaser(null); }, [ps.pointer]);

  const run = (a: Parameters<typeof liveActionFor>[1]) => { const act = liveActionFor(state, a); if (act) dispatch(act); };
  const c: ShowControl = {
    next: () => (live.ended ? cmd.endShow() : dispatch({ type: 'live/next' })),
    prev: () => dispatch({ type: 'live/prev' }),
    go: (seq) => p && dispatch({ type: 'live/go', presentationId: p.id, seq }),
    lastViewed: () => run({ kind: 'lastViewed' }),
    black: () => dispatch({ type: 'live/toggleBlack' }),
    white: () => dispatch({ type: 'live/white' }),
    end: cmd.endShow,
    ink: (stroke) => dispatch({ type: 'live/ink', op: 'add', stroke }),
    erase: (x, y) => dispatch({ type: 'live/ink', op: 'erase', x, y }),
    clearInk: () => dispatch({ type: 'live/ink', op: 'clear' }),
    zoom: (zoom) => dispatch({ type: 'live/zoom', zoom }),
    customShows: p?.customShows?.map((s) => ({ id: s.id, name: s.name })),
    customShow: (id) => run({ kind: 'customShow', show: id }),
  };

  // Editing while presenting: the slide on screen, unless another was picked.
  const liveTarget = cursor && live.slide ? { presId: cursor.presentationId, slideId: live.slide.id, seq: cursor.seq } : null;
  const target = follow ? liveTarget ?? edit : edit ?? liveTarget;
  const editPres = target ? lib.presentations.find((x) => x.id === target.presId) : null;
  const editSlide = editPres && target ? sequence(editPres)[target.seq]?.slide ?? null : null;
  const editDispatch: Dispatch<Action> = (a) => dispatch(a.type === 'slide/update' && a.presentationId === editPres?.id && a.slideId === editSlide?.id ? { ...a, seq: target?.seq, sequenceLength: editPres ? sequence(editPres).length : 0 } : a);
  const editTheme = (editPres && lib.themes.find((t) => t.id === editPres.themeId)) || lib.themes[0];
  const editingLive = !!editSlide && editSlide.id === live.slide?.id;
  const theme = (p && lib.themes.find((t) => t.id === p.themeId)) || live.theme;

  return (
    <div className="presenter pv">
      <NarrationHost state={state} dispatch={dispatch} cmd={cmd} />
      <CaptionHost />
      {/* DeckCraft's presenter window: the time, the clock and the slide number, with 이전 · 다음 · 쇼 마침 on the right … */}
      <header className="pv-row pv-row1">
        <span className={`pv-elapsed ${timer.since === null ? 'paused' : ''}`} role="timer" aria-label="경과 시간">{presenterClock(elapsed)}</span>
        <span className="pv-clock">{new Date(now).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="pv-count">{live.ended ? '슬라이드 쇼 끝' : cursor ? `슬라이드 ${cursor.seq + 1}/${seqLen}` : '—'}</span>
        <span className="grow" />
        <button type="button" className="pv-btn" title="이전 애니메이션 또는 슬라이드" onClick={c.prev}>◀ 이전</button>
        <button type="button" className="pv-btn" title="다음 애니메이션 또는 슬라이드" onClick={c.next}>다음 ▶</button>
        <button type="button" className="pv-btn" onClick={cmd.endShow}>쇼 마침</button>
      </header>
      {/* … then the show's buttons. After them, LightCast's own: 펜 · 레이저, 자막, 설교 시간, 슬라이드 편집, 청중 화면. */}
      <div className="pv-row pv-row2">
        <button type="button" className="pv-btn" onClick={() => setTimer(timer.since === null ? { base: timer.base, since: Date.now() } : { base: timer.base + Date.now() - timer.since, since: null })}>{timer.since === null ? '다시 시작' : '일시 중지'}</button>
        <button type="button" className="pv-btn" onClick={() => setTimer({ base: 0, since: timer.since === null ? null : Date.now() })}>다시 설정</button>
        <button type="button" className={`pv-btn ${live.black ? 'on' : ''}`} aria-pressed={live.black} onClick={c.black}>{live.black ? '검정 화면 켬' : '검정 화면'}</button>
        <button type="button" className={`pv-btn ${live.white ? 'on' : ''}`} aria-pressed={!!live.white} onClick={c.white}>{live.white ? '흰색 화면 켬' : '흰색 화면'}</button>
        <button type="button" className={`pv-btn ${mode === 'all' ? 'on' : ''}`} aria-pressed={mode === 'all'} onClick={() => setMode(mode === 'all' ? 'slides' : 'all')}>{mode === 'all' ? '모든 슬라이드 켬' : '모든 슬라이드'}</button>
        <button type="button" className={`pv-btn ${ps.zoomArm || live.zoom ? 'on' : ''}`} onClick={() => (live.zoom ? c.zoom(null) : ps.setZoomArm(!ps.zoomArm))}>{live.zoom ? '확대 끄기' : ps.zoomArm ? '확대할 곳 클릭' : '확대'}</button>
        <span className="pv-sep" />
        <ShowToolbar className="pv-tools" penOnly penLabel={ps.pointer === 'laser' ? '레이저 포인터 켬' : ps.pointer === 'arrow' ? '펜 · 레이저 포인터' : '펜 켬'} c={c} ps={ps} nav={false} black={live.black} white={!!live.white} zoomed={!!live.zoom} onAll={() => setMode('all')} onHelp={() => setHelp(true)} />
        <button type="button" className={`pv-btn ${caps.on ? 'on' : ''}`} aria-label={caps.on ? '자막 끄기' : '자막 켜기'} aria-pressed={caps.on} onClick={() => toggleCaptions(cmd.notify)}>{caps.on ? '자막 끄기' : '자막 켜기'}</button>
        <button type="button" className={`pv-btn ${editing ? 'on' : ''}`} title="쇼를 진행하면서 슬라이드를 고칩니다" aria-pressed={editing} onClick={() => setEditing(!editing)}>슬라이드 편집</button>
        <button type="button" className="pv-btn" onClick={() => openOutput('output')}>청중 화면 열기</button>
      </div>
      <div className={`pv-body ${editing ? 'editing' : ''}`}>
        {mode === 'all' && p ? (
          <section className="pv-left pv-all">
            <AllSlidesGrid p={p} theme={theme} current={cursor?.seq ?? null} onPick={c.go} onClose={() => setMode('slides')} />
          </section>
        ) : (
          <section className="pv-left">
            {editing && <div className="pv-pane-label">청중 화면</div>}
            <div className="pv-current">
              <PointerSurface ps={ps} c={c} zoom={live.zoom ?? null} onLaser={(pt) => sendLaser(pt)}>
                <SlideCanvas {...liveCanvasProps(live)} />
              </PointerSurface>
            </div>
            {ps.zoomArm && <p className="pv-hint">미리 보기에서 확대할 곳을 클릭하세요.</p>}
          </section>
        )}
        {!editing && <section className="pv-right">
          <div className="pv-next-label">다음</div>
          <div className="pv-next">
            {nextSlide && nextPres ? (
              <button type="button" className="pv-next-btn" onClick={c.next} title="클릭하여 다음 슬라이드 표시">
                <SlideCanvas slide={nextSlide} theme={nextTheme} background={resolveBackground(nextSlide, nextPres)} />
              </button>
            ) : <div className="pv-end">슬라이드 쇼 끝</div>}
          </div>
          <div className="pv-notes-head">
            <span>노트</span>
            <button type="button" className="pv-btn small" title="텍스트 작게" aria-label="텍스트 작게" onClick={() => setNotesSize(Math.max(10, notesSize - 2))}>A−</button>
            <span className="pv-notes-px">{notesSize}</span>
            <button type="button" className="pv-btn small" title="텍스트 크게" aria-label="텍스트 크게" onClick={() => setNotesSize(Math.min(60, notesSize + 2))}>A+</button>
          </div>
          <div className="pv-notes" style={{ fontSize: notesSize }}>{live.slide?.notes || <span className="pv-muted">노트 없음</span>}</div>
        </section>}
        {editing && (
          <section className="presenter-edit pv-edit">
            <div className="presenter-top">
              <strong>슬라이드 편집</strong>
              {editSlide && <span className={`edit-badge ${editingLive ? 'live' : ''}`}>{editingLive ? '● 화면에 표시 중 — 바로 반영됩니다' : '다음에 표시할 때 반영'}</span>}
              <label className="check small"><input type="checkbox" checked={follow} onChange={(e) => { if (!e.target.checked) setEdit(liveTarget); setFollow(e.target.checked); }} /> 현재 슬라이드 따라가기</label>
              <button type="button" className="task-x" aria-label="닫기" onClick={() => setEditing(false)}>✕</button>
            </div>
            {editPres && editSlide ? (
              <div className="presenter-edit-body">
                <div className="presenter-edit-canvas">
                  <div className="pv-pane-label">LightCast 편집 화면</div>
                  <CanvasEditor key={`${editPres.id}:${target?.seq}`} readOnly={editPres.protected} slide={editSlide} theme={editTheme} background={resolveBackground(editSlide, editPres)} bgEffect={editPres.bgEffect}
                    selected={selEl ? [selEl] : []} onSelect={(ids) => setSelEl(ids[ids.length - 1] ?? null)}
                    onLockedDelete={cmd.locked && editingLive ? () => cmd.notify('🔒 화면에 표시 중이라 삭제가 잠겨 있습니다 — 상태 표시줄의 🔒를 눌러 해제하세요') : undefined}
                    onChange={(patch) => dispatch({ type: 'slide/update', presentationId: editPres.id, slideId: editSlide.id, seq: target?.seq, sequenceLength: sequence(editPres).length, patch })} />
                  <div className="muted small">{editPres.title} · {editSlide.group}</div>
                </div>
                <div className="presenter-format">
                  <div className="pv-pane-label">슬라이드 조정</div>
                  <SlideFormat state={state} dispatch={editDispatch} presentation={editPres} slide={editSlide} onDesign={() => setDesigning(true)} selectedId={selEl} onSelect={setSelEl} />
                </div>
              </div>
            ) : <p className="muted presenter-hint">슬라이드를 화면에 표시하면 여기서 바로 편집할 수 있습니다.</p>}
          </section>
        )}
      </div>
      {help && <ShowHelp onClose={() => setHelp(false)} />}
      {designing && editPres && editSlide && (
        <SlideDesigner readOnly={editPres.protected} slide={editSlide} theme={editTheme} background={resolveBackground(editSlide, editPres)} media={lib.media}
          addMedia={(m) => dispatch({ type: 'media/add', media: m })}
          onClose={() => setDesigning(false)}
          onSave={(elements, text) => {
            dispatch({ type: 'slide/update', presentationId: editPres.id, slideId: editSlide.id, seq: target?.seq, sequenceLength: sequence(editPres).length, patch: { elements: elements.length ? elements : undefined, text } });
          }} />
      )}
    </div>
  );
}
