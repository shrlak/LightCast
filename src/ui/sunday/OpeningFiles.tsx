// 기도회 찬양 from files: 파일에서 가져오기 (button or drag-and-drop) and 내려받기 (.pptx / .ppt).
import { useRef, useState, type DragEvent } from 'react';
import type { Library, MediaMeta, Presentation } from '../../domain/types';
import { importedOpeningDeck, titleFromFileName } from '../../domain/sunday/openingImport';
import { saveRestorePoint } from '../../domain/restorePoints';
import { downloadDeck, canTryPpt, type DeckFormat } from '../../domain/io/pptDownload';
import { EmbedFontsOption } from '../ppt/EmbedFontsOption';
import { IMPORT_ACCEPT, describeReport, importFilesWithSummary, isImportable, type ImportReport } from '../importSummary';

interface Args {
  title: string;
  setTitle: (t: string) => void;
  deck: Presentation | null;
  setDeck: (deck: Presentation | null) => void;
  library?: Library;
  addMedia: (m: MediaMeta) => void;
  create: (deck: Presentation) => void;
  notify: (msg: string) => void;
}

export function useOpeningFiles(a: Args) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reports, setReports] = useState<ImportReport[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const importFiles = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []).filter((f) => f.name);
    if (!files.length || busy) return;
    setBusy('파일 읽는 중…');
    try {
      if (a.library) await saveRestorePoint(a.library, 'import', Date.now(), '기도회 찬양 가져오기').catch(() => undefined);
      const { slides, reports: found } = await importFilesWithSummary(files, a.addMedia, setBusy);
      setReports(found);
      if (!slides.length) {
        a.notify(`기도회 찬양을 가져오지 못했습니다 — ${found.map(describeReport).join(' / ')}. 기존 자료는 그대로입니다.`);
        return;
      }
      const title = a.title.trim() || titleFromFileName(files.find(isImportable)?.name ?? files[0].name) || '기도회 찬양';
      const deck = importedOpeningDeck(title, slides, files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`);
      a.create(deck);
      a.setTitle(title);
      a.setDeck(deck);
      const failed = found.filter((r) => r.error).length;
      a.notify(`기도회 찬양 “${title}”: 슬라이드 ${slides.length}장을 Front 앞에 넣었습니다${failed ? ` (${failed}개 파일은 읽지 못했습니다)` : ''}`);
    } catch (e) {
      a.notify(`기도회 찬양을 가져오지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const download = async (format: DeckFormat) => {
    if (!a.deck || !a.library || busy) return;
    setBusy(format === 'ppt' ? '.ppt로 바꾸는 중…' : '.pptx 만드는 중…');
    try {
      const name = await downloadDeck(a.library, { presentation: a.deck }, a.deck.title, format);
      a.notify(`${name} 내려받았습니다`);
    } catch (e) {
      a.notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      setOver(false);
      void importFiles(e.dataTransfer.files);
    },
  };
  return { busy, reports, over, input, importFiles, download, dropProps };
}

export type OpeningFiles = ReturnType<typeof useOpeningFiles>;

/** The buttons, the per-file summary and the font option. */
export function OpeningFileTools({ files, deck, canExport, disabled }: { files: OpeningFiles; deck: Presentation | null; canExport: boolean; disabled: boolean }) {
  return (
    <div className="stack">
      <div className="row gap-s wrap">
        <button disabled={disabled || !!files.busy} onClick={() => files.input.current?.click()}>📂 파일에서 가져오기</button>
        <input ref={files.input} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => { void files.importFiles(e.target.files); e.target.value = ''; }} />
        {deck && canExport && <button disabled={!!files.busy} onClick={() => void files.download('pptx')}>⬇ 내려받기 (.pptx)</button>}
        {deck && canExport && canTryPpt() && <button disabled={!!files.busy} onClick={() => void files.download('ppt')}>⬇ 내려받기 (.ppt)</button>}
        <span className="muted small">.pptx · .ppt · .ppsx · .odp · .pdf · 그림 파일을 여기에 끌어다 놓아도 됩니다</span>
      </div>
      {deck && canExport && <EmbedFontsOption />}
      {files.busy && <div className="muted small">⏳ {files.busy}</div>}
      {files.reports.length > 0 && (
        <ul className="file-list small">
          {files.reports.map((r, i) => <li key={`${r.name}-${i}`} className={r.error ? 'warn' : ''}>{r.error ? '⚠ ' : '✓ '}{describeReport(r)}</li>)}
        </ul>
      )}
    </div>
  );
}
