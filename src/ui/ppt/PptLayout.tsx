import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import type { Slide, SlideElement } from '../../domain/types';
import { blankSlide, uid } from '../../domain/lyrics';
import { putMedia } from '../../domain/media';
import { sequence } from '../../domain/arrangement';
import { activePlaylist } from '../../domain/live';
import { SlideFormat } from './SlideFormat';
import { CanvasEditor, SLIDE_TEXT, copyObjects, type CanvasTool, type ViewOptions } from './CanvasEditor';
import { LibraryPanel } from '../LibraryPanel';
import { MediaBin } from '../MediaBin';
import { Ribbon } from './Ribbon';
import { PresenterView } from './PresenterView';
import type { Commands } from './commands';
import { SlidePane, paneSlideId } from './SlidePane';
import { paneSource, selectedRow, slidePaneRows, type PaneSlide } from './paneRows';
import { resolveBackground } from '../../domain/autoBackground';
import { NameDialog } from '../NameDialog';
import { AutoTextarea } from '../AutoTextarea';
import { PROTECTED_MESSAGE } from '../../domain/materialProtection';
import { SUNDAY_STEPS } from '../../domain/sunday/wizardSteps';
import { AddToPlaylistMenu } from '../AddToPlaylist';
import { isPdfSlide } from '../../domain/importedSlides';
import { animationBadges } from '../../domain/animations';
import { canGroup, canUngroup, deleteSelection, groupSelection, orderSelection, ungroupSelection } from '../../domain/editOps';
import { selectedEls, type Ed, type TableRange, type TaskPane, type DialogKind } from './editor';
import { AnimationPane, CommentsPane, SelectionPane } from './panes';
import { Dialogs } from './dialogs';
import { RevisionsPane, SpellingPane } from './reviewPanes';
import { uid as newId } from '../../domain/lyrics';

/** A picture chosen from this computer, stored as media: its id (null when none was chosen). */
function pickPictureFile(dispatch: Dispatch<Action>): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const id = newId('m');
      void putMedia(id, f).then(() => { dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image' } }); resolve(id); });
    };
    inp.click();
  });
}
import { withMaster } from '../../domain/master';
import { Backstage, FindReplaceDialog, NotesPageView, OutlineView, PlayPreview, ReadingView, SlideSorter } from './views';
import { zoomStep } from '../../domain/viewOptions';
import { Menu, MenuItem, MenuSep } from './ribbonParts';

/** Status bar lock: a closed padlock when locked; the shackle swung open outward when unlocked. */
function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg className="ppt-lock-icon" viewBox="0 0 28 24" width="21" height="18" aria-hidden="true">
      {locked
        ? <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        // Unlocked: the shackle stays on its right leg and is turned outward, open beside the body.
        : <path d="M16.5 11V7.5a4.5 4.5 0 0 1 9 0V9.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />}
      <rect x="4.5" y="11" width="15" height="10.5" rx="2.2" fill="currentColor" />
      <circle cx="12" cy="15.6" r="1.6" fill={locked ? '#14673b' : '#fff'} />
    </svg>
  );
}

const LOCK_MSG = '🔒 화면에 표시 중이라 삭제·추가가 잠겨 있습니다 — 상태 표시줄의 🔒를 눌러 해제하세요';
/** PowerPoint's 100% is the slide at its real size: a 10-inch (4:3) slide at 96 dpi. */
const ACTUAL_W = 960;

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  cmd: Commands;
}

/** The PowerPoint window: title bar and ribbon, slide thumbnails, the slide with its notes, task panes and the status bar. */
export function PptLayout({ state, dispatch, cmd }: Props) {
  const [sectionRequest, setSectionRequest] = useState<{ presentationId: string; ids: string[]; initialValue: string } | null>(null);
  const [leftTab, setLeftTab] = useState<'slides' | 'library' | 'media'>('slides');
  /** Objects selected on the slide. */
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool | null>(null);
  // View › Show options (ruler, grid, guides, grid options, 회색조) are remembered on this computer, as PowerPoint does.
  const [view, setViewState] = useState<ViewOptions>(() => { try { return JSON.parse(localStorage.getItem('fc.pptView') ?? '{}') as ViewOptions; } catch { return {}; } });
  const setView = (v: ViewOptions) => { setViewState(v); try { localStorage.setItem('fc.pptView', JSON.stringify(v)); } catch { /* storage unavailable */ } };
  const [pane, setPane] = useState<TaskPane>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [cell, setCell] = useState<TableRange>({ r: 0, c: 0, r1: 0, c1: 0 });
  const [backstage, setBackstage] = useState(false);
  const [find, setFind] = useState<null | 'find' | 'replace'>(null);
  const [preview, setPreview] = useState<null | 'transition' | 'animation'>(null);
  const [reading, setReading] = useState<false | { ids?: string[]; rehearse?: boolean }>(false);
  const [linking, setLinking] = useState(false);
  const [commentDraft, setCommentDraft] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; seq: number } | null>(null);
  const [objMenu, setObjMenu] = useState<DOMRect | null>(null);
  const [addMenu, setAddMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [findTick, setFindTick] = useState(0);
  const [stageW, setStageW] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  // ⌘/Ctrl+F opens Find (as in PowerPoint); the library keeps its own search box.
  useEffect(() => {
    const onFind = () => setFind('find');
    window.addEventListener('freecast:find-library', onFind);
    return () => window.removeEventListener('freecast:find-library', onFind);
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
  }, [menu]);
  const p = state.library.presentations.find((x) => x.id === state.selectedId) ?? null;
  const slide = (p && cmd.slideSeq != null ? sequence(p)[cmd.slideSeq]?.slide : null) ?? p?.slides.find((s) => s.id === cmd.slideId) ?? p?.slides[0] ?? null;
  const index = p && slide ? p.slides.indexOf(slide) : -1;
  const theme = (p && state.library.themes.find((t) => t.id === p.themeId)) || state.library.themes[0];
  const background = slide ? resolveBackground(slide, p) : null;

  // The 슬라이드 pane lists the whole playlist (or the presentation picked on its own).
  const playlist = activePlaylist(state);
  const source = paneSource(state.library, playlist, state.playlistIndex, state.selectedId);
  const rows = useMemo(() => slidePaneRows(state.library, source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.library.presentations, state.library.playlists, state.activePlaylistId, state.playlistIndex, state.selectedId]);
  const paneSlides = useMemo(() => rows.filter((r): r is PaneSlide => r.kind === 'slide'), [rows]);
  const [paneKey, setPaneKey] = useState<string | null>(null);
  const selected = (cmd.slideSeq != null ? paneSlides.find((r) => r.presentation.id === p?.id && r.seq === cmd.slideSeq && (r.itemIndex === null || state.playlistIndex === null || r.itemIndex === state.playlistIndex)) : null)
    ?? selectedRow(rows, paneKey, p?.id, slide?.id, state.playlistIndex);
  const item = selected?.itemIndex ?? (source && 'playlist' in source
    ? state.playlistIndex ?? source.playlist.items.findIndex((i) => i.kind !== 'header' && i.presentationId === p?.id)
    : null);
  /** Slides picked together (Shift/Ctrl-click) in the edited presentation; empty = just the one being edited. */
  const [multi, setMulti] = useState<string[]>([]);
  useEffect(() => { setMulti([]); setSel([]); }, [p?.id, state.activePlaylistId, item]);
  useEffect(() => { setSel([]); setCell({ r: 0, c: 0, r1: 0, c1: 0 }); }, [slide?.id]);
  const sameBlock = (r: PaneSlide) => !!selected && r.presentation.id === selected.presentation.id && r.itemIndex === selected.itemIndex;
  const onClickSlide = (r: PaneSlide, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    setSel([]);
    if (selected && sameBlock(r) && e.shiftKey) {
      const a = paneSlides.indexOf(selected), b = paneSlides.indexOf(r);
      setMulti(paneSlides.slice(Math.min(a, b), Math.max(a, b) + 1).filter(sameBlock).map((x) => x.key));
    } else if (selected && sameBlock(r) && (e.metaKey || e.ctrlKey)) {
      const cur = multi.length ? multi : [selected.key];
      setMulti(cur.includes(r.key) ? cur.filter((key) => key !== r.key) : [...cur, r.key]);
    } else {
      setMulti([]);
      pick(r);
    }
  };
  const picked = (): PaneSlide[] => multi.length && selected ? paneSlides.filter((r) => sameBlock(r) && multi.includes(r.key)) : selected ? [selected] : [];
  const deleteSlides = (pickedRows: PaneSlide[]) => {
    if (!p || !pickedRows.length) return;
    if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
    const seqs = pickedRows.map((r) => r.seq);
    dispatch({ type: 'slide/delete', presentationId: p.id, slideIds: pickedRows.map((r) => r.slide.id), seqs });
    const pages = sequence(p);
    const at = Math.min(...seqs);
    const left = pages.filter((_, i) => !seqs.includes(i));
    const next = Math.min(at, left.length - 1);
    cmd.setSlideId(left[next]?.slide.id ?? null, next >= 0 ? next : undefined);
    setMulti([]); setSel([]);
  };
  const updateSlide = (patch: Partial<Slide>) => p && slide && dispatch({ type: 'slide/update', presentationId: p.id, slideId: slide.id, seq: selected?.seq, sequenceLength: sequence(p).length, patch });
  const editDispatch: Dispatch<Action> = (a) => dispatch(a.type === 'slide/update' && a.presentationId === p?.id && a.slideId === slide?.id ? { ...a, seq: selected?.seq, sequenceLength: p ? sequence(p).length : 0 } : a);
  const makeSection = (ids: string[]) => {
    if (!p || !ids.length) return;
    setSectionRequest({ presentationId: p.id, ids, initialValue: slide?.label || '새 구역' });
  };
  const pick = (r: PaneSlide) => {
    setSel([]);
    if (r.itemIndex !== null && r.itemIndex !== state.playlistIndex) dispatch({ type: 'playlist/select', index: r.itemIndex });
    cmd.setSlideId(r.slide.id, r.seq);
    setPaneKey(r.key);
  };
  const updateSlides = (slides: Slide[]) => p && dispatch({ type: 'presentation/update', id: p.id, patch: { slides } });

  // Keep the selection valid when switching presentations.
  useEffect(() => {
    const page = p && cmd.slideSeq != null ? sequence(p)[cmd.slideSeq]?.slide : null;
    if (page && page.id !== cmd.slideId) cmd.setSlideId(page.id, cmd.slideSeq!);
    else if (p && !p.slides.some((s) => s.id === cmd.slideId)) cmd.setSlideId(p.slides[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.slides, cmd.slideSeq, cmd.slideId]);

  const canEdit = !!p && !p.protected && !!slide && !isPdfSlide(slide);
  const elements = slide?.elements ?? [];
  const ed: Ed = {
    state, dispatch, cmd, p, slide, theme, elements, sel, setSel, dialog, setDialog, play: (opts) => setReading(opts ?? {}),
    selEls: selectedEls(elements, sel),
    canEdit,
    updateSlide: (patch) => { if (!canEdit && !('notes' in patch && Object.keys(patch).length === 1)) { if (p?.protected) cmd.notify(PROTECTED_MESSAGE); return; } updateSlide(patch); },
    updatePres: (patch) => { if (!p) return; if (p.protected) return cmd.notify(PROTECTED_MESSAGE); dispatch({ type: 'presentation/update', id: p.id, patch }); },
    setElements: (fn) => { if (!canEdit || !slide) return; const next = fn(slide.elements ?? []); updateSlide({ elements: next.length ? next : undefined }); },
    addElement: (el: SlideElement) => { if (!canEdit || !slide) return; updateSlide({ elements: [...(slide.elements ?? []), el] }); setSel([el.id]); },
    tool, setTool, view, setView, pane, setPane, zoom, setZoom, notesOpen, setNotesOpen,
    makeSection: () => makeSection(picked().map((r) => r.slide.id)),
    cell, setCell,
  };

  const addSlideAfter = () => {
    if (!p || !slide) return;
    if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
    if (cmd.locked && state.live.slide) return cmd.notify(LOCK_MSG);
    const n = p.master?.elements.length ? withMaster(blankSlide(slide.group), p.master.elements) : blankSlide(slide.group);
    const slides = [...p.slides];
    slides.splice(p.slides.indexOf(slide) + 1, 0, n);
    updateSlides(slides);
    cmd.setSlideId(n.id);
    setMulti([]);
  };

  // Keys of the slide pane and PowerPoint's window shortcuts (the slide editor handles its own first).
  useEffect(() => {
    if (cmd.view === 'presenter') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const mod = e.metaKey || e.ctrlKey;
      if (e.defaultPrevented || e.isComposing || document.querySelector('.modal-backdrop')) return;
      // The canvas's hidden typing field (CanvasEditor `sink`) is not typing: the window's shortcuts still apply.
      const typing = (t.isContentEditable || !!t.closest('input,textarea,select')) && !t.closest('[data-ime-sink]');
      if (mod && !e.altKey && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'm') { e.preventDefault(); addSlideAfter(); return; }
        if (k === 'h') { e.preventDefault(); setFind('replace'); return; }
      }
      if (e.key === 'Escape' && tool) { setTool(null); return; }
      if (typing || !paneSlides.length || backstage || reading) return;
      if (cmd.view === 'sorter' && t.closest('.slides-panel')) return;
      const locked = cmd.locked && !!state.live.slide;
      if ((e.key === 'Backspace' || e.key === 'Delete') && !sel.length && selected) {
        if (mod || e.altKey) return;
        e.preventDefault();
        if (e.repeat) return;
        if (locked) cmd.notify(LOCK_MSG);
        else deleteSlides(picked());
        return;
      }
      // ⌘/Ctrl+D duplicates the slide when no object is selected, as in PowerPoint's slide pane.
      if (mod && !e.altKey && e.key.toLowerCase() === 'd' && p && slide && !sel.length) {
        e.preventDefault();
        const copy = { ...slide, id: uid('s') };
        const slides = [...p.slides];
        slides.splice(p.slides.indexOf(slide) + 1, 0, copy);
        updateSlides(slides);
        cmd.setSlideId(copy.id);
        setMulti([]);
        return;
      }
      // Enter adds a blank slide after the current one (Enter on a focused button still presses it).
      if (e.key === 'Enter' && !sel.length && p && slide && !mod && !e.altKey && !t.closest('button,a,[role="button"]')) {
        e.preventDefault();
        addSlideAfter();
        return;
      }
      const step = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 }[e.key];
      if (!step || sel.length) return;
      setMulti([]);
      e.preventDefault();
      const at = selected ? paneSlides.indexOf(selected) : -1;
      const next = paneSlides[Math.min(paneSlides.length - 1, Math.max(0, at + step))];
      if (next) {
        pick(next);
        document.getElementById(paneSlideId(next))?.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Paste a screenshot or picture: it becomes a new slide after the current one.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (!p || cmd.view === 'presenter' || t.matches('input,textarea,select,[contenteditable="true"]') || document.querySelector('.modal-backdrop')) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
      const id = uid('m');
      const at = slide ? p.slides.indexOf(slide) + 1 : p.slides.length;
      putMedia(id, file).then(() => {
        dispatch({ type: 'media/add', media: { id, name: file.name || '붙여넣은 그림', type: 'image' } });
        const n: Slide = { id: uid('s'), group: slide?.group ?? 'Image', text: '', background: { kind: 'media', mediaId: id, mediaType: 'image', fit: 'contain' } };
        const slides = [...p.slides];
        slides.splice(at, 0, n);
        updateSlides(slides);
        cmd.setSlideId(n.id);
        cmd.notify('붙여넣은 그림을 새 슬라이드로 추가했습니다');
      }).catch(() => cmd.notify('그림을 붙여넣지 못했습니다'));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // The stage's width, for the zoom percentage shown when the slide fits the window.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.querySelector('.ppt-canvas')?.clientWidth ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [cmd.view, zoom]);

  const slideMenu = (id: string, action: 'dup' | 'up' | 'down' | 'skip' | 'live') => {
    if (!p) return;
    const i = p.slides.findIndex((s) => s.id === id);
    const s = p.slides[i];
    const slides = [...p.slides];
    if (action === 'dup') slides.splice(i + 1, 0, { ...s, id: uid('s') });
    if (action === 'up' && i > 0) [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]];
    if (action === 'down' && i < slides.length - 1) [slides[i + 1], slides[i]] = [slides[i], slides[i + 1]];
    if (action === 'skip') slides[i] = { ...s, disabled: s.disabled ? undefined : true };
    if (action === 'live') {
      const seq = menu?.seq ?? selected?.seq ?? sequence(p).findIndex((x) => x.slide.id === s.id);
      if (seq >= 0) dispatch({ type: 'live/go', presentationId: p.id, seq });
    } else updateSlides(slides);
    setMenu(null);
  };

  const shownZoom = zoom ?? (stageW ? stageW / ACTUAL_W : 1);
  const badges = useMemo(() => (slide?.animations?.length ? animationBadges(slide) : undefined), [slide]);
  const actions = {
    onBackstage: () => setBackstage(true),
    onFind: () => setFind('find'),
    onReplace: () => setFind('replace'),
    onLink: () => setLinking(true),
    onComment: () => { setPane('comments'); setCommentDraft(true); },
    onPreview: (w: 'transition' | 'animation') => setPreview(w),
    onOutline: () => cmd.setView(cmd.view === 'outline' ? 'normal' : 'outline'),
    onReading: () => setReading({}),
  };
  const selIds = ed.selEls.map((e) => e.id);

  const statusBar = (
    <footer className="ppt-status pp-status">
      <span>{p && index >= 0 ? `슬라이드 ${index + 1}/${p.slides.length}` : '프레젠테이션 없음'}</span>
      <span className="pp-status-item">한국어</span>
      <span className="ppt-team" title="KCCP 빛주사랑 대학청년부 미디어팀"><img src="/media-team-logo.png" alt="" />KCCP 미디어팀</span>
      <span className="grow" />
      <button type="button" className={`ppt-lock ${cmd.locked ? 'on' : 'off'}`} onClick={() => cmd.setLocked(!cmd.locked)} aria-pressed={cmd.locked}
        title={cmd.locked ? '잠금 켜짐: 화면에 표시 중에는 Enter·Delete로 슬라이드를 추가/삭제하지 않습니다 (클릭하면 해제)' : '잠금 해제됨 (클릭하면 잠금)'}>
        <LockIcon locked={cmd.locked} /><span>{cmd.locked ? '잠금' : '잠금 해제'}</span>
      </button>
      <button type="button" className={`pp-status-btn ${notesOpen ? 'on' : ''}`} title="슬라이드 노트" onClick={() => setNotesOpen(!notesOpen)}>≡ 슬라이드 노트</button>
      <button type="button" className={`pp-status-btn ${pane === 'comments' ? 'on' : ''}`} title="메모" onClick={() => setPane(pane === 'comments' ? null : 'comments')}>💬 메모</button>
      <span className="pp-views" role="group" aria-label="보기">
        <button type="button" className={cmd.view === 'normal' ? 'on' : ''} title="기본" onClick={() => cmd.setView('normal')}>▭</button>
        <button type="button" className={cmd.view === 'sorter' ? 'on' : ''} title="여러 슬라이드" onClick={() => cmd.setView('sorter')}>▦</button>
        <button type="button" title="읽기용 보기" onClick={() => setReading({})}>📖</button>
        <button type="button" className={cmd.view === 'presenter' ? 'on' : ''} title="슬라이드 쇼 (발표자 보기)" onClick={() => cmd.startShow(true)}>▶</button>
      </span>
      <span className="pp-zoom">
        <button type="button" title="축소" onClick={() => setZoom(zoomStep(shownZoom, false))}>−</button>
        <input type="range" min={10} max={400} value={Math.round(shownZoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="확대/축소" />
        <button type="button" title="확대" onClick={() => setZoom(zoomStep(shownZoom, true))}>+</button>
        <button type="button" className="pp-zoom-pct" title="확대/축소…" onClick={() => setDialog('viewZoom')}>{Math.round(shownZoom * 100)}%</button>
        <button type="button" className={`pp-fit ${zoom === null ? 'on' : ''}`} title="현재 창 크기에 맞춤" onClick={() => setZoom(null)}>⤢</button>
      </span>
    </footer>
  );

  if (cmd.view === 'presenter') {
    return (
      <div className="ppt">
        <Ribbon ed={ed} actions={actions} />
        <PresenterView state={state} dispatch={dispatch} cmd={cmd} />
        {statusBar}
      </div>
    );
  }

  return (
    <div className="ppt" onClick={() => menu && setMenu(null)}>
      {sectionRequest && <NameDialog title="구역 이름 바꾸기" initialValue={sectionRequest.initialValue} onClose={() => setSectionRequest(null)} onSave={(name) => {
        const target = state.library.presentations.find((x) => x.id === sectionRequest.presentationId);
        if (!target) return '프레젠테이션이 삭제되었습니다.';
        const slides = target.slides.map((s) => sectionRequest.ids.includes(s.id) ? { ...s, group: name, label: undefined } : s);
        dispatch({ type: 'presentation/update', id: target.id, patch: target.arrangementId ? { slides, arrangementId: null } : { slides } });
        setMulti([]);
      }} />}
      {linking && <NameDialog title="링크 삽입 — 주소" initialValue={ed.selEls[0]?.href ?? 'https://'} onClose={() => setLinking(false)} onSave={(href) => {
        const v = href.trim();
        ed.setElements((els) => els.map((e) => (selIds.includes(e.id) ? { ...e, href: v && v !== 'https://' ? v : undefined } : e)));
        setLinking(false);
      }} />}
      <Ribbon ed={ed} actions={actions} />
      <div className="ppt-body">
        <aside className={`ppt-left ${view.grayscale ? 'grayscale' : ''}`}>
          <div className="ppt-left-tabs">
            <button type="button" className={leftTab === 'slides' ? 'on' : ''} onClick={() => setLeftTab('slides')}>{cmd.view === 'outline' ? '개요' : '슬라이드'}</button>
            <button type="button" className={leftTab === 'library' ? 'on' : ''} onClick={() => { setLeftTab('library'); setFindTick((n) => n + 1); }} title="라이브러리 · 재생목록">라이브러리</button>
            <button type="button" className={leftTab === 'media' ? 'on' : ''} onClick={() => setLeftTab('media')} title="배경 · 그림 · 영상 · 카메라">미디어</button>
          </div>
          {leftTab === 'library' ? (
            <LibraryPanel state={state} dispatch={dispatch} onNew={() => cmd.open('new')} notify={cmd.notify} focusSearch={findTick} online={cmd.online} onReloadOnline={cmd.reloadOnline} />
          ) : leftTab === 'media' ? (
            <MediaBin state={state} dispatch={dispatch} />
          ) : cmd.view === 'outline' ? (
            <OutlineView ed={ed} />
          ) : (
            <SlidePane state={state} dispatch={dispatch} rows={rows} p={p} item={item} selected={selected} pick={pick} multi={multi} onClickSlide={onClickSlide} notify={cmd.notify}
              playlistId={source && 'playlist' in source ? source.playlist.id : null}
              heading={source && 'playlist' in source ? source.playlist.name : p?.title ?? ''}
              onMenu={(x, y, id, seq) => setMenu({ x, y, id, seq })}
              onAdd={() => { if (!p) return; const n = { id: uid('s'), group: slide?.group ?? 'Slide', text: '' }; updateSlides([...p.slides, n]); cmd.setSlideId(n.id); }} />
          )}
        </aside>

        {cmd.view === 'sorter' ? (
          <div className="ppt-sorter"><SlideSorter ed={ed} /></div>
        ) : cmd.view === 'notesPage' ? (
          <main className="ppt-center"><NotesPageView ed={ed} grayscale={view.grayscale} onNotes={(notes) => p && slide && dispatch({ type: 'slide/update', presentationId: p.id, slideId: slide.id, seq: selected?.seq, sequenceLength: sequence(p).length, patch: { notes } })} /></main>
        ) : (
          <main className="ppt-center">
            <div className={`ppt-stage ${zoom !== null ? 'zoomed' : ''}`} ref={stageRef}>
              {p && slide ? (
                <div className={`ppt-canvas ${view.grayscale ? 'grayscale' : ''}`} style={zoom !== null ? { width: ACTUAL_W * zoom } : undefined}
                  onContextMenu={(e) => { if (!ed.selEls.length) return; e.preventDefault(); setObjMenu(new DOMRect(e.clientX, e.clientY, 0, 0)); }}>
                  <CanvasEditor key={`${p.id}:${selected?.key}`} readOnly={p.protected} slide={slide} theme={theme} background={background} bgEffect={p.bgEffect}
                    selected={sel} onSelect={setSel} tool={tool} onToolDone={() => setTool(null)} view={view} badges={badges} defaultShape={p.defaultShape} customGuides={view.guides ? p.guides : undefined} onGuidesChange={p.protected ? undefined : (g) => ed.updatePres({ guides: g.v.length || g.h.length ? g : undefined })}
                    pickPicture={() => pickPictureFile(dispatch)} motionPaths onAddMedia={(m) => dispatch({ type: 'media/add', media: m })}
                    onLockedDelete={cmd.locked && state.live.slide?.id === slide.id ? () => cmd.notify(LOCK_MSG) : undefined}
                    onChange={(patch) => dispatch({ type: 'slide/update', presentationId: p.id, slideId: slide.id, seq: selected?.seq, sequenceLength: sequence(p).length, patch })} />
                  {preview && <PlayPreview ed={ed} what={preview} onDone={() => setPreview(null)} />}
                </div>
              ) : (
                <div className="ppt-empty">
                  <h2>무엇을 준비할까요?</h2>
                  <p>왼쪽 <b>라이브러리</b>에서 프레젠테이션을 고르거나 아래에서 시작하세요. 파일을 창에 끌어다 놓으면 이번 주 예배에 바로 들어갑니다.</p>
                  <div className="ppt-start">
                    <button type="button" className="ppt-start-card primary" onClick={() => cmd.service.open()}>
                      <span className="ppt-start-icon">⛪</span><b>이번 주 예배 열기</b><small>교회 템플릿으로 주일예배를 열고 콘티 · 가사 · 설교를 올립니다</small>
                    </button>
                    <button type="button" className="ppt-start-card" onClick={() => cmd.open('sunday')}>
                      <span className="ppt-start-icon">📝</span><b>주일예배 마법사</b><small>순서 · 찬양 · 광고를 단계별로 채웁니다</small>
                    </button>
                    <button type="button" className="ppt-start-card" onClick={() => cmd.open('retreat')}>
                      <span className="ppt-start-icon">⛺</span><b>수련회 만들기</b><small>주제에 어울리는 움직이는 배경까지</small>
                    </button>
                    <button type="button" className="ppt-start-card" onClick={() => cmd.open('new')}>
                      <span className="ppt-start-icon">📄</span><b>새 프레젠테이션</b><small>빈 슬라이드에서 시작합니다</small>
                    </button>
                  </div>
                  <div className="ppt-start-steps">
                    <span className="muted small">단계별 수정:</span>
                    {SUNDAY_STEPS.map((s, i) => (
                      <button key={s.label} type="button" className="ppt-start-step" title={s.hint} onClick={() => cmd.editSundayStep(i)}>{s.icon} {s.edit}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {p && slide && notesOpen && (
              <AutoTextarea disabled={p.protected} className="ppt-notes" placeholder="슬라이드 노트를 추가하려면 클릭하세요"
                value={slide.notes ?? ''} onChange={(e) => dispatch({ type: 'slide/update', presentationId: p.id, slideId: slide.id, seq: selected?.seq, sequenceLength: sequence(p).length, patch: { notes: e.target.value || undefined } })} />
            )}
          </main>
        )}

        {pane && p && slide && cmd.view !== 'sorter' && (
          <aside className="ppt-format">
            {pane === 'format' && (
              <>
                <div className="task-head"><span>{ed.selEls.length ? '개체 서식' : `서식 · 슬라이드 ${index + 1}`}</span><button type="button" className="task-x" onClick={() => setPane(null)}>✕</button></div>
                <SlideFormat state={state} dispatch={editDispatch} presentation={p} slide={slide} onDesign={() => undefined}
                  selectedId={ed.selEls.length === 1 ? ed.selEls[0].id : sel.includes(SLIDE_TEXT) ? null : null} onSelect={(id) => setSel(id ? [id] : [])} cell={cell} onCell={setCell} />
              </>
            )}
            {pane === 'animation' && <AnimationPane ed={ed} onPlay={() => setPreview('animation')} />}
            {pane === 'selection' && <SelectionPane ed={ed} />}
            {pane === 'spelling' && <SpellingPane ed={ed} />}
            {pane === 'revisions' && <RevisionsPane ed={ed} />}
            {pane === 'comments' && <CommentsPane ed={ed} draftOpen={commentDraft} onDraftDone={() => setCommentDraft(false)} />}
          </aside>
        )}
      </div>
      {statusBar}

      {menu && (
        <div ref={menuRef} className="ctx-menu" style={{ left: menu.x, top: menu.y, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { addSlideAfter(); setMenu(null); }}>＋ 새 슬라이드</button>
          <button type="button" onClick={() => slideMenu(menu.id, 'dup')}>⧉ 슬라이드 복제</button>
          <button type="button" onClick={() => { const ids = picked(); setMenu(null); makeSection(ids.map((r) => r.slide.id)); }}>📑 구역 추가{multi.length > 1 ? ` (${multi.length}장)` : ''}</button>
          <button type="button" onClick={() => slideMenu(menu.id, 'skip')}>⏭ 슬라이드 숨기기/해제</button>
          <button type="button" onClick={() => slideMenu(menu.id, 'up')}>↑ 위로 이동</button>
          <button type="button" onClick={() => slideMenu(menu.id, 'down')}>↓ 아래로 이동</button>
          <button type="button" onClick={() => slideMenu(menu.id, 'live')}>▶ 지금 화면에 표시</button>
          <button type="button" onClick={() => { cmd.setSlideId(menu.id, menu.seq); setMenu(null); cmd.open('edit'); }}>✎ 내용 편집</button>
          {p && <button type="button" onClick={() => { setAddMenu({ id: p.id, x: menu.x, y: menu.y }); setMenu(null); }}>📋 “{p.title}” 재생목록에 넣기…</button>}
          <button type="button" className="danger" onClick={() => {
            const row = paneSlides.find((r) => r.presentation.id === p?.id && r.seq === menu.seq && r.itemIndex === selected?.itemIndex);
            setMenu(null); if (row) deleteSlides([row]);
          }}>🗑 슬라이드 삭제</button>
          {multi.length > 1 && <button type="button" className="danger" onClick={() => { const chosen = picked(); setMenu(null); deleteSlides(chosen); }}>🗑 선택한 슬라이드 삭제 ({multi.length}장)</button>}
        </div>
      )}
      {objMenu && slide && (
        <Menu anchor={objMenu} onClose={() => setObjMenu(null)}>
          <MenuItem label="잘라내기" hint="Ctrl+X" disabled={!canEdit} onClick={() => { copyObjects(ed.selEls); updateSlide(deleteSelection(slide, selIds)); setSel([]); setObjMenu(null); }} />
          <MenuItem label="복사" hint="Ctrl+C" onClick={() => { copyObjects(ed.selEls); setObjMenu(null); }} />
          <MenuSep />
          <MenuItem label="그룹" hint="Ctrl+G" disabled={!canGroup(elements, selIds)} onClick={() => { ed.setElements((els) => groupSelection(els, selIds)); setObjMenu(null); }} />
          <MenuItem label="그룹 해제" disabled={!canUngroup(elements, selIds)} onClick={() => { ed.setElements((els) => ungroupSelection(els, selIds)); setObjMenu(null); }} />
          <MenuItem label="맨 앞으로 가져오기" onClick={() => { ed.setElements((els) => orderSelection(els, selIds, 'front')); setObjMenu(null); }} />
          <MenuItem label="맨 뒤로 보내기" onClick={() => { ed.setElements((els) => orderSelection(els, selIds, 'back')); setObjMenu(null); }} />
          <MenuSep />
          <MenuItem label="링크" onClick={() => { setLinking(true); setObjMenu(null); }} />
          <MenuItem label="애니메이션 창" onClick={() => { setPane('animation'); setObjMenu(null); }} />
          <MenuItem label="개체 서식…" onClick={() => { setPane('format'); setObjMenu(null); }} />
          <MenuSep />
          <MenuItem label="삭제" hint="Delete" disabled={!canEdit} onClick={() => { updateSlide(deleteSelection(slide, selIds)); setSel([]); setObjMenu(null); }} />
        </Menu>
      )}
      {addMenu && <AddToPlaylistMenu state={state} dispatch={dispatch} presentationId={addMenu.id} x={addMenu.x} y={addMenu.y} notify={cmd.notify} onClose={() => setAddMenu(null)} />}
      {dialog && <Dialogs ed={ed} kind={dialog} onClose={() => setDialog(null)} />}
      {find && <FindReplaceDialog ed={ed} replace={find === 'replace'} onClose={() => setFind(null)} />}
      {reading && <ReadingView ed={ed} ids={reading.ids} rehearse={reading.rehearse} onClose={() => setReading(false)} />}
      {backstage && <Backstage ed={ed} onClose={() => setBackstage(false)} />}
    </div>
  );
}
