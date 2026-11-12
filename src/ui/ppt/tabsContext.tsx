// The tabs PowerPoint adds while an object is selected: 도형 서식, 그림 서식, 테이블 디자인,
// 레이아웃 (표) and 차트 디자인.
import { useRef, useState, type CSSProperties } from 'react';
import type { PictureAdjust, SlideElement } from '../../domain/types';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { PICTURE_STYLE_IDS } from '../SlideCanvas';
import { adjustPicture, colorAt } from './pictureTools';
import { EffectsMenu } from './tabsMain';
import { pictureCatalog, type PictureSteps } from '../../engine';
import { editTable, tableStyles, type ChartKind, type TableAction, type TableData } from '../../engine';
import type { Ed } from './editor';
import { ArrangeMenu, ShapeStyleButtons, AlignItems } from './tabsMain';
import { ShapeGallery, ShapeThumb } from './galleries';
import { Big, Col, ColorButton, ColorGrid, DropButton, Gallery, Group, MenuHead, MenuItem, MenuSep, RI, Small } from './ribbonParts';
import { orderSelection, rotateSelection, flipSelection, groupSelection, ungroupSelection, canGroup, canUngroup, canRegroup, regroupSelection, canMerge, mergeSelection, pathShapeOf } from '../../domain/editOps';
import { shapeToPath, smoothCorners, warpCatalog, warpGuides } from '../../engine';
import { WARP_LABEL, polyD, warpPreset } from '../../domain/textWarp';
import { smartArtOwner } from '../../domain/smartArt';
import { applyBorders, CELL_MARGINS, editCells, setTrackSize, trackSizes, type BorderMode } from '../../domain/tableBorders';
import type { CellBorder, TableCell } from '../../engine';
import { layoutTable } from '../../engine';

export type ContextTab = 'shape' | 'picture' | 'tableDesign' | 'tableLayout' | 'chart';
export const CONTEXT_LABEL: Record<ContextTab, string> = { shape: '도형 서식', picture: '그림 서식', tableDesign: '테이블 디자인', tableLayout: '레이아웃', chart: '차트 디자인' };

/** The contextual tabs for what is selected. */
export function contextTabs(ed: Ed): ContextTab[] {
  const kinds = new Set(ed.selEls.map((e) => e.kind));
  if (!kinds.size) return [];
  if (kinds.size === 1 && kinds.has('table')) return ['tableDesign', 'tableLayout'];
  if (kinds.size === 1 && kinds.has('chart')) return ['chart'];
  if (kinds.size === 1 && kinds.has('image')) return ['picture'];
  return ['shape'];
}

function ArrangeGroup({ ed }: { ed: Ed }) {
  const sel = ed.selEls.map((e) => e.id);
  const act = (fn: (els: SlideElement[]) => SlideElement[]) => ed.setElements(fn);
  return (
    <Group label="정렬">
      <Col>
        <Small icon={RI.bringFront} label="앞으로 가져오기" onClick={() => act((e) => orderSelection(e, sel, 'forward'))} />
        <Small icon={RI.sendBack} label="뒤로 보내기" onClick={() => act((e) => orderSelection(e, sel, 'backward'))} />
        <Small icon={RI.selectionPane} label="선택 창" active={ed.pane === 'selection'} onClick={() => ed.setPane(ed.pane === 'selection' ? null : 'selection')} />
      </Col>
      <Col>
        <DropButton icon={RI.align} label="맞춤" render={(close) => <AlignItems ed={ed} close={close} />} />
        <DropButton icon={RI.group} label="그룹화" render={(close) => (
          <>
            <MenuItem label="그룹" hint="Ctrl+G" disabled={!canGroup(ed.elements, sel)} onClick={() => { act((e) => groupSelection(e, sel)); close(); }} />
            <MenuItem label="그룹 해제" hint="Ctrl+Shift+G" disabled={!canUngroup(ed.elements, sel)} onClick={() => { act((e) => ungroupSelection(e, sel)); close(); }} />
            <MenuItem label="다시 그룹" disabled={!canRegroup(ed.elements, sel)} onClick={() => { const r = regroupSelection(ed.elements, sel); ed.setElements(() => r.elements); ed.setSel(r.ids); close(); }} />
          </>
        )} />
        <DropButton icon={RI.rotate} label="회전" render={(close) => (
          <>
            <MenuItem label="오른쪽으로 90도 회전" onClick={() => { act((e) => rotateSelection(e, sel, 90)); close(); }} />
            <MenuItem label="왼쪽으로 90도 회전" onClick={() => { act((e) => rotateSelection(e, sel, -90)); close(); }} />
            <MenuItem label="상하 대칭" onClick={() => { act((e) => flipSelection(e, sel, 'vertical')); close(); }} />
            <MenuItem label="좌우 대칭" onClick={() => { act((e) => flipSelection(e, sel, 'horizontal')); close(); }} />
          </>
        )} />
      </Col>
      <DropButton big icon={RI.arrange} label="정렬" render={(close) => <ArrangeMenu ed={ed} close={close} />} />
    </Group>
  );
}

function SizeGroup({ ed }: { ed: Ed }) {
  const one = ed.selEls.length === 1 ? ed.selEls[0] : null;
  const set = (patch: Partial<SlideElement>) => one && ed.setElements((els) => els.map((e) => (e.id === one.id ? { ...e, ...patch, ...(e.kind === 'text' ? { autoFit: false } : {}) } : e)));
  // Canvas pixels: a 1440-wide slide is 25.4 cm, so 1 cm ≈ 56.7 px.
  const cm = (px: number) => (px / (1440 / 25.4)).toFixed(2);
  const px = (v: string) => Math.max(1, Math.round(Number(v) * (1440 / 25.4)));
  return (
    <Group label="크기">
      <Col>
        <label className="rb-field">↕ 높이: <input type="number" step={0.1} disabled={!one} value={one ? cm(one.h) : ''} onChange={(e) => set({ h: px(e.target.value) })} /> cm</label>
        <label className="rb-field">↔ 너비: <input type="number" step={0.1} disabled={!one} value={one ? cm(one.w) : ''} onChange={(e) => set({ w: px(e.target.value) })} /> cm</label>
        <label className="rb-field">⟳ 회전: <input type="number" step={1} disabled={!one} value={one?.rotation ?? 0} onChange={(e) => set({ rotation: Number(e.target.value) || undefined })} /> °</label>
      </Col>
    </Group>
  );
}

export function ShapeFormatTab({ ed }: { ed: Ed }) {
  const shapes = ed.selEls.filter((e) => e.kind === 'shape');
  const text = ed.selEls.filter((e) => e.kind === 'text' || e.kind === 'shape');
  const setText = (patch: Partial<SlideElement>) => ed.setElements((els) => els.map((e) => (text.some((t) => t.id === e.id) ? { ...e, ...patch } : e)));
  return (
    <>
      <Group label="도형 삽입">
        <Gallery rows={3} className="rb-shape-strip">
          {['rect', 'ellipse', 'triangle', 'roundRect', 'rightArrow', 'star5', 'line', 'straightConnector1', 'textBox'].map((n) => <button key={n} type="button" className="shape-cell" onClick={() => ed.setTool({ kind: 'shape', name: n })}><ShapeThumb name={n} size={16} /></button>)}
        </Gallery>
        <DropButton icon="⬠" label="도형 편집" title="도형 모양 변경 · 점 편집" disabled={!shapes.length} wide render={(close) => (
          <>
            <MenuItem label="점 편집" hint="점을 끌어 모양을 바꿉니다 (Enter: 끝)" disabled={shapes.length !== 1} onClick={() => {
              const el = shapes[0];
              // A preset first becomes its own outline (curves kept), as PowerPoint does.
              if (!el.path) {
                const p = shapeToPath(pathShapeOf(el));
                if (p) ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, path: p.path, pathW: p.pathW, pathH: p.pathH, shape: undefined, adj: undefined } : e)));
              }
              ed.setTool({ kind: 'points', id: el.id });
              close();
            }} />
            <MenuHead>부드러운 모서리</MenuHead>
            <div className="rb-chip-row">{[0, 25, 50, 75, 100].map((v) => (
              <button key={v} type="button" className="mini-btn" title={`모서리를 ${v}% 부드럽게 (사각형 → 둥근 정도)`} disabled={!shapes.length} onClick={() => {
                ed.setElements((els) => els.map((e) => {
                  if (!shapes.some((x) => x.id === e.id)) return e;
                  const short = Math.min(e.w, e.h);
                  const radius = e.shape === 'roundRect' ? ((e.adj?.[0] ?? 16667) / 100000) * short : short * 0.1666;
                  const r = smoothCorners(e.w, e.h, v / 100, radius);
                  return r ? { ...e, shape: undefined, adj: undefined, ellipse: undefined, radius: undefined, path: r.path, pathW: r.pathW, pathH: r.pathH, name: e.name ?? '부드러운 모서리 사각형' } : e;
                }));
                close();
              }}>{v}%</button>
            ))}</div>
            <MenuHead>도형 모양 변경</MenuHead>
            <ShapeGallery compact onPick={(n) => { ed.setElements((els) => els.map((e) => (shapes.some((s) => s.id === e.id) ? { ...e, shape: n, adj: undefined, ellipse: undefined, radius: undefined, path: undefined, pathW: undefined, pathH: undefined } : e))); close(); }} />
          </>
        )} />
        <DropButton icon="◒" label="도형 병합" title="선택한 순서대로: 첫 도형의 서식이 남습니다" disabled={!canMerge(ed.elements, ed.sel)} render={(close) => (
          <>
            {([['union', '통합'], ['combine', '결합'], ['fragment', '조각'], ['intersect', '교차'], ['subtract', '빼기']] as const).map(([m, l]) => (
              <MenuItem key={m} label={l} onClick={() => { const r = mergeSelection(ed.elements, ed.sel, m); if (r.ids.length) { ed.setElements(() => r.elements); ed.setSel(r.ids); } close(); }} />
            ))}
          </>
        )} />
        <Small icon="★" label="기본 도형으로 설정" title="새로 그리는 도형이 이 서식을 따릅니다" disabled={shapes.length !== 1} onClick={() => { const e = shapes[0]; ed.updatePres({ defaultShape: { fill: e.fill, stroke: e.stroke, strokeWidth: e.strokeWidth, gradient: e.gradient, gradientAngle: e.gradientAngle, dropShadow: e.dropShadow, glow: e.glow, color: e.color, fontSize: e.fontSize } }); ed.cmd.notify('새 도형이 이 서식으로 그려집니다'); }} />
      </Group>
      {smartArtOwner(ed.elements, ed.selEls) && (
        <Group label="SmartArt">
          <Big icon="⧉" label="텍스트 창 · 레이아웃" title="SmartArt의 텍스트, 레이아웃, 스타일, 색 바꾸기" onClick={() => ed.setDialog('smartArt')} />
          <Big icon="🖼" label="그림 삽입" title="선택한 SmartArt 도형을 그림으로 채웁니다 (그림 레이아웃의 그림 자리)" disabled={ed.sel.length !== 1}
            onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (!f) return; const id = uid('m'); void putMedia(id, f).then(() => { ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image', backgroundHidden: true } }); ed.setElements((els) => els.map((e) => (e.id === ed.sel[0] ? { ...e, fillImage: id, pattern: undefined, gradient: undefined } : e))); }); }; inp.click(); }} />
          <DropButton big icon="⇄" label="변환" render={(close) => {
            const owner = smartArtOwner(ed.elements, ed.selEls);
            return (
              <>
                <MenuItem label="도형으로 변환" onClick={() => { if (owner) ed.setElements((els) => els.map((e) => (e.id === owner.id ? { ...e, smartArt: undefined } : e))); close(); }} />
                <MenuItem label="텍스트로 변환" onClick={() => {
                  if (!owner?.smartArt) return close();
                  const g = owner.groupId, sa = owner.smartArt;
                  const box: SlideElement = { id: uid('el'), kind: 'text', text: sa.nodes.map((n) => n.text).join('\n'), x: sa.box.x, y: sa.box.y, w: sa.box.w, h: sa.box.h, fontSize: 48, color: '#ffffff', align: 'left', list: 'bullet' };
                  ed.setElements((els) => [...els.filter((e) => (g ? e.groupId !== g : e.id !== owner.id)), box]);
                  ed.setSel([box.id]);
                  close();
                }} />
              </>
            );
          }} />
        </Group>
      )}
      <Group label="도형 스타일"><ShapeStyleButtons ed={ed} big /></Group>
      <Group label="WordArt 스타일" launcher={text.length ? () => ed.setDialog('font') : undefined}>
        <Col>
          <ColorButton icon={<b style={{ fontSize: 14 }}>A</b>} label="텍스트 채우기" title="텍스트 채우기" disabled={!text.length} value={text[0]?.color} onPick={(c) => setText({ color: c })} />
          <DropButton icon={<b style={{ WebkitTextStroke: '1px #c43e1c', color: 'transparent', fontSize: 14 }}>A</b>} label="텍스트 윤곽선" disabled={!text.length} render={(close) => (
            <>
              <MenuItem label="윤곽선 없음" on={!text[0]?.textOutline} onClick={() => { setText({ textOutline: undefined }); close(); }} />
              <ColorGrid value={text[0]?.textOutline?.color} scheme={ed.p?.colorScheme} onPick={(c) => { setText({ textOutline: { color: c, width: text[0]?.textOutline?.width ?? 3 } }); close(); }} />
              <MenuHead>두께</MenuHead>
              {[1, 2, 3, 4, 6, 9].map((w) => <MenuItem key={w} label={`${w / 2} pt`} on={text[0]?.textOutline?.width === w} onClick={() => { setText({ textOutline: { color: text[0]?.textOutline?.color ?? '#000000', width: w } }); close(); }} />)}
            </>
          )} />
          <DropButton icon={<b style={{ textShadow: '1px 1px 1px #888' }}>A</b>} label="텍스트 효과" disabled={!text.length} render={(close) => (
            <>
              <MenuItem label="그림자" on={!!text[0]?.shadow} onClick={() => { setText({ shadow: !text[0]?.shadow }); close(); }} />
              <MenuItem label="모두 대문자" on={text[0]?.caps === 'all'} onClick={() => { setText({ caps: text[0]?.caps === 'all' ? undefined : 'all' }); close(); }} />
              <MenuItem label="작은 대문자" on={text[0]?.caps === 'small'} onClick={() => { setText({ caps: text[0]?.caps === 'small' ? undefined : 'small' }); close(); }} />
              <MenuHead>텍스트 투명도</MenuHead>
              <div className="rb-chip-row">{[0, 0.25, 0.5, 0.75].map((v) => <button key={v} type="button" className={`mini-btn ${(text[0]?.textTransparency ?? 0) === v ? 'on' : ''}`} onClick={() => { setText({ textTransparency: v || undefined }); close(); }}>{v * 100}%</button>)}</div>
              <MenuHead>변환</MenuHead>
              <WarpGallery value={text[0]?.warp} disabled={!text.some((t) => t.kind === 'text')} onPick={(w) => { setText({ warp: w }); close(); }} />
              <MenuSep />
              <MenuItem label="텍스트 옵션…" onClick={() => { ed.setDialog('paragraph'); close(); }} />
            </>
          )} />
        </Col>
      </Group>
      <ArrangeGroup ed={ed} />
      <SizeGroup ed={ed} />
    </>
  );
}

/** WordArt › Text Effects › Transform: DeckCraft's 40 presets, Follow Path then Warp, each drawn on its own guides. */
function WarpGallery({ value, onPick, disabled }: { value?: string; onPick: (w: string | undefined) => void; disabled?: boolean }) {
  const cat = warpCatalog();
  const cur = value ? warpPreset(value) : undefined;
  const cell = (id: string) => {
    const bands = warpGuides(id, 60, 30) ?? [];
    return (
      <button key={id} type="button" className={`warp-cell ${cur === id ? 'on' : ''}`} title={WARP_LABEL[id] ?? id} disabled={disabled} onClick={() => onPick(id === 'textPlain' ? undefined : id)}>
        <svg viewBox="-4 -8 68 46" width="44" height="30">
          {bands.map((b, i) => b.kind === 'fill'
            ? <g key={i}><path d={polyD(b.top)} fill="none" stroke="#c43e1c" strokeWidth="1.6" /><path d={polyD(b.bottom)} fill="none" stroke="#c43e1c" strokeWidth="1.6" /></g>
            : <path key={i} d={polyD(b.path, b.closed)} fill="none" stroke="#c43e1c" strokeWidth="2.4" />)}
        </svg>
      </button>
    );
  };
  return (
    <div className="warp-gallery">
      <button type="button" className={`mini-btn ${!value ? 'on' : ''}`} disabled={disabled} onClick={() => onPick(undefined)}>변환 없음</button>
      <div className="warp-head">경로 따라</div>
      <div className="warp-grid">{cat.filter((c) => c.follow).map((c) => cell(c.id))}</div>
      <div className="warp-head">휘기</div>
      <div className="warp-grid">{cat.filter((c) => !c.follow).map((c) => cell(c.id))}</div>
    </div>
  );
}

const ARTISTIC_LABEL: Record<string, string> = {
  artisticBlur: '흐리게', artisticPencilGrayscale: '연필 회색조', artisticLineDrawing: '선 그리기', artisticPhotocopy: '복사',
  artisticFilmGrain: '필름 입자', artisticCutout: '오려내기', artisticGlowEdges: '네온 가장자리',
};
const RECOLOR_LABEL = (id: string) => ({ none: '다시 칠하기 없음', grayscale: '회색조', sepia: '세피아', washout: '희미하게', bw25: '흑백: 25%', bw50: '흑백: 50%', bw75: '흑백: 75%' } as Record<string, string>)[id]
  ?? id.replace(/accent(\d)(Dark|Light)/, (_, n, k) => `강조 ${n} ${k === 'Dark' ? '어둡게' : '밝게'}`);
const PIC_STYLE_LABEL: Record<string, string> = {
  simpleFrame: '단순형 프레임, 흰색', thickMatte: '두꺼운 매트, 검정', polaroid: '사진 테두리', shadowRect: '그림자 사각형', rounded: '둥근 대각선 모서리',
  oval: '타원', softEdge: '부드러운 가장자리 사각형', reflected: '반사된 둥근 사각형', tilted: '원근감 있는 그림자', beveled: '입체 사각형',
};

export function PictureFormatTab({ ed }: { ed: Ed }) {
  const pics = ed.selEls.filter((e) => e.kind === 'image');
  const set = (patch: Partial<SlideElement>) => ed.setElements((els) => els.map((e) => (pics.some((p) => p.id === e.id) ? { ...e, ...patch } : e)));
  const p = pics[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const a = p?.picture;
  /** Re-make the selected picture from its original with these adjustments (through the engine). */
  const adjust = async (patch: Partial<PictureAdjust> | null, extra?: PictureSteps) => {
    if (!p) return;
    setBusy(true);
    try {
      const r = await adjustPicture(p, patch, ed.dispatch, ed.p?.colorScheme, extra);
      if (!r) ed.cmd.notify('그림을 처리하지 못했습니다');
      else ed.setElements((els) => els.map((e) => (e.id === p.id ? { ...e, ...r } : e)));
    } finally { setBusy(false); }
  };
  const pcts = [-40, -20, 0, 20, 40];
  const cat = pictureCatalog();
  const cropAspect = (rw: number, rh: number) => {
    if (!p) return;
    const target = rw / rh, cur = p.w / p.h;
    const [l, t, r, b] = p.crop ?? [0, 0, 0, 0];
    const fw = 1 - l - r, fh = 1 - t - b;
    // Keep the middle of what is shown, cut the long side down to the ratio.
    if (cur > target) { const cut = fw * (1 - target / cur) / 2; set({ crop: [l + cut, t, r + cut, b], w: Math.round(p.h * target), x: Math.round(p.x + (p.w - p.h * target) / 2), fit: 'fill' }); }
    else { const cut = fh * (1 - cur / target) / 2; set({ crop: [l, t + cut, r, b + cut], h: Math.round(p.w / target), y: Math.round(p.y + (p.h - p.w / target) / 2), fit: 'fill' }); }
  };
  const replace = async (file: File | undefined) => {
    if (!file || !p) return;
    const id = uid('m');
    await putMedia(id, file);
    ed.dispatch({ type: 'media/add', media: { id, name: file.name, type: 'image' } });
    set({ mediaId: id, picture: undefined, crop: undefined });
  };
  return (
    <>
      <Group label="조정">
        <Big icon="✂" label={busy ? '처리 중…' : '배경 제거'} title="가장자리에서 이어진 배경을 투명하게 (엔진)" disabled={!p || busy} onClick={() => void adjust({ removeBackground: a?.removeBackground ? undefined : 20 })} active={!!a?.removeBackground} />
        <DropButton big icon="☀" label="수정" disabled={!p || busy} wide render={(close) => (
          <>
            <MenuHead>선명도 조정</MenuHead>
            <div className="adj-grid">{[-0.5, -0.25, 0, 0.25, 0.5].map((v) => <button key={v} type="button" className={`mini-btn ${(a?.sharpness ?? 0) === v ? 'on' : ''}`} onClick={() => { void adjust({ sharpness: v || undefined }); close(); }}>{v > 0 ? '선명하게' : v < 0 ? '부드럽게' : '0%'} {v ? `${Math.abs(v * 100)}%` : ''}</button>)}</div>
            <MenuHead>밝기/대비</MenuHead>
            <div className="adj-grid">{pcts.flatMap((c) => pcts.map((b) => (
              <button key={`${b}${c}`} type="button" className={`mini-btn ${Math.round((a?.brightness ?? 0) * 100) === b && Math.round((a?.contrast ?? 0) * 100) === c ? 'on' : ''}`} title={`밝기 ${b}% 대비 ${c}%`} onClick={() => { void adjust({ brightness: b / 100 || undefined, contrast: c / 100 || undefined }); close(); }}>{b}/{c}</button>
            )))}</div>
          </>
        )} />
        <DropButton big icon="🎨" label="색" disabled={!p || busy} wide render={(close) => (
          <>
            <MenuHead>채도</MenuHead>
            <div className="adj-grid">{[-1, -0.5, 0, 0.5, 1].map((v) => <button key={v} type="button" className={`mini-btn ${(a?.saturation ?? 0) === v ? 'on' : ''}`} onClick={() => { void adjust({ saturation: v || undefined }); close(); }}>{Math.round((1 + v) * 100)}%</button>)}</div>
            <MenuHead>색조</MenuHead>
            <div className="adj-grid">{[-0.6, -0.3, 0, 0.3, 0.6].map((v) => <button key={v} type="button" className={`mini-btn ${(a?.temperature ?? 0) === v ? 'on' : ''}`} onClick={() => { void adjust({ temperature: v || undefined }); close(); }}>{v < 0 ? '차갑게' : v > 0 ? '따뜻하게' : '그대로'} {v ? Math.abs(v * 100) : ''}</button>)}</div>
            <MenuHead>다시 칠하기</MenuHead>
            <div className="recolor-list">{(cat?.recolor ?? []).map((r) => <MenuItem key={r} label={RECOLOR_LABEL(r)} on={(a?.recolor ?? 'none') === r} onClick={() => { void adjust({ recolor: r === 'none' ? undefined : r }); close(); }} />)}</div>
            <MenuSep />
            <MenuItem label="투명한 색 설정 — 그림에서 클릭" onClick={() => { if (p) ed.setTool({ kind: 'eyedrop', id: p.id, onPick: (fx, fy) => void colorAt(p, fx, fy).then((c) => { if (c) void adjust({ transparentColor: c }); }) }); close(); }} />
            {a?.transparentColor && <MenuItem label="투명한 색 없애기" onClick={() => { void adjust({ transparentColor: undefined }); close(); }} />}
          </>
        )} />
        <DropButton big icon="🖌" label="꾸밈 효과" disabled={!p || busy} render={(close) => (
          <>
            <MenuItem label="없음" on={!a?.artistic} onClick={() => { void adjust({ artistic: undefined }); close(); }} />
            {(cat?.artistic ?? []).map((x) => <MenuItem key={x} label={ARTISTIC_LABEL[x] ?? x} on={a?.artistic === x} onClick={() => { void adjust({ artistic: x }); close(); }} />)}
          </>
        )} />
        <DropButton big icon="◐" label="투명도" disabled={!p} render={(close) => <>{[0, 15, 30, 50, 65, 80].map((t) => <MenuItem key={t} label={`투명도: ${t}%`} on={Math.round((1 - (p?.opacity ?? 1)) * 100) === t} onClick={() => { set({ opacity: 1 - t / 100 }); close(); }} />)}</>} />
        <Col>
          <Small icon="🗜" label="그림 압축" title="긴 쪽을 1920픽셀로 줄여 파일을 작게" disabled={!p || busy} onClick={() => void adjust({}, { maxSide: 1920 })} />
          <Small icon="🔁" label="그림 바꾸기" disabled={!p} onClick={() => fileRef.current?.click()} />
          <Small icon="↺" label="그림 원래대로" disabled={!p || (!a && !p.crop && !p.pictureStyle && !p.maskShape)} onClick={() => { void adjust(null); set({ crop: undefined, pictureStyle: undefined, maskShape: undefined }); }} />
        </Col>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void replace(e.target.files?.[0]); e.target.value = ''; }} />
      </Group>
      <Group label="그림 스타일">
        <DropButton big icon="🖼" label="빠른 스타일" disabled={!p} wide render={(close) => (
          <div className="pic-style-grid">
            <button type="button" className={`pic-style ${!p?.pictureStyle ? 'on' : ''}`} title="스타일 없음" onClick={() => { set({ pictureStyle: undefined }); close(); }}><span /></button>
            {PICTURE_STYLE_IDS.map((id) => <button key={id} type="button" className={`pic-style ${p?.pictureStyle === id ? 'on' : ''}`} title={PIC_STYLE_LABEL[id] ?? id} onClick={() => { set({ pictureStyle: id }); close(); }}><span style={PICTURE_STYLE_PREVIEW[id]} /></button>)}
          </div>
        )} />
        <Col>
          <ColorButton icon={RI.outline} label="그림 테두리" title="그림 테두리" value={p?.stroke} onPick={(c) => set({ stroke: c, strokeWidth: p?.strokeWidth ?? 6 })} onNone={() => set({ stroke: undefined })} noneLabel="윤곽선 없음" />
          <DropButton icon={RI.effects} label="그림 효과" disabled={!p} wide render={(close) => <EffectsMenu first={p} set={set} close={close} />} />
          <DropButton icon="▣" label="맞춤" render={(close) => <>{([['fill', '늘려서 채우기'], ['contain', '비율 유지 (전체)'], ['cover', '비율 유지 (꽉 차게)']] as const).map(([v, l]) => <MenuItem key={v} label={l} on={(p?.fit ?? 'contain') === v} onClick={() => { set({ fit: v }); close(); }} />)}</>} />
        </Col>
      </Group>
      <ArrangeGroup ed={ed} />
      <Group label="크기">
        <DropButton big icon="⛶" label="자르기" disabled={!p} wide render={(close) => (
          <>
            <MenuItem label="자르기" hint="검은 핸들을 끌기, Enter로 끝" onClick={() => { if (p) { ed.setSel([p.id]); ed.setTool({ kind: 'crop', id: p.id }); } close(); }} />
            <MenuHead>가로 세로 비율</MenuHead>
            {([[1, 1], [4, 3], [3, 4], [16, 9], [9, 16], [3, 2]] as const).map(([w, h]) => <MenuItem key={`${w}:${h}`} label={`${w}:${h}`} onClick={() => { cropAspect(w, h); close(); }} />)}
            <MenuHead>도형에 맞춰 자르기</MenuHead>
            <ShapeGallery compact onPick={(n) => { set({ maskShape: n === 'rect' ? undefined : n }); close(); }} />
            <MenuSep />
            <MenuItem label="자르기 없애기" onClick={() => { set({ crop: undefined, maskShape: undefined }); close(); }} />
          </>
        )} />
      </Group>
      <SizeGroup ed={ed} />
    </>
  );
}

const PICTURE_STYLE_PREVIEW: Record<string, CSSProperties> = {
  simpleFrame: { border: '3px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.5)' }, thickMatte: { border: '5px solid #222' }, polaroid: { borderStyle: 'solid', borderColor: '#fff', borderWidth: '3px 3px 9px' },
  shadowRect: { boxShadow: '3px 3px 5px rgba(0,0,0,.6)' }, rounded: { borderRadius: 8 }, oval: { borderRadius: '50%' }, softEdge: { WebkitMaskImage: 'radial-gradient(ellipse, #000 50%, transparent 75%)' },
  reflected: { borderRadius: 4, WebkitBoxReflect: 'below 1px linear-gradient(transparent 50%, rgba(255,255,255,.4))' }, tilted: { transform: 'perspective(80px) rotateY(-14deg)' }, beveled: { boxShadow: 'inset 2px 2px 3px rgba(255,255,255,.6), inset -2px -2px 3px rgba(0,0,0,.4)' },
};

const STYLE_KIND: Record<string, string> = { none: '스타일 없음', grid: '표 눈금', light1: '밝은 스타일 1', light2: '밝은 스타일 2', medium2: '보통 스타일 2', medium4: '보통 스타일 4', dark1: '어두운 스타일 1' };
const styleLabel = (id: string) => {
  const [kind, accent] = id.split('-');
  return `${STYLE_KIND[kind] ?? kind}${accent ? ` - ${accent === 'tx1' ? '텍스트' : `강조 ${accent.replace('accent', '')}`}` : ''}`;
};

function TableStyleThumb({ table, style, scheme }: { table: TableData; style: string; scheme?: string }) {
  const sample: TableData = { ...table, style, rows: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({ text: '' }))), cols: [1, 1, 1, 1], heights: [1, 1, 1, 1] };
  const cells = layoutTable(sample, 56, 36, scheme);
  return (
    <svg width="56" height="36" viewBox="0 0 56 36">
      <rect width="56" height="36" fill="#fff" />
      {cells.map((c) => <rect key={`${c.r}${c.c}`} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill ?? 'none'} stroke={c.border ?? 'none'} strokeWidth={0.6} />)}
    </svg>
  );
}

const tablePen = { current: { color: '#ffffff', width: 2 } as CellBorder };

export function TableDesignTab({ ed }: { ed: Ed }) {
  const [, setPenTick] = useState(0);
  const el = ed.selEls.find((e) => e.kind === 'table');
  const t = el?.table;
  if (!el || !t) return null;
  const setTable = (table: TableData) => ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, table } : e)));
  const opt = (k: 'firstRow' | 'firstCol' | 'lastRow' | 'lastCol' | 'bandRow' | 'bandCol', label: string) => (
    <label className="rb-check"><input type="checkbox" checked={!!t[k]} onChange={(e) => setTable({ ...t, [k]: e.target.checked })} /> {label}</label>
  );
  const { r, c, r1, c1 } = ed.cell;
  const [pen, setPen] = [tablePen.current, (p: CellBorder) => { tablePen.current = p; setPenTick((x) => x + 1); }];
  const shade = (fill: string | undefined) => setTable({ ...t, rows: t.rows.map((row, ri) => row.map((cell, ci) => (ri >= Math.min(r, r1) && ri <= Math.max(r, r1) && ci >= Math.min(c, c1) && ci <= Math.max(c, c1) ? { ...cell, fill } : cell))) });
  return (
    <>
      <Group label="표 스타일 옵션">
        <Col>{opt('firstRow', '머리글 행')}{opt('lastRow', '요약 행')}{opt('bandRow', '줄무늬 행')}</Col>
        <Col>{opt('firstCol', '첫째 열')}{opt('lastCol', '마지막 열')}{opt('bandCol', '줄무늬 열')}</Col>
      </Group>
      <Group label="표 스타일">
        <Gallery className="rb-table-styles">
          {['medium2-accent1', 'medium2-accent2', 'medium2-accent3', 'light1-accent1', 'light2-accent1', 'medium4-accent1', 'dark1-accent1'].map((s) => (
            <button key={s} type="button" className={`rb-tstyle ${t.style === s ? 'on' : ''}`} title={styleLabel(s)} onClick={() => setTable({ ...t, style: s })}><TableStyleThumb table={t} style={s} scheme={ed.p?.colorScheme} /></button>
          ))}
          <DropButton icon={<span className="rb-more">▾</span>} title="모든 표 스타일" wide render={(close) => (
            <div className="tstyle-all">{tableStyles().map((s) => <button key={s.id} type="button" className={`rb-tstyle ${t.style === s.id ? 'on' : ''}`} title={styleLabel(s.id)} onClick={() => { setTable({ ...t, style: s.id }); close(); }}><TableStyleThumb table={t} style={s.id} scheme={ed.p?.colorScheme} /></button>)}</div>
          )} />
        </Gallery>
        <ColorButton icon={RI.fill} label="음영" title="선택한 셀 음영 (서식 창에서 셀 선택)" onPick={(col) => shade(col)} onNone={() => shade(undefined)} noneLabel="채우기 없음" />
        <DropButton icon="▦" label="테두리" title="선택한 셀의 테두리를 펜 색과 두께로" render={(close) => (
          <>
            {([['bottom', '아래쪽 테두리'], ['top', '위쪽 테두리'], ['left', '왼쪽 테두리'], ['right', '오른쪽 테두리'], ['none', '테두리 없음'], ['all', '모든 테두리'], ['outside', '바깥쪽 테두리'], ['inside', '안쪽 테두리'], ['insideH', '안쪽 가로 테두리'], ['insideV', '안쪽 세로 테두리'], ['diagDown', '하향 대각선 테두리'], ['diagUp', '상향 대각선 테두리']] as [BorderMode, string][]).map(([m, l]) => (
              <MenuItem key={m} label={l} onClick={() => { setTable(applyBorders(t, ed.cell, m, pen)); close(); }} />
            ))}
          </>
        )} />
        <DropButton icon="✦" label="효과" title="표 효과: 셀 입체 효과 · 그림자 · 반사" render={(close) => (
          <>
            <MenuItem label="셀 입체 효과" on={!!t.cellBevel} onClick={() => { setTable({ ...t, cellBevel: !t.cellBevel || undefined }); close(); }} />
            <MenuItem label="그림자" on={!!el.dropShadow} onClick={() => { ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, dropShadow: !e.dropShadow || undefined } : e))); close(); }} />
            <MenuItem label="반사" on={!!el.reflection} onClick={() => { ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, reflection: !e.reflection || undefined } : e))); close(); }} />
          </>
        )} />
      </Group>
      <Group label="테두리 그리기">
        <Col>
          <label className="rb-field">펜 스타일 <select value={pen.dash ?? 'solid'} onChange={(e) => setPen({ ...pen, dash: e.target.value === 'solid' ? undefined : (e.target.value as CellBorder['dash']) })}>
            {([['solid', '실선'], ['dash', '파선'], ['dot', '점선'], ['dashDot', '파선-점선'], ['longDash', '긴 파선']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label className="rb-field">펜 두께 <select value={pen.width} onChange={(e) => setPen({ ...pen, width: Number(e.target.value) })}>{[1, 1.5, 2, 3, 4.5, 6, 9, 12].map((w) => <option key={w} value={w}>{w / 2} pt</option>)}</select></label>
          <label className="rb-field">펜 색 <input type="color" value={pen.color} onChange={(e) => setPen({ ...pen, color: e.target.value })} /></label>
        </Col>
        <Big icon="✎" label="표 그리기" title="셀 안을 끌어 선을 그리면 셀이 나뉩니다" active={ed.tool?.kind === 'tableDraw' && !ed.tool.erase} onClick={() => ed.setTool(ed.tool?.kind === 'tableDraw' && !ed.tool.erase ? null : { kind: 'tableDraw', id: el.id })} />
        <Big icon="⌫" label="지우개" title="셀 사이의 선을 클릭하면 두 셀이 합쳐집니다" active={ed.tool?.kind === 'tableDraw' && !!ed.tool.erase} onClick={() => ed.setTool(ed.tool?.kind === 'tableDraw' && ed.tool.erase ? null : { kind: 'tableDraw', id: el.id, erase: true })} />
      </Group>
    </>
  );
}

export function TableLayoutTab({ ed }: { ed: Ed }) {
  const el = ed.selEls.find((e) => e.kind === 'table');
  const t = el?.table;
  if (!el || !t) return null;
  const { r, c, r1, c1 } = ed.cell;
  const act = (a: TableAction) => {
    const next = editTable(t, a, Math.min(r, r1), Math.min(c, c1), Math.max(r, r1), Math.max(c, c1));
    if (next) ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, table: next } : e)));
    if (a === 'merge' || a === 'deleteRow' || a === 'deleteCol') ed.setCell({ r: Math.min(r, r1), c: Math.min(c, c1), r1: Math.min(r, r1), c1: Math.min(c, c1) });
  };
  const setT = (table: TableData, patch: Partial<SlideElement> = {}) => ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, ...patch, table } : e)));
  const cellsDo = (fn: (cell: TableCell) => TableCell) => setT(editCells(t, ed.cell, fn));
  const align = (al: 'left' | 'center' | 'right' | 'justify') => cellsDo((cell) => ({ ...cell, align: al }));
  const anchor = (a: 'top' | 'middle' | 'bottom') => cellsDo((cell) => ({ ...cell, anchor: a === 'middle' ? undefined : a }));
  const here = t.rows[Math.min(r, r1)]?.[Math.min(c, c1)];
  const nCols = Math.max(0, ...t.rows.map((x) => x.length));
  // Cell Size › Height / Width of the selected row and column, in points (2 canvas px per pt).
  const rowPx = trackSizes(t.heights, t.rows.length, el.h)[Math.min(r, r1)] ?? 0;
  const colPx = trackSizes(t.cols, nCols, el.w)[Math.min(c, c1)] ?? 0;
  const size = (axis: 'row' | 'col', pt: number) => {
    if (!(pt > 0)) return;
    const res = setTrackSize(t, axis, axis === 'row' ? Math.min(r, r1) : Math.min(c, c1), pt * 2, axis === 'row' ? el.h : el.w);
    setT(res.table, axis === 'row' ? { h: res.total } : { w: res.total });
  };
  return (
    <>
      <Group label="표">
        <DropButton big icon="⬚" label="선택" render={(close) => (
          <>
            <MenuItem label="셀 선택" onClick={() => { ed.setCell({ r: Math.min(r, r1), c: Math.min(c, c1), r1: Math.min(r, r1), c1: Math.min(c, c1) }); close(); }} />
            <MenuItem label="열 선택" onClick={() => { ed.setCell({ r: 0, c: Math.min(c, c1), r1: t.rows.length - 1, c1: Math.max(c, c1) }); close(); }} />
            <MenuItem label="행 선택" onClick={() => { ed.setCell({ r: Math.min(r, r1), c: 0, r1: Math.max(r, r1), c1: nCols - 1 }); close(); }} />
            <MenuItem label="표 선택" onClick={() => { ed.setCell({ r: 0, c: 0, r1: t.rows.length - 1, c1: nCols - 1 }); close(); }} />
          </>
        )} />
      </Group>
      <Group label="행 및 열">
        <DropButton big icon={RI.deleteIcon} label="삭제" render={(close) => (
          <>
            <MenuItem label="열 삭제" onClick={() => { act('deleteCol'); close(); }} />
            <MenuItem label="행 삭제" onClick={() => { act('deleteRow'); close(); }} />
            <MenuItem label="표 삭제" onClick={() => { ed.setElements((els) => els.filter((e) => e.id !== el.id)); ed.setSel([]); close(); }} />
          </>
        )} />
        <Big icon={RI.insertAbove} label="위에 삽입" onClick={() => act('insertRowAbove')} />
        <Big icon={RI.insertBelow} label="아래에 삽입" onClick={() => act('insertRowBelow')} />
        <Big icon={RI.insertLeft} label="왼쪽에 삽입" onClick={() => act('insertColLeft')} />
        <Big icon={RI.insertRight} label="오른쪽에 삽입" onClick={() => act('insertColRight')} />
      </Group>
      <Group label="병합">
        <Big icon={RI.merge} label="셀 병합" title="서식 창에서 고른 셀들을 합칩니다" disabled={r === r1 && c === c1} onClick={() => act('merge')} />
        <Big icon={RI.split} label="셀 분할" onClick={() => act('split')} />
      </Group>
      <Group label="셀 크기">
        <Col>
          <label className="rb-field" title="선택한 행의 높이 (pt)">↕ 높이: <input key={`h${r}-${rowPx}`} className="rb-num" type="number" min={4} step={1} defaultValue={Math.round(rowPx / 2 * 10) / 10} onBlur={(e) => size('row', Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') size('row', Number((e.target as HTMLInputElement).value)); }} /></label>
          <label className="rb-field" title="선택한 열의 너비 (pt)">↔ 너비: <input key={`w${c}-${colPx}`} className="rb-num" type="number" min={4} step={1} defaultValue={Math.round(colPx / 2 * 10) / 10} onBlur={(e) => size('col', Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') size('col', Number((e.target as HTMLInputElement).value)); }} /></label>
        </Col>
        <Col>
          <Small icon={RI.distributeRows} label="행 높이를 같게" onClick={() => act('distributeRows')} />
          <Small icon={RI.distributeCols} label="열 너비를 같게" onClick={() => act('distributeCols')} />
        </Col>
      </Group>
      <Group label="맞춤">
        <DropButton big icon="⊡" label="셀 여백" render={(close) => (
          <>
            {([['normal', '보통'], ['none', '없음'], ['narrow', '좁게'], ['wide', '넓게']] as const).map(([k, l]) => (
              <MenuItem key={k} label={`${l} (위/아래 ${CELL_MARGINS[k][1] / 2} pt, 왼쪽/오른쪽 ${CELL_MARGINS[k][0] / 2} pt)`} onClick={() => { ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, table: { ...t, margins: CELL_MARGINS[k] } } : e))); close(); }} />
            ))}
            <MenuSep />
            <MenuItem label="사용자 지정 여백…" onClick={() => {
              const v = window.prompt('셀 여백 (pt): 왼쪽, 위쪽, 오른쪽, 아래쪽', (t.margins ?? CELL_MARGINS.normal).map((x) => x / 2).join(', '));
              const nums = v?.split(/[ ,]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
              if (nums && nums.length === 4) ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, table: { ...t, margins: nums.map((x) => x * 2) as [number, number, number, number] } } : e)));
              close();
            }} />
          </>
        )} />
        <Col>
          <Small icon="⯇" label="왼쪽 맞춤" active={(here?.align ?? 'left') === 'left'} onClick={() => align('left')} />
          <Small icon="≡" label="가운데 맞춤" active={here?.align === 'center'} onClick={() => align('center')} />
          <Small icon="⯈" label="오른쪽 맞춤" active={here?.align === 'right'} onClick={() => align('right')} />
        </Col>
        <Col>
          <Small icon="☰" label="양쪽 맞춤" active={here?.align === 'justify'} onClick={() => align('justify')} />
          <Small icon="⤒" label="위쪽 맞춤" active={here?.anchor === 'top'} onClick={() => anchor('top')} />
          <Small icon="↕" label="세로 가운데 맞춤" active={!here?.anchor || here.anchor === 'middle'} onClick={() => anchor('middle')} />
        </Col>
        <Col>
          <Small icon="⤓" label="아래쪽 맞춤" active={here?.anchor === 'bottom'} onClick={() => anchor('bottom')} />
          <DropButton icon="⟲" label="텍스트 방향" render={(close) => (
            <>
              {([['horz', '가로'], ['vert', '모든 텍스트 90도 회전'], ['vert270', '모든 텍스트 270도 회전'], ['stacked', '스택형']] as const).map(([d, l]) => (
                <MenuItem key={d} label={l} on={(here?.dir ?? 'horz') === d} onClick={() => { cellsDo((cell) => ({ ...cell, dir: d === 'horz' ? undefined : d })); close(); }} />
              ))}
            </>
          )} />
        </Col>
      </Group>
      <SizeGroup ed={ed} />
    </>
  );
}

const CHART_TYPES: [ChartKind, string][] = [['column', '세로 막대형'], ['columnStacked', '누적 세로 막대형'], ['bar', '가로 막대형'], ['barStacked', '누적 가로 막대형'], ['line', '꺾은선형'], ['area', '영역형'], ['pie', '원형'], ['doughnut', '도넛형'], ['scatter', '분산형']];

export function ChartDesignTab({ ed }: { ed: Ed }) {
  const el = ed.selEls.find((e) => e.kind === 'chart');
  const ch = el?.chart;
  if (!el || !ch) return null;
  const set = (patch: Partial<typeof ch>) => ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, chart: { ...ch, ...patch } } : e)));
  return (
    <>
      <Group label="차트 레이아웃">
        <Col>
          <label className="rb-check"><input type="checkbox" checked={!!ch.title} onChange={(e) => set({ title: e.target.checked ? '차트 제목' : '' })} /> 차트 제목</label>
          <label className="rb-check"><input type="checkbox" checked={ch.legend !== false} onChange={(e) => set({ legend: e.target.checked })} /> 범례</label>
          <label className="rb-check"><input type="checkbox" checked={!!ch.dataLabels} onChange={(e) => set({ dataLabels: e.target.checked })} /> 데이터 레이블</label>
        </Col>
      </Group>
      <Group label="데이터">
        <Big icon={RI.editData} label="데이터 편집" title="서식 창의 데이터 표에서 값과 이름을 바꿉니다" onClick={() => ed.setPane('format')} />
      </Group>
      <Group label="종류">
        <DropButton big icon={RI.chart} label="차트 종류 변경" render={(close) => <>{CHART_TYPES.map(([k, l]) => <MenuItem key={k} label={l} on={ch.kind === k} onClick={() => { set({ kind: k }); close(); }} />)}</>} />
      </Group>
      <Group label="색">
        <ColorButton icon={<b>A</b>} label="글자 색" title="차트 글자와 축 색" value={ch.textColor ?? el.color} onPick={(c) => set({ textColor: c })} />
      </Group>
      <SizeGroup ed={ed} />
    </>
  );
}

export function ContextTabBody({ tab, ed }: { tab: ContextTab; ed: Ed }) {
  if (tab === 'shape') return <ShapeFormatTab ed={ed} />;
  if (tab === 'picture') return <PictureFormatTab ed={ed} />;
  if (tab === 'tableDesign') return <TableDesignTab ed={ed} />;
  if (tab === 'tableLayout') return <TableLayoutTab ed={ed} />;
  return <ChartDesignTab ed={ed} />;
}
