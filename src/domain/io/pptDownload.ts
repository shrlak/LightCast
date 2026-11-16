// 내려받기: a deck or playlist as .pptx (always) or legacy .ppt (desktop app with PowerPoint or LibreOffice).
import type { Library, Playlist, Presentation } from '../types';
import { desktop as realDesktop, type DesktopBridge } from '../desktop';
import { exportPptxBytes } from './pptxExport';

export type DeckFormat = 'pptx' | 'ppt';
export type DeckSource = { playlist: Playlist } | { presentation: Presentation };

export const NO_PPT_CONVERTER = '.ppt로 바꾸려면 이 컴퓨터에 PowerPoint 또는 LibreOffice가 설치되어 있어야 합니다. 설치한 뒤 다시 시도하거나 .pptx로 내려받으세요 (PowerPoint에서 열어 .ppt로 저장할 수 있습니다).';
export const PPT_DESKTOP_ONLY = '.ppt 내려받기는 데스크톱 앱에서만 됩니다. 지금은 .pptx로 내려받아 주세요.';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PPT_MIME = 'application/vnd.ms-powerpoint';

type Bridge = Pick<DesktopBridge, 'pptxToPpt'> | undefined;

/** Whether this build can even try .ppt (the desktop app; the browser offers .pptx only). */
export const canTryPpt = (bridge: Bridge = realDesktop): boolean => typeof bridge?.pptxToPpt === 'function';

export const safeFileName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\.(pptx?|ppsx?)$/i, '').trim() || 'LightCast';

/** The file's bytes in the wanted format. Throws a Korean message when .ppt cannot be made. */
export async function deckBytes(
  lib: Library, source: DeckSource, format: DeckFormat,
  bridge: Bridge = realDesktop,
  build: (lib: Library, source: DeckSource) => Promise<Uint8Array> = exportPptxBytes,
): Promise<Uint8Array> {
  if (format === 'ppt' && !canTryPpt(bridge)) throw new Error(PPT_DESKTOP_ONLY);
  const pptx = await build(lib, source);
  if (format === 'pptx') return pptx;
  const ppt = await bridge!.pptxToPpt!(pptx).catch(() => null);
  if (!ppt) throw new Error(NO_PPT_CONVERTER);
  return new Uint8Array(ppt);
}

/** Hand bytes to the browser as a file download. */
export function saveDownload(name: string, bytes: Uint8Array, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Build and download; returns the file name written. */
export async function downloadDeck(lib: Library, source: DeckSource, title: string, format: DeckFormat): Promise<string> {
  const bytes = await deckBytes(lib, source, format);
  const name = `${safeFileName(title)}.${format}`;
  saveDownload(name, bytes, format === 'pptx' ? PPTX_MIME : PPT_MIME);
  return name;
}
