// Task panes on the right of the window: 애니메이션 창, 선택 창, 메모.
import { useState, useSyncExternalStore } from 'react';
import type { Slide, SlideAnimation, SlideComment, SlideElement } from '../../domain/types';
import { commentCount, initialsOf, neighbourComment, type CommentRef } from '../../domain/comments';
import { uid } from '../../domain/lyrics';
import { getDevice } from '../../domain/device';
import { loadSession } from '../../domain/cloud';
import { orderSelection, moveAnimation } from '../../domain/editOps';
import { moveInOrder, revealOnPick } from '../../domain/shapeOps';
import { REPEAT_UNTIL_CLICK, animationClicks, slideTimeline, textParagraphs } from '../../domain/animations';
import type { Ed } from './editor';
import { ANIMATION, ANIMATION_START } from './ko';

const KIND: Record<string, string> = { text: '텍스트 상자', image: '그림', shape: '도형', video: '동영상', camera: '카메라', qr: 'QR 코드', table: '표', chart: '차트', icon: '아이콘', ink: '잉크' };
export const elementName = (el: SlideElement, i: number) => el.name || `${KIND[el.kind] ?? el.kind} ${i + 1}${el.text ? `: ${el.text.split('\n')[0].slice(0, 18)}` : ''}`;
const COLORS: Record<string, string> = { entrance: '#3a9d23', emphasis: '#e6a800', exit: '#c43e1c', path: '#2b78c5' };

function PaneHead({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="task-head"><span>{title}</span><button type="button" className="task-x" title="닫기" onClick={onClose}>✕</button></div>;
}

export function AnimationPane({ ed, onPlay }: { ed: Ed; onPlay: () => void }) {
  const slide = ed.slide;
  const list = slide?.animations ?? [];
  const tl = slide ? slideTimeline(slide) : null;
  const els = ed.elements;
  const set = (animations: SlideAnimation[]) => ed.updateSlide({ animations: animations.length ? animations : undefined });
  const [picked, setPicked] = useState<string | null>(null);
  // Click numbers from the timeline, so each paragraph of a 단락별로 build counts as its own click.
  const clicks = slide ? animationClicks(slide) : {};
  return (
    <div className="task-pane">
      <PaneHead title="애니메이션 창" onClose={() => ed.setPane(null)} />
      <div className="task-tools">
        <button type="button" disabled={!list.length} onClick={onPlay}>▶ 모두 재생</button>
        <button type="button" disabled={!list.length || !ed.canEdit} title="이 슬라이드의 애니메이션을 모두 지웁니다" onClick={() => { set([]); setPicked(null); }}>모두 제거</button>
        <span className="grow" />
        <button type="button" disabled={!picked} title="앞으로" onClick={() => picked && set(moveAnimation(list, picked, -1))}>▲</button>
        <button type="button" disabled={!picked} title="뒤로" onClick={() => picked && set(moveAnimation(list, picked, 1))}>▼</button>
      </div>
      {!list.length && <p className="task-empty">이 슬라이드에는 애니메이션이 없습니다. 개체를 고르고 <b>애니메이션</b> 탭에서 효과를 고르세요.</p>}
      <ol className="anim-list">
        {list.map((a) => {
          const el = els.find((e) => e.id === a.elementId);
          const i = els.findIndex((e) => e.id === a.elementId);
          const c = clicks[a.id];
          const paras = c && c.paragraphs.some((p) => p !== null) && el ? textParagraphs(el) : null;
          return [
            <li key={a.id} className={picked === a.id ? 'on' : ''} onClick={() => { setPicked(a.id); if (el) ed.setSel([el.id]); }}>
              <span className="anim-num">{a.start === 'click' && c ? c.clicks[0] : ''}</span>
              <span className="anim-ico" style={{ color: COLORS[a.class] }}>{a.start === 'click' ? '🖱' : a.start === 'with' ? '' : '⏱'}★</span>
              <span className="anim-name">{el ? elementName(el, i) : '(지운 개체)'}<small>{ANIMATION[a.effect] ?? a.effect} · {a.trigger ? `⚡ ${(() => { const t = els.findIndex((e) => e.id === a.trigger); return t >= 0 ? elementName(els[t], t) : '(지운 개체)'; })()} 클릭 시` : ANIMATION_START[a.start]} · {(a.durationMs / 1000).toFixed(2)}초{a.repeat && a.repeat > 1 ? ` · ${a.repeat === REPEAT_UNTIL_CLICK ? '다음 클릭까지 반복' : `${a.repeat}번 반복`}` : ''}{a.rewind ? ' · 되감기' : ''}</small></span>
              <select value={a.start} onClick={(e) => e.stopPropagation()} onChange={(e) => set(list.map((x) => (x.id === a.id ? { ...x, start: e.target.value as SlideAnimation['start'] } : x)))}>
                {(['click', 'with', 'after'] as const).map((s) => <option key={s} value={s}>{ANIMATION_START[s]}</option>)}
              </select>
              <button type="button" className="task-x" title="제거" onClick={(e) => { e.stopPropagation(); set(list.filter((x) => x.id !== a.id)); }}>✕</button>
            </li>,
            // 단락별로: a line per paragraph step under the effect, with its own click number.
            ...(paras && c ? c.paragraphs.map((p, k) => (
              <li key={`${a.id}#${k}`} className={`anim-sub ${picked === a.id ? 'on' : ''}`} onClick={() => { setPicked(a.id); if (el) ed.setSel([el.id]); }}>
                <span className="anim-num">{a.start === 'click' ? c.clicks[k] : ''}</span>
                <span className="anim-ico" style={{ color: COLORS[a.class] }}>{a.start === 'click' ? '🖱' : ''}</span>
                <span className="anim-name">{(paras[p ?? 0] ?? '').trim().slice(0, 30) || '\u00a0'}</span>
              </li>
            )) : []),
          ];
        })}
      </ol>
      {tl && <p className="task-foot">클릭 {tl.auto[0] ? tl.steps - 1 : tl.steps}번 · 총 {tl.total.toFixed(1)}초</p>}
    </div>
  );
}

export function SelectionPane({ ed }: { ed: Ed }) {
  const els = ed.elements;
  const set = (fn: (els: SlideElement[]) => SlideElement[]) => ed.setElements(fn);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; above: boolean } | null>(null);
  return (
    <div className="task-pane">
      <PaneHead title="선택" onClose={() => ed.setPane(null)} />
      <div className="task-tools">
        <button type="button" onClick={() => set((l) => l.map((e) => ({ ...e, hidden: undefined })))}>모두 표시</button>
        <button type="button" onClick={() => set((l) => l.map((e) => ({ ...e, hidden: true })))}>모두 숨기기</button>
        <span className="grow" />
        <button type="button" disabled={!ed.selEls.length} title="앞으로 가져오기" onClick={() => set((l) => orderSelection(l, ed.selEls.map((e) => e.id), 'forward'))}>▲</button>
        <button type="button" disabled={!ed.selEls.length} title="뒤로 보내기" onClick={() => set((l) => orderSelection(l, ed.selEls.map((e) => e.id), 'backward'))}>▼</button>
      </div>
      {!els.length && <p className="task-empty">이 슬라이드에는 개체가 없습니다.</p>}
      <ul className="sel-list">
        {[...els].filter((el) => !el.master).reverse().map((el) => {
          const i = els.indexOf(el);
          const on = ed.selEls.some((s) => s.id === el.id);
          return (
            <li key={el.id} className={`${on ? 'on' : ''} ${el.hidden ? 'hidden' : ''} ${el.groupId ? 'grouped' : ''} ${over?.id === el.id ? (over.above ? 'drop-above' : 'drop-below') : ''}`}
              draggable={renaming !== el.id} onDragStart={(e) => { e.dataTransfer.setData('text/plain', el.id); setDragId(el.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}
              onDragOver={(e) => { if (!dragId || dragId === el.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id: el.id, above: e.clientY < r.top + r.height / 2 }); }}
              onDrop={(e) => { e.preventDefault(); if (dragId && over) { const { id, above } = over; set((l) => moveInOrder(l, dragId, id, above)); } setDragId(null); setOver(null); }}
              onClick={(e) => {
                // A hidden object picked in the list is shown (DeckCraft's selection.select).
                if (el.hidden) set((l) => revealOnPick(l, el.id));
                ed.setSel(e.shiftKey || e.ctrlKey || e.metaKey ? (ed.sel.includes(el.id) ? ed.sel.filter((x) => x !== el.id) : [...ed.sel, el.id]) : [el.id]);
              }} onDoubleClick={() => setRenaming(el.id)}>
              {renaming === el.id
                ? <input autoFocus defaultValue={elementName(el, i)} onBlur={(e) => { const v = e.target.value.trim(); set((l) => l.map((x) => (x.id === el.id ? { ...x, name: v || undefined } : x))); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
                : <span className="sel-name">{el.groupId ? '▸ ' : ''}{elementName(el, i)}</span>}
              <button type="button" className="sel-eye" title={el.locked ? '잠금 해제' : '잠금 (슬라이드에서 선택 · 이동 안 됨)'} onClick={(e) => { e.stopPropagation(); set((l) => l.map((x) => (x.id === el.id ? { ...x, locked: x.locked ? undefined : true } : x))); }}>{el.locked ? '🔒' : '🔓'}</button>
              <button type="button" className="sel-eye" title={el.hidden ? '표시' : '숨기기'} onClick={(e) => { e.stopPropagation(); set((l) => l.map((x) => (x.id === el.id ? { ...x, hidden: x.hidden ? undefined : true } : x))); }}>{el.hidden ? '⊘' : '👁'}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The comment Previous / Next (and a click on a card) put in focus: shared by the ribbon and the pane.
let focused: CommentRef | null = null;
const focusListeners = new Set<() => void>();
export function setCommentFocus(ref: CommentRef | null) { focused = ref; focusListeners.forEach((f) => f()); }
const useCommentFocus = () => useSyncExternalStore((f) => { focusListeners.add(f); return () => { focusListeners.delete(f); }; }, () => focused);

/** Review › Previous / Next comment (DeckCraft comment.prev / comment.next): goes to its slide and opens the pane. */
export function stepComment(ed: Ed, forward: boolean) {
  const p = ed.p;
  if (!p) return;
  const at = ed.slide ? p.slides.indexOf(ed.slide) : 0;
  const cur = focused && focused.slide === at ? focused.index : null;
  const next = neighbourComment(p.slides, at, cur, forward);
  if (!next) return ed.cmd.notify(commentCount(p.slides) ? (forward ? '마지막 메모입니다.' : '첫 메모입니다.') : '메모가 없습니다.');
  ed.cmd.setSlideId(p.slides[next.slide].id);
  setCommentFocus(next);
  if (ed.pane !== 'comments') ed.setPane('comments');
}

export function CommentsPane({ ed, draftOpen, onDraftDone }: { ed: Ed; draftOpen: boolean; onDraftDone: () => void }) {
  const slide = ed.slide;
  const p = ed.p;
  const slides = p?.slides ?? [];
  const here = slide ? slides.indexOf(slide) : -1;
  const [text, setText] = useState('');
  const [writing, setWriting] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const focus = useCommentFocus();
  const author = loadSession()?.username || getDevice().userName || '나';
  const anchor = ed.sel.length === 1 && ed.elements.some((e) => e.id === ed.sel[0]) ? ed.sel[0] : undefined;
  const save = () => {
    if (!slide || !text.trim()) return;
    const list = slide.comments ?? [];
    ed.updateSlide({ comments: [...list, { id: uid('c'), author, text: text.trim(), at: Date.now(), ...(anchor ? { elementId: anchor } : {}) }] });
    setCommentFocus({ slide: here, index: list.length });
    setText('');
    setWriting(false);
    onDraftDone();
  };
  const setOn = (s: Slide, comments: SlideComment[]) => ed.updatePres({ slides: slides.map((x) => (x.id === s.id ? { ...x, comments: comments.length ? comments : undefined } : x)) });
  const go = (si: number, ci: number) => {
    const s = slides[si];
    setCommentFocus({ slide: si, index: ci });
    if (s.id !== slide?.id) ed.cmd.setSlideId(s.id);
    const el = s.comments?.[ci]?.elementId;
    if (el && s.elements?.some((e) => e.id === el)) setTimeout(() => ed.setSel([el]), 0);
  };
  const groups = slides.map((s, si) => ({ s, si })).filter(({ s }) => s.comments?.length);
  return (
    <div className="task-pane">
      <PaneHead title="메모" onClose={() => ed.setPane(null)} />
      {(draftOpen || writing || !groups.length) && slide && (
        <div className="comment-new">
          <small className="dlg-note">슬라이드 {here + 1}{anchor ? ` · ${elementName(ed.elements.find((e) => e.id === anchor)!, ed.elements.findIndex((e) => e.id === anchor))}` : ''}</small>
          <textarea autoFocus={draftOpen || writing} placeholder="메모를 입력하세요. 팀원이 이 슬라이드에서 봅니다." value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }} />
          <div className="row gap-xs"><span className="grow" /><button type="button" onClick={() => { setText(''); setWriting(false); onDraftDone(); }}>취소</button><button type="button" className="primary" disabled={!text.trim()} onClick={save}>게시</button></div>
        </div>
      )}
      <div className="task-tools">
        {!draftOpen && !writing && !!groups.length && <button type="button" onClick={() => setWriting(true)}>＋ 새 메모</button>}
        <span className="grow" />
        <button type="button" title="이전 메모" disabled={!groups.length} onClick={() => stepComment(ed, false)}>◀ 이전</button>
        <button type="button" title="다음 메모" disabled={!groups.length} onClick={() => stepComment(ed, true)}>다음 ▶</button>
      </div>
      {!groups.length && <p className="dlg-note comment-empty">메모가 없습니다.</p>}
      {groups.map(({ s, si }) => (
        <div key={s.id} className="comment-group">
          <div className={`comment-slide ${si === here ? 'on' : ''}`}>슬라이드 {si + 1}{s.title ? ` · ${s.title.slice(0, 24)}` : ''}</div>
          <ul className="comment-list">
            {s.comments!.map((c, ci) => {
              const list = s.comments!;
              const on = focus?.slide === si && focus.index === ci;
              const el = c.elementId ? s.elements?.find((e) => e.id === c.elementId) : undefined;
              return (
                <li key={c.id} className={`${c.resolved ? 'resolved' : ''} ${on ? 'focus' : ''}`} ref={on ? (n) => n?.scrollIntoView({ block: 'nearest' }) : undefined} onClick={() => go(si, ci)}>
                  <div className="comment-head"><span className="comment-avatar">{initialsOf(c.author)}</span><b className="grow">{c.author}</b><small>{new Date(c.at).toLocaleString()}{c.resolved ? ' · 해결됨' : ''}</small></div>
                  {el && <small className="comment-anchor">📌 {elementName(el, s.elements!.indexOf(el))}</small>}
                  <p>{c.text}</p>
                  {c.replies?.map((r, i) => <div key={i} className="comment-reply"><span className="comment-avatar sm">{initialsOf(r.author)}</span><b>{r.author}</b> {r.text}</div>)}
                  <div className="row gap-xs" onClick={(e) => e.stopPropagation()}>
                    <input placeholder="회신" value={reply[c.id] ?? ''} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} onKeyDown={(e) => {
                      if (e.key !== 'Enter' || !reply[c.id]?.trim()) return;
                      setOn(s, list.map((x) => (x.id === c.id ? { ...x, replies: [...(x.replies ?? []), { author, text: reply[c.id].trim(), at: Date.now() }] } : x)));
                      setReply({ ...reply, [c.id]: '' });
                    }} />
                    <button type="button" className="mini-btn" disabled={!ed.canEdit} onClick={() => setOn(s, list.map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved || undefined } : x)))}>{c.resolved ? '다시 열기' : '해결'}</button>
                    <button type="button" className="mini-btn danger" disabled={!ed.canEdit} onClick={() => { setOn(s, list.filter((x) => x.id !== c.id)); if (on) setCommentFocus(null); }}>삭제</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

