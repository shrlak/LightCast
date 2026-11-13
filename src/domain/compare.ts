// Review › Compare (DeckCraft review.accept): the differences between this presentation and another
// version of it, as revisions that can be accepted one by one (or all) into this one.
import type { Presentation, Slide, SlideElement } from './types';
import { matchSlides } from './slideMatch';

export type Revision =
  | { id: string; kind: 'slideInsert'; slide: Slide; after: string | null; label: string }
  | { id: string; kind: 'slideDelete'; slideId: string; label: string }
  | { id: string; kind: 'field'; slideId: string; field: 'title' | 'text' | 'subtext' | 'notes'; to: string | undefined; label: string }
  | { id: string; kind: 'elementInsert'; slideId: string; element: SlideElement; label: string }
  | { id: string; kind: 'elementDelete'; slideId: string; elementId: string; label: string }
  | { id: string; kind: 'element'; slideId: string; element: SlideElement; label: string };

const name = (s: Slide, i: number) => `슬라이드 ${i + 1}${s.title ? ` (${s.title.slice(0, 20)})` : ''}`;
const FIELD = { title: '제목', text: '본문', subtext: '둘째 줄', notes: '슬라이드 노트' } as const;
const KIND: Record<string, string> = { text: '텍스트 상자', shape: '도형', image: '그림', table: '표', chart: '차트', video: '비디오', audio: '오디오', icon: '아이콘', ink: '잉크', zoom: '확대/축소', qr: 'QR 코드', camera: '카메라' };

function elementChange(a: SlideElement, b: SlideElement): string | null {
  const strip = ({ x, y, w, h, rotation, text, runs, paragraphs, ...rest }: SlideElement) => ({ rest, x, y, w, h, rotation, text, runs, paragraphs });
  const A = strip(a), B = strip(b);
  const parts: string[] = [];
  if ((A.text ?? '') !== (B.text ?? '')) parts.push('텍스트');
  if (A.x !== B.x || A.y !== B.y) parts.push('이동');
  if (A.w !== B.w || A.h !== B.h) parts.push('크기');
  if ((A.rotation ?? 0) !== (B.rotation ?? 0)) parts.push('회전');
  if (JSON.stringify(A.rest) !== JSON.stringify(B.rest) || JSON.stringify(A.runs) !== JSON.stringify(B.runs) || JSON.stringify(A.paragraphs?.map(({ text: _t, ...p }) => p)) !== JSON.stringify(B.paragraphs?.map(({ text: _t, ...p }) => p))) parts.push('서식');
  return parts.length ? parts.join(', ') : null;
}

/** What `other` has that `mine` does not: slides matched by id, then import source, then text, then (if nothing lines up) by position. */
export function compare(mine: Presentation, other: Presentation): Revision[] {
  const out: Revision[] = [];
  const used = new Set<string>();
  // Slides line up by id, then (a presentation re-imported from the same file) by import source, then by title and text;
  // when nothing lines up at all, by position.
  const found = new Map(matchSlides(mine.slides, other.slides).map((x) => [x.old, x.cur]));
  const pairs: [Slide | null, Slide, number][] = other.slides.map((o, i) => {
    const at = found.size ? found.get(i) : i;
    const m = at === undefined ? null : mine.slides[at] ?? null;
    if (m) used.add(m.id);
    return [m, o, i];
  });
  pairs.forEach(([m, o, i]) => {
    if (!m) {
      out.push({ id: `ins-${o.id}-${i}`, kind: 'slideInsert', slide: o, after: i > 0 ? (pairs[i - 1][0]?.id ?? pairs[i - 1][1].id) : null, label: `${name(o, i)} 삽입됨` });
      return;
    }
    for (const f of ['title', 'text', 'subtext', 'notes'] as const) {
      if ((m[f] ?? '') !== (o[f] ?? '')) out.push({ id: `f-${m.id}-${f}`, kind: 'field', slideId: m.id, field: f, to: o[f], label: `${name(o, i)}: ${FIELD[f]} 변경 → “${(o[f] ?? '').slice(0, 30)}”` });
    }
    const mineEls = new Map((m.elements ?? []).filter((e) => !e.master).map((e) => [e.id, e]));
    const otherEls = (o.elements ?? []).filter((e) => !e.master);
    for (const e of otherEls) {
      const had = mineEls.get(e.id);
      if (!had) out.push({ id: `ei-${m.id}-${e.id}`, kind: 'elementInsert', slideId: m.id, element: e, label: `${name(o, i)}: ${KIND[e.kind] ?? '개체'} 삽입됨` });
      else {
        const what = elementChange(had, e);
        if (what) out.push({ id: `e-${m.id}-${e.id}`, kind: 'element', slideId: m.id, element: e, label: `${name(o, i)}: ${e.name ?? KIND[e.kind] ?? '개체'} — ${what}` });
      }
    }
    for (const e of mineEls.values()) if (!otherEls.some((x) => x.id === e.id)) out.push({ id: `ed-${m.id}-${e.id}`, kind: 'elementDelete', slideId: m.id, elementId: e.id, label: `${name(m, mine.slides.indexOf(m))}: ${e.name ?? KIND[e.kind] ?? '개체'} 삭제됨` });
  });
  mine.slides.forEach((s, i) => { if (!used.has(s.id)) out.push({ id: `del-${s.id}`, kind: 'slideDelete', slideId: s.id, label: `${name(s, i)} 삭제됨` }); });
  return out;
}

/** This presentation's slides with one revision accepted. */
export function accept(slides: Slide[], r: Revision): Slide[] {
  switch (r.kind) {
    case 'slideInsert': {
      if (slides.some((s) => s.id === r.slide.id)) return slides;
      const at = r.after ? slides.findIndex((s) => s.id === r.after) + 1 : 0;
      const out = [...slides];
      out.splice(Math.max(0, at), 0, r.slide);
      return out;
    }
    case 'slideDelete': return slides.filter((s) => s.id !== r.slideId);
    case 'field': return slides.map((s) => (s.id === r.slideId ? { ...s, [r.field]: r.field === 'text' ? r.to ?? '' : r.to, ...(r.field === 'text' ? { textRuns: undefined } : {}) } : s));
    case 'elementInsert': return slides.map((s) => (s.id === r.slideId && !s.elements?.some((e) => e.id === r.element.id) ? { ...s, elements: [...(s.elements ?? []), r.element] } : s));
    case 'elementDelete': return slides.map((s) => (s.id === r.slideId ? { ...s, elements: s.elements?.filter((e) => e.id !== r.elementId) } : s));
    case 'element': return slides.map((s) => (s.id === r.slideId ? { ...s, elements: s.elements?.map((e) => (e.id === r.element.id ? r.element : e)) } : s));
  }
}

/**
 * Every revision accepted (Review › Accept All). As DeckCraft's review.accept {all}: a deletion that
 * would leave the presentation without slides is skipped, so its last slide stays.
 */
export function acceptAll(slides: Slide[], revs: Revision[]): Slide[] {
  return revs.reduce((sl, r) => (r.kind === 'slideDelete' && sl.length <= 1 && sl.some((s) => s.id === r.slideId) ? sl : accept(sl, r)), slides);
}
