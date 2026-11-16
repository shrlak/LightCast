// 기도회 찬양 from a file on this computer (.pptx/.ppt/.odp/.pdf/pictures): the slides keep their own
// objects and format, and become the same kind of library deck the internet search makes.
import type { Presentation, Slide } from '../types';
import { uid } from '../lyrics';
import { OPENING_FOLDER, WHITE } from './openingSong';

/** A readable song title from a file name: “주를 찾는 모든 자들이.pptx” → “주를 찾는 모든 자들이”. */
export const titleFromFileName = (name: string): string =>
  name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The deck for imported slides. It lies in the same library folder as searched decks and carries a
 * `scoreSheet` mark (title + file), so next week's 기도회 찬양 with the same title finds it again.
 */
export function importedOpeningDeck(title: string, slides: Slide[], fileName: string): Presentation {
  const t = title.trim();
  return {
    id: uid('p'),
    title: t,
    slides: slides.map((s) => ({ ...s, group: s.group || t })),
    themeId: 'theme_classic',
    folder: OPENING_FOLDER,
    background: WHITE,
    scoreSheet: { title: t, file: fileName, page: '' },
  };
}
