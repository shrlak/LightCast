import { useEffect, useState, type Dispatch } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import type { Presentation } from '../../domain/types';
import { sequence } from '../../domain/arrangement';
import { activePlaylist, slideAt, nextCursor } from '../../domain/live';
import { groupColor } from '../../domain/lyrics';
import { SlideCanvas } from '../SlideCanvas';
import { liveCanvasProps } from '../liveProps';
import { SlideDesigner } from '../SlideDesigner';
import { useNow } from '../hooks';
import { SlideFormat } from './SlideFormat';
import { CanvasEditor } from './CanvasEditor';
import type { Commands } from './commands';
import { resolveBackground } from '../../domain/autoBackground';
import { LaserArea, NarrationHost, toggleLaser } from './showTools';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  cmd: Commands;
}

/** Every slide of the service (playlist), or of the current presentation, as clickable thumbnails. */
function AllSlides({ state, dispatch, onEdit }: { state: AppState; dispatch: Dispatch<Action>; onEdit: (presId: string, slideId: string, seq: number) => void }) {
  const lib = state.library;
  const items = activePlaylist(state)?.items ?? [];
  const inPlaylist = !!state.cursor && items.some((i) => i.kind !== 'header' && i.presentationId === state.cursor!.presentationId);
  const sections: { index: number | null; header?: string; p?: Presentation }[] = inPlaylist
    ? items.map((i, index) => (i.kind === 'header' ? { index, header: i.title } : { index, p: lib.presentations.find((x) => x.id === i.presentationId) }))
    : state.cursor || state.selectedId
      ? [{ index: null, p: lib.presentations.find((x) => x.id === (state.cursor?.presentationId ?? state.selectedId)) }]
      : [];
  return (
    <div className="all-slides">
      {sections.map((sec, k) => {
        if (sec.header) return <div key={k} className="all-header">{sec.header}</div>;
        const p = sec.p;
        if (!p) return null;
        const theme = lib.themes.find((t) => t.id === p.themeId) ?? lib.themes[0];
        return (
          <div key={k} className="all-pres">
            <div className="all-title">{p.title}</div>
            <div className="all-grid">
              {sequence(p).map(({ slide }, seq) => {
                const live = state.cursor?.presentationId === p.id && state.cursor.seq === seq && (sec.index == null || state.cursor.playlistIndex === sec.index || state.playlistIndex === sec.index);
                return (
                  <button key={`${slide.id}-${seq}`} className={`all-thumb ${live ? 'live' : ''} ${slide.disabled ? 'skip' : ''}`}
                    title="클릭: 화면에 표시 · 오른쪽 클릭: 편집"
                    onClick={() => {
                      if (sec.index != null) dispatch({ type: 'playlist/select', index: sec.index });
                      dispatch({ type: 'live/go', presentationId: p.id, seq });
                    }}
                    onContextMenu={(e) => { e.preventDefault(); onEdit(p.id, slide.id, seq); }}>
                    <SlideCanvas slide={slide} theme={theme} background={resolveBackground(slide, p)} bgEffect={p.bgEffect} />
                    <span className="all-label" style={{ background: groupColor(slide.group) }}>{seq + 1} {slide.label || slide.group}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {!sections.length && <p className="muted">재생목록이나 프레젠테이션을 선택하세요.</p>}
    </div>
  );
}

/**
 * Split-screen Presenter View. Left: what the audience sees, the next slide, notes, timer and
 * every slide of the service (click to show). Right: edit any slide while presenting — changes
 * to the slide on screen appear on the output immediately.
 */
export function PresenterView({ state, dispatch, cmd }: Props) {
  const now = useNow(1000);
  const [started] = useState(() => Date.now());
  const [mode, setMode] = useState<'next' | 'all'>('next');
  const [edit, setEdit] = useState<{ presId: string; slideId: string; seq: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const [designing, setDesigning] = useState(false);
  const [selEl, setSelEl] = useState<string | null>(null);
  const { live, cursor } = state;
  const lib = state.library;
  const p = cursor ? lib.presentations.find((x) => x.id === cursor.presentationId) : null;
  const seqLen = p ? sequence(p).length : 0;
  const next = cursor ? nextCursor(state, cursor) : null;
  const nextSlide = next ? slideAt(lib, next) : undefined;
  const nextPres = next ? lib.presentations.find((x) => x.id === next.presentationId) : null;
  const nextTheme = (nextPres && lib.themes.find((t) => t.id === nextPres.themeId)) || live.theme;
  const elapsed = Math.floor((now - started) / 1000);

  // The editor follows the live slide unless the operator picked another slide to edit.
  const liveTarget = cursor && live.slide ? { presId: cursor.presentationId, slideId: live.slide.id, seq: cursor.seq } : null;
  const target = follow ? liveTarget ?? edit : edit ?? liveTarget;
  const editPres = target ? lib.presentations.find((x) => x.id === target.presId) : null;
  const editSlide = editPres && target ? sequence(editPres)[target.seq]?.slide ?? null : null;
  const editDispatch: Dispatch<Action> = (a) => dispatch(a.type === 'slide/update' && a.presentationId === editPres?.id && a.slideId === editSlide?.id ? { ...a, seq: target?.seq, sequenceLength: editPres ? sequence(editPres).length : 0 } : a);
  const editTheme = (editPres && lib.themes.find((t) => t.id === editPres.themeId)) || lib.themes[0];
  const editingLive = !!editSlide && editSlide.id === live.slide?.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) cmd.endShow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmd]);

  const pickToEdit = (presId: string, slideId: string, seq: number) => {
    setEdit({ presId, slideId, seq });
    setFollow(false);
  };

  return (
    <div className="presenter split">
      <NarrationHost state={state} dispatch={dispatch} cmd={cmd} />
      <section className="presenter-main">
        <div className="presenter-top">
          <span className="presenter-clock">⏱ {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
          <span>{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <span className="muted truncate">{live.title ?? '라이브 없음'}</span>
          <div className="seg">
            <button className={mode === 'next' ? 'on' : ''} onClick={() => setMode('next')}>다음 슬라이드</button>
            <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>모든 슬라이드</button>
          </div>
          <button type="button" title="Ctrl을 누른 채 마우스를 움직여도 됩니다" onClick={toggleLaser}>◉ 레이저 포인터</button>
          <button className="danger" onClick={cmd.endShow}>쇼 마침 (Esc)</button>
        </div>
        {mode === 'next' ? (
          <div className="presenter-slides">
            <div className="presenter-current">
              <div className="presenter-label">현재 화면</div>
              <LaserArea cmd={cmd}><SlideCanvas {...liveCanvasProps(live)} /></LaserArea>
              <div className="presenter-nav">
                <button onClick={() => dispatch({ type: 'live/prev' })}>◀</button>
                <span>{cursor ? `슬라이드 ${cursor.seq + 1} / ${seqLen}` : '—'}</span>
                <button className="primary" onClick={() => dispatch({ type: 'live/next' })}>▶</button>
              </div>
            </div>
            <div className="presenter-side">
              <div className="presenter-label">다음 슬라이드</div>
              {nextSlide && nextPres ? (
                <button className="presenter-next" onClick={() => dispatch({ type: 'live/next' })} title="클릭하여 다음 슬라이드 표시">
                  <SlideCanvas slide={nextSlide} theme={nextTheme} background={resolveBackground(nextSlide, nextPres)} />
                </button>
              ) : <div className="presenter-end">쇼의 끝</div>}
              <div className="presenter-label">노트</div>
              <div className="presenter-notes">{live.slide?.notes || <span className="muted">노트 없음</span>}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="presenter-strip">
              <div className="presenter-mini"><SlideCanvas {...liveCanvasProps(live)} /></div>
              <div className="presenter-nav">
                <button onClick={() => dispatch({ type: 'live/prev' })}>◀</button>
                <span>{cursor ? `${cursor.seq + 1} / ${seqLen}` : '—'}</span>
                <button className="primary" onClick={() => dispatch({ type: 'live/next' })}>▶</button>
              </div>
            </div>
            <AllSlides state={state} dispatch={dispatch} onEdit={pickToEdit} />
          </>
        )}
      </section>

      <section className="presenter-edit">
        <div className="presenter-top">
          <strong>실시간 편집</strong>
          {editSlide && <span className={`edit-badge ${editingLive ? 'live' : ''}`}>{editingLive ? '● 화면에 표시 중 — 바로 반영됩니다' : '다음에 표시할 때 반영'}</span>}
          <label className="check small"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 현재 슬라이드 따라가기</label>
        </div>
        {editPres && editSlide ? (
          <div className="presenter-edit-body">
            <div className="presenter-edit-canvas">
              <CanvasEditor key={`${editPres.id}:${target?.seq}`} readOnly={editPres.protected} slide={editSlide} theme={editTheme} background={resolveBackground(editSlide, editPres)} bgEffect={editPres.bgEffect}
                selected={selEl ? [selEl] : []} onSelect={(ids) => setSelEl(ids[ids.length - 1] ?? null)}
                onLockedDelete={cmd.locked && editingLive ? () => cmd.notify('🔒 화면에 표시 중이라 삭제가 잠겨 있습니다 — 상태 표시줄의 🔒를 눌러 해제하세요') : undefined}
                onChange={(patch) => dispatch({ type: 'slide/update', presentationId: editPres.id, slideId: editSlide.id, seq: target?.seq, sequenceLength: sequence(editPres).length, patch })} />
              <div className="muted small">{editPres.title} · {editSlide.group}</div>
            </div>
            <div className="presenter-format">
              <SlideFormat state={state} dispatch={editDispatch} presentation={editPres} slide={editSlide} onDesign={() => setDesigning(true)} selectedId={selEl} onSelect={setSelEl} />
            </div>
          </div>
        ) : (
          <p className="muted presenter-hint">슬라이드를 화면에 표시하면 여기서 바로 편집할 수 있습니다. "모든 슬라이드"에서 오른쪽 클릭하면 다른 슬라이드를 편집합니다.</p>
        )}
      </section>


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
