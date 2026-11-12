// View › Slide Master: the master and its layouts are edited like slides. Objects on the master show
// on every slide; a layout holds placeholders (title, text, picture) that slides made from it start
// with (DeckCraft master.insertLayout / renameLayout / deleteLayout / insertPlaceholder / preserve).
import { useRef, useState } from 'react';
import type { Background, MasterLayout, Slide, SlideElement } from '../../domain/types';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { defaultLayouts, deleteLayoutBlocker, duplicateLayout, insertLayout, makePlaceholder, placeholderState, setPlaceholders, syncMaster, type PlaceholderWant } from '../../domain/master';
import { Check, Dialog } from './dialogs';
import { SlideCanvas } from '../SlideCanvas';
import { CanvasEditor, type CanvasTool } from './CanvasEditor';
import type { Ed } from './editor';

export function MasterView({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool | null>(null);
  /** null: the master itself; else a layout id. */
  const [at, setAt] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [layoutBox, setLayoutBox] = useState(false);
  if (!p || !ed.theme) return null;
  const master = p.master ?? { elements: [] };
  const layouts = master.layouts ?? [];
  const layout = at ? layouts.find((l) => l.id === at) ?? null : null;
  const saveMaster = (patch: Partial<NonNullable<typeof p.master>>) => {
    const next = { ...master, ...patch };
    const empty = !next.elements.length && !next.background && !next.layouts?.length && !next.preserve;
    ed.updatePres({ master: empty ? undefined : next, ...(patch.elements ? { slides: syncMaster(p.slides, patch.elements) } : {}) });
  };
  const setLayouts = (ls: MasterLayout[]) => saveMaster({ layouts: ls.length ? ls : undefined });
  const elements = layout ? layout.elements : master.elements;
  const ph = placeholderState(elements);
  const footersOn = ph.date && ph.footer && ph.slideNumber;
  const saveEls = (els: SlideElement[]) => (layout ? setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, elements: els } : l))) : saveMaster({ elements: els }));
  const want = (w: PlaceholderWant) => saveEls(setPlaceholders(elements, w, master.elements));
  const add = (el: SlideElement) => { saveEls([...elements, el]); setSel([el.id]); };
  const picture = async (f: File | undefined) => {
    if (!f) return;
    const id = uid('m');
    await putMedia(id, f);
    ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image' } });
    add({ id: uid('el'), kind: 'image', mediaId: id, fit: 'contain', x: 1180, y: 40, w: 220, h: 160, name: f.name });
  };
  // A layout shows the master's objects behind its own (as slides made from it will).
  const slide: Slide = { id: `__master-${at ?? 'm'}`, group: '', text: '', elements, background: master.background };
  const bg = master.background ?? null;
  const thumb = (els: SlideElement[]) => <SlideCanvas slide={{ id: '__t', group: '', text: '', elements: els }} theme={ed.theme!} background={bg} />;
  return (
    <div className="master-view" role="dialog" aria-label="슬라이드 마스터">
      <div className="master-bar">
        <b>슬라이드 마스터</b>
        <button type="button" title="현재 레이아웃 다음에 제목이 있는 새 레이아웃을 넣습니다" onClick={() => { const r = insertLayout(layouts, master.elements, at); setLayouts(r.layouts); setAt(r.id); setSel([]); }}>레이아웃 삽입</button>
        {!layouts.length && <button type="button" onClick={() => setLayouts(defaultLayouts())}>기본 레이아웃 추가</button>}
        <button type="button" disabled={!layout} onClick={() => layout && setNaming(layout.name)}>이름 바꾸기</button>
        <button type="button" disabled={!layout} onClick={() => { const r = layout && duplicateLayout(layouts, layout.id); if (r) { setLayouts(r.layouts); setAt(r.id); setSel([]); } }}>레이아웃 복제</button>
        <button type="button" disabled={!layout} onClick={() => {
          if (!layout) return;
          const why = deleteLayoutBlocker(layouts, p.slides, layout.id);
          if (why) { ed.cmd.notify(why); return; }
          setLayouts(layouts.filter((l) => l.id !== layout.id)); setAt(null);
        }}>삭제</button>
        <label className="rb-check" title="쓰지 않아도 지우지 않습니다"><input type="checkbox" checked={!!(layout ? layout.preserve : master.preserve)} onChange={(e) => (layout ? setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, preserve: e.target.checked || undefined } : l))) : saveMaster({ preserve: e.target.checked || undefined }))} /> 유지</label>
        <span className="master-sep" />
        <label className="rb-check" title="이 마스터/레이아웃의 제목 개체 틀"><input type="checkbox" checked={ph.title} onChange={(e) => want({ title: e.target.checked })} /> 제목</label>
        <label className="rb-check" title="날짜, 바닥글, 슬라이드 번호 개체 틀"><input type="checkbox" checked={footersOn} ref={(el) => { if (el) el.indeterminate = !footersOn && (ph.date || ph.footer || ph.slideNumber); }} onChange={(e) => want({ date: e.target.checked, footer: e.target.checked, slideNumber: e.target.checked })} /> 바닥글</label>
        <button type="button" onClick={() => setLayoutBox(true)}>마스터 레이아웃…</button>
        <span className="master-sep" />
        <select value="" disabled={!layout} title="개체 틀 삽입 (레이아웃에서)" onChange={(e) => { if (e.target.value) add(makePlaceholder(e.target.value as NonNullable<SlideElement['placeholder']>)); }}>
          <option value="">개체 틀 삽입 ▾</option><option value="content">내용</option><option value="title">제목</option><option value="body">텍스트 (글머리 기호)</option><option value="text">텍스트</option><option value="picture">그림</option><option value="chart">차트</option><option value="table">표</option><option value="media">미디어</option>
        </select>
        <button type="button" onClick={() => setTool({ kind: 'shape', name: 'textBox' })}>텍스트 상자</button>
        <button type="button" onClick={() => setTool({ kind: 'shape', name: 'rect' })}>사각형</button>
        <button type="button" onClick={() => setTool({ kind: 'shape', name: 'line' })}>선</button>
        <button type="button" onClick={() => file.current?.click()}>그림</button>
        <button type="button" onClick={() => add({ id: uid('el'), kind: 'text', text: '{slide}', x: 1240, y: 1000, w: 160, h: 60, fontSize: 28, color: '#ffffff', align: 'right' })}>슬라이드 번호</button>
        <label className="rb-check">배경 <input type="color" value={master.background?.kind === 'color' ? master.background.value : '#000000'} onChange={(e) => saveMaster({ background: { kind: 'color', value: e.target.value } as Background })} /></label>
        <button type="button" disabled={!sel.length} onClick={() => { saveEls(elements.filter((e) => !sel.includes(e.id))); setSel([]); }}>삭제(개체)</button>
        <span className="grow" />
        <button type="button" className="primary" onClick={onClose}>마스터 보기 닫기</button>
      </div>
      <div className="master-main">
        <aside className="master-list">
          <button type="button" className={`master-thumb ${!at ? 'on' : ''}`} onClick={() => { setAt(null); setSel([]); }}>{thumb(master.elements)}<span>슬라이드 마스터 — 모든 슬라이드{master.preserve ? ' 📌' : ''}</span></button>
          {layouts.map((l) => (
            <button key={l.id} type="button" className={`master-thumb layout ${at === l.id ? 'on' : ''}`} onClick={() => { setAt(l.id); setSel([]); }}>{thumb([...master.elements, ...l.elements])}<span>{l.name}{l.preserve ? ' 📌' : ''}</span></button>
          ))}
        </aside>
        <div className="master-stage">
          <CanvasEditor slide={slide} theme={ed.theme} background={bg} selected={sel} onSelect={setSel} tool={tool} onToolDone={() => setTool(null)}
            readOnly={!!p.protected} onAddMedia={(m) => ed.dispatch({ type: 'media/add', media: m })} onChange={(patch) => { if ('elements' in patch) saveEls(patch.elements ?? []); if (patch.background) saveMaster({ background: patch.background }); }} />
          <p className="dlg-note">{layout ? `“${layout.name}” 레이아웃 — 홈 › 새 슬라이드에서 이 레이아웃으로 슬라이드를 만듭니다.` : '여기에 놓은 개체는 모든 슬라이드에 나옵니다.'}</p>
        </div>
      </div>
      {naming !== null && layout && (
        <Dialog title="레이아웃 이름 바꾸기" onClose={() => setNaming(null)} onOk={() => { const name = naming.trim(); if (name) setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, name } : l))); setNaming(null); }} okDisabled={!naming.trim()}>
          <input autoFocus aria-label="레이아웃 이름" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && naming.trim()) { setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, name: naming.trim() } : l))); setNaming(null); } }} />
        </Dialog>
      )}
      {layoutBox && (
        <Dialog title="마스터 레이아웃" onClose={() => setLayoutBox(false)}>
          <p className="dlg-note">{layout ? `“${layout.name}” 레이아웃` : '슬라이드 마스터'}에 둘 개체 틀을 고릅니다. 체크를 풀면 그 개체 틀이 지워집니다.</p>
          <fieldset className="dlg-set"><legend>개체 틀</legend>
            <Check label="제목" checked={ph.title} onChange={(v) => want({ title: v })} />
            <Check label="텍스트" checked={ph.text} onChange={(v) => want({ text: v })} />
            <Check label="날짜" checked={ph.date} onChange={(v) => want({ date: v })} />
            <Check label="바닥글" checked={ph.footer} onChange={(v) => want({ footer: v })} />
            <Check label="슬라이드 번호" checked={ph.slideNumber} onChange={(v) => want({ slideNumber: v })} />
          </fieldset>
        </Dialog>
      )}
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void picture(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
