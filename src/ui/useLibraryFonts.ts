// Every font the library uses, on every computer: shortly after LightCast opens (and every ten minutes, for decks that
// arrive from other devices), the families the whole library names are checked. Fonts installed on this computer are
// shared through the church server (installedFonts.ts); fonts this computer lacks are found on the internet (Google
// Fonts · Fontsource · Pretendard, webFonts.ts) and downloaded. Both are kept like imported fonts, so font sync uploads
// them and every computer signed in draws the same letters. Only free fonts are downloaded; the rest are listed.
import { useEffect, useRef } from 'react';
import type { Library } from '../domain/types';
import { usedFamilies } from '../domain/io/pptxFonts';
import { missingFamilies } from '../domain/importedFonts';
import { FONT_OPTIONS } from '../domain/fonts';
import { familiesToShare, shareInstalledFonts } from '../domain/installedFonts';
import { fetchMissingWebFonts, loadAutoWebFonts, webFontSummary, webFontTried } from '../domain/webFonts';

const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 10 * 60_000;

/** The families the library's own presentations name (online songs use the church defaults). */
export const libraryFamilies = (lib: Library): string[] => usedFamilies(lib.presentations.filter((p) => !p.online).map((p) => ({ slides: p.slides, master: p.master, fontScheme: p.fontScheme, defaultShape: p.defaultShape })));

export function useLibraryFonts(library: Library, notify: (m: string) => void) {
  const lib = useRef(library); lib.current = library;
  const say = useRef(notify); say.current = notify;
  useEffect(() => {
    let running = false;
    let shared = new Set<string>();
    const check = async () => {
      if (running) return;
      running = true;
      try {
        await (document.fonts?.ready ?? Promise.resolve());
        const used = libraryFamilies(lib.current);
        const fresh = familiesToShare(used).filter((f) => !shared.has(f));
        if (fresh.length) {
          shared = new Set([...shared, ...fresh]);
          await shareInstalledFonts(fresh, '라이브러리');
        }
        if (!loadAutoWebFonts()) return;
        const own = FONT_OPTIONS.flatMap((o) => [o.label, o.pptx]);
        const missing = missingFamilies(used, own).filter((f) => !webFontTried(f));
        if (!missing.length) return;
        const results = await fetchMissingWebFonts(missing);
        if (results.some((r) => r.added.length)) say.current(webFontSummary(results));
      } catch { /* tried again at the next check */ } finally { running = false; }
    };
    const first = setTimeout(() => void check(), FIRST_CHECK_MS);
    const every = setInterval(() => { if (!document.hidden) void check(); }, CHECK_EVERY_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
}
