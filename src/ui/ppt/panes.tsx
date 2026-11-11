// Task panes on the right of the window: 애니메이션 창, 선택 창, 메모, 접근성 검사.
import { useState } from 'react';
import type { SlideAnimation, SlideElement } from '../../domain/types';
import { uid } from '../../domain/lyrics';
import { getDevice } from '../../domain/device';
import { loadSession } from '../../domain/cloud';
import { orderSelection, moveAnimation } from '../../domain/editOps';
import { animationClicks, slideTimeline, textParagraphs } from '../../domain/animations';
import { contrastRatio } from '../../engine';
import { resolveBackground } from '../../domain/autoBackground';
import { slideTheme } from '../SlideCanvas';
import { sequence } from '../../domain/arrangement';
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
              <span className="anim-name">{el ? elementName(el, i) : '(지운 개체)'}<small>{ANIMATION[a.effect] ?? a.effect} · {ANIMATION_START[a.start]} · {(a.durationMs / 1000).toFixed(2)}초</small></span>
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
            <li key={el.id} className={`${on ? 'on' : ''} ${el.hidden ? 'hidden' : ''} ${el.groupId ? 'grouped' : ''}`}
              onClick={(e) => ed.setSel(e.shiftKey || e.ctrlKey || e.metaKey ? [...ed.sel, el.id] : [el.id])} onDoubleClick={() => setRenaming(el.id)}>
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

export function CommentsPane({ ed, draftOpen, onDraftDone }: { ed: Ed; draftOpen: boolean; onDraftDone: () => void }) {
  const slide = ed.slide;
  const list = slide?.comments ?? [];
  const [text, setText] = useState('');
  const [writing, setWriting] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const author = loadSession()?.username ?? getDevice().userName ?? '나';
  const save = () => {
    if (!slide || !text.trim()) return;
    ed.updateSlide({ comments: [...list, { id: uid('c'), author, text: text.trim(), at: Date.now() }] });
    setText('');
    setWriting(false);
    onDraftDone();
  };
  const set = (comments: typeof list) => ed.updateSlide({ comments: comments.length ? comments : undefined });
  return (
    <div className="task-pane">
      <PaneHead title="메모" onClose={() => ed.setPane(null)} />
      {(draftOpen || writing || !list.length) && slide && (
        <div className="comment-new">
          <textarea autoFocus={draftOpen || writing} placeholder="메모를 입력하세요. 팀원이 이 슬라이드에서 봅니다." value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }} />
          <div className="row gap-xs"><span className="grow" /><button type="button" onClick={() => { setText(''); setWriting(false); onDraftDone(); }}>취소</button><button type="button" className="primary" disabled={!text.trim()} onClick={save}>게시</button></div>
        </div>
      )}
      {!draftOpen && !writing && !!list.length && <div className="task-tools"><button type="button" onClick={() => setWriting(true)}>＋ 새 메모</button></div>}
      <ul className="comment-list">
        {list.map((c) => (
          <li key={c.id} className={c.resolved ? 'resolved' : ''}>
            <div className="comment-head"><b>{c.author}</b><small>{new Date(c.at).toLocaleString()}</small></div>
            <p>{c.text}</p>
            {c.replies?.map((r, i) => <div key={i} className="comment-reply"><b>{r.author}</b> {r.text}</div>)}
            <div className="row gap-xs">
              <input placeholder="회신" value={reply[c.id] ?? ''} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} onKeyDown={(e) => {
                if (e.key !== 'Enter' || !reply[c.id]?.trim()) return;
                set(list.map((x) => (x.id === c.id ? { ...x, replies: [...(x.replies ?? []), { author, text: reply[c.id].trim(), at: Date.now() }] } : x)));
                setReply({ ...reply, [c.id]: '' });
              }} />
              <button type="button" className="mini-btn" onClick={() => set(list.map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved } : x)))}>{c.resolved ? '다시 열기' : '해결'}</button>
              <button type="button" className="mini-btn danger" onClick={() => set(list.filter((x) => x.id !== c.id))}>삭제</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Issue { level: 'error' | 'warning' | 'tip'; text: string; seq: number; elementId?: string }

/** Review › Check Accessibility: missing alt text, text that is hard to read on its background (contrast from the engine), empty slides. */
export function accessibilityIssues(ed: Ed): Issue[] {
  const p = ed.p;
  const theme = ed.theme;
  if (!p || !theme) return [];
  const out: Issue[] = [];
  sequence(p).forEach(({ slide }, seq) => {
    const t = slideTheme(theme, slide);
    const bg = resolveBackground(slide, p);
    const bgColor = bg?.kind === 'color' ? bg.value : bg?.kind === 'gradient' ? null : bg ? null : '#000000';
    (slide.elements ?? []).forEach((el, i) => {
      if ((el.kind === 'image' || el.kind === 'chart' || el.kind === 'icon') && !el.alt) out.push({ level: 'error', text: `${elementName(el, i)} — 대체 텍스트 없음`, seq, elementId: el.id });
      if (el.kind === 'text' && el.text?.trim() && bgColor && el.color && /^#[0-9a-f]{6}$/i.test(el.color) && /^#[0-9a-f]{6}$/i.test(bgColor)) {
        const c = contrastRatio(el.color, bgColor);
        if (c && !c.aaLarge) out.push({ level: 'warning', text: `${elementName(el, i)} — 글자와 배경의 대비 ${c.ratio}:1 (읽기 어려움)`, seq, elementId: el.id });
      }
    });
    if (slide.text.trim() && bgColor && /^#[0-9a-f]{6}$/i.test(t.color) && /^#[0-9a-f]{6}$/i.test(bgColor)) {
      const c = contrastRatio(t.color, bgColor);
      if (c && !c.aaLarge) out.push({ level: 'warning', text: `슬라이드 텍스트 — 배경과의 대비 ${c.ratio}:1`, seq });
    }
    if (!slide.text.trim() && !slide.title && !(slide.elements ?? []).length && !slide.background) out.push({ level: 'tip', text: '빈 슬라이드', seq });
  });
  return out;
}

export function AccessibilityPane({ ed, onGo }: { ed: Ed; onGo: (seq: number, elementId?: string) => void }) {
  const issues = accessibilityIssues(ed);
  const label = { error: '오류', warning: '경고', tip: '팁' } as const;
  return (
    <div className="task-pane">
      <PaneHead title="접근성" onClose={() => ed.setPane(null)} />
      {!issues.length ? <p className="task-empty">✓ 접근성 문제가 없습니다.</p> : (
        <ul className="a11y-list">
          {issues.map((it, i) => (
            <li key={i} className={it.level} onClick={() => onGo(it.seq, it.elementId)}>
              <span className="a11y-level">{label[it.level]}</span><span>슬라이드 {it.seq + 1} · {it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
