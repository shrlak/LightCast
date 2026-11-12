import { useRef, useState, type Dispatch, type ReactNode } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import type { Background, Presentation, Slide, SlideStyle, Theme } from '../../domain/types';
import { BACKGROUND_PRESETS } from '../../domain/defaults';
import { swatchStyle } from '../backgroundSwatch';
import { gradientCss, hexOf, parseGradient, transparencyOf, withTransparency, type GradientSpec } from '../../domain/backgroundFormat';
import { PATTERNS } from '../../domain/patterns';
import { withMaster } from '../../domain/master';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { assetUrl, slideTheme } from '../SlideCanvas';
import { useMediaUrl } from '../hooks';
import { patchElement } from '../../domain/templates/convert';
import { ElementFormat, elementPatch, sizeOf, textValue, type TableRange } from './ElementFormat';
import { TextFormatPanel } from './TextFormatPanel';
import { SlideContentEditor } from '../SlideContentEditor';
import { changeCase, clearTextFormat } from '../../domain/textFormat';
import { isPdfSlide } from '../../domain/importedSlides';
import { PdfReadOnly } from '../PdfReadOnly';
import { ProtectedMaterialNotice } from '../MaterialProtection';
import { BackgroundPictureOptions, BackgroundSources } from './designTab';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  presentation: Presentation;
  slide: Slide;
  onDesign: () => void;
  /** The full slide editor already displays its content fields. */
  showContent?: boolean;
  /** The object selected on the slide (CanvasEditor); its settings show first. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  cell?: TableRange;
  onCell?: (r: TableRange) => void;
}

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="fmt-section" open={open}>
      <summary>{title}</summary>
      <div className="fmt-body">{children}</div>
    </details>
  );
}

function MediaThumb({ id, video }: { id: string; video: boolean }) {
  const url = useMediaUrl(id);
  if (!url) return <span className="fmt-swatch-fill" />;
  return video ? <video className="fmt-swatch-fill" src={url} muted /> : <img className="fmt-swatch-fill" src={url} alt="" />;
}


/**
 * PowerPoint-style Format pane for one slide: text, font (나눔고딕 / Arial / Calibri…),
 * size, colour, bold/italic/underline, alignment, spacing and background — for this slide
 * only, with "apply to all slides".
 */
export function SlideFormat({ state, dispatch, presentation: p, slide, onDesign: _onDesign, selectedId, onSelect, cell, onCell, showContent = true }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const base: Theme = state.library.themes.find((t) => t.id === p.themeId) ?? state.library.themes[0];
  const t = slideTheme(base, slide);
  const st = slide.style ?? {};
  const upd = (patch: Partial<Slide>) => dispatch({ type: 'slide/update', presentationId: p.id, slideId: slide.id, patch });
  const setStyle = (patch: SlideStyle) => {
    const next: SlideStyle = { ...st, ...patch };
    for (const k of Object.keys(next) as (keyof SlideStyle)[]) if (next[k] === undefined || next[k] === base[k as keyof Theme]) delete next[k];
    upd({ style: Object.keys(next).length ? next : undefined, ...(patch.fontSize !== undefined ? { maximizeFont: false, preferredFontSize: undefined } : {}) });
  };
  const flash = (msg: string) => {
    setApplied(msg);
    setTimeout(() => setApplied(null), 1800);
  };
  const applyToAll = (what: 'style' | 'background') => {
    const slides = p.slides.map((s) => (what === 'style' ? { ...s, style: slide.style, preferredFontSize: slide.preferredFontSize } : { ...s, background: slide.background }));
    dispatch({ type: 'presentation/update', id: p.id, patch: { slides } });
    flash(what === 'style' ? '글꼴 서식을 모든 슬라이드에 적용했습니다' : '배경을 모든 슬라이드에 적용했습니다');
  };
  const setBg = (bg: Background | undefined) => upd({ background: bg });
  const uploadBg = async (file: File | undefined) => {
    if (!file) return;
    const id = uid('m');
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    await putMedia(id, file);
    dispatch({ type: 'media/add', media: { id, name: file.name, type } });
    setBg({ kind: 'media', mediaId: id, mediaType: type, fit: 'cover' });
    if (fileRef.current) fileRef.current.value = '';
  };
  const bg = slide.background;
  const bgColor = bg?.kind === 'color' ? bg.value : '#000000';
  const grad = bg?.kind === 'gradient' ? parseGradient(bg.value) : null;
  const setGrad = (patch: Partial<GradientSpec>) => setBg({ kind: 'gradient', value: gradientCss({ type: 'linear', angle: 90, from: '#1f8a52', to: '#0a1a35', ...grad, ...patch }) });
  const pat = bg?.kind === 'pattern' ? bg : null;
  const setPat = (patch: Partial<Extract<Background, { kind: 'pattern' }>>) => setBg({ kind: 'pattern', preset: 'pct50', fg: '#1f8a52', bg: '#000000', ...pat, ...patch });

  const selected = slide.elements?.find((e) => e.id === selectedId);
  const elements = slide.elements ?? [];
  // A slide whose words sit in text boxes (the church's template slides) has no slide text for
  // the 글꼴 · 단락 settings to act on, so they format its text boxes instead.
  const textEls = elements.filter((e) => e.kind === 'text');
  const boxMode = !selected && !slide.text.trim() && !slide.title && !slide.subtext && textEls.length > 0;
  const ref = textEls[0];
  const patchBoxes = (fn: (e: typeof elements[number]) => Partial<typeof elements[number]>) =>
    upd({ elements: elements.map((e) => (e.kind === 'text' ? patchElement(e, fn(e)) : e)) });
  if (p.protected) return <ProtectedMaterialNotice presentation={p} dispatch={dispatch} />;
  if (isPdfSlide(slide)) return <PdfReadOnly slide={slide} onChange={upd} />;
  return (
    <div className="slide-format">
      {showContent && <Section title="내용 · 이 슬라이드만"><SlideContentEditor slide={slide} onChange={upd} /></Section>}
      {applied && <div className="fmt-flash">✓ {applied}</div>}
      {!selected && <button title="원래 글자 크기로 상자를 늘리고, 슬라이드 안에 들어가지 않을 때만 글자를 줄입니다." onClick={() => boxMode ? upd({ elements: elements.map((e) => e.kind === 'text' ? { ...e, autoFit: true, maximizeFont: false } : e) }) : setStyle({ autoFit: true })}>넘친 내용 맞추기</button>}
      {!selected && boxMode && <button onClick={() => patchBoxes((e) => ({ fontSize: sizeOf(e), x: e.x, y: e.y, w: e.w, h: e.h }))}>글자 크기 통일</button>}
      {selected ? (
        <ElementFormat themeFont={t.fontFamily}
          el={selected}
          onChange={(patch) => upd({ elements: elements.map((e) => (e.id === selected.id ? patchElement(e, patch) : e)) })}
          onDelete={() => { upd({ elements: elements.filter((e) => e.id !== selected.id) }); onSelect?.(null); }}
          onOrder={(where) => {
            const rest = elements.filter((e) => e.id !== selected.id);
            upd({ elements: where === 'front' ? [...rest, selected] : [selected, ...rest] });
          }}
          addMedia={(m) => dispatch({ type: 'media/add', media: m })}
          cell={cell} onCell={onCell}
        />
      ) : null}
      <Section title="글꼴 · 단락">
        <TextFormatPanel
          value={boxMode ? textValue(ref) : {
            fontFamily: t.fontFamily, fontSize: t.fontSize, bold: t.fontWeight >= 700, italic: !!t.italic, underline: !!t.underline,
            strike: !!t.strike, shadow: t.shadow, letterSpacing: t.letterSpacing ?? 0, color: t.color, highlight: t.highlight,
            align: t.align, vAlign: t.vAlign, lineHeight: t.lineHeight, list: t.list, indent: t.indent ?? 0, columns: t.columns ?? 1,
            vertical: !!t.vertical, autoFit: t.autoFit !== false,
          }}
          onChange={boxMode ? (patch) => patchBoxes((e) => elementPatch(e, patch)) : ({ bold, ...rest }) => setStyle({ ...rest, ...(bold === undefined ? {} : { fontWeight: bold ? 700 : 400 }) })}
          onChangeCase={boxMode ? (kind) => patchBoxes((e) => ({ text: changeCase(e.text ?? '', kind) })) : (kind) => upd({ text: changeCase(slide.text, kind), ...(slide.title ? { title: changeCase(slide.title, kind) } : {}), ...(slide.subtext ? { subtext: changeCase(slide.subtext, kind) } : {}) })}
          onClear={boxMode ? () => patchBoxes(clearTextFormat) : () => upd({ style: undefined, preferredFontSize: undefined })}
          shortcuts={false}
          theme={t.fontFamily}
        />
      </Section>

      <Section title="텍스트 옵션" open={false}>
        <label className="check small"><input type="checkbox" checked={t.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} /> 모두 대문자로 표시</label>
        <label>여백 <span className="muted">{t.padding}px</span><input type="range" min={0} max={400} step={10} value={t.padding} onChange={(e) => setStyle({ padding: Number(e.target.value) })} /></label>
        <label>텍스트 윤곽선 <span className="muted">{t.strokeWidth ?? 0}px</span>
          <div className="fmt-row"><input className="grow" type="range" min={0} max={12} value={t.strokeWidth ?? 0} onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })} /><input type="color" value={t.strokeColor ?? '#000000'} onChange={(e) => setStyle({ strokeColor: e.target.value })} /></div>
        </label>
        <div className="fmt-row">
          <label className="fmt-color" title="텍스트 효과 · 네온"><span style={{ background: t.glowColor ?? 'transparent' }} />네온<input type="color" value={t.glowColor ?? '#ffffff'} onChange={(e) => setStyle({ glowColor: e.target.value })} /></label>
          {t.glowColor && <button className="mini-btn" onClick={() => setStyle({ glowColor: undefined })}>네온 없음</button>}
          <label className="fmt-color" title="둘째 줄 (번역 · 둘째 성경) 색"><span style={{ background: t.subColor ?? t.color }} />둘째 줄 색<input type="color" value={t.subColor ?? t.color} onChange={(e) => setStyle({ subColor: e.target.value })} /></label>
        </div>
      </Section>
      <div className="fmt-row fmt-apply">
        <button className="grow" onClick={() => applyToAll('style')}>서식을 모든 슬라이드에 적용</button>
        <button disabled={!slide.style} onClick={() => upd({ style: undefined })} title="테마 서식으로 되돌리기">초기화</button>
      </div>

      <Section title="배경">
        <div className="fmt-swatches">
          <button className={`fmt-swatch ${!bg ? 'on' : ''}`} title="자동 — 섹션과 슬라이드의 텍스트를 보고 배경을 정합니다" onClick={() => setBg(undefined)}><span className="fmt-swatch-fill fmt-none">자동</span></button>
          {BACKGROUND_PRESETS.map((b) => (
            <button key={b.name} className="fmt-swatch" title={b.name} onClick={() => setBg(b.background)}>
              {b.background.kind === 'image' ? <img className="fmt-swatch-fill" src={assetUrl(b.background.url)} alt="" />
                : <span className="fmt-swatch-fill" style={swatchStyle(b.background)} />}
            </button>
          ))}
          {state.library.media.filter((m) => m.type !== 'audio' && !m.backgroundHidden).map((m) => (
            <button key={m.id} className="fmt-swatch" title={m.name} onClick={() => setBg({ kind: 'media', mediaId: m.id, mediaType: m.type === 'video' ? 'video' : 'image', fit: 'cover' })}>
              <MediaThumb id={m.id} video={m.type === 'video'} />
            </button>
          ))}
        </div>
        <div className="fmt-row">
          <label className="fmt-color grow" title="단색 배경"><span style={{ background: bgColor }} />단색<input type="color" value={hexOf(bgColor)} onChange={(e) => setBg({ kind: 'color', value: withTransparency(e.target.value, transparencyOf(bgColor)) })} /></label>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => uploadBg(e.target.files?.[0])} />
        </div>
        <BackgroundSources ed={{ dispatch, cmd: { notify: flash } as never }} setBg={setBg} onFile={() => fileRef.current?.click()} />
        {bg?.kind === 'color' && (
          <label>투명도 <span className="muted">{Math.round(transparencyOf(bgColor) * 100)}%</span><input type="range" min={0} max={100} value={Math.round(transparencyOf(bgColor) * 100)} onChange={(e) => setBg({ kind: 'color', value: withTransparency(hexOf(bgColor), Number(e.target.value) / 100) })} /></label>
        )}
        {bg?.kind === 'media' && bg.mediaType === 'image' && (
          <label>그림 투명도 <span className="muted">{Math.round((bg.transparency ?? 0) * 100)}%</span><input type="range" min={0} max={100} value={Math.round((bg.transparency ?? 0) * 100)} onChange={(e) => setBg({ ...bg, transparency: Number(e.target.value) / 100 || undefined })} /></label>
        )}
        <div className="fmt-row">
          <button className={`fmt-tog ${grad ? 'on' : ''}`} onClick={() => setGrad({})}>그라데이션 채우기</button>
          <button className={`fmt-tog ${pat ? 'on' : ''}`} onClick={() => setPat({})}>패턴 채우기</button>
        </div>
        {grad && (
          <div className="fmt-row">
            <select value={grad.type} onChange={(e) => setGrad({ type: e.target.value as GradientSpec['type'] })}><option value="linear">선형</option><option value="radial">방사형</option></select>
            <input type="color" title="시작 색" value={grad.from} onChange={(e) => setGrad({ from: e.target.value })} />
            <input type="color" title="끝 색" value={grad.to} onChange={(e) => setGrad({ to: e.target.value })} />
            {grad.type === 'linear' && <input type="number" title="각도" min={0} max={359} style={{ width: 56 }} value={grad.angle} onChange={(e) => setGrad({ angle: Number(e.target.value) })} />}
          </div>
        )}
        {pat && (
          <div className="fmt-row">
            <select value={pat.preset} onChange={(e) => setPat({ preset: e.target.value })}>{PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            <input type="color" title="전경색" value={pat.fg} onChange={(e) => setPat({ fg: e.target.value })} />
            <input type="color" title="배경색" value={pat.bg} onChange={(e) => setPat({ bg: e.target.value })} />
          </div>
        )}
        {bg && (bg.kind === 'media' || bg.kind === 'image') && (
          <div className="fmt-row">
            <span className="muted">맞춤</span>
            <button className={`fmt-tog ${(bg.fit ?? 'cover') === 'cover' ? 'on' : ''}`} onClick={() => setBg({ ...bg, fit: 'cover' })}>채우기</button>
            <button className={`fmt-tog ${bg.fit === 'contain' ? 'on' : ''}`} onClick={() => setBg({ ...bg, fit: 'contain' })}>맞추기</button>
          </div>
        )}
        {bg && (bg.kind === 'media' || bg.kind === 'image') && <BackgroundPictureOptions bg={bg} setBg={setBg} />}
        <label className="check small" title="슬라이드 마스터의 개체를 이 슬라이드에서 숨깁니다"><input type="checkbox" checked={!!slide.hideMaster} disabled={!p.master?.elements.length} onChange={(e) => upd({ hideMaster: e.target.checked || undefined, elements: withMaster({ ...slide, hideMaster: e.target.checked }, p.master?.elements ?? []).elements })} /> 배경 그래픽 숨기기</label>
        <div className="fmt-row">
          <button className="grow" disabled={!bg} onClick={() => applyToAll('background')}>모두 적용</button>
          <button disabled={!bg} onClick={() => setBg(undefined)} title="자동 배경으로 되돌리기">배경 다시 설정</button>
        </div>
      </Section>

    </div>
  );
}
