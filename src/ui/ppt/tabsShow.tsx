// 디자인 · 전환 · 애니메이션 tabs.
import type { Background, SlideAnimation, Transition } from '../../domain/types';
import { BACKGROUND_PRESETS, presetBackground } from '../../domain/defaults';
import { swatchStyle } from '../backgroundSwatch';
import { SlideCanvas, assetUrl } from '../SlideCanvas';
import { useMediaUrl } from '../hooks';
import { animationCatalog, colorSchemes, transitionCatalog, type AnimEffectInfo } from '../../engine';
import { moveAnimation, setAnimation, addAnimation } from '../../domain/editOps';
import { REPEAT_UNTIL_CLICK, canBuildByParagraph, paintAnimations, slideTimeline } from '../../domain/animations';
import { elementName } from './panes';
import type { Ed } from './editor';
import { useEffect, useRef, useState } from 'react';
import { withMaster } from '../../domain/master';
import { FONT_OPTIONS, officeFont } from '../../domain/fonts';
import { customSchemeName, readThemeFile } from '../../domain/io/themeFile';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { BUILTIN_SOUNDS, builtinSound } from '../../domain/transitionSounds';
import { Big, Col, DropButton, Gallery, Group, MenuHead, MenuItem, MenuSep, RI, Small } from './ribbonParts';
import { openThemeColors, openThemeFonts, removeCustomColors, removeCustomFonts, useCustomSchemes } from './designTab';
import { applyFontScheme, applyBackgroundStyle, backgroundStyles, colorsOf, customSchemeId, loadColorSchemes } from '../../domain/themeStyles';
import { ANIMATION, ANIMATION_CLASS, ANIMATION_START, TRANSITION, TRANSITION_CATEGORY, animOptionLabel, optionLabel } from './ko';

function MediaSwatch({ id, video }: { id: string; video: boolean }) {
  const url = useMediaUrl(id);
  if (!url) return <span className="rb-swatch-fill" />;
  return video ? <video className="rb-swatch-fill" src={url} muted /> : <img className="rb-swatch-fill" src={url} alt="" />;
}

export function DesignTab({ ed }: { ed: Ed }) {
  const { p, state } = ed;
  const lib = state.library;
  const sample = { id: 'sample', group: '', text: '가나다\nAaBb' };
  const applyBackground = (bg: Background | undefined) => p && ed.updatePres({ background: bg });
  // A scheme brought in by Browse for Themes is listed first (the engine reads its colours from its name).
  const schemes = [...colorSchemes()];
  const custom = p?.colorScheme?.startsWith('custom:') ? p.colorScheme : null;
  const customSaved = loadColorSchemes();
  if (custom && !customSaved.some((s) => customSchemeId(s.name, s.colors) === custom)) schemes.unshift({ name: custom, colors: custom.split('|')[1]?.split(',') ?? [] });
  const customLists = useCustomSchemes();
  const themeText = lib.themes.find((x) => x.id === p?.themeId)?.color ?? '#ffffff';
  const styles = backgroundStyles(colorsOf(p?.colorScheme, colorSchemes()));
  const schemeLabel = (n: string) => (n.startsWith('custom:') ? n.slice(7).split('|')[0] : n);
  const themeFile = useRef<HTMLInputElement>(null);
  const browseTheme = async (f: File | undefined) => {
    if (!f || !p) return;
    const t = await readThemeFile(f).catch(() => null);
    if (!t) return ed.cmd.notify('이 파일에서 테마를 찾지 못했습니다');
    const font = t.majorEa || t.major;
    ed.updatePres({ colorScheme: customSchemeName(t), ...(font ? { slides: p.slides.map((x) => ({ ...x, style: { ...x.style, fontFamily: `"${font}", ${t.minorEa ? `"${t.minorEa}", ` : ''}sans-serif` } })) } : {}) });
    ed.cmd.notify(`“${t.name}” 테마의 색${font ? `과 글꼴(${font})` : ''}을 적용했습니다`);
  };
  // Design › Variants: the theme with other colours and backgrounds.
  const cur = p?.colorScheme ?? schemes[0]?.name ?? '';
  const others = schemes.filter((s) => s.name !== cur);
  const variants: { scheme: string; background: Background; label: string }[] = [
    { scheme: cur, background: presetBackground('Black'), label: '현재 색 · 검정 배경' },
    { scheme: cur, background: { kind: 'color', value: '#ffffff' } as Background, label: '현재 색 · 흰색 배경' },
    { scheme: others[0]?.name ?? cur, background: backgroundStyles(others[0]?.colors ?? [])[2].background, label: `${schemeLabel(others[0]?.name ?? '')} · 어두운 배경 (텍스트 2)` },
    { scheme: others[1]?.name ?? cur, background: backgroundStyles(others[1]?.colors ?? [])[1].background, label: `${schemeLabel(others[1]?.name ?? '')} · 밝은 배경 (배경 2)` },
  ];
  return (
    <>
      <Group label="테마">
        <Gallery className="rb-gallery-themes">
          {lib.themes.map((t) => (
            <button key={t.id} type="button" className={`rb-theme ${p?.themeId === t.id ? 'on' : ''}`} title={t.name} disabled={!p || !ed.canEdit} onClick={() => ed.updatePres({ themeId: t.id })}>
              <SlideCanvas slide={sample} theme={t} background={p?.background ?? presetBackground('Black')} />
              <span>{t.name}</span>
            </button>
          ))}
        </Gallery>
        <Col>
          <Small icon="Aa" label="테마 편집" onClick={() => ed.cmd.open('themes')} />
          <Small icon="📂" label="테마 찾아보기…" title="PowerPoint 테마 · 서식 파일(.thmx, .potx, .pptx)의 색과 글꼴을 가져옵니다" disabled={!p || !ed.canEdit} onClick={() => themeFile.current?.click()} />
        </Col>
        <input ref={themeFile} type="file" accept=".thmx,.potx,.pptx,.ppsx" hidden onChange={(e) => { void browseTheme(e.target.files?.[0]); e.target.value = ''; }} />
      </Group>
      <Group label="변형">
        <Gallery className="rb-variants">
          {variants.map((v, i) => (
            <button key={i} type="button" className="rb-theme" title={v.label} disabled={!p || !ed.canEdit} onClick={() => ed.updatePres({ colorScheme: v.scheme, background: v.background })}>
              <SlideCanvas slide={sample} theme={lib.themes.find((t) => t.id === p?.themeId) ?? lib.themes[0]} background={v.background} />
              <span className="variant-chip">{(schemes.find((s) => s.name === v.scheme)?.colors ?? []).slice(4, 8).map((c, k) => <i key={k} style={{ background: c }} />)}</span>
            </button>
          ))}
        </Gallery>
        <DropButton icon="✦" label="효과" title="도형 스타일의 그림자 · 입체 효과 정도" disabled={!p || !ed.canEdit} render={(close) => (
          <>
            {([['subtle', '미묘한 효과'], ['moderate', '보통 효과'], ['intense', '강한 효과']] as const).map(([k, l]) => (
              <MenuItem key={k} label={l} on={(p?.themeEffects ?? 'moderate') === k} onClick={() => { ed.updatePres({ themeEffects: k === 'moderate' ? undefined : k }); close(); }} />
            ))}
          </>
        )} />
      </Group>
      <Group label="적용">
        <DropButton big icon={<span style={{ fontFamily: 'serif', fontSize: 20 }}>가A</span>} label="글꼴" title="모든 슬라이드와 텍스트 상자의 테마 글꼴" disabled={!p || !ed.canEdit} render={(close) => (
          <>
            <MenuHead>테마 글꼴</MenuHead>
            {FONT_OPTIONS.map((f) => (
              <MenuItem key={f.label} label={<span style={{ fontFamily: f.family, fontSize: 15 }}>{f.label} — 가나다 Aa</span>} onClick={() => {
                if (!p) return;
                ed.updatePres({ slides: p.slides.map((x) => ({ ...x, style: { ...x.style, fontFamily: f.family }, elements: x.elements?.map((e) => (e.kind === 'text' || e.kind === 'shape' || e.kind === 'table' ? { ...e, fontFamily: f.family } : e)) })) });
                close();
              }} />
            ))}
            {!!customLists.fonts.length && <MenuHead>사용자 지정</MenuHead>}
            {customLists.fonts.map((f) => (
              <div key={f.id} className="rb-mi-row">
                <MenuItem on={p?.fontScheme?.name === f.name && p.fontScheme.major === f.major && p.fontScheme.minor === f.minor} label={<span><b style={{ fontFamily: officeFont(f.major), fontSize: 15 }}>{f.major}</b> / <span style={{ fontFamily: officeFont(f.minor), fontSize: 13 }}>{f.minor}</span> — {f.name}</span>} onClick={() => { if (p) ed.updatePres(applyFontScheme(p, f)); close(); }} />
                <button type="button" className="rb-mi-act" title="편집" aria-label={`${f.name} 편집`} onClick={() => { close(); openThemeFonts(ed, f.id); }}>✎</button>
                <button type="button" className="rb-mi-act" title="삭제" aria-label={`${f.name} 삭제`} onClick={() => { if (window.confirm(`사용자 지정 글꼴 “${f.name}”을(를) 목록에서 지울까요?\n이미 적용한 슬라이드의 글꼴은 그대로 남습니다.`)) removeCustomFonts(f.id); }}>✕</button>
              </div>
            ))}
            <MenuSep />
            <MenuItem icon="가A" label="새 테마 글꼴 만들기…" onClick={() => { close(); openThemeFonts(ed); }} />
          </>
        )} />
        <DropButton big icon={<span className="scheme-chip">{(schemes.find((s) => s.name === p?.colorScheme) ?? schemes[0])?.colors.slice(4, 8).map((c) => <i key={c} style={{ background: c }} />)}</span>} label="색" title="표 · 차트 · 도형 스타일 · 색 선택에 쓰는 테마 색" disabled={!p || !ed.canEdit} render={(close) => (
          <>
            {schemes.map((s) => (
              <MenuItem key={s.name} on={(p?.colorScheme ?? schemes[0]?.name) === s.name} label={<span className="scheme-row"><span className="scheme-chip">{s.colors.slice(4, 10).map((c, i) => <i key={i} style={{ background: c }} />)}</span>{schemeLabel(s.name)}</span>} onClick={() => { ed.updatePres({ colorScheme: s.name }); close(); }} />
            ))}
            {!!customLists.colors.length && <MenuHead>사용자 지정</MenuHead>}
            {customLists.colors.map((s) => {
              const id = customSchemeId(s.name, s.colors);
              return (
                <div key={s.id} className="rb-mi-row">
                  <MenuItem on={p?.colorScheme === id} label={<span className="scheme-row"><span className="scheme-chip">{s.colors.slice(4, 10).map((c, i) => <i key={i} style={{ background: c }} />)}</span>{s.name}</span>} onClick={() => { ed.updatePres({ colorScheme: id }); close(); }} />
                  <button type="button" className="rb-mi-act" title="편집" aria-label={`${s.name} 편집`} onClick={() => { close(); openThemeColors(ed, s.id); }}>✎</button>
                  <button type="button" className="rb-mi-act" title="삭제" aria-label={`${s.name} 삭제`} onClick={() => { if (window.confirm(`사용자 지정 색 “${s.name}”을(를) 목록에서 지울까요?\n이미 적용한 프레젠테이션의 색은 그대로 남습니다.`)) removeCustomColors(s.id); }}>✕</button>
                </div>
              );
            })}
            <MenuSep />
            <MenuItem icon="🎨" label="새 테마 색 만들기…" onClick={() => { close(); openThemeColors(ed); }} />
          </>
        )} />
        <DropButton big icon={RI.background} label="배경 스타일" title="테마 색으로 만든 배경 스타일 1–12 (모든 슬라이드)" disabled={!p || !ed.canEdit} render={(close) => (
          <>
            <MenuHead>배경 스타일</MenuHead>
            <div className="bgstyle-grid">
              {styles.map((s) => (
                <button key={s.n} type="button" className="bgstyle" title={s.label} aria-label={s.label} style={{ background: s.css }} onClick={() => { if (p) ed.updatePres(applyBackgroundStyle(p, s, themeText)); close(); }}><span style={{ color: s.text }}>Aa</span></button>
              ))}
            </div>
            <MenuSep />
            <MenuItem label="배경 서식…" onClick={() => { close(); ed.setSel([]); ed.setPane('format'); }} />
            <MenuItem label="배경 지우기" onClick={() => { applyBackground(undefined); close(); }} />
          </>
        )} />
      </Group>
      <Group label="배경 (모든 슬라이드)">
        <Gallery rows={2} className="rb-gallery-bg">
          {BACKGROUND_PRESETS.map((b) => (
            <button key={b.name} type="button" className="rb-swatch" title={b.name} disabled={!p || !ed.canEdit} onClick={() => applyBackground(b.background)}>
              {b.background.kind === 'image' ? <img className="rb-swatch-fill" src={assetUrl(b.background.url)} alt="" /> : <span className="rb-swatch-fill" style={swatchStyle(b.background)} />}
            </button>
          ))}
          {lib.media.filter((m) => m.type !== 'audio' && !m.backgroundHidden).map((m) => (
            <button key={m.id} type="button" className="rb-swatch" title={m.name} disabled={!p || !ed.canEdit} onClick={() => applyBackground({ kind: 'media', mediaId: m.id, mediaType: m.type === 'video' ? 'video' : 'image' })}><MediaSwatch id={m.id} video={m.type === 'video'} /></button>
          ))}
        </Gallery>
        <Col>
          <Small icon="✕" label="배경 지우기" disabled={!p || !ed.canEdit} onClick={() => applyBackground(undefined)} />
          <label className="rb-range">어둡게 <input type="range" min={0} max={0.9} step={0.05} disabled={!p} value={p?.bgEffect?.dim ?? 0} onChange={(e) => ed.updatePres({ bgEffect: { dim: Number(e.target.value), blur: p?.bgEffect?.blur ?? 0 } })} /></label>
          <label className="rb-range">흐리게 <input type="range" min={0} max={40} disabled={!p} value={p?.bgEffect?.blur ?? 0} onChange={(e) => ed.updatePres({ bgEffect: { dim: p?.bgEffect?.dim ?? 0, blur: Number(e.target.value) } })} /></label>
        </Col>
      </Group>
      <Group label="사용자 지정">
        <DropButton big icon={RI.slideSize} label="슬라이드 크기" render={(close) => (
          <>
            <MenuItem label="표준 (4:3)" on onClick={close} />
            <MenuItem label="와이드스크린 (16:9)" disabled hint="교회 프로젝터에 맞춘 4:3 고정" onClick={close} />
            <MenuSep />
            <MenuItem label="슬라이드 크기…" onClick={() => { close(); ed.setDialog('slideSize'); }} />
          </>
        )} />
        <Big icon={RI.background} label="배경 서식" title="이 슬라이드만의 배경 — 오른쪽 서식 창" disabled={!ed.slide} onClick={() => { ed.setSel([]); ed.setPane('format'); }} />
        <label className="rb-check" title="슬라이드 마스터의 개체를 이 슬라이드에서 숨깁니다"><input type="checkbox" disabled={!ed.slide || !ed.canEdit || !ed.p?.master?.elements.length} checked={!!ed.slide?.hideMaster}
          onChange={(e) => { if (ed.slide) ed.updateSlide({ hideMaster: e.target.checked || undefined, elements: withMaster({ ...ed.slide, hideMaster: e.target.checked }, ed.p?.master?.elements ?? []).elements }); }} /> 배경 그래픽 숨기기</label>
      </Group>
      <Group label="디자이너">
        <Big icon={<span style={{ fontSize: 24 }}>✨</span>} label="디자인 아이디어" title="이 슬라이드의 제목 · 내용 · 그림을 여러 가지로 배치해 봅니다" disabled={!ed.slide} active={ed.pane === 'designer'} onClick={() => ed.setPane(ed.pane === 'designer' ? null : 'designer')} />
      </Group>
    </>
  );
}

const transitionOf = (ed: Ed): Transition | undefined => ed.slide?.transition ?? ed.p?.transition;
const fxId = (t: Transition | undefined) => (!t || t.kind === 'cut' ? 'none' : t.kind.startsWith('fx:') ? t.kind.slice(3) : t.kind === 'slide' ? 'push' : t.kind);

/** A small picture of what a transition does. */
function TransitionIcon({ id }: { id: string }) {
  const map: Record<string, string> = { none: '▭', fade: '◐', push: '⇤', wipe: '▤', split: '⇔', reveal: '◧', cut: '✂', randomBar: '▥', shape: '◯', uncover: '⇥', cover: '⇤', flash: '✦', dissolve: '░', checker: '▦', blinds: '☰', clock: '◔', zoom: '⤢', cube: '❒', doors: '⊓', box: '▣', ripple: '◎', honeycomb: '⬡', vortex: '✺', flip: '⇋', gallery: '▯', pan: '⇢', morph: '✿' };
  return <span className="tr-icon">{map[id] ?? '◇'}</span>;
}

export function TransitionsTab({ ed, onPreview }: { ed: Ed; onPreview: () => void }) {
  const cat = transitionCatalog();
  const t = transitionOf(ed);
  const cur = fxId(t);
  const info = cat.find((c) => c.id === cur);
  const soundFile = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Transition>) => {
    if (!ed.slide) return;
    const base: Transition = ed.slide.transition ?? ed.p?.transition ?? { kind: 'cut', duration: 1 };
    ed.updateSlide({ transition: { ...base, ...patch } });
  };
  const pick = (id: string) => {
    if (id === 'none') return set({ kind: 'cut', duration: 1, option: undefined });
    const c = cat.find((x) => x.id === id);
    set({ kind: `fx:${id}`, duration: c?.durationMs || 1000, option: c?.options[0]?.id });
  };
  const groups = ['Subtle', 'Exciting', 'Dynamic Content'];
  const addSound = (f: File) => {
    const id = uid('m');
    void putMedia(id, f).then(() => { ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'audio' } }); set({ sound: id, stopSound: undefined }); });
  };
  // A built-in sound goes into the media library once and is reused after that.
  const builtin = (id: string) => {
    const f = builtinSound(id);
    if (!f) return;
    const have = ed.state.library.media.find((m) => m.type === 'audio' && m.name === f.name);
    if (have) set({ sound: have.id, stopSound: undefined }); else addSound(f);
  };
  return (
    <>
      <Group label="미리 보기"><Big icon={RI.preview} label="미리 보기" disabled={!ed.slide} onClick={onPreview} /></Group>
      <Group label="이 슬라이드로 화면 전환">
        <Gallery className="rb-tr-gallery">
          {['none', 'morph', 'fade', 'push', 'wipe', 'split', 'reveal', 'randomBar', 'shape', 'uncover', 'cover', 'flash'].map((id) => (
            <button key={id} type="button" className={`rb-tr ${cur === id ? 'on' : ''}`} disabled={!ed.slide || !ed.canEdit} onClick={() => pick(id)}><TransitionIcon id={id} /><span>{TRANSITION[id] ?? id}</span></button>
          ))}
          <DropButton icon={<span className="rb-more">▾</span>} title="모든 화면 전환" disabled={!ed.slide || !ed.canEdit} wide render={(close) => (
            <div className="tr-all">
              <button type="button" className={`rb-tr ${cur === 'none' ? 'on' : ''}`} onClick={() => { pick('none'); close(); }}><TransitionIcon id="none" /><span>없음</span></button>
              {groups.map((g) => (
                <div key={g}>
                  <MenuHead>{TRANSITION_CATEGORY[g]}</MenuHead>
                  <div className="tr-grid">{cat.filter((c) => c.category === g && c.id !== 'none').map((c) => <button key={c.id} type="button" className={`rb-tr ${cur === c.id ? 'on' : ''}`} onClick={() => { pick(c.id); close(); }}><TransitionIcon id={c.id} /><span>{TRANSITION[c.id] ?? c.label}</span></button>)}</div>
                </div>
              ))}
            </div>
          )} />
        </Gallery>
        <DropButton big icon={RI.effectOptions} label="효과 옵션" disabled={!info?.options.length || !ed.canEdit} render={(close) => <>{info?.options.map((o) => <MenuItem key={o.id} label={optionLabel(o.label)} on={(t?.option ?? info.options[0].id) === o.id} onClick={() => { set({ option: o.id }); close(); }} />)}</>} />
      </Group>
      <Group label="타이밍">
        <Col>
          <label className="rb-field">소리: <select disabled={!ed.slide || !ed.canEdit} value={t?.stopSound ? '__stop' : t?.sound ?? ''} onChange={(e) => {
            const v = e.target.value;
            if (v === '__file') { soundFile.current?.click(); return; }
            if (v === '__stop') return set({ sound: undefined, soundLoop: undefined, stopSound: true });
            if (v.startsWith('builtin:')) return builtin(v.slice(8));
            set({ sound: v || undefined, stopSound: undefined, ...(v ? {} : { soundLoop: undefined }) });
          }}>
            <option value="">[소리 없음]</option>
            <option value="__stop">[이전 소리 중지]</option>
            <optgroup label="기본 소리">{BUILTIN_SOUNDS.map(([id, l]) => <option key={id} value={`builtin:${id}`}>{l}</option>)}</optgroup>
            <optgroup label="미디어 라이브러리">{ed.state.library.media.filter((m) => m.type === 'audio').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
            <option value="__file">기타 소리…</option>
          </select></label>
          <input ref={soundFile} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addSound(f); }} />
          <label className="rb-check" title="다음 소리가 나올 때까지 이 소리를 되풀이합니다"><input type="checkbox" disabled={!t?.sound || !ed.canEdit} checked={!!t?.sound && !!t.soundLoop} onChange={(e) => set({ soundLoop: e.target.checked || undefined })} /> 다음 소리까지 반복</label>
          <label className="rb-field">기간(초): <input type="number" min={0.01} max={59} step={0.25} disabled={!ed.slide || !ed.canEdit} value={((t?.duration ?? 1) / 1000).toFixed(2)} onChange={(e) => set({ duration: Math.min(59000, Math.max(1, Math.round(Number(e.target.value) * 1000))) })} /></label>
        </Col>
        <Col>
          <label className="rb-check" title="끄면 클릭해도 다음 슬라이드로 넘어가지 않습니다 (애니메이션은 클릭으로 재생)"><input type="checkbox" disabled={!ed.slide || !ed.canEdit} checked={t?.advanceOnClick !== false} onChange={(e) => set({ advanceOnClick: e.target.checked ? undefined : false })} /> 마우스를 클릭할 때</label>
          <label className="rb-check"><input type="checkbox" disabled={!ed.slide || !ed.canEdit} checked={!!ed.slide?.autoAdvance} onChange={(e) => ed.updateSlide({ autoAdvance: e.target.checked ? 5 : undefined })} /> 다음 시간 후:</label>
          <input className="rb-num" type="number" min={0} step={0.5} disabled={!ed.slide?.autoAdvance} value={ed.slide?.autoAdvance ?? 0} onChange={(e) => ed.updateSlide({ autoAdvance: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
        </Col>
        <Big icon="⧉" label="모두 적용" title="이 화면 전환과 소리 · 타이밍을 모든 슬라이드에" disabled={!ed.p || !ed.canEdit} onClick={() => {
          if (!ed.p) return;
          const tr = transitionOf(ed);
          // DeckCraft's Apply To All copies the whole transition, advance timing included.
          const after = ed.slide?.autoAdvance;
          ed.updatePres({ transition: tr, slides: ed.p.slides.map((s) => ({ ...s, transition: undefined, autoAdvance: after })) });
          ed.cmd.notify('모든 슬라이드에 같은 화면 전환과 타이밍을 적용했습니다');
        }} />
      </Group>
    </>
  );
}

const ENTRANCE_QUICK = ['appear', 'fade', 'fly', 'float', 'split', 'wipe', 'shape', 'wheel', 'randomBars', 'grow', 'zoom', 'swivel', 'bounce'];
const EMPHASIS_QUICK = ['pulse', 'colorPulse', 'teeter', 'spin', 'growShrink', 'transparency', 'boldFlash', 'wave'];
const EXIT_QUICK = ['disappear', 'fadeOut', 'flyOut', 'floatOut', 'splitOut', 'wipeOut', 'zoomOut', 'bounceOut'];
const COLORS: Record<string, string> = { entrance: '#3a9d23', emphasis: '#e6a800', exit: '#c43e1c', path: '#2b78c5' };

function AnimButton({ e, on, onClick }: { e: AnimEffectInfo; on?: boolean; onClick: () => void }) {
  return <button type="button" className={`rb-anim ${on ? 'on' : ''}`} onClick={onClick}><span className="anim-star" style={{ color: COLORS[e.class] }}>★</span><span>{ANIMATION[e.id] ?? e.label}</span></button>;
}

export function AnimGallery({ onPick, current }: { onPick: (e: AnimEffectInfo | null) => void; current?: string }) {
  const cat = animationCatalog();
  return (
    <div className="anim-all">
      <MenuItem label="없음" onClick={() => onPick(null)} />
      {(['entrance', 'emphasis', 'exit', 'path'] as const).map((c) => (
        <div key={c}>
          <MenuHead>{ANIMATION_CLASS[c]}</MenuHead>
          <div className="anim-grid">{cat.filter((e) => e.class === c).map((e) => <AnimButton key={`${c}-${e.id}`} e={e} on={current === e.id} onClick={() => onPick(e)} />)}</div>
        </div>
      ))}
    </div>
  );
}

/** The armed Animation Painter: the animations picked and from which object; `sticky` after a double-click. */
const painter: { current: { anims: SlideAnimation[]; source: string; sticky: boolean } | null } = { current: null };

export function AnimationsTab({ ed, onPreview }: { ed: Ed; onPreview: () => void }) {
  const cat = animationCatalog();
  const slide = ed.slide;
  const ids = ed.selEls.map((e) => e.id);
  const mine = (slide?.animations ?? []).filter((a) => ids.includes(a.elementId));
  const first = mine[0];
  const info = first ? cat.find((c) => c.id === first.effect && c.class === first.class) : undefined;
  const can = !!slide && ed.canEdit && ids.length > 0;
  const setList = (animations: SlideAnimation[] | undefined) => ed.updateSlide({ animations: animations?.length ? animations : undefined });
  const patchMine = (patch: Partial<SlideAnimation>) => slide && setList((slide.animations ?? []).map((a) => (mine.some((m) => m.id === a.id) ? { ...a, ...patch } : a)));
  const pick = (e: AnimEffectInfo | null) => slide && setList(setAnimation(slide, ids, e));
  const quick = [...ENTRANCE_QUICK, ...EMPHASIS_QUICK, ...EXIT_QUICK].map((id) => cat.find((c) => c.id === id)).filter((e): e is AnimEffectInfo => !!e);
  const steps = slide ? slideTimeline(slide)?.steps ?? 0 : 0;
  // Effect Options › 순서 for a text box or shape with text (motion paths move the whole object).
  const seqable = !!first && first.class !== 'path' && canBuildByParagraph(ed.selEls.find((e) => e.id === first.elementId));
  // Animation Painter: armed with the selected object's animations, it paints the next object picked.
  const [, repaint] = useState(0);
  const armPainter = (sticky: boolean) => {
    if (!slide || !ids.length) return;
    const src = ids[0];
    const anims = (slide.animations ?? []).filter((a) => a.elementId === src);
    if (!anims.length) return ed.cmd.notify('이 개체에는 복사할 애니메이션이 없습니다');
    painter.current = { anims, source: src, sticky };
    repaint((x) => x + 1);
    ed.cmd.notify(`애니메이션 ${anims.length}개를 복사했습니다 — 적용할 개체를 클릭하세요${sticky ? ' (계속 적용, Esc: 끝)' : ''}`);
  };
  const disarmPainter = () => { painter.current = null; repaint((x) => x + 1); };
  const selKey = ids.join(',');
  useEffect(() => {
    const pt = painter.current;
    if (!pt || !slide || !ids.length || selKey === pt.source) return;
    setList(paintAnimations(slide.animations ?? [], pt.anims, ids, () => uid('an')));
    if (!pt.sticky) disarmPainter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && painter.current) disarmPainter(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const repeatValue = first?.repeat === REPEAT_UNTIL_CLICK ? 'click' : String(first?.repeat && first.repeat > 1 ? first.repeat : 1);
  return (
    <>
      <Group label="미리 보기"><Big icon={RI.preview} label="미리 보기" title={`이 슬라이드의 애니메이션 재생 (${steps}단계)`} disabled={!slide?.animations?.length} onClick={onPreview} /></Group>
      <Group label="애니메이션">
        <Gallery className="rb-anim-gallery">
          <button type="button" className={`rb-anim ${can && !first ? 'on' : ''}`} disabled={!can} onClick={() => pick(null)}><span className="anim-star" style={{ color: '#999' }}>☆</span><span>없음</span></button>
          {quick.map((e) => <AnimButton key={`${e.class}-${e.id}`} e={e} on={first?.effect === e.id} onClick={() => can && pick(e)} />)}
          <DropButton icon={<span className="rb-more">▾</span>} title="모든 애니메이션" disabled={!can} wide render={(close) => <AnimGallery current={first?.effect} onPick={(e) => { pick(e); close(); }} />} />
        </Gallery>
        <DropButton big icon={RI.effectOptions} label="효과 옵션" disabled={!info?.options.length && !seqable} render={(close) => (
          <>
            {info?.options.map((o) => <MenuItem key={o} label={animOptionLabel(o)} on={(first?.option ?? info.options[0]) === o} onClick={() => { patchMine({ option: o }); close(); }} />)}
            {seqable && (
              <>
                {!!info?.options.length && <MenuSep />}
                <MenuHead>순서</MenuHead>
                <MenuItem label="하나의 개체로" on={first?.sequence !== 'paragraph'} onClick={() => { patchMine({ sequence: undefined }); close(); }} />
                <MenuItem label="단락별로" on={first?.sequence === 'paragraph'} onClick={() => { patchMine({ sequence: 'paragraph' }); close(); }} />
              </>
            )}
          </>
        )} />
      </Group>
      <Group label="고급 애니메이션">
        <DropButton big icon={RI.addAnim} label="애니메이션 추가" disabled={!can} wide render={(close) => (
          <>
            <MenuItem icon="✎" label="사용자 지정 경로 그리기" hint="두 번 클릭: 끝" disabled={ids.length !== 1} onClick={() => { ed.setTool({ kind: 'motionPath', id: ids[0], add: true }); close(); }} />
            <AnimGallery onPick={(e) => { if (slide && e) setList(addAnimation(slide, ids, e)); close(); }} />
          </>
        )} />
        <Small icon="✎" label="사용자 지정 경로" title="이동 경로를 직접 그립니다 (이 개체의 애니메이션을 바꿈)" disabled={!can || ids.length !== 1} onClick={() => ed.setTool({ kind: 'motionPath', id: ids[0], add: false })} />
        <Col>
          <Small icon={RI.animPane} label="애니메이션 창" active={ed.pane === 'animation'} onClick={() => ed.setPane(ed.pane === 'animation' ? null : 'animation')} />
          <DropButton icon="⚡" label="트리거" title="다른 개체를 클릭할 때 이 애니메이션 재생" disabled={!first || !ed.canEdit} render={(close) => (
            <>
              <MenuHead>클릭할 때</MenuHead>
              <MenuItem label="(없음 — 슬라이드 클릭 순서대로)" on={!first?.trigger} onClick={() => { patchMine({ trigger: undefined }); close(); }} />
              {ed.elements.filter((e) => !e.master && !ids.includes(e.id)).map((e) => (
                <MenuItem key={e.id} label={elementName(e, ed.elements.indexOf(e))} on={first?.trigger === e.id} onClick={() => { patchMine({ trigger: e.id }); close(); }} />
              ))}
            </>
          )} />
          <span onDoubleClick={() => armPainter(true)}>
            <Small icon="🖌" label="애니메이션 복사" title="애니메이션 복사 — 이 개체의 애니메이션을 다음에 클릭하는 개체에 그대로 적용합니다 (두 번 누르면 계속, Esc: 끝)" active={!!painter.current}
              disabled={!slide || (!first && !painter.current)} onClick={() => (painter.current ? disarmPainter() : armPainter(false))} />
          </span>
        </Col>
      </Group>
      <Group label="타이밍">
        <Col>
          <label className="rb-field">▶ 시작: <select disabled={!first} value={first?.start ?? 'click'} onChange={(e) => patchMine({ start: e.target.value as SlideAnimation['start'] })}>
            {(['click', 'with', 'after'] as const).map((s) => <option key={s} value={s}>{ANIMATION_START[s]}</option>)}
          </select></label>
          <label className="rb-field">⏱ 재생 시간: <input type="number" min={0.01} step={0.25} disabled={!first} value={((first?.durationMs ?? 500) / 1000).toFixed(2)} onChange={(e) => patchMine({ durationMs: Math.max(10, Math.round(Number(e.target.value) * 1000)) })} /></label>
          <label className="rb-field">⏳ 지연: <input type="number" min={0} step={0.25} disabled={!first} value={((first?.delayMs ?? 0) / 1000).toFixed(2)} onChange={(e) => patchMine({ delayMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) })} /></label>
        </Col>
        <Col>
          <label className="rb-field">↻ 반복: <select disabled={!first} value={repeatValue} onChange={(e) => patchMine({ repeat: e.target.value === 'click' ? REPEAT_UNTIL_CLICK : Number(e.target.value) > 1 ? Number(e.target.value) : undefined })}>
            <option value="1">(없음)</option>{[2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}<option value="click">다음 클릭할 때까지</option>
          </select></label>
          <label className="rb-check" title="효과가 끝나면 개체가 효과 전 모습으로 돌아갑니다"><input type="checkbox" disabled={!first} checked={!!first?.rewind} onChange={(e) => patchMine({ rewind: e.target.checked || undefined })} /> 재생 후 되감기</label>
        </Col>
        <Col>
          <span className="rb-note">애니메이션 순서 바꾸기</span>
          <Small icon="▲" label="앞으로 이동" disabled={!first || !slide} onClick={() => slide && first && setList(moveAnimation(slide.animations ?? [], first.id, -1))} />
          <Small icon="▼" label="뒤로 이동" disabled={!first || !slide} onClick={() => slide && first && setList(moveAnimation(slide.animations ?? [], first.id, 1))} />
        </Col>
      </Group>
    </>
  );
}

export { MenuSep };
