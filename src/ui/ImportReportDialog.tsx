import { useEffect, useRef } from 'react';
import type { ImportReport, ReportStatus } from '../domain/io/importReport';
import { reportLines } from '../domain/io/importReport';

const HEAD: Record<ReportStatus, string> = { dropped: '가져오지 못한 것', approximated: '비슷하게 가져온 것', converted: '그대로 가져온 것' };

/** 가져오기 보고서: per imported PowerPoint file, what was left out, approximated and brought over as it was. */
export function ImportReportDialog({ reports, onClose }: { reports: ImportReport[]; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal name-dialog" role="dialog" aria-modal="true" aria-label="가져오기 보고서" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <header className="modal-head"><h2>가져오기 보고서</h2><button type="button" onClick={onClose} aria-label="닫기">✕</button></header>
      <div className="wizard-body stack" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {reports.map((r) => (
          <section key={r.file} className="stack">
            <h3>{r.file} · 슬라이드 {r.slideCount}개</h3>
            {(['dropped', 'approximated', 'converted'] as const).map((st) => {
              const lines = reportLines(r, [st]);
              return lines.length ? <div key={st}><strong>{HEAD[st]}</strong><ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul></div> : null;
            })}
          </section>
        ))}
        <p>각 슬라이드의 차이는 슬라이드 정보(가져온 원본)에도 남아 있습니다.</p>
        <div className="row"><button ref={close} className="primary" type="button" onClick={onClose}>확인</button></div>
      </div>
    </div>
  </div>;
}
