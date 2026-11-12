// Browser side of the 기도회 찬양 search: ask the local server for "<제목> ppt" files, download one,
// and turn it into white sheet-music slides (see openingSong.ts for the rules).
import type { MediaMeta, Presentation } from '../types';
import { renderPptxSlides, revokeRenderedSlides } from '../io/pptxRender';
import { putMedia } from '../media';
import { desktop } from '../desktop';
import { uid } from '../lyrics';
import { applyInkFix, AUTO_PICK, inkFix, openingDeck, scorePages, scoreSlides, type ScorePicture, type SongPptCandidate } from './openingSong';

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/** PowerPoint files on the internet for this song, best match first. */
export async function searchSongPpt(title: string): Promise<SongPptCandidate[]> {
  const res = await fetch(`/api/song-ppt/search?title=${encodeURIComponent(title)}`).catch(() => {
    throw new Error('LightCast 서버에 연결할 수 없습니다 — 데스크톱 앱(또는 npm start)에서 사용해 주세요');
  });
  return (await json<{ candidates: SongPptCandidate[] }>(res)).candidates;
}

/** The file's bytes as a .pptx (an old .ppt is converted by PowerPoint / LibreOffice on the desktop app). */
async function downloadPptx(c: SongPptCandidate): Promise<ArrayBuffer> {
  const res = await fetch(`/api/song-ppt/file?url=${encodeURIComponent(c.url)}`);
  if (!res.ok) await json(res);
  const data = await res.arrayBuffer();
  if (res.headers.get('x-ppt-format') !== 'ppt') return data;
  const converted = await desktop?.pptToPptx?.(new Uint8Array(data)).catch(() => null);
  if (!converted) throw new Error('구형 .ppt 파일이라 PowerPoint 또는 LibreOffice가 있는 데스크톱 앱에서만 열 수 있습니다');
  return new Uint8Array(converted).buffer;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('그림을 읽지 못했습니다'));
    img.src = url;
  });
}

/** The visible, cropped part of a picture as a PNG, made readable on white. */
async function pictureOnWhite(p: ScorePicture): Promise<Blob> {
  const img = await loadImage(p.imageUrl);
  const c = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const sx = c.l * img.naturalWidth, sy = c.t * img.naturalHeight;
  const sw = Math.max(1, img.naturalWidth * (1 - c.l - c.r)), sh = Math.max(1, img.naturalHeight * (1 - c.t - c.b));
  const k = Math.min(1, 2400 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const fix = inkFix(pixels.data);
  if (fix !== 'none') {
    applyInkFix(pixels.data, fix);
    ctx.putImageData(pixels, 0, 0);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그림을 저장하지 못했습니다'))), 'image/png'));
}

/** A downloaded deck → white sheet-music slides; each picture is stored once as media. */
export async function sheetMusicDeck(title: string, data: ArrayBuffer, file: SongPptCandidate, addMedia: (m: MediaMeta) => void): Promise<Presentation> {
  const rendered = await renderPptxSlides(data);
  try {
    const pages = scorePages(rendered);
    if (!pages.length) throw new Error('악보 그림이 없는 PPT입니다');
    const stored = new Map<string, string>();
    let n = 0;
    const out: { index: number; mediaIds: string[]; boxes: ScorePicture['box'][] }[] = [];
    for (const page of pages) {
      const mediaIds: string[] = [];
      for (const pic of page.pictures) {
        const key = `${pic.imageUrl}|${pic.crop ? Object.values(pic.crop).map((v) => v.toFixed(4)).join(',') : ''}`;
        let id = stored.get(key);
        if (!id) {
          id = uid('m');
          await putMedia(id, await pictureOnWhite(pic));
          addMedia({ id, name: `${title} 악보 ${++n}`, type: 'image', backgroundHidden: true });
          stored.set(key, id);
        }
        mediaIds.push(id);
      }
      out.push({ index: page.index, mediaIds, boxes: page.pictures.map((p) => p.box) });
    }
    return openingDeck(title, scoreSlides(out, title, file), file);
  } finally {
    revokeRenderedSlides(rendered);
  }
}

export interface OpeningSongResult {
  deck: Presentation;
  file: SongPptCandidate;
  candidates: SongPptCandidate[];
}

/**
 * Find and build the 기도회 찬양: search, then try the candidates best first until one gives sheet
 * music (`pick` forces one file). Only files that match the title well are tried automatically.
 */
export async function fetchOpeningSong(
  title: string,
  opts: { addMedia: (m: MediaMeta) => void; progress?: (msg: string) => void; pick?: SongPptCandidate; candidates?: SongPptCandidate[] },
): Promise<OpeningSongResult> {
  opts.progress?.(`인터넷에서 “${title} ppt” 찾는 중…`);
  const candidates = opts.candidates ?? (await searchSongPpt(title));
  const tries = opts.pick ? [opts.pick] : candidates.filter((c) => c.score >= AUTO_PICK).slice(0, 5);
  if (!tries.length) {
    throw new Error(candidates.length
      ? `“${title}”과 이름이 맞는 PPT를 찾지 못했습니다 — 아래 목록에서 직접 골라 주세요`
      : `“${title} ppt” 검색에서 PPT 파일을 찾지 못했습니다 — 제목을 확인해 주세요`);
  }
  const errors: string[] = [];
  for (const file of tries) {
    try {
      opts.progress?.(`내려받는 중: ${file.name}`);
      const data = await downloadPptx(file);
      opts.progress?.(`악보만 남기는 중: ${file.name}`);
      return { deck: await sheetMusicDeck(title, data, file, opts.addMedia), file, candidates };
    } catch (e) {
      errors.push(`${file.name}: ${(e as Error).message}`);
    }
  }
  throw Object.assign(new Error(`PPT를 가져오지 못했습니다 — ${errors.join(' · ')}`), { candidates });
}
