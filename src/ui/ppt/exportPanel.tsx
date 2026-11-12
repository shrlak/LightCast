// File › Export › slide pictures: PNG / JPEG of the current slide or of every slide (one .zip), at a chosen
// size (DeckCraft file.export png/jpeg: slide / all / slides range, hidden slides). "Save as PDF" is the
// print dialog's PDF printer, reached from Print.
import { useState } from 'react';
import JSZip from 'jszip';
import { EXPORT_SIZES, exportFileName, printPages, type ExportFormat } from '../../domain/filePrint';
import { slideToImage } from '../slideImage';
import { slideTheme } from '../SlideCanvas';
import { Check } from './dialogs';
import type { Ed } from './editor';

function save(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function ExportPanel({ ed, onPdf }: { ed: Ed; onPdf: () => void }) {
  const p = ed.p;
  const [format, setFormat] = useState<ExportFormat>('png');
  const [size, setSize] = useState('medium');
  const [scope, setScope] = useState<'current' | 'all' | 'range'>('current');
  const [range, setRange] = useState('');
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!p) return null;
  const sel = scope === 'all' ? printPages(p, { range: '', includeHidden: hidden }) : scope === 'range' ? printPages(p, { range, includeHidden: hidden }) : { pages: [] as ReturnType<typeof printPages>['pages'], error: undefined };
  const currentIndex = ed.slide ? p.slides.findIndex((s) => s.id === ed.slide!.id) : -1;
  const ext = format === 'png' ? 'png' : 'jpg';
  const width = EXPORT_SIZES.find((s) => s.id === size)!.width;
  const ready = scope === 'current' ? currentIndex >= 0 : sel.pages.length > 0 && !sel.error;
  const run = async () => {
    setMsg(null);
    try {
      const list = scope === 'current' ? [{ slide: p.slides[currentIndex], number: currentIndex + 1 }] : sel.pages;
      const out: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < list.length; i++) {
        setBusy(`${i + 1} / ${list.length} 그리는 중…`);
        const blob = await slideToImage(p, list[i].slide, slideTheme(ed.theme!, list[i].slide), width, format);
        out.push({ name: exportFileName(p.title, list[i].number, p.slides.length, ext), blob });
      }
      if (out.length === 1) save(out[0].name, out[0].blob);
      else {
        setBusy('압축하는 중…');
        const zip = new JSZip();
        for (const f of out) zip.file(f.name, f.blob);
        save(`${p.title.replace(/[\\/:*?"<>|\s]+/g, ' ').trim() || 'slides'}.zip`, await zip.generateAsync({ type: 'blob' }));
      }
      setMsg(`${out.length}장을 저장했습니다.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="bs-export">
      <h2>슬라이드를 그림으로 내보내기</h2>
      <div className="bs-print-opts">
        <label className="bs-opt"><span>파일 형식</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}><option value="png">PNG 이식 가능 네트워크 그래픽 (.png)</option><option value="jpeg">JPEG 파일 교환 형식 (.jpg)</option></select>
        </label>
        <label className="bs-opt"><span>크기</span>
          <select value={size} onChange={(e) => setSize(e.target.value)}>{EXPORT_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <label className="bs-opt"><span>내보낼 슬라이드</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="current">현재 슬라이드만</option><option value="all">모든 슬라이드 (.zip)</option><option value="range">범위 (.zip)</option></select>
        </label>
        {scope === 'range' && <label className="bs-opt"><span>슬라이드</span><input value={range} placeholder="예: 1-3, 5" aria-invalid={!!sel.error} onChange={(e) => setRange(e.target.value)} /></label>}
        {sel.error && <p className="bs-opt-err" role="alert">{sel.error}</p>}
        {scope !== 'current' && <Check label="숨겨진 슬라이드 포함" checked={hidden} onChange={setHidden} />}
        <button type="button" className="bs-print-go primary" disabled={!ready || !!busy} onClick={() => void run()}>{busy ?? (scope === 'current' ? '현재 슬라이드 저장' : `${sel.pages.length}장 저장`)}</button>
        {msg && <p className="bs-note" role="status">{msg}</p>}
        <button type="button" className="bs-link" onClick={onPdf}>PDF로 저장… (인쇄 창에서 “PDF로 저장”)</button>
      </div>
    </div>
  );
}
