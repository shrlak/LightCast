// View › Slide Master: objects placed on the master appear on every slide (behind the slide's own
// objects), as copies marked `master` that the slide cannot select. Format Background › Hide
// Background Graphics (`hideMaster`) leaves them off one slide.
import type { Background, MasterLayout, Slide, SlideElement } from './types';
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

/**
 * Design › Background Styles (DeckCraft design.background `style` 1..12): the theme's three
 * background fills (plain, soft gradient, strong gradient) in each of its four background colours
 * (Background 1, Background 2, Text 2, Text 1). `colors` is the scheme: dk1, lt1, dk2, lt2, accent1…
 */
export function backgroundStyle(style: number, colors: string[]): Background | null {
  if (style < 1 || style > 12 || colors.length < 4) return null;
  const i = style - 1;
  const base = [colors[1], colors[3], colors[2], colors[0]][i % 4];
  const fill = Math.floor(i / 4);
  if (fill === 0) return { kind: 'color', value: base };
  const shade = (pct: number) => `color-mix(in srgb, ${base} ${pct}%, ${fill === 1 ? 'white' : 'black'})`;
  return { kind: 'gradient', value: fill === 1 ? `linear-gradient(180deg, ${base} 0%, ${shade(80)} 55%, ${shade(55)} 100%)` : `radial-gradient(ellipse at 50% 40%, ${shade(75)} 0%, ${base} 55%, ${shade(45)} 100%)` };
}

const isEmptyPlaceholder = (e: SlideElement) => !!e.placeholder && !e.text?.trim() && !e.paragraphs?.some((p) => p.text.trim());

/**
 * Home › Layout (DeckCraft slide.layout / apply_layout): the slide's placeholders move onto the
 * layout's. Each layout placeholder takes the slide's placeholder of the same kind (a title takes
 * the title) keeping its text, else a fresh empty one; a leftover placeholder with content stays
 * where it was, an empty one goes. The slide's other objects are untouched.
 */
export function applyLayout(slide: Slide, layout: MasterLayout, master: SlideElement[] = []): Slide {
  const own = (slide.elements ?? []).filter((e) => !e.master);
  const old = own.filter((e) => e.placeholder);
  const taken = new Set<string>();
  const placed: SlideElement[] = layout.elements.filter((l) => l.placeholder).map((l) => {
    const sameKind = old.find((o) => !taken.has(o.id) && o.placeholder === l.placeholder);
    // A text-like placeholder takes another text-like one when its own kind is not there.
    const alike = old.find((o) => !taken.has(o.id) && (o.placeholder === 'title') === (l.placeholder === 'title') && o.placeholder !== 'picture' && l.placeholder !== 'picture');
    const from = sameKind ?? alike;
    if (!from) return { ...l, id: uid('el') };
    taken.add(from.id);
    // The content stays, the box and look come from the layout.
    return { ...l, id: from.id, text: from.text, paragraphs: from.paragraphs, runs: from.runs, mediaId: from.mediaId, fillImage: from.fillImage };
  });
  const rest = own.filter((e) => !e.placeholder || (!taken.has(e.id) && !isEmptyPlaceholder(e)));
  const next: Slide = { ...slide, layoutId: layout.id, elements: [...placed, ...rest] };
  return master.length ? withMaster(next, master) : { ...next, elements: next.elements?.length ? next.elements : undefined };
}

/**
 * Home › Reset: placeholders back to the slide's layout box and look (their text stays), the
 * slide's own background and font settings cleared (DeckCraft slide.reset). Without a layout only
 * the slide-level settings reset.
 */
export function resetSlide(slide: Slide, layouts: MasterLayout[] = [], master: SlideElement[] = []): Slide {
  const base: Slide = { ...slide, style: undefined, transition: undefined, preferredFontSize: undefined, background: undefined };
  const layout = layouts.find((l) => l.id === slide.layoutId);
  return layout ? applyLayout(base, layout, master) : base;
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
