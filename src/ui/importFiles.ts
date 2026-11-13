import type { MediaMeta, Slide } from '../domain/types';
import { putMedia } from '../domain/media';
import { uid } from '../domain/lyrics';
import { importPptx } from '../domain/io/pptxImport';
import { parseOdp } from '../domain/io/odp';
import { importPpt } from '../domain/io/pptImport';
import { renderPdf } from '../domain/io/pdf';
import { desktop } from '../domain/desktop';
import { pptxSlides } from '../domain/templates/serviceTemplates';

async function storeImage(blob: Blob, name: string, addMedia: (m: MediaMeta) => void): Promise<string> {
  const id = uid('m');
  await putMedia(id, blob);
  addMedia({ id, name, type: 'image' });
  return id;
}

const imageSlide = (mediaId: string, group: string): Slide => ({
  id: uid('s'), group, text: '', background: { kind: 'media', mediaId, mediaType: 'image', fit: 'contain' },
});

/**
 * Turn PPTX, PDF and image files into slides, in the order given:
 * PDF → read-only pages; image → one slide; PPTX/PPT → editable objects, plus notes.
 */
export async function filesToSlides(files: File[], addMedia: (m: MediaMeta) => void, onProgress?: (msg: string) => void, onApprox?: (fileName: string) => void): Promise<Slide[]> {
  const slides: Slide[] = [];
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, '');
    if (/\.pptx?$/i.test(file.name)) {
      const format = /\.ppt$/i.test(file.name) ? 'ppt' : 'pptx';
      const addPptMedia = (m: MediaMeta) => addMedia({ ...m, backgroundHidden: true });
      onProgress?.(`편집 가능한 슬라이드 읽는 중: ${file.name}…`);
      let data = await file.arrayBuffer();
      if (format === 'ppt') {
        onProgress?.(`PPT를 편집 가능한 PPTX로 변환 중: ${file.name}…`);
        const converted = await desktop?.pptToPptx?.(new Uint8Array(data)).catch(() => null);
        if (!converted) {
          // No PowerPoint / LibreOffice to convert with (or a browser): LightCast's own reader takes the text, notes and pictures.
          onProgress?.(`PPT에서 텍스트와 그림 읽는 중: ${file.name}…`);
          const result = await importPpt(new Uint8Array(data), file.name, {
            group: base, newId: uid,
            store: async (pic, name) => {
              const id = uid('m');
              await putMedia(id, new Blob([pic.bytes as BlobPart], { type: pic.mime }));
              addPptMedia({ id, name, type: 'image' });
              return id;
            },
          });
          if (!result.slides.length) throw new Error(`${file.name}: ${result.warnings[0] ?? '슬라이드를 읽지 못했습니다.'} 구형 PPT 변환에는 데스크톱 앱과 PowerPoint 또는 LibreOffice가 필요합니다. 설치 후 다시 가져오거나 PowerPoint에서 PPTX로 저장해 주세요. 기존 자료는 유지됩니다.`);
          onApprox?.(file.name);
          slides.push(...result.slides);
          continue;
        }
        data = new Uint8Array(converted).buffer;
      }
      const imported = await importPptx(new Blob([data])).catch(() => []);
      // Keep source objects editable on every platform; never flatten PowerPoint into PDF pages.
      let n = 0;
      // Every picture, box and text of the slide becomes its own object at the same place, size and
      // order, so it looks and plays like the PowerPoint slide and can still be edited.
      const faithful = await pptxSlides(data, {
        group: () => base,
        mediaId: () => uid('m'),
        store: async (id, blob) => {
          await putMedia(id, blob);
          addPptMedia({ id, name: `${base} ${++n}`, type: 'image' });
        },
      }).catch(() => []);
      if (faithful.length) {
        // Speaker notes come from the plain reader when it sees the same slides (a title would draw the text twice).
        faithful.forEach((s, i) => slides.push({ ...s, importSource: { format, name: file.name, page: i + 1 }, notes: imported.length === faithful.length ? imported[i].notes : undefined }));
        continue;
      }
      if (!imported.length) throw new Error(`${file.name}: 슬라이드를 읽지 못했습니다. 기존 자료는 유지됩니다.`);
      onApprox?.(file.name);
      for (const [i, s] of imported.entries()) {
        const mediaId = s.image ? await storeImage(s.image, `${base} ${i + 1}`, addPptMedia) : undefined;
        slides.push({
          id: uid('s'), importSource: { format, name: file.name, page: i + 1 }, group: base, title: s.title, text: s.text, notes: s.notes,
          background: mediaId ? { kind: 'media', mediaId, mediaType: 'image', fit: 'contain' } : undefined,
        });
      }
    } else if (/\.odp$/i.test(file.name)) {
      onProgress?.(`OpenDocument 슬라이드 읽는 중: ${file.name}…`);
      const doc = await parseOdp(file, { storeImage: (bytes, mime, name) => storeImage(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mime }), name, (m) => addMedia({ ...m, backgroundHidden: true })) })
        .catch((e: Error) => { throw new Error(`${file.name}: ${e.message} 기존 자료는 유지됩니다.`); });
      if (!doc.slides.length) throw new Error(`${file.name}: 슬라이드를 읽지 못했습니다. 기존 자료는 유지됩니다.`);
      doc.slides.forEach((s) => slides.push({ ...s, group: base }));
    } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      onProgress?.(`Rendering ${file.name}…`);
      for (const page of await renderPdf(file, { scale: 2.5, quality: 0.95 })) {
        slides.push({ ...imageSlide(await storeImage(page.blob, `${base} p${page.page}`, (m) => addMedia({ ...m, backgroundHidden: true })), base), importSource: { format: 'pdf', name: file.name, page: page.page } });
      }
    } else if (file.type.startsWith('image/')) {
      slides.push(imageSlide(await storeImage(file, file.name, addMedia), base));
    }
  }
  return slides;
}
