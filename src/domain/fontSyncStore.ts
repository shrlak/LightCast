// The real cloud / font-store ends of fontSync.ts (the tests use fakes instead of these).
import { getMedia, putMedia, deleteMedia } from './media';
import { cloudApi } from './cloud';
import { addCloudFont, importedFontBytes, importedFonts, removeImportedFonts, updateImportedFont } from './importedFonts';
import { addCloudEmbedded, embeddedFontBytes, embeddedFontsForSync, removeEmbeddedFont, updateEmbeddedFont } from './embeddedFonts';
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
    // The fonts imported from files and the fonts that came inside .pptx files ("embfont:") are one list for the sync.
    list: () => [...importedFonts(), ...embeddedFontsForSync()],
    bytes: (f) => (f.embedded || f.id.startsWith('embfont:') ? embeddedFontBytes(f.id) : importedFontBytes(f)),
    setFields: (id, patch) => (id.startsWith('embfont:') ? updateEmbeddedFont(id, patch) : updateImportedFont(id, patch)),
    add: (entry, data, suffix) => (entry.embedded ? addCloudEmbedded(entry, data, suffix) : addCloudFont(entry, data, suffix)),
    remove: async (id) => { if (id.startsWith('embfont:')) await removeEmbeddedFont(id); else await removeImportedFonts({ id }); },
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
