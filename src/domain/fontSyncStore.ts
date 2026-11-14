// The real cloud / font-store ends of fontSync.ts (the tests use fakes instead of these).
import { getMedia, putMedia, deleteMedia } from './media';
import { cloudApi } from './cloud';
import { addCloudFont, importedFontBytes, importedFonts, removeImportedFonts, updateImportedFont } from './importedFonts';
import type { FontCloudApi, FontStoreApi } from './fontSync';

const KNOWN_KEY = 'impfont:known';

export function createFontCloud(token: string, resetId?: string): FontCloudApi {
  return {
    list: () => cloudApi.listMedia(token),
    upload: async (id, blob) => { await cloudApi.uploadMedia(token, id, blob, resetId); },
    download: (id) => cloudApi.downloadMedia(token, id),
    remove: async (id) => { await cloudApi.deleteMedia(token, id); },
  };
}

export function createFontStore(scope: string): FontStoreApi {
  return {
    list: importedFonts,
    bytes: importedFontBytes,
    setFields: updateImportedFont,
    add: addCloudFont,
    remove: async (id) => { await removeImportedFonts({ id }); },
    loadKnown: async () => {
      try {
        const b = await getMedia(KNOWN_KEY);
        const v = b ? JSON.parse(await b.text()) : null;
        return new Set<string>(v?.scope === scope && Array.isArray(v.ids) ? v.ids.filter((x: unknown) => typeof x === 'string') : []);
      } catch { return new Set<string>(); }
    },
    saveKnown: async (known) => { await putMedia(KNOWN_KEY, new Blob([JSON.stringify({ scope, ids: [...known] })], { type: 'application/json' })); },
  };
}

export const forgetKnownFonts = () => deleteMedia(KNOWN_KEY).catch(() => undefined);
