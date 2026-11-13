// Views and dialogs of the PowerPoint window: 찾기 / 바꾸기, 개요 보기, 여러 슬라이드, 읽기용 보기,
// transition and animation previews, and the 파일 (backstage) view.
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import type { ElementAction, Slide, SlideElement } from '../../domain/types';
import { CANVAS_W } from '../../domain/canvas';
import { actionAt, hoverAt, lastViewed, runLinkAt } from '../../domain/showActions';
import { playMedia } from './mediaControl';
import { returnAfter, type ZoomReturn } from '../../domain/zoom';
export { actionAt };
import { sequence } from '../../domain/arrangement';
import { resolveBackground } from '../../domain/autoBackground';
import { findText } from '../../engine';
import { findItems, parseFindKey, replaceMatches } from '../../domain/findReplace';
import { SlideCanvas } from '../SlideCanvas';
import { clickTrigger, triggerObjects, type LiveBuild } from '../../domain/animations';
import type { Ed } from './editor';
import { ACCEPT } from './commands';
import { RI } from './ribbonParts';
import { TRANSITION } from './ko';
import { PropertiesForm } from './printing';
import { PrintPanel } from './printPanel';
import { InfoStats } from './infoPanel';
import { ExportPanel } from './exportPanel';
import { ExportMorePanel } from './exportMorePanel';

// ── Find and replace ──────────────────────────────────────────────────────────────────────────
// What is searched and how a replacement keeps the formatting: domain/findReplace (DeckCraft text.find /
// text.replace — slide text, objects, table cells and notes).

/** Home › Editing › Find / Replace, searched by the engine across the whole presentation. */
export function FindReplaceDialog({ ed, replace: startReplace, onClose }: { ed: Ed; replace: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [replace, setReplace] = useState(startReplace);
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [at, setAt] = useState(-1);
  const [msg, setMsg] = useState('');
  const p = ed.p;
  const hits = useMemo(() => (p && q ? findText(findItems(p), q, { matchCase, wholeWord: whole }) : []), [p, q, matchCase, whole]);
  const go = (i: number) => {
    if (!hits.length || !p) return setMsg(q ? '찾는 항목이 없습니다.' : '');
    const n = ((i % hits.length) + hits.length) % hits.length;
    setAt(n);
    const k = parseFindKey(hits[n].key);
    ed.cmd.setSlideId(k.slideId);
    if (k.elementId) setTimeout(() => ed.setSel([k.elementId!]), 0);
    setMsg(`${n + 1} / ${hits.length}`);
  };
  const one = () => {
    if (!p || at < 0 || !hits[at]) return go(0);
    ed.updatePres({ slides: replaceMatches(p.slides, [hits[at]], r) });
    setMsg('1개를 바꿨습니다.');
    // The next match is where this one was (the list is searched again).
    setAt(at - 1);
  };
  const all = () => {
    if (!p) return;
    if (!hits.length) return setMsg('찾는 항목이 없습니다.');
    ed.updatePres({ slides: replaceMatches(p.slides, hits, r) });
    setMsg(`${hits.length}개 항목을 바꿨습니다.`);
    setAt(-1);
  };
  return (
    <div className="ppt-dialog" role="dialog" aria-label={replace ? '바꾸기' : '찾기'}>
      <div className="ppt-dialog-head"><b>{replace ? '바꾸기' : '찾기'}</b><button type="button" className="task-x" onClick={onClose}>✕</button></div>
      <label>찾을 내용:<input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setAt(-1); setMsg(''); }} onKeyDown={(e) => { if (e.key === 'Enter') go(at + 1); if (e.key === 'Escape') onClose(); }} /></label>
      {replace && <label>바꿀 내용:<input value={r} onChange={(e) => setR(e.target.value)} /></label>}
      <label className="rb-check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> 대/소문자 구분</label>
      <label className="rb-check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> 단어 단위로</label>
      <div className="ppt-dialog-buttons">
        <button type="button" className="primary" disabled={!q} onClick={() => go(at + 1)}>다음 찾기</button>
        {replace ? <><button type="button" disabled={!q || !ed.canEdit} onClick={one}>바꾸기</button><button type="button" disabled={!q || !ed.canEdit} onClick={all}>모두 바꾸기</button></>
          : <button type="button" onClick={() => setReplace(true)}>바꾸기…</button>}
        <button type="button" onClick={onClose}>닫기</button>
      </div>
      <div className="ppt-dialog-msg">{msg}</div>
    </div>
  );
}

// ── Outline view ──────────────────────────────────────────────────────────────────────────────
export function OutlineView({ ed }: { ed: Ed }) {
  const p = ed.p;
  if (!p) return <div className="ppt-empty"><p>프레젠테이션을 고르세요.</p></div>;
  const set = (id: string, patch: Partial<Slide>) => ed.updatePres({ slides: p.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  return (
    <div className="outline-view">
      {p.slides.map((s, i) => (
        <div key={s.id} className={`outline-slide ${s.id === ed.slide?.id ? 'on' : ''}`} onFocus={() => ed.cmd.setSlideId(s.id)}>
          <span className="outline-num">{i + 1}</span>
          <span className="outline-icon">▭</span>
          <div className="outline-body">
            <input className="outline-title" placeholder="제목" disabled={!ed.canEdit} value={s.title ?? ''} onChange={(e) => set(s.id, { title: e.target.value || undefined })} />
            <textarea className="outline-text" disabled={!ed.canEdit} rows={Math.max(1, s.text.split('\n').length)} value={s.text} onChange={(e) => set(s.id, { text: e.target.value })} />
            {(s.elements ?? []).filter((e) => e.kind === 'text' && e.text).map((e) => (
              <textarea key={e.id} className="outline-text sub" disabled={!ed.canEdit} rows={Math.max(1, (e.text ?? '').split('\n').length)} value={e.text}
                onChange={(ev) => set(s.id, { elements: s.elements!.map((x) => (x.id === e.id ? { ...x, text: ev.target.value, runs: undefined, paragraphs: undefined } : x)) })} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Slide sorter ──────────────────────────────────────────────────────────────────────────────
export function SlideSorter({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  if (!p || !ed.theme) return <div className="ppt-empty"><p>프레젠테이션을 고르세요.</p></div>;
  const theme = ed.theme;
  const drop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (drag === null || drag === to || !ed.canEdit) return setDrag(null);
    const slides = [...p.slides];
    const [moved] = slides.splice(drag, 1);
    slides.splice(to > drag ? to - 1 : to, 0, moved);
    ed.updatePres({ slides, ...(p.arrangementId ? { arrangementId: null } : {}) });
    setDrag(null); setOver(null);
  };
  return (
    <div className="sorter">
      {p.slides.map((s, i) => {
        const t = s.transition ?? p.transition;
        return (
          <div key={s.id} className={`sorter-item ${s.id === ed.slide?.id ? 'on' : ''} ${s.disabled ? 'hidden-slide' : ''} ${over === i ? 'drop' : ''}`} draggable={ed.canEdit}
            onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, i)}
            onClick={() => ed.cmd.setSlideId(s.id)} onDoubleClick={() => { ed.cmd.setSlideId(s.id); ed.cmd.setView('normal'); }}>
            <div className="sorter-thumb"><SlideCanvas slide={s} theme={theme} background={resolveBackground(s, p)} /></div>
            <div className="sorter-meta"><span>{i + 1}</span>{t && t.kind !== 'cut' && <span title={`화면 전환: ${TRANSITION[t.kind.replace('fx:', '')] ?? t.kind}`}>✦</span>}{s.animations?.length ? <span title="애니메이션">★</span> : null}{s.comments?.length ? <span title="메모">💬</span> : null}</div>
          </div>
        );
      })}
      <div className="sorter-end" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, p.slides.length)} />
    </div>
  );
}

// ── Reading view and previews ─────────────────────────────────────────────────────────────────
/** 읽기용 보기: the slide show inside the window, with transitions and animations, without sending anything to the screens. */
/**
 * Reading view: the slide show in a window — click or the arrow keys to advance, objects with an
 * action (Action Settings, links, slide zooms) do what they say. With `ids` it plays a custom show;
 * with `rehearse` it times each slide (Rehearse Timings) and offers to keep the timings.
 */
export function ReadingView({ ed, onClose, ids, rehearse }: { ed: Ed; onClose: () => void; ids?: string[]; rehearse?: boolean }) {
  const p = ed.p;
  // Action › Custom Show: the show's slides, then back to the slide that started it.
  const [custom, setCustom] = useState<{ ids: string[]; back: number } | null>(null);
  const pages = useMemo(() => {
    if (!p) return [];
    const all = sequence(p).filter((x) => !x.slide.disabled);
    const only = custom?.ids ?? ids;
    return only ? only.map((id) => all.find((x) => x.slide.id === id)).filter((x): x is (typeof all)[number] => !!x) : all;
  }, [p, ids, custom]);
  /** Pages shown, for Action › Last Slide Viewed. */
  const history = useRef<number[]>([]);
  const hovered = useRef<string | null>(null);
  const [tip, setTip] = useState<string | undefined>();
  const start = ids || rehearse ? 0 : Math.max(0, pages.findIndex((x) => x.slide.id === ed.slide?.id));
  const [i, setI] = useState(start);
  const [build, setBuild] = useState<LiveBuild | null>(null);
  const [ended, setEnded] = useState(false);
  const times = useRef<Record<string, number>>({});
  const zoomBack = useRef<ZoomReturn | null>(null);
  const shownAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const slide = pages[i]?.slide ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!rehearse) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rehearse]);
  useEffect(() => {
    if (!slide) return;
    shownAt.current = Date.now();
    void import('../../domain/animations').then(({ initialBuild }) => setBuild(ed.p?.showSetup?.noAnimation ? null : initialBuild(slide, Date.now()) ?? null));
  }, [slide, ed.p?.showSetup?.noAnimation]);
  const record = () => { if (rehearse && slide) times.current[slide.id] = (times.current[slide.id] ?? 0) + (Date.now() - shownAt.current) / 1000; };
  const finish = () => {
    record();
    if (custom) { const back = custom.back; setCustom(null); setI(back); return; }
    if (rehearse) setEnded(true); else onClose();
  };
  const goTo = (n: number) => { if (n === i) return; record(); if (n >= pages.length) return finish(); history.current.push(i); setI(Math.max(0, n)); };
  /** Next: the next build, else the next slide (a mouse click only when the slide allows it). */
  const next = async (mouse = false) => {
    const { advanceBuild } = await import('../../domain/animations');
    const b = slide && !ed.p?.showSetup?.noAnimation ? advanceBuild(slide, build ?? undefined, Date.now()) : null;
    if (b) { setBuild(b); return; }
    if (mouse && transition?.advanceOnClick === false) return;
    const back = returnAfter(zoomBack.current, slide?.id);
    if (back !== null) { zoomBack.current = null; goTo(back); } else goTo(i + 1);
  };
  const prev = () => goTo(i - 1);
  const act = (el: SlideElement, over?: ElementAction) => {
    if (!over && el.kind === 'zoom' && el.targetSlideId) {
      const n = pages.findIndex((x) => x.slide.id === el.targetSlideId);
      // Return to Zoom: going on past the target (or its section's last slide) comes back to this slide.
      if (n >= 0) { zoomBack.current = el.zoomReturn ? { from: i, after: el.zoomReturn } : null; goTo(n); }
      return;
    }
    const a = over ?? el.action ?? (el.href ? { kind: 'url' as const, url: el.href } : null);
    if (!a) return;
    if (a.kind === 'next') goTo(i + 1);
    else if (a.kind === 'prev') goTo(i - 1);
    else if (a.kind === 'first') goTo(0);
    else if (a.kind === 'last') goTo(pages.length - 1);
    else if (a.kind === 'end') finish();
    else if (a.kind === 'slide') { const n = pages.findIndex((x) => x.slide.id === a.slideId); if (n >= 0) goTo(n); }
    else if (a.kind === 'url' && a.url) window.open(a.url, '_blank', 'noopener');
    else if (a.kind === 'lastViewed') { const n = lastViewed(history.current, i); if (n != null) { record(); setI(n); } }
    else if (a.kind === 'customShow') {
      const cs = p?.customShows?.find((c) => c.id === a.show);
      if (cs?.slideIds.length && !custom) { record(); history.current.push(i); setCustom({ ids: cs.slideIds, back: i }); setI(0); }
    } else if (a.kind === 'playMedia') playMedia(el, ed.dispatch);
  };
  const onStageMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = stage.current?.querySelector('.slide-canvas, .canvas, div')?.getBoundingClientRect();
    if (!r?.width) return;
    const k = CANVAS_W / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const over = hoverAt(slide, x, y);
    const click = actionAt(slide, x, y);
    setTip(over?.tooltip ?? click?.tooltip);
    // Mouse Over fires once as the pointer enters the object.
    if (over?.id !== hovered.current) {
      hovered.current = over?.id ?? null;
      if (over?.hoverAction) act(over, over.hoverAction);
    }
  };
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = runLinkAt(e.target);
    if (link) { window.open(link, '_blank', 'noopener'); return; }
    const r = stage.current?.querySelector('.slide-canvas, .canvas, div')?.getBoundingClientRect() ?? stage.current?.getBoundingClientRect();
    if (r && r.width) {
      const k = CANVAS_W / r.width;
      const [x, y] = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
      // Animations › Trigger: a click on a trigger object plays its sequence (a link on it still goes).
      if (slide && !ed.p?.showSetup?.noAnimation) {
        const ids = triggerObjects(slide);
        const on = [...(slide.elements ?? [])].reverse().find((el) => ids.includes(el.id) && !el.hidden && x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + Math.max(el.h, 1));
        const b = on && clickTrigger(slide, build, on.id, Date.now());
        if (b) { setBuild(b); const hit = actionAt(slide, x, y); if (hit?.id === on!.id) act(hit); return; }
      }
      const hit = actionAt(slide, x, y);
      if (hit) return act(hit);
    }
    void next(true);
  };
  if (!p || !ed.theme) return null;
  if (ended) {
    const total = Object.values(times.current).reduce((a, b) => a + b, 0);
    const keep = () => {
      ed.updatePres({ slides: p.slides.map((s) => (times.current[s.id] ? { ...s, autoAdvance: Math.max(1, Math.round(times.current[s.id])) } : s)), showSetup: { ...p.showSetup, manual: undefined } });
      ed.cmd.notify('슬라이드 시간을 저장했습니다 — 슬라이드 쇼에서 자동으로 넘어갑니다');
      onClose();
    };
    return (
      <div className="reading-view rehearse-end">
        <div className="ppt-dialog center" role="dialog" aria-label="예행 연습">
          <b>슬라이드 쇼에 걸린 총 시간은 {Math.floor(total / 60)}:{String(Math.round(total % 60)).padStart(2, '0')}입니다.</b>
          <p>새 슬라이드 시간을 저장하시겠습니까?</p>
          <div className="ppt-dialog-buttons"><button type="button" className="primary" disabled={!ed.canEdit} onClick={keep}>예</button><button type="button" onClick={onClose}>아니요</button></div>
        </div>
      </div>
    );
  }
  const transition = ed.p?.showSetup?.noTransitions ? undefined : slide?.transition ?? p.transition;
  const onSlide = (now - shownAt.current) / 1000;
  return (
    <div className="reading-view" ref={ref} tabIndex={0} onKeyDown={(e) => {
      e.stopPropagation();
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) { e.preventDefault(); void next(); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) { e.preventDefault(); prev(); }
      if (e.key === 'Home') goTo(0);
      if (e.key === 'End') goTo(pages.length - 1);
      if (e.key === 'Escape') finish();
    }} onClick={onStageClick}>
      <div className="reading-stage" ref={stage} title={tip} onMouseMove={onStageMove}><SlideCanvas slide={slide} theme={ed.theme} background={slide ? resolveBackground(slide, p) : null} bgEffect={p.bgEffect} transition={transition} build={build} animate number={i + 1} /></div>
      <div className="reading-bar" onClick={(e) => e.stopPropagation()}>
        <span>{p.title}{ids || custom ? ' · 재구성한 쇼' : ''}</span><span className="grow" />
        {rehearse && <span className="rehearse-clock">⏱ {Math.floor(onSlide / 60)}:{String(Math.floor(onSlide % 60)).padStart(2, '0')}</span>}
        <button type="button" onClick={prev}>◀</button><span>슬라이드 {i + 1} / {pages.length}</span><button type="button" onClick={() => void next()}>▶</button>
        <button type="button" onClick={finish}>{rehearse ? '예행 연습 마침 (Esc)' : '읽기용 보기 닫기 (Esc)'}</button>
      </div>
    </div>
  );
}

/** Transitions / Animations › Preview, played over the slide being edited. */
export function PlayPreview({ ed, what, onDone }: { ed: Ed; what: 'transition' | 'animation'; onDone: () => void }) {
  const p = ed.p, slide = ed.slide;
  const prevSlide = useMemo(() => {
    if (!p || !slide) return null;
    const pages = sequence(p);
    const at = pages.findIndex((x) => x.slide.id === slide.id);
    return at > 0 ? pages[at - 1].slide : { id: '__black', group: '', text: '' };
  }, [p, slide]);
  const [shown, setShown] = useState<Slide | null>(what === 'transition' ? prevSlide : slide);
  const [build] = useState<LiveBuild | null>(what === 'animation' ? { step: 0, startedAt: Date.now() + 150, all: true } : null);
  useEffect(() => {
    if (what === 'transition') {
      const t1 = setTimeout(() => setShown(slide), 60);
      const dur = (slide?.transition ?? p?.transition)?.duration ?? 1000;
      const t2 = setTimeout(onDone, dur + 500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    void import('../../domain/animations').then(({ slideTimeline }) => {
      const tl = slide ? slideTimeline(slide) : null;
      setTimeout(onDone, (tl?.total ?? 1) * 1000 + 800);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!p || !slide || !ed.theme) return null;
  return (
    <div className="play-preview" onClick={onDone}>
      <SlideCanvas slide={shown} theme={ed.theme} background={shown && shown.id !== '__black' ? resolveBackground(shown, p) : null} bgEffect={p.bgEffect}
        transition={slide.transition ?? p.transition} build={build} animate />
    </div>
  );
}

// ── File (backstage) ──────────────────────────────────────────────────────────────────────────
type Page = 'home' | 'open' | 'info' | 'save' | 'print' | 'export';

function Card({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text?: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="bs-card" disabled={disabled} onClick={onClick}><span className="bs-card-icon">{icon}</span><b>{title}</b>{text && <small>{text}</small>}</button>;
}

export function Backstage({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const [page, setPage] = useState<Page>('home');
  const { cmd, p, state } = ed;
  const lib = state.library;
  const run = (fn: () => void) => { fn(); onClose(); };
  const recent = [...lib.presentations].filter((x) => !x.online).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 12);
  const nav: [Page, string][] = [['home', '홈'], ['open', '열기'], ['info', '정보'], ['save', '저장'], ['print', '인쇄'], ['export', '내보내기']];
  return (
    <div className="backstage" role="dialog" aria-label="파일">
      <nav className="bs-nav">
        <button type="button" className="bs-back" onClick={onClose}>← 뒤로</button>
        {nav.map(([id, label]) => <button key={id} type="button" className={page === id ? 'on' : ''} onClick={() => setPage(id)}>{label}</button>)}
        <span className="grow" />
        <button type="button" onClick={() => run(() => cmd.open(cmd.cloud.session ? 'sync' : 'account'))}>계정</button>
        <button type="button" onClick={() => run(() => cmd.open('settings'))}>옵션</button>
      </nav>
      <main className="bs-main">
        {page === 'home' && (
          <>
            <h1>좋은 하루입니다</h1>
            <h2>새로 만들기</h2>
            <div className="bs-cards">
              <Card icon="📄" title="새 프레젠테이션" text="빈 슬라이드에서 시작" onClick={() => run(() => cmd.open('new'))} />
              <Card icon="⛪" title="이번 주 예배 열기" text="교회 템플릿으로 주일예배" onClick={() => run(() => cmd.service.open())} />
              <Card icon="📝" title="주일예배 마법사" text="순서 · 찬양 · 광고" onClick={() => run(() => cmd.open('sunday'))} />
              <Card icon="⛺" title="수련회" text="움직이는 배경까지" onClick={() => run(() => cmd.open('retreat'))} />
              <Card icon="✨" title="AI로 만들기" onClick={() => run(() => cmd.open('ai'))} />
            </div>
            <h2>최근 항목</h2>
            <ul className="bs-recent">
              {recent.map((x) => <li key={x.id}><button type="button" onClick={() => run(() => ed.dispatch({ type: 'select', id: x.id }))}><span>📊</span><b>{x.title}</b><small>{x.folder ?? ''} · 슬라이드 {x.slides.length}장</small></button></li>)}
            </ul>
          </>
        )}
        {page === 'open' && (
          <>
            <h1>열기</h1>
            <div className="bs-cards">
              <Card icon="📊" title="PowerPoint · PDF · 그림" text=".pptx .ppt .pdf 이미지" onClick={() => run(() => cmd.pickFiles('slides', ACCEPT.slides))} />
              <Card icon="🎵" title="찬양 파일" text="텍스트 · ChordPro · OpenLyrics · OpenSong" onClick={() => run(() => cmd.pickFiles('lyrics', ACCEPT.lyrics))} />
              <Card icon="🗂" title="백업 복원" text=".zip 백업에서" onClick={() => run(() => cmd.pickFiles('backup', ACCEPT.backup))} />
              <Card icon="{ }" title="라이브러리 JSON" onClick={() => run(() => cmd.pickFiles('library', ACCEPT.library))} />
            </div>
          </>
        )}
        {page === 'info' && (
          <>
            <h1>정보</h1>
            {p ? (
              <div className="bs-info">
                <h2>{p.title}</h2>
                <InfoStats ed={ed} />
                <div className="bs-cards">
                  <Card icon="🔒" title={p.protected ? '자료 보호 해제' : '프레젠테이션 보호'} text="실수로 바꾸거나 지우지 않게" onClick={() => run(() => ed.dispatch({ type: 'presentation/protect', id: p.id, on: !p.protected }))} />
                  <Card icon="🕘" title="복원 지점" text="자동 저장된 때로 되돌리기" onClick={() => run(() => cmd.open('restore'))} />
                  <Card icon="🗑" title="휴지통" onClick={() => run(() => cmd.open('trash'))} />
                  <Card icon="📋" title="사용 기록" onClick={() => run(() => cmd.open('activity'))} />
                  <Card icon="🔍" title="문제 확인 › 문서 검사" text="메모 · 노트 · 숨긴 내용" onClick={() => run(() => ed.setDialog('inspect'))} />
                </div>
                <PropertiesForm ed={ed} />
              </div>
            ) : <p>프레젠테이션이 열려 있지 않습니다.</p>}
          </>
        )}
        {page === 'save' && (
          <>
            <h1>저장</h1>
            <p className="bs-note">LightCast는 바꾸는 즉시 이 컴퓨터에 저장하고, 로그인하면 클라우드에도 동기화합니다.</p>
            <div className="bs-cards">
              <Card icon={RI.paste} title="PowerPoint 파일로 저장 (.pptx)" text="지금 재생목록을 MMDD.pptx로" onClick={() => run(cmd.exportPlaylistPptx)} />
              <Card icon="🗜" title="전체 백업 저장 (.zip)" text="라이브러리와 미디어 전부" onClick={() => run(cmd.exportBackup)} />
              <Card icon="{ }" title="라이브러리 JSON 저장" onClick={() => run(cmd.exportLibrary)} />
            </div>
          </>
        )}
        {page === 'print' && (
          <>
            <h1>인쇄</h1>
            <PrintPanel ed={ed} onMaster={() => run(() => ed.setDialog('handoutMaster'))} onChords={() => run(() => cmd.open('chords'))} />
          </>
        )}
        {page === 'export' && (
          <>
            <h1>내보내기</h1>
            <ExportPanel ed={ed} onPdf={() => setPage('print')} />
            <ExportMorePanel ed={ed} />
            <h2>다른 형식</h2>
            <div className="bs-cards">
              <Card icon="📊" title="PowerPoint 프레젠테이션" text=".pptx" onClick={() => run(cmd.exportPlaylistPptx)} />
              <Card icon="📈" title={`찬양 사용 CSV (${lib.usage.length})`} onClick={() => run(cmd.exportUsage)} />
              <Card icon="©" title="저작권(CCLI) 보고" onClick={() => run(() => cmd.open('ccli'))} />
              <Card icon="🧹" title="발표 기록 지우기" onClick={() => run(cmd.clearUsage)} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Notes Page view ───────────────────────────────────────────────────────────────────────────
/** View › 슬라이드 노트 (DeckCraft view.notesPage): the slide on a page with its notes under it, to edit. */
export function NotesPageView({ ed, grayscale, onNotes }: { ed: Ed; grayscale?: boolean; onNotes: (notes: string | undefined) => void }) {
  const p = ed.p, s = ed.slide;
  if (!p || !s || !ed.theme) return <div className="ppt-empty"><p>프레젠테이션을 고르세요.</p></div>;
  const m = p.notesMaster;
  const n = p.slides.indexOf(s) + 1;
  return (
    <div className="notes-page-view">
      <div className={`notes-page ${grayscale ? 'grayscale' : ''}`}>
        <div className="notes-page-head"><span>{m?.header}</span><span>{m?.date ? new Date().toLocaleDateString() : ''}</span></div>
        <div className="notes-page-slide"><SlideCanvas slide={s} theme={ed.theme} background={resolveBackground(s, p)} /></div>
        <textarea className="notes-page-text" disabled={!ed.canEdit} placeholder="텍스트를 입력하십시오" value={s.notes ?? ''} onChange={(e) => onNotes(e.target.value || undefined)} />
        <div className="notes-page-foot"><span>{m?.footer}</span><span>{m?.pageNumber !== false ? n : ''}</span></div>
      </div>
    </div>
  );
}
