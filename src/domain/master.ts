// View › Slide Master: objects placed on the master appear on every slide (behind the slide's own
// objects), as copies marked `master` that the slide cannot select. Format Background › Hide
// Background Graphics (`hideMaster`) leaves them off one slide.
import type { MasterLayout, Slide, SlideElement } from './types';
import { uid } from './lyrics';

export const masterCopyId = (id: string) => `master:${id}`;

/** One slide with the master's objects (re)applied. */
export function withMaster(slide: Slide, master: SlideElement[]): Slide {
  const own = (slide.elements ?? []).filter((e) => !e.master);
  const copies = slide.hideMaster ? [] : master.map((e) => ({ ...e, id: masterCopyId(e.id), master: true }));
  const elements = [...copies, ...own];
  return { ...slide, elements: elements.length ? elements : undefined };
}

export const syncMaster = (slides: Slide[], master: SlideElement[]): Slide[] => slides.map((s) => withMaster(s, master));

/** What a placeholder says while it is empty. */
export const PLACEHOLDER_PROMPT: Record<NonNullable<SlideElement['placeholder']>, string> = {
  title: '제목을 입력하려면 클릭하십시오', body: '텍스트를 입력하려면 클릭하십시오', text: '텍스트를 입력하려면 클릭하십시오', picture: '그림을 추가하려면 클릭하십시오',
};

/** A placeholder of each kind, as Slide Master › Insert Placeholder places it. */
export function makePlaceholder(kind: NonNullable<SlideElement['placeholder']>): SlideElement {
  const id = uid('el');
  if (kind === 'title') return { id, kind: 'text', placeholder: 'title', text: '', x: 90, y: 60, w: 1260, h: 170, fontSize: 88, bold: true, color: '#ffffff', align: 'center', autoFit: false };
  if (kind === 'picture') return { id, kind: 'shape', shape: 'rect', placeholder: 'picture', x: 360, y: 280, w: 720, h: 540, fill: 'transparent', stroke: '#9aa0a6', strokeWidth: 3, dash: 'dash' };
  return { id, kind: 'text', placeholder: kind, text: '', x: 90, y: 270, w: 1260, h: 700, fontSize: 56, color: '#ffffff', align: 'left', vAlign: 'top', list: kind === 'body' ? 'bullet' : undefined, autoFit: false };
}

/** A new slide from a layout: the layout's placeholders become the slide's own objects. */
export function slideFromLayout(layout: MasterLayout, group: string, master: SlideElement[] = []): Slide {
  const slide: Slide = { id: uid('s'), group, text: '', layoutId: layout.id, elements: layout.elements.map((e) => ({ ...e, id: uid('el') })) };
  return master.length ? withMaster(slide, master) : slide;
}

/** Slide Master's default layouts (PowerPoint's first ones). */
export function defaultLayouts(): MasterLayout[] {
  return [
    { id: uid('ly'), name: '제목 슬라이드', elements: [{ ...makePlaceholder('title'), y: 300, h: 220, fontSize: 100 }, { ...makePlaceholder('text'), y: 560, h: 160, fontSize: 48, align: 'center', vAlign: 'top' }] },
    { id: uid('ly'), name: '제목 및 내용', elements: [makePlaceholder('title'), makePlaceholder('body')] },
    { id: uid('ly'), name: '구역 머리글', elements: [{ ...makePlaceholder('title'), y: 420, h: 200, align: 'left' }] },
    { id: uid('ly'), name: '그림 및 캡션', elements: [{ ...makePlaceholder('picture'), x: 90, y: 90, w: 820, h: 900 }, { ...makePlaceholder('title'), x: 960, y: 120, w: 400, h: 220, fontSize: 56, align: 'left' }, { ...makePlaceholder('text'), x: 960, y: 380, w: 400, h: 560, fontSize: 36 }] },
    { id: uid('ly'), name: '제목만', elements: [makePlaceholder('title')] },
  ];
}
