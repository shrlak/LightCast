/** File name for a PDF export: the presentation's title (characters a file name cannot hold removed) plus what was exported. */
const SUFFIX = { slides: '', handout: ' 유인물', notes: ' 노트' } as const;

export function pdfFileName(title: string | undefined, mode: keyof typeof SUFFIX): string {
  const base = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'LightCast';
  return `${base}${SUFFIX[mode]}.pdf`;
}
