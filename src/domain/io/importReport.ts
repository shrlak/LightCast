// What an imported PowerPoint file held and what became of each kind of component: brought over as it
// was, approximated (kept but drawn or behaving differently), or left out. Shown in Korean after an
// import and kept on the slides (importSource.warnings), so nothing is dropped silently.

export type ReportStatus = 'converted' | 'approximated' | 'dropped';

export interface ReportItem {
  /** Korean name of the component (차트, SmartArt, 동영상 …). */
  label: string;
  status: ReportStatus;
  count: number;
  /** 1-based slide numbers it was found on (empty: the whole file). */
  slides: number[];
  /** Korean detail: how it was approximated or why it was left out. */
  detail?: string;
}

export interface ImportReport {
  file: string;
  slideCount: number;
  items: ReportItem[];
}

export function newReport(file: string): ImportReport {
  return { file, slideCount: 0, items: [] };
}

/** Count one component on a slide (0: the whole file). Items with the same label, status and detail are merged. */
export function note(r: ImportReport, label: string, status: ReportStatus, slide = 0, detail?: string, count = 1): void {
  if (count <= 0) return;
  let item = r.items.find((i) => i.label === label && i.status === status && i.detail === detail);
  if (!item) { item = { label, status, count: 0, slides: [], ...(detail ? { detail } : {}) }; r.items.push(item); }
  item.count += count;
  if (slide > 0 && !item.slides.includes(slide)) item.slides.push(slide);
}

const VERB: Record<ReportStatus, string> = { converted: '가져왔습니다', approximated: '비슷하게 가져왔습니다', dropped: '가져오지 못했습니다' };

const slideList = (s: number[]) => (s.length ? ` (슬라이드 ${s.slice(0, 6).join(', ')}${s.length > 6 ? ' …' : ''})` : '');

/** One Korean sentence per item, e.g. "차트 2개를 편집 가능한 차트로 가져왔습니다 (슬라이드 3, 4)". */
export function reportLines(r: ImportReport, statuses: ReportStatus[] = ['approximated', 'dropped', 'converted']): string[] {
  const order: Record<ReportStatus, number> = { dropped: 0, approximated: 1, converted: 2 };
  return r.items
    .filter((i) => statuses.includes(i.status))
    .sort((a, b) => order[a.status] - order[b.status])
    .map((i) => `${i.label} ${i.count}개를 ${i.detail ? `${i.detail} ` : ''}${VERB[i.status]}${slideList(i.slides)}`);
}

/** Lines about one slide (for importSource.warnings): only what was approximated or left out there. */
export function slideWarnings(r: ImportReport, slide: number): string[] {
  return r.items
    .filter((i) => i.status !== 'converted' && i.slides.includes(slide))
    .map((i) => `${i.label}: ${i.detail ? `${i.detail} ` : ''}${VERB[i.status]}`);
}

/** A short toast: the slide count, then what was approximated or left out (or that everything came over). */
export function reportSummary(r: ImportReport): string {
  const bad = r.items.filter((i) => i.status !== 'converted');
  const head = `${r.file}: 슬라이드 ${r.slideCount}개를 가져왔습니다.`;
  if (!bad.length) return `${head} 빠진 구성 요소가 없습니다.`;
  const parts = bad.slice(0, 3).map((i) => `${i.label} ${i.count}개 ${i.status === 'dropped' ? '제외' : '근사'}`);
  return `${head} ${parts.join(', ')}${bad.length > 3 ? ` 외 ${bad.length - 3}건` : ''} — 자세한 내용은 가져오기 보고서를 확인하세요.`;
}
