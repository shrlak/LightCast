// Per-file import with a summary: every file is read on its own, so one that fails (or is read only
// approximately) is reported by name instead of silently dropping out of the combined result.
import type { MediaMeta, Slide } from '../domain/types';
import { filesToSlides, SLIDE_DECK_ACCEPT, SLIDE_DECK_FILE } from './importFiles';

/** Everything the 주일예배 file fields (and 기도회 찬양) take: every PowerPoint variant, OpenDocument, PDF and pictures. */
export const IMPORT_ACCEPT = `${SLIDE_DECK_ACCEPT},.pdf,image/*,.wmf,.emf,.svgz`;
const OTHER_FILE = /\.(pdf|wmf|emf|svgz|png|jpe?g|gif|webp|bmp|svg|avif)$/i;
export const isImportable = (f: Pick<File, 'name' | 'type'>) => SLIDE_DECK_FILE.test(f.name) || OTHER_FILE.test(f.name) || f.type.startsWith('image/') || f.type === 'application/pdf';

export interface ImportReport {
  name: string;
  slides: number;
  /** Notices that do not stop the import (approximate reading, skipped fonts). */
  warnings: string[];
  /** Why the file gave nothing; the other files were still read. */
  error?: string;
}

export interface ImportOutcome { slides: Slide[]; reports: ImportReport[] }

type Reader = typeof filesToSlides;

/** Read the files one by one. Never throws for a single bad file; check `reports` (and `slides.length`). */
export async function importFilesWithSummary(files: File[], addMedia: (m: MediaMeta) => void, onProgress?: (msg: string) => void, read: Reader = filesToSlides): Promise<ImportOutcome> {
  const slides: Slide[] = [];
  const reports: ImportReport[] = [];
  for (const file of files) {
    const warnings: string[] = [];
    if (!isImportable(file)) { reports.push({ name: file.name, slides: 0, warnings, error: '지원하지 않는 형식입니다 (PowerPoint, OpenDocument, PDF, 그림 파일만 가져올 수 있어요)' }); continue; }
    try {
      const got = await read([file], addMedia, onProgress,
        () => warnings.push('PowerPoint의 모든 요소를 그대로 읽지 못해 글과 그림 위주로 가져왔습니다 (근사치)'),
        (m) => warnings.push(m));
      if (!got.length) reports.push({ name: file.name, slides: 0, warnings, error: '슬라이드를 읽지 못했습니다' });
      else { slides.push(...got); reports.push({ name: file.name, slides: got.length, warnings }); }
    } catch (e) {
      reports.push({ name: file.name, slides: 0, warnings, error: (e as Error).message.replace(`${file.name}: `, '') });
    }
  }
  return { slides, reports };
}

/** One line per file, for a notice or the summary list. */
export function describeReport(r: ImportReport): string {
  if (r.error) return `${r.name}: 가져오지 못함 — ${r.error}`;
  return `${r.name}: 슬라이드 ${r.slides}장${r.warnings.length ? ` · ${r.warnings.join(' · ')}` : ''}`;
}
