import JSZip from 'jszip';
import type { Library } from '../types';
import { getMedia, putMedia } from '../media';
import { normalizeLibrary } from '../persistence';

/** Library + every media file in one .zip (online songs and Bibles stay on the server). */
export async function exportBackup(lib: Library): Promise<Blob> {
  const zip = new JSZip();
  zip.file('library.json', JSON.stringify({ ...lib, presentations: lib.presentations.filter((p) => !p.online) }, null, 2));
  for (const m of lib.media) {
    const blob = await getMedia(m.id);
    if (blob) zip.file(`media/${m.id}`, blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Restore a backup made by exportBackup. Returns the library; media is written to storage. */
export async function importBackup(file: Blob, protectedIds = new Set<string>()): Promise<Library> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const libFile = zip.file('library.json');
  if (!libFile) throw new Error('Not a LightCast backup (library.json missing)');
  const lib = normalizeLibrary(JSON.parse(await libFile.async('string')));
  if (!lib) throw new Error('library.json is not a LightCast library');
  for (const path of Object.keys(zip.files)) {
    const m = /^media\/([\w-]+)$/.exec(path);
    if (m && !protectedIds.has(m[1])) await putMedia(m[1], await zip.file(path)!.async('blob'));
  }
  return lib;
}
