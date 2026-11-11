// File › Print (slides, handouts, notes pages, outline) and the masters that shape them: View ›
// Handout Master and Notes Master (DeckCraft view.handoutMaster / view.notesMaster and their
// placeholders). Pages are drawn by the app itself and printed with the browser's print dialog,
// so they look like the slides on screen. Also File › Info › Properties and Inspect Document.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HandoutMaster, NotesMaster, PagePlaceholders, Presentation, Slide } from '../../domain/types';
import { sequence } from '../../domain/arrangement';
import { resolveBackground } from '../../domain/autoBackground';
import { SlideCanvas } from '../SlideCanvas';
import { Check, Dialog, Field } from './dialogs';
import type { Ed } from './editor';

export type PrintMode = 'slides' | 'handout' | 'notes';
export const DEFAULT_HANDOUT: HandoutMaster = { perPage: 3, date: true, pageNumber: true };
export const DEFAULT_NOTES: NotesMaster = { date: true, pageNumber: true };

/** How a handout page divides into slide frames (columns × rows) for N slides per page. */
export const handoutGrid = (n: HandoutMaster['perPage']): readonly [number, number] => ({ 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] } as const)[n];

/** Pages of slides: N to a page. */
export function paginate<T>(items: T[], per: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

function PageChrome({ m, page, children }: { m: PagePlaceholders; page: number; children: ReactNode }) {
  return (
    <div className="print-page">
      {(m.header || m.date) && <div className="print-head"><span>{m.header}</span><span>{m.date ? new Date().toLocaleDateString() : ''}</span></div>}
      <div className="print-body">{children}</div>
      {(m.footer || m.pageNumber) && <div className="print-foot"><span>{m.footer}</span><span>{m.pageNumber ? page : ''}</span></div>}
    </div>
  );
}

function SlideBox({ ed, p, s }: { ed: Ed; p: Presentation; s: Slide }) {
  const theme = ed.state.library.themes.find((t) => t.id === p.themeId) ?? ed.theme!;
  return <div className="print-slide"><SlideCanvas slide={s} theme={theme} background={resolveBackground(s, p)} /></div>;
}

/** The pages to print, laid out like PowerPoint's print preview. */
export function PrintPages({ ed, mode, handout, notes }: { ed: Ed; mode: PrintMode; handout?: HandoutMaster; notes?: NotesMaster }) {
  const p = ed.p;
  if (!p || !ed.theme) return null;
  const slides = sequence(p).map((x) => x.slide).filter((s) => !s.disabled);
  if (mode === 'slides') return <>{slides.map((s, i) => <div key={s.id} className="print-page slide-page"><SlideBox ed={ed} p={p} s={s} /><span className="print-num">{i + 1}</span></div>)}</>;
  if (mode === 'notes') {
    const m = { ...DEFAULT_NOTES, ...notes };
    return <>{slides.map((s, i) => (
      <PageChrome key={s.id} m={m} page={i + 1}>
        <div className="notes-slide"><SlideBox ed={ed} p={p} s={s} /></div>
        <div className="notes-text">{s.notes || ''}</div>
      </PageChrome>
    ))}</>;
  }
  const m = { ...DEFAULT_HANDOUT, ...handout };
  const [cols, rows] = handoutGrid(m.perPage);
  return <>{paginate(slides, m.perPage).map((page, i) => (
    <PageChrome key={i} m={m} page={i + 1}>
      <div className={`handout-grid ${m.perPage === 3 ? 'with-lines' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {page.map((s) => <div key={s.id} className="handout-cell"><SlideBox ed={ed} p={p} s={s} />{m.perPage === 3 && <div className="handout-lines">{Array.from({ length: 6 }, (_, k) => <i key={k} />)}</div>}</div>)}
      </div>
    </PageChrome>
  ))}</>;
}

/** Renders the pages off screen and opens the print dialog; done when printing ends. */
export function PrintRun({ ed, mode, onDone }: { ed: Ed; mode: PrintMode; onDone: () => void }) {
  useEffect(() => {
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); onDone(); };
    window.addEventListener('afterprint', done);
    // Let the slide canvases measure themselves before the page is printed.
    const t = window.setTimeout(() => window.print(), 600);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.body.classList.remove('printing'); };
  }, [onDone]);
  const landscape = mode === 'slides' || (mode === 'handout' ? ed.p?.handoutMaster?.landscape : ed.p?.notesMaster?.landscape);
  return createPortal(
    <div id="print-root" className={landscape ? 'landscape' : ''}>
      <style>{`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`}</style>
      <PrintPages ed={ed} mode={mode} handout={ed.p?.handoutMaster} notes={ed.p?.notesMaster} />
    </div>,
    document.body,
  );
}

function Placeholders({ m, set }: { m: PagePlaceholders; set: (p: Partial<PagePlaceholders>) => void }) {
  return (
    <fieldset className="dlg-set">
      <legend>개체 틀</legend>
      <div className="dlg-cols">
        <div>
          <Check label="머리글" checked={m.header !== undefined} onChange={(on) => set({ header: on ? m.header ?? '' : undefined })} />
          {m.header !== undefined && <input value={m.header} placeholder="머리글" onChange={(e) => set({ header: e.target.value })} />}
          <Check label="날짜" checked={!!m.date} onChange={(on) => set({ date: on || undefined })} />
        </div>
        <div>
          <Check label="바닥글" checked={m.footer !== undefined} onChange={(on) => set({ footer: on ? m.footer ?? '' : undefined })} />
          {m.footer !== undefined && <input value={m.footer} placeholder="바닥글" onChange={(e) => set({ footer: e.target.value })} />}
          <Check label="페이지 번호" checked={!!m.pageNumber} onChange={(on) => set({ pageNumber: on || undefined })} />
        </div>
      </div>
    </fieldset>
  );
}

/** View › Handout Master / Notes Master: the page set-up, its placeholders, a preview and Print. */
export function PageMasterDialog({ ed, kind, onClose }: { ed: Ed; kind: 'handout' | 'notes'; onClose: () => void }) {
  const p = ed.p;
  const [printing, setPrinting] = useState(false);
  if (!p) return null;
  const handout = { ...DEFAULT_HANDOUT, ...p.handoutMaster };
  const notes = { ...DEFAULT_NOTES, ...p.notesMaster };
  const set = (patch: Partial<HandoutMaster & NotesMaster>) => ed.updatePres(kind === 'handout' ? { handoutMaster: { ...handout, ...patch } } : { notesMaster: { ...notes, ...patch } });
  const m = kind === 'handout' ? handout : notes;
  return (
    <Dialog title={kind === 'handout' ? '유인물 마스터' : '슬라이드 노트 마스터'} onClose={onClose} onOk={() => setPrinting(true)} okLabel="인쇄…" wide>
      <div className="dlg-grid3">
        {kind === 'handout' && (
          <Field label="페이지당 슬라이드 수">
            <select value={handout.perPage} onChange={(e) => set({ perPage: Number(e.target.value) as HandoutMaster['perPage'] })}>{[1, 2, 3, 4, 6, 9].map((n) => <option key={n} value={n}>{n}{n === 3 ? ' (메모 줄 포함)' : ''}</option>)}</select>
          </Field>
        )}
        <Field label="방향"><select value={m.landscape ? 'l' : 'p'} onChange={(e) => set({ landscape: e.target.value === 'l' || undefined })}><option value="p">세로</option><option value="l">가로</option></select></Field>
      </div>
      <Placeholders m={m} set={set} />
      <div className={`page-preview ${m.landscape ? 'landscape' : ''}`}>
        <div className="page-preview-inner"><PrintPages ed={{ ...ed, p: { ...p, slides: p.slides.slice(0, kind === 'handout' ? handout.perPage : 1) } }} mode={kind} handout={handout} notes={notes} /></div>
      </div>
      {printing && <PrintRun ed={ed} mode={kind} onDone={() => setPrinting(false)} />}
    </Dialog>
  );
}

const PROPS: [keyof NonNullable<Presentation['properties']>, string][] = [['title', '제목'], ['subject', '주제'], ['author', '작성자'], ['manager', '관리자'], ['company', '회사'], ['category', '범주'], ['keywords', '키워드'], ['comments', '설명']];

/** File › Info › Properties. */
export function PropertiesForm({ ed }: { ed: Ed }) {
  const p = ed.p;
  if (!p) return null;
  const v = p.properties ?? {};
  return (
    <div className="bs-props">
      <h2>속성</h2>
      {PROPS.map(([k, l]) => (
        <label key={k} className="bs-prop"><span>{l}</span>
          <input value={v[k] ?? ''} placeholder={k === 'title' ? p.title : '추가'} disabled={!!p.protected} onChange={(e) => ed.updatePres({ properties: { ...v, [k]: e.target.value || undefined } })} />
        </label>
      ))}
    </div>
  );
}

/** What Inspect Document finds, and how to take each out. */
export function inspectFindings(p: Presentation): { id: string; label: string; count: number; remove: (p: Presentation) => Partial<Presentation> }[] {
  const off = (s: Slide) => (s.elements ?? []).filter((e) => !e.master && (e.x + e.w <= 0 || e.y + e.h <= 0 || e.x >= 1440 || e.y >= 1080));
  return [
    { id: 'comments', label: '메모', count: p.slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0), remove: (x) => ({ slides: x.slides.map((s) => ({ ...s, comments: undefined })) }) },
    { id: 'notes', label: '발표자 노트', count: p.slides.filter((s) => s.notes?.trim()).length, remove: (x) => ({ slides: x.slides.map((s) => ({ ...s, notes: undefined })) }) },
    { id: 'hidden', label: '숨겨진 슬라이드', count: p.slides.filter((s) => s.disabled).length, remove: (x) => ({ slides: x.slides.filter((s) => !s.disabled) }) },
    { id: 'invisible', label: '보이지 않는 개체 (선택 창에서 숨김)', count: p.slides.reduce((n, s) => n + (s.elements?.filter((e) => e.hidden).length ?? 0), 0), remove: (x) => ({ slides: x.slides.map((s) => ({ ...s, elements: s.elements?.filter((e) => !e.hidden) })) }) },
    { id: 'offslide', label: '슬라이드 밖 내용', count: p.slides.reduce((n, s) => n + off(s).length, 0), remove: (x) => ({ slides: x.slides.map((s) => { const out = off(s).map((e) => e.id); return { ...s, elements: s.elements?.filter((e) => !out.includes(e.id)) }; }) }) },
    { id: 'properties', label: '문서 속성 및 개인 정보', count: p.properties && Object.values(p.properties).some(Boolean) ? 1 : 0, remove: () => ({ properties: undefined }) },
  ];
}

/** File › Info › Check for Issues › Inspect Document. */
export function InspectDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  if (!p) return null;
  const found = inspectFindings(p);
  return (
    <Dialog title="문서 검사" onClose={onClose}>
      <p className="dlg-note">숨겨진 데이터와 개인 정보를 찾았습니다. 지우면 되돌릴 수 없습니다 (실행 취소는 됩니다).</p>
      <div className="inspect-list">
        {found.map((f) => (
          <div key={f.id} className={`inspect-row ${f.count ? 'found' : ''}`}>
            <span className="inspect-mark">{f.count ? '!' : '✓'}</span>
            <span className="grow"><b>{f.label}</b><br /><small>{f.count ? `${f.count}개를 찾았습니다.` : '없습니다.'}</small></span>
            {f.count > 0 && <button type="button" disabled={!ed.canEdit && !!p.protected} onClick={() => ed.updatePres(f.remove(p))}>모두 제거</button>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
