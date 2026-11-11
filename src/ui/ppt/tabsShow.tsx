// 디자인 · 전환 · 애니메이션 tabs.
import type { Background, SlideAnimation, Transition } from '../../domain/types';
import { BACKGROUND_PRESETS, presetBackground } from '../../domain/defaults';
import { MOTION_PRESETS } from '../../domain/motion';
import { swatchStyle } from '../backgroundSwatch';
import { SlideCanvas, assetUrl } from '../SlideCanvas';
import { useMediaUrl } from '../hooks';
import { animationCatalog, colorSchemes, transitionCatalog, type AnimEffectInfo } from '../../engine';
import { moveAnimation, setAnimation, addAnimation } from '../../domain/editOps';
import { slideTimeline } from '../../domain/animations';
import type { Ed } from './editor';
import { useRef } from 'react';
import { withMaster } from '../../domain/master';
import { FONT_OPTIONS } from '../../domain/fonts';
import { customSchemeName, readThemeFile } from '../../domain/io/themeFile';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { Big, Col, DropButton, Gallery, Group, MenuHead, MenuItem, MenuSep, RI, Small } from './ribbonParts';
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
  if (custom) schemes.unshift({ name: custom, colors: custom.split('|')[1]?.split(',') ?? [] });
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
    { scheme: others[0]?.name ?? cur, background: { kind: 'color', value: '#1f2a44' } as Background, label: `${schemeLabel(others[0]?.name ?? '')} · 남색 배경` },
    { scheme: others[1]?.name ?? cur, background: { kind: 'color', value: '#f2f2f2' } as Background, label: `${schemeLabel(others[1]?.name ?? '')} · 밝은 회색 배경` },
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
          </>
        )} />
        <DropButton big icon={<span className="scheme-chip">{(schemes.find((s) => s.name === p?.colorScheme) ?? schemes[0])?.colors.slice(4, 8).map((c) => <i key={c} style={{ background: c }} />)}</span>} label="색" title="표 · 차트 · 도형 스타일 · 색 선택에 쓰는 테마 색" disabled={!p || !ed.canEdit} render={(close) => (
          <>
            {schemes.map((s) => (
              <MenuItem key={s.name} on={(p?.colorScheme ?? schemes[0]?.name) === s.name} label={<span className="scheme-row"><span className="scheme-chip">{s.colors.slice(4, 10).map((c, i) => <i key={i} style={{ background: c }} />)}</span>{schemeLabel(s.name)}</span>} onClick={() => { ed.updatePres({ colorScheme: s.name }); close(); }} />
            ))}
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
          {MOTION_PRESETS.map((b) => <button key={b.name} type="button" className="rb-swatch" title={b.name} disabled={!p || !ed.canEdit} onClick={() => applyBackground(b.background)}><span className="rb-swatch-fill" style={swatchStyle(b.background)} /></button>)}
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
          </>
        )} />
        <Big icon={RI.background} label="배경 서식" title="이 슬라이드만의 배경 — 오른쪽 서식 창" disabled={!ed.slide} onClick={() => { ed.setSel([]); ed.setPane('format'); }} />
        <label className="rb-check" title="슬라이드 마스터의 개체를 이 슬라이드에서 숨깁니다"><input type="checkbox" disabled={!ed.slide || !ed.canEdit || !ed.p?.master?.elements.length} checked={!!ed.slide?.hideMaster}
          onChange={(e) => { if (ed.slide) ed.updateSlide({ hideMaster: e.target.checked || undefined, elements: withMaster({ ...ed.slide, hideMaster: e.target.checked }, ed.p?.master?.elements ?? []).elements }); }} /> 배경 그래픽 숨기기</label>
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
  return (
    <>
      <Group label="미리 보기"><Big icon={RI.preview} label="미리 보기" disabled={!ed.slide} onClick={onPreview} /></Group>
      <Group label="이 슬라이드로 화면 전환">
        <Gallery className="rb-tr-gallery">
          {['none', 'fade', 'push', 'wipe', 'split', 'reveal', 'randomBar', 'shape', 'uncover', 'cover', 'flash'].map((id) => (
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
          <label className="rb-field">소리: <select disabled={!ed.slide || !ed.canEdit} value={t?.sound ?? ''} onChange={(e) => { if (e.target.value === '__file') { soundFile.current?.click(); return; } set({ sound: e.target.value || undefined }); }}>
            <option value="">[소리 없음]</option>
            {ed.state.library.media.filter((m) => m.type === 'audio').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value="__file">기타 소리…</option>
          </select></label>
          <input ref={soundFile} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const id = uid('m'); void putMedia(id, f).then(() => { ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'audio' } }); set({ sound: id }); }); }} />
          <label className="rb-field">기간(초): <input type="number" min={0.01} max={60} step={0.25} disabled={!ed.slide || !ed.canEdit} value={((t?.duration ?? 1) / 1000).toFixed(2)} onChange={(e) => set({ duration: Math.max(1, Math.round(Number(e.target.value) * 1000)) })} /></label>
          <Small icon="⧉" label="모두 적용" title="이 화면 전환을 모든 슬라이드에" disabled={!ed.p || !ed.canEdit} onClick={() => { if (!ed.p) return; const tr = transitionOf(ed); ed.updatePres({ transition: tr, slides: ed.p.slides.map((s) => ({ ...s, transition: undefined })) }); ed.cmd.notify('모든 슬라이드에 같은 화면 전환을 적용했습니다'); }} />
        </Col>
        <Col>
          <label className="rb-check"><input type="checkbox" checked readOnly /> 마우스를 클릭할 때</label>
          <label className="rb-check"><input type="checkbox" disabled={!ed.slide || !ed.canEdit} checked={!!ed.slide?.autoAdvance} onChange={(e) => ed.updateSlide({ autoAdvance: e.target.checked ? 5 : undefined })} /> 다음 시간 후:</label>
          <input className="rb-num" type="number" min={0} step={0.5} disabled={!ed.slide?.autoAdvance} value={ed.slide?.autoAdvance ?? 0} onChange={(e) => ed.updateSlide({ autoAdvance: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
        </Col>
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
  return (
    <>
      <Group label="미리 보기"><Big icon={RI.preview} label="미리 보기" title={`이 슬라이드의 애니메이션 재생 (${steps}단계)`} disabled={!slide?.animations?.length} onClick={onPreview} /></Group>
      <Group label="애니메이션">
        <Gallery className="rb-anim-gallery">
          <button type="button" className={`rb-anim ${can && !first ? 'on' : ''}`} disabled={!can} onClick={() => pick(null)}><span className="anim-star" style={{ color: '#999' }}>☆</span><span>없음</span></button>
          {quick.map((e) => <AnimButton key={`${e.class}-${e.id}`} e={e} on={first?.effect === e.id} onClick={() => can && pick(e)} />)}
          <DropButton icon={<span className="rb-more">▾</span>} title="모든 애니메이션" disabled={!can} wide render={(close) => <AnimGallery current={first?.effect} onPick={(e) => { pick(e); close(); }} />} />
        </Gallery>
        <DropButton big icon={RI.effectOptions} label="효과 옵션" disabled={!info?.options.length} render={(close) => <>{info?.options.map((o) => <MenuItem key={o} label={animOptionLabel(o)} on={(first?.option ?? info.options[0]) === o} onClick={() => { patchMine({ option: o }); close(); }} />)}</>} />
      </Group>
      <Group label="고급 애니메이션">
        <DropButton big icon={RI.addAnim} label="애니메이션 추가" disabled={!can} wide render={(close) => <AnimGallery onPick={(e) => { if (slide && e) setList(addAnimation(slide, ids, e)); close(); }} />} />
        <Col>
          <Small icon={RI.animPane} label="애니메이션 창" active={ed.pane === 'animation'} onClick={() => ed.setPane(ed.pane === 'animation' ? null : 'animation')} />
          <Small icon="⧉" label="애니메이션 복사" title="선택한 개체의 애니메이션을 다른 개체에 (다른 개체를 고른 뒤 다시 누르기)" disabled={!can || !first}
            onClick={() => { if (!slide || !first) return; (window as unknown as { __fcAnim?: SlideAnimation }).__fcAnim = first; ed.cmd.notify('애니메이션을 복사했습니다 — 적용할 개체를 고르고 “애니메이션 붙여넣기”를 누르세요'); }} />
          <Small icon="📋" label="애니메이션 붙여넣기" disabled={!can} onClick={() => { const a = (window as unknown as { __fcAnim?: SlideAnimation }).__fcAnim; const e = a && cat.find((c) => c.id === a.effect && c.class === a.class); if (slide && e) setList(addAnimation(slide, ids, e).map((x) => (ids.includes(x.elementId) && x.effect === a.effect ? { ...x, option: a.option, durationMs: a.durationMs, delayMs: a.delayMs, start: a.start } : x))); }} />
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
          <span className="rb-note">애니메이션 순서 바꾸기</span>
          <Small icon="▲" label="앞으로 이동" disabled={!first || !slide} onClick={() => slide && first && setList(moveAnimation(slide.animations ?? [], first.id, -1))} />
          <Small icon="▼" label="뒤로 이동" disabled={!first || !slide} onClick={() => slide && first && setList(moveAnimation(slide.animations ?? [], first.id, 1))} />
        </Col>
      </Group>
    </>
  );
}

export { MenuSep };
