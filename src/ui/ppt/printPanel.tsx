// File › Print: DeckCraft's print dialog — what to print (slides / handouts 1–9 per page / notes pages /
// outline), the Slides range ("1-3, 5"), hidden slides, frame, colour (color / grayscale / black & white),
// scale to fit — with a live preview. Printing goes through the browser's print dialog, which also
// offers "Save as PDF".
import { useMemo, useState } from 'react';
import type { Presentation } from '../../domain/types';
import { COLOR_LABEL, DEFAULT_PRINT, printPages, type ColorMode, type HandoutPerPage, type PrintOptions, type PrintWhat } from '../../domain/filePrint';
import { printHtml } from '../printHtml';
import { Check } from './dialogs';
import type { Ed } from './editor';
import { PrintPages, PrintRun, type PrintMode } from './printing';

const WHAT: [PrintWhat, string][] = [['slides', '전체 페이지 슬라이드'], ['handout', '유인물'], ['notes', '슬라이드 노트'], ['outline', '개요']];
const PER_PAGE: HandoutPerPage[] = [1, 2, 3, 4, 6, 9];

/** The outline page: each slide's text and notes (Print › Outline). */
export function outlineHtml(p: Presentation, pages: { slide: Presentation['slides'][number]; number: number }[], o: Pick<PrintOptions, 'frame' | 'color'>): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const filter = o.color === 'color' ? '' : 'filter:grayscale(1)';
  return `<html><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>body{font-family:sans-serif;padding:24px;${filter}}h1{font-size:20px}.s{${o.frame ? 'border:1px solid #999;' : ''}margin:10px 0;padding:10px;page-break-inside:avoid}.n{color:#777;font-size:12px}pre{white-space:pre-wrap;font:inherit;margin:4px 0}</style></head><body><h1>${esc(p.title)}</h1>${
    pages.map(({ slide: s, number }) => `<div class="s"><div class="n">슬라이드 ${number}${s.disabled ? ' (숨김)' : ''}</div>${s.title ? `<b>${esc(s.title)}</b>` : ''}<pre>${esc([s.text, ...(s.elements ?? []).map((e) => e.text ?? '')].filter(Boolean).join('\n'))}</pre>${s.notes ? `<div class="n">노트: ${esc(s.notes)}</div>` : ''}</div>`).join('')
  }</body></html>`;
}

export function PrintPanel({ ed, onMaster, onChords }: { ed: Ed; onMaster: () => void; onChords: () => void }) {
  const p = ed.p;
  const [o, setO] = useState<PrintOptions>({ ...DEFAULT_PRINT, perPage: (p?.handoutMaster?.perPage ?? DEFAULT_PRINT.perPage) as HandoutPerPage, landscape: !!p?.handoutMaster?.landscape });
  const [running, setRunning] = useState(false);
  const set = (patch: Partial<PrintOptions>) => setO((cur) => ({ ...cur, ...patch }));
  const sel = useMemo(() => (p ? printPages(p, o) : { pages: [] as ReturnType<typeof printPages>['pages'] }), [p, o]);
  if (!p) return <p>프레젠테이션이 열려 있지 않습니다.</p>;
  const mode: PrintMode | null = o.what === 'outline' ? null : o.what;
  const sheets = o.what === 'handout' ? Math.ceil(sel.pages.length / o.perPage) : sel.pages.length;
  const go = () => {
    if (!sel.pages.length) return;
    if (mode) setRunning(true);
    else printHtml(outlineHtml(p, sel.pages, o));
  };
  return (
    <div className="bs-print">
      <div className="bs-print-opts">
        <button type="button" className="bs-print-go primary" disabled={!sel.pages.length} onClick={go}>🖨 인쇄{sel.pages.length ? ` (${sheets}쪽)` : ''}</button>
        <label className="bs-opt"><span>인쇄 대상</span>
          <select value={o.what} onChange={(e) => set({ what: e.target.value as PrintWhat })}>{WHAT.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
        </label>
        {o.what === 'handout' && (
          <label className="bs-opt"><span>페이지당 슬라이드 수</span>
            <select value={o.perPage} onChange={(e) => set({ perPage: Number(e.target.value) as HandoutPerPage })}>{PER_PAGE.map((n) => <option key={n} value={n}>{n}{n === 3 ? ' (메모 줄 포함)' : ''}</option>)}</select>
          </label>
        )}
        <label className="bs-opt"><span>슬라이드</span>
          <input value={o.range} placeholder="전체 (예: 1-3, 5)" aria-invalid={!!sel.error} onChange={(e) => set({ range: e.target.value })} />
        </label>
        {sel.error && <p className="bs-opt-err" role="alert">{sel.error}</p>}
        <Check label="숨겨진 슬라이드 인쇄" checked={o.includeHidden} onChange={(on) => set({ includeHidden: on })} />
        <Check label="슬라이드에 테두리 넣기" checked={o.frame} onChange={(on) => set({ frame: on })} />
        {o.what === 'slides' && <Check label="용지에 맞게 크기 조정" checked={o.fit} onChange={(on) => set({ fit: on })} />}
        <label className="bs-opt"><span>색상</span>
          <select value={o.color} onChange={(e) => set({ color: e.target.value as ColorMode })}>{(Object.keys(COLOR_LABEL) as ColorMode[]).map((c) => <option key={c} value={c}>{COLOR_LABEL[c]}</option>)}</select>
        </label>
        {(o.what === 'handout' || o.what === 'notes') && (
          <label className="bs-opt"><span>용지 방향</span>
            <select value={o.landscape ? 'l' : 'p'} onChange={(e) => set({ landscape: e.target.value === 'l' })}><option value="p">세로 방향</option><option value="l">가로 방향</option></select>
          </label>
        )}
        <div className="bs-print-links">
          <button type="button" onClick={onMaster}>유인물 마스터…</button>
          <button type="button" onClick={onChords}>🎼 코드 · 키 악보 인쇄</button>
        </div>
        <p className="bs-note">인쇄 창에서 대상을 “PDF로 저장”으로 고르면 PDF 파일이 만들어집니다.</p>
      </div>
      <div className="bs-print-preview">
        <h2>미리 보기{sel.pages.length ? ` · ${sel.pages.length}장` : ''}</h2>
        {o.what === 'outline' ? <p className="bs-note">개요는 슬라이드마다 텍스트와 노트를 한 페이지에 이어서 인쇄합니다.</p> : (
          <div className={`page-preview print-preview ${o.landscape || o.what === 'slides' ? 'landscape' : ''}`}>
            <div className="page-preview-inner">
              <PrintPages ed={ed} mode={mode!} handout={p.handoutMaster} notes={p.notesMaster} o={o} limit={2} />
            </div>
          </div>
        )}
      </div>
      {running && mode && <PrintRun ed={ed} mode={mode} o={o} onDone={() => setRunning(false)} />}
    </div>
  );
}
