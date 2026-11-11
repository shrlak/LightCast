import type { Slide } from '../domain/types';
import { patchElement } from '../domain/templates/convert';
import { AutoTextarea } from './AutoTextarea';
import { isPdfSlide, PDF_READ_ONLY } from '../domain/importedSlides';

/** Every editable word on this slide, including text imported as PowerPoint objects. */
export function SlideContentEditor({ slide, onChange }: { slide: Slide; onChange: (patch: Partial<Slide>) => void }) {
  if (isPdfSlide(slide)) return <p className="hint" role="note">{PDF_READ_ONLY}</p>;
  return (
    <div className="slide-content-editor">
      <label>슬라이드 제목<input aria-label="슬라이드 제목" value={slide.title ?? ''} onChange={(e) => onChange({ title: e.target.value || undefined })} /></label>
      <label>본문 · 가사<AutoTextarea aria-label="본문 · 가사" rows={3} value={slide.text} onChange={(e) => onChange({ text: e.target.value })} /></label>
      <label>둘째 줄 · 번역<AutoTextarea aria-label="둘째 줄 · 번역" rows={2} value={slide.subtext ?? ''} onChange={(e) => onChange({ subtext: e.target.value || undefined })} /></label>
      {(slide.elements ?? []).filter((el) => el.kind === 'text' && !el.master).map((el, index) => (
        <label key={el.id}>텍스트 상자 {index + 1}<AutoTextarea aria-label={`텍스트 상자 ${index + 1}`} rows={2} value={el.text ?? ''} onChange={(e) => onChange({
          elements: slide.elements!.map((x) => x.id === el.id ? patchElement(x, { text: e.target.value }) : x),
        })} /></label>
      ))}
    </div>
  );
}
