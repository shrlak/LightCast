// Design tab pieces: the Design Ideas pane (디자인 아이디어), the Create New Theme Colors / Fonts dialogs,
// the Slide Size dialog, and the Format Background source and picture options.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Background, BackgroundPicture, Slide } from '../../domain/types';
import { applyIdea, ideasFor, type IdeaId } from '../../domain/designIdeas';
import { resolveBackground } from '../../domain/autoBackground';
import { colorSchemes } from '../../engine';
import { ALIGNS, ALIGN_LABEL, MIRRORS, MIRROR_LABEL, patchPicture } from '../../domain/pictureBackground';
import {
  COLOR_SLOTS, cleanName, colorsOf, customSchemeId, deleteColorScheme, deleteFontScheme, loadColorSchemes, loadFontSchemes, nextCustomName, normalizeHex,
  saveColorScheme, saveFontScheme, applyFontScheme, type CustomColorScheme, type CustomFontScheme,
} from '../../domain/themeStyles';
import { FONT_OPTIONS, officeFont } from '../../domain/fonts';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { mediaUrl, putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { SlideCanvas } from '../SlideCanvas';
import type { Ed } from './editor';
import { Dialog, Field } from './dialogs';
import { FontImportButton, useImportedFonts } from './FontImport';
import { importedFamilies } from '../../domain/importedFonts';

// ---------------------------------------------------------------- the galleries' custom lists

const listeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** The custom colour and font schemes the Design › Colors / Fonts galleries list; re-renders when one is saved or deleted. */
export function useCustomSchemes(): { colors: CustomColorScheme[]; fonts: CustomFontScheme[] } {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  return useMemo(() => ({ colors: loadColorSchemes(), fonts: loadFontSchemes() }), [v]);
}
export const removeCustomColors = (id: string) => { deleteColorScheme(id); bump(); };
export const removeCustomFonts = (id: string) => { deleteFontScheme(id); bump(); };

/** Which custom scheme the open dialog edits (null: a new one). */
const target: { color: string | null; font: string | null } = { color: null, font: null };
export const openThemeColors = (ed: Ed, id: string | null = null) => { target.color = id; ed.setDialog('themeColors'); };
export const openThemeFonts = (ed: Ed, id: string | null = null) => { target.font = id; ed.setDialog('themeFonts'); };

// ---------------------------------------------------------------- Create New Theme Colors

/** A small slide drawn in the scheme: Background 1 with Text 1, the accents, the hyperlink colours — and the dark pairing. */
function SchemePreview({ colors }: { colors: string[] }) {
  const [dk1, lt1, dk2, lt2, a1, a2, a3, a4, a5, a6, hl, fh] = colors;
  return (
    <div className="scheme-preview" aria-label="미리 보기">
      <div className="sp-slide" style={{ background: lt1, color: dk1 }}>
        <b style={{ color: dk1 }}>제목 텍스트</b>
        <span style={{ color: dk2 }}>본문 텍스트 <u style={{ color: hl }}>하이퍼링크</u> <u style={{ color: fh }}>열어 본 링크</u></span>
        <span className="sp-chips">{[a1, a2, a3, a4, a5, a6].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        <span className="sp-bar" style={{ background: lt2, color: dk1 }}>배경 2</span>
      </div>
      <div className="sp-slide" style={{ background: dk2, color: lt1 }}>
        <b>제목 텍스트</b>
        <span style={{ color: lt2 }}>어두운 배경의 본문</span>
        <span className="sp-chips">{[a1, a2, a3, a4, a5, a6].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        <span className="sp-bar" style={{ background: dk1, color: lt1 }}>텍스트 1</span>
      </div>
    </div>
  );
}

export function ThemeColorsDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const builtin = colorSchemes();
  const all = loadColorSchemes();
  const editing = all.find((s) => s.id === target.color) ?? null;
  const base = useMemo(() => (editing?.colors ?? colorsOf(ed.p?.colorScheme, builtin)).map((c) => normalizeHex(c) ?? '#000000'), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<string[]>(base);
  const [name, setName] = useState(editing?.name ?? nextCustomName(all.map((s) => s.name)));
  const colors = draft.map((d, i) => normalizeHex(d) ?? base[i]);
  const bad = draft.map((d) => !normalizeHex(d));
  const clean = cleanName(name);
  const clash = all.some((s) => s.name === clean && s.id !== editing?.id);
  const set = (i: number, v: string) => setDraft((d) => d.map((x, k) => (k === i ? v : x)));
  const save = () => {
    const item: CustomColorScheme = { id: editing?.id ?? uid('cs'), name: clean, colors };
    saveColorScheme(item);
    bump();
    if (ed.p && ed.canEdit) ed.updatePres({ colorScheme: customSchemeId(item.name, item.colors) });
    ed.cmd.notify(`“${item.name}” 테마 색을 저장하고 적용했습니다`);
    onClose();
  };
  return (
    <Dialog title={editing ? '테마 색 편집' : '새 테마 색 만들기'} onClose={onClose} onOk={save} okLabel="저장" okDisabled={!clean || bad.some(Boolean)} wide>
      <div className="theme-colors-body">
        <div className="theme-colors-slots">
          {COLOR_SLOTS.map((s, i) => (
            <label key={s.key} className="theme-color-row">
              <span>{s.label}</span>
              <input type="color" aria-label={s.label} value={colors[i]} onChange={(e) => set(i, e.target.value)} />
              <input type="text" className={bad[i] ? 'bad' : ''} aria-label={`${s.label} 16진수`} maxLength={7} value={draft[i]} onChange={(e) => set(i, e.target.value)} />
            </label>
          ))}
        </div>
        <SchemePreview colors={colors} />
      </div>
      <Field label="이름"><input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      <p className="muted small">{clash ? '같은 이름의 사용자 지정 색이 있어 저장하면 바뀝니다. ' : ''}저장하면 이 프레젠테이션에 적용되고 디자인 › 색 목록에 남습니다.{bad.some(Boolean) ? ' 빨갛게 표시된 칸은 #RRGGBB 형식이어야 합니다.' : ''}</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Create New Theme Fonts

const COMMON_FONTS = ['맑은 고딕', '나눔고딕', '나눔명조', '굴림', '돋움', '바탕', '궁서', 'Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Consolas'];
const FONT_NAMES = [...new Set([...FONT_OPTIONS.map((f) => f.pptx), ...COMMON_FONTS])];

export function ThemeFontsDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const all = loadFontSchemes();
  const editing = all.find((s) => s.id === target.font) ?? null;
  const cur = ed.p?.fontScheme;
  const [major, setMajor] = useState(editing?.major ?? cur?.major ?? '맑은 고딕');
  const [minor, setMinor] = useState(editing?.minor ?? cur?.minor ?? '맑은 고딕');
  const [name, setName] = useState(editing?.name ?? nextCustomName(all.map((s) => s.name)));
  const clean = cleanName(name);
  const importedNow = useImportedFonts().length ? importedFamilies() : [];
  const clash = all.some((s) => s.name === clean && s.id !== editing?.id);
  const save = () => {
    const item: CustomFontScheme = { id: editing?.id ?? uid('fs'), name: clean, major: major.trim(), minor: minor.trim() };
    saveFontScheme(item);
    bump();
    if (ed.p && ed.canEdit) ed.updatePres(applyFontScheme(ed.p, item));
    ed.cmd.notify(`“${item.name}” 테마 글꼴을 저장하고 적용했습니다`);
    onClose();
  };
  return (
    <Dialog title={editing ? '테마 글꼴 편집' : '새 테마 글꼴 만들기'} onClose={onClose} onOk={save} okLabel="저장" okDisabled={!clean || !major.trim() || !minor.trim()}>
      <datalist id="theme-font-names">{[...new Set([...importedNow, ...FONT_NAMES])].map((f) => <option key={f} value={f} />)}</datalist>
      <Field label="제목 글꼴"><input list="theme-font-names" value={major} onChange={(e) => setMajor(e.target.value)} /></Field>
      <Field label="본문 글꼴"><input list="theme-font-names" value={minor} onChange={(e) => setMinor(e.target.value)} /></Field>
      <div className="font-preview">
        <div style={{ fontFamily: officeFont(major || '맑은 고딕'), fontSize: 26, fontWeight: 700 }}>제목 글꼴 — 주님을 찬양해 Aa</div>
        <div style={{ fontFamily: officeFont(minor || '맑은 고딕'), fontSize: 17 }}>본문 글꼴 — 우리는 주님의 백성이요 Aa 123</div>
      </div>
      <FontImportButton className="btn small" label="글꼴 가져오기…" />
      <Field label="이름"><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      <p className="muted small">{clash ? '같은 이름의 사용자 지정 글꼴이 있어 저장하면 바뀝니다. ' : ''}저장하면 모든 슬라이드의 제목과 본문 글꼴이 바뀌고 디자인 › 글꼴 목록에 남습니다.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Slide Size

const CM = 2.54 / 72 / 2; // canvas px → cm (2 px per pt)
const cm = (px: number) => (Math.round(px * CM * 100) / 100).toString();
/** DeckCraft's sizes (points), shown so the choice is visible; none but 4:3 can be used. */
const OTHER_SIZES: [string, string][] = [
  ['와이드스크린 (16:9)', '33.87 × 19.05 cm'], ['화면 쇼 (16:10)', '25.4 × 15.88 cm'], ['Letter 용지 (8.5×11 인치)', '25.4 × 19.05 cm'],
  ['Ledger 용지 (11×17 인치)', '33.87 × 25.4 cm'], ['A3 용지 (297×420 mm)', '35.56 × 26.67 cm'], ['A4 용지 (210×297 mm)', '27.52 × 19.05 cm'],
  ['B4 (ISO) 용지 (250×353 mm)', '30.06 × 22.54 cm'], ['B5 (ISO) 용지 (176×250 mm)', '21.1 × 15.82 cm'], ['35mm 슬라이드', '28.58 × 19.05 cm'],
  ['오버헤드', '25.4 × 19.05 cm'], ['배너', '20.32 × 2.54 cm'], ['정사각형 (1:1)', '19.05 × 19.05 cm'], ['세로 (9:16)', '19.05 × 33.87 cm'],
];

export function SlideSizeDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="슬라이드 크기" onClose={onClose} onOk={onClose} okLabel="확인">
      <div className="slide-size-list" role="radiogroup" aria-label="슬라이드 크기">
        <label className="slide-size-row on"><input type="radio" checked readOnly /> <b>표준 (4:3)</b> <span>{cm(CANVAS_W)} × {cm(CANVAS_H)} cm · {CANVAS_W} × {CANVAS_H} px</span></label>
        {OTHER_SIZES.map(([n, d]) => <label key={n} className="slide-size-row off" title="LightCast는 4:3 크기만 지원합니다"><input type="radio" disabled /> {n} <span>{d}</span></label>)}
        <label className="slide-size-row off" title="LightCast는 4:3 크기만 지원합니다"><input type="radio" disabled /> 사용자 지정 <span>너비 × 높이 (cm)</span></label>
      </div>
      <p className="muted small">LightCast의 슬라이드는 교회 프로젝터와 PowerPoint 서식 파일(앞면 · 뒷면 · 예배 템플릿)에 맞춘 4:3 고정 크기(1440 × 1080)입니다. 출력 창, 무대 화면, 리모컨, .pptx 내보내기가 모두 이 크기를 기준으로 하므로 회색으로 표시된 크기와 사용자 지정 크기는 선택할 수 없습니다.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Design Ideas pane

/** The width / height of each picture on the slide, from the picture files (the ideas crop to the box). */
function useAspects(slide: Slide | null): Record<string, number | undefined> {
  const ids = [...new Set((slide?.elements ?? []).filter((e) => e.kind === 'image' && e.mediaId).map((e) => e.mediaId!))].join(',');
  const [aspects, setAspects] = useState<Record<string, number | undefined>>({});
  useEffect(() => {
    let alive = true;
    for (const id of ids ? ids.split(',') : []) {
      void mediaUrl(id).then((url) => {
        if (!url || !alive) return;
        const img = new Image();
        img.onload = () => { if (alive && img.naturalHeight) setAspects((a) => (a[id] === img.naturalWidth / img.naturalHeight ? a : { ...a, [id]: img.naturalWidth / img.naturalHeight })); };
        img.src = url;
      });
    }
    return () => { alive = false; };
  }, [ids]);
  return aspects;
}

export function DesignerPane({ ed }: { ed: Ed }) {
  const { slide, p, theme } = ed;
  const aspects = useAspects(slide);
  const ideas = ideasFor(slide);
  const variants = useMemo(() => (slide ? ideas.map((i) => ({ idea: i, slide: applyIdea(slide, i.id, { theme: theme ?? undefined, aspects }) })).filter((v): v is { idea: typeof ideas[number]; slide: Slide } => !!v.slide) : []), [slide, theme, aspects]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = (id: IdeaId) => {
    const out = slide && applyIdea(slide, id, { theme: theme ?? undefined, aspects });
    if (!out) return;
    ed.updateSlide({ elements: out.elements, title: out.title, text: out.text, subtext: out.subtext });
    ed.setSel([]);
  };
  return (
    <div className="task-pane designer-pane">
      <div className="task-head"><span>디자인 아이디어</span><button type="button" className="task-x" title="닫기" onClick={() => ed.setPane(null)}>✕</button></div>
      {!variants.length && (
        <p className="task-empty">이 슬라이드에는 적용할 디자인 아이디어가 없습니다. 제목과 내용, 또는 그림이 있는 슬라이드에서 배치를 제안합니다. (표 · 차트 · 도형 등 다른 개체가 있거나 그림이 둘 이상이면 제안하지 않습니다.)</p>
      )}
      <div className="designer-list">
        {variants.map(({ idea, slide: s }) => (
          <button key={idea.id} type="button" className="designer-idea" disabled={!ed.canEdit} title={idea.label} onClick={() => apply(idea.id)}>
            <SlideCanvas slide={s} theme={theme!} background={p && slide ? resolveBackground(slide, p) : null} />
            <span>{idea.label}</span>
          </button>
        ))}
      </div>
      {!!variants.length && <p className="muted small">고르면 이 슬라이드의 제목 · 내용 · 그림 배치만 바뀝니다. 되돌리려면 실행 취소(Ctrl+Z)를 누르세요.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Format Background

/** Where a background picture comes from: a file, the clipboard, or an address on the internet. */
export function BackgroundSources({ ed, setBg, onFile }: { ed: Pick<Ed, 'dispatch' | 'cmd'>; setBg: (b: Background) => void; onFile: () => void }) {
  const [asking, setAsking] = useState(false);
  const [url, setUrl] = useState('');
  const take = async (blob: Blob, name: string) => {
    const id = uid('m');
    await putMedia(id, blob);
    ed.dispatch({ type: 'media/add', media: { id, name, type: 'image' } });
    setBg({ kind: 'media', mediaId: id, mediaType: 'image', fit: 'cover' });
  };
  const fromClipboard = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return void (await take(await item.getType(type), '붙여넣은 배경.png'));
      }
    } catch { /* clipboard not readable */ }
    ed.cmd.notify('클립보드에 그림이 없습니다');
  };
  const fromWeb = async () => {
    try {
      const u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error('scheme');
      const r = await fetch(u.href);
      const blob = await r.blob();
      if (!r.ok || !blob.type.startsWith('image/')) throw new Error('not an image');
      await take(blob, decodeURIComponent(u.pathname.split('/').pop() || '온라인 배경'));
      setAsking(false); setUrl('');
    } catch {
      ed.cmd.notify('이 주소에서 그림을 가져오지 못했습니다. 그림 주소(https://…)가 맞는지, 사이트가 허용하는지 확인하세요');
    }
  };
  return (
    <>
      <div className="fmt-row">
        <button type="button" title="이 컴퓨터의 그림 · 동영상 파일" onClick={onFile}>파일에서…</button>
        <button type="button" title="복사한 그림을 배경으로" onClick={() => void fromClipboard()}>클립보드에서</button>
        <button type="button" title="인터넷의 그림 주소" className={asking ? 'on' : ''} onClick={() => setAsking(!asking)}>온라인…</button>
      </div>
      {asking && (
        <div className="fmt-row">
          <input className="grow" autoFocus placeholder="그림 주소 https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void fromWeb(); }} />
          <button type="button" disabled={!url.trim()} onClick={() => void fromWeb()}>가져오기</button>
        </div>
      )}
    </>
  );
}

const NumRow = ({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (n: number) => void }): ReactNode => (
  <label className="fmt-num"><span>{label}</span><input type="number" min={min} max={max} step={step} value={value} onChange={(e) => { if (e.target.value !== '') onChange(Number(e.target.value)); }} /><em>{unit}</em></label>
);

/** Picture fill: transparency, and tiling as a texture with its scale, offset, alignment and mirror. */
export function BackgroundPictureOptions({ bg, setBg }: { bg: Extract<Background, { kind: 'media' | 'image' }>; setBg: (b: Background) => void }) {
  if (bg.kind === 'media' && bg.mediaType !== 'image') return null;
  const o = bg.pic;
  const set = (patch: Partial<BackgroundPicture>) => { const pic = patchPicture(o, patch); const { pic: _old, ...rest } = bg; setBg(pic ? { ...rest, pic } as Background : rest as Background); };
  return (
    <div className="bg-pic-options">
      <label className="fmt-num"><span>투명도</span><input type="range" min={0} max={100} value={o?.transparency ?? 0} onChange={(e) => set({ transparency: Number(e.target.value) })} /><em>{o?.transparency ?? 0}%</em></label>
      <label className="rb-check"><input type="checkbox" checked={!!o?.tile} onChange={(e) => set({ tile: e.target.checked })} /> 그림을 질감으로 바둑판식 배열</label>
      {o?.tile && (
        <>
          <NumRow label="가로 배율" value={o.scaleX ?? 100} min={1} max={1000} unit="%" onChange={(n) => set({ scaleX: n })} />
          <NumRow label="세로 배율" value={o.scaleY ?? 100} min={1} max={1000} unit="%" onChange={(n) => set({ scaleY: n })} />
          <NumRow label="가로 오프셋" value={o.offsetX ?? 0} min={-4000} max={4000} unit="px" onChange={(n) => set({ offsetX: n })} />
          <NumRow label="세로 오프셋" value={o.offsetY ?? 0} min={-4000} max={4000} unit="px" onChange={(n) => set({ offsetY: n })} />
          <label className="fmt-num"><span>맞춤</span><select value={o.align ?? 'tl'} onChange={(e) => set({ align: e.target.value as BackgroundPicture['align'] })}>{ALIGNS.map((a) => <option key={a} value={a}>{ALIGN_LABEL[a]}</option>)}</select></label>
          <label className="fmt-num"><span>대칭 종류</span><select value={o.mirror ?? 'none'} onChange={(e) => set({ mirror: e.target.value as BackgroundPicture['mirror'] })}>{MIRRORS.map((m) => <option key={m} value={m}>{MIRROR_LABEL[m]}</option>)}</select></label>
        </>
      )}
      {o && <button type="button" onClick={() => setBg((({ pic: _p, ...rest }) => rest as Background)(bg))}>그림 옵션 초기화</button>}
    </div>
  );
}
