/**
 * 슬라이드 쇼 › 쇼 설정 in a PowerPoint file: `ppt/presProps.xml` › `p:showPr` (반복, 내레이션 재생, 애니메이션 없이,
 * 타이밍 사용) and PowerPoint 2010's `p14:showMediaCtrls` (미디어 컨트롤 표시). Read on import, written on export.
 */
import type { Presentation } from '../types';

export interface ShowSettings { loop?: true; showSetup?: Presentation['showSetup'] }

const MEDIA_CTRLS_URI = '{2FDB2607-1784-4EEB-B798-7EB5836EED8A}';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const off = (v: string | undefined) => v === '0' || v === 'false';
const on = (v: string | undefined) => v === '1' || v === 'true';

/** The show settings in presProps.xml (only what differs from LightCast's defaults). */
export function readShowPr(xml: string): ShowSettings {
  const m = /<(?:\w+:)?showPr\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?showPr>)/.exec(xml);
  if (!m) return {};
  const tag = `<showPr${m[1]}>`, body = m[3] ?? '';
  const setup: NonNullable<Presentation['showSetup']> = {};
  // The schema's defaults: showAnimation and useTimings on. Narration is only turned off when the file says so.
  if (off(attr(tag, 'showNarration'))) setup.noNarration = true;
  if (off(attr(tag, 'showAnimation'))) setup.noAnimation = true;
  if (off(attr(tag, 'useTimings'))) setup.manual = true;
  const ctrl = /<(?:\w+:)?showMediaCtrls\b[^>]*>/.exec(body)?.[0];
  if (ctrl && off(attr(ctrl, 'val'))) setup.noMediaControls = true;
  return { ...(on(attr(tag, 'loop')) ? { loop: true as const } : {}), ...(Object.keys(setup).length ? { showSetup: setup } : {}) };
}

/** `p:showPr` for a presentation's show settings. */
export function showPrXml(p: Pick<Presentation, 'loop' | 'showSetup'>): string {
  const s = p.showSetup ?? {};
  const attrs = [p.loop ? ' loop="1"' : '', ` showNarration="${s.noNarration ? 0 : 1}"`, s.noAnimation ? ' showAnimation="0"' : '', s.manual ? ' useTimings="0"' : ''].join('');
  return `<p:showPr${attrs}><p:present/><p:sldAll/><p:extLst><p:ext uri="${MEDIA_CTRLS_URI}"><p14:showMediaCtrls xmlns:p14="${P14}" val="${s.noMediaControls ? 0 : 1}"/></p:ext></p:extLst></p:showPr>`;
}

/** presProps.xml with its `p:showPr` replaced by the presentation's (in the schema's place: before clrMru and extLst). */
export function writeShowPr(xml: string, p: Pick<Presentation, 'loop' | 'showSetup'>): string {
  const show = showPrXml(p);
  const without = xml.replace(/<p:showPr\b[^>]*?(?:\/>|>[\s\S]*?<\/p:showPr>)/, '');
  // An empty presentationPr (as PptxGenJS writes it) gets a body.
  if (/<p:presentationPr\b[^>]*\/>/.test(without)) return without.replace(/<p:presentationPr\b([^>]*)\/>/, `<p:presentationPr$1>${show}</p:presentationPr>`);
  const at = [without.indexOf('<p:clrMru'), without.lastIndexOf('<p:extLst'), without.indexOf('</p:presentationPr>')].filter((i) => i >= 0);
  if (!at.length) return without;
  const i = Math.min(...at);
  return without.slice(0, i) + show + without.slice(i);
}

/** The show settings of a PowerPoint file's bytes (none when it cannot be read, e.g. encrypted). */
export async function readShowSettings(data: ArrayBuffer | Uint8Array): Promise<ShowSettings> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(data);
    const xml = await zip.file('ppt/presProps.xml')?.async('string');
    return xml ? readShowPr(xml) : {};
  } catch {
    return {};
  }
}
