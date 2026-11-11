// 홈 · 삽입 · 그리기 tabs.
import { useRef, useState } from 'react';
import type { SlideElement } from '../../domain/types';
import { uid } from '../../domain/lyrics';
import { putMedia } from '../../domain/media';
import { PROTECTED_MESSAGE } from '../../domain/materialProtection';
import { isPdfSlide } from '../../domain/importedSlides';
import { SLIDE_TEMPLATES } from '../../domain/slideTemplates';
import { qrElement } from '../../domain/qrElements';
import {
  alignSelection, canGroup, canUngroup, cloneElements, copyStyle, deleteSelection, distributeSelection, flipSelection, groupSelection, makeChart, makeIcon,
  makeTable, orderSelection, rotateSelection, ungroupSelection,
} from '../../domain/editOps';
import { shapeQuickStyles, type ChartKind } from '../../engine';
import { TextFormatPanel } from './TextFormatPanel';
import { textTarget, useTextSelectionTick, type Ed } from './editor';
import { SLIDE_TEXT, copyObjects, objectClipboard } from './CanvasEditor';
import { Big, Col, ColorButton, DropButton, Gallery, Group, MenuHead, MenuItem, MenuSep, RI, Small } from './ribbonParts';
import { IconGallery, QUICK_SHAPES, ShapeGallery, ShapeThumb } from './galleries';
import { shapeLabel } from './ko';
import { shapeCatalog } from '../../engine';

const blocked = (ed: Ed) => {
  if (!ed.p || !ed.slide) return ed.cmd.notify('먼저 슬라이드를 선택하세요'), true;
  if (ed.p.protected) return ed.cmd.notify(PROTECTED_MESSAGE), true;
  if (isPdfSlide(ed.slide)) return ed.cmd.notify('PDF 페이지에는 개체를 넣을 수 없습니다'), true;
  return false;
};

/** 새 슬라이드 ▾: a blank slide, a layout from the slide templates, or a copy of this one. */
export function NewSlideButton({ ed, big = true }: { ed: Ed; big?: boolean }) {
  const { p, slide } = ed;
  const insert = (make: () => import('../../domain/types').Slide) => {
    if (!p) return;
    if (p.protected) return ed.cmd.notify(PROTECTED_MESSAGE);
    const i = slide ? p.slides.findIndex((s) => s.id === slide.id) : p.slides.length - 1;
    const n = make();
    const slides = [...p.slides];
    slides.splice(i + 1, 0, n);
    ed.updatePres({ slides });
    ed.cmd.setSlideId(n.id);
  };
  return (
    <DropButton big={big} icon={RI.newSlide} label="새 슬라이드" title="새 슬라이드 (Ctrl+M)" disabled={!p} wide render={(close) => (
      <>
        <MenuHead>레이아웃</MenuHead>
        <div className="layout-grid">
          <button type="button" className="layout-cell" onClick={() => { insert(() => ({ id: uid('s'), group: slide?.group ?? 'Slide', text: '' })); close(); }}><span className="layout-thumb blank" />빈 화면</button>
          {SLIDE_TEMPLATES.map((t) => <button key={t.id} type="button" className="layout-cell" onClick={() => { insert(() => t.make(slide?.group ?? 'Slide')); close(); }}><span className="layout-thumb">{t.icon}</span>{t.name}</button>)}
        </div>
        <MenuSep />
        <MenuItem icon="⧉" label="선택한 슬라이드 복제" hint="Ctrl+D" disabled={!slide} onClick={() => { if (slide) insert(() => ({ ...slide, id: uid('s') })); close(); }} />
      </>
    )} />
  );
}

/** 정렬 ▾ (Home › Drawing and Shape Format › Arrange). */
export function ArrangeMenu({ ed, close }: { ed: Ed; close: () => void }) {
  const sel = ed.selEls.map((e) => e.id);
  const els = ed.elements;
  const act = (fn: (els: SlideElement[]) => SlideElement[]) => { ed.setElements(fn); close(); };
  const none = !sel.length;
  return (
    <>
      <MenuHead>개체 순서</MenuHead>
      <MenuItem icon={RI.bringFront} label="맨 앞으로 가져오기" hint="Ctrl+Shift+]" disabled={none} onClick={() => act((e) => orderSelection(e, sel, 'front'))} />
      <MenuItem icon={RI.sendBack} label="맨 뒤로 보내기" hint="Ctrl+Shift+[" disabled={none} onClick={() => act((e) => orderSelection(e, sel, 'back'))} />
      <MenuItem label="앞으로 가져오기" disabled={none} onClick={() => act((e) => orderSelection(e, sel, 'forward'))} />
      <MenuItem label="뒤로 보내기" disabled={none} onClick={() => act((e) => orderSelection(e, sel, 'backward'))} />
      <MenuHead>개체 그룹화</MenuHead>
      <MenuItem icon={RI.group} label="그룹" hint="Ctrl+G" disabled={!canGroup(els, sel)} onClick={() => act((e) => groupSelection(e, sel))} />
      <MenuItem label="그룹 해제" hint="Ctrl+Shift+G" disabled={!canUngroup(els, sel)} onClick={() => act((e) => ungroupSelection(e, sel))} />
      <MenuHead>개체 위치</MenuHead>
      <AlignItems ed={ed} close={close} />
      <MenuSep />
      <MenuItem icon={RI.rotate} label="오른쪽으로 90도 회전" disabled={none} onClick={() => act((e) => rotateSelection(e, sel, 90))} />
      <MenuItem label="왼쪽으로 90도 회전" disabled={none} onClick={() => act((e) => rotateSelection(e, sel, -90))} />
      <MenuItem label="상하 대칭" disabled={none} onClick={() => act((e) => flipSelection(e, sel, 'vertical'))} />
      <MenuItem label="좌우 대칭" disabled={none} onClick={() => act((e) => flipSelection(e, sel, 'horizontal'))} />
      <MenuSep />
      <MenuItem icon={RI.selectionPane} label="선택 창…" onClick={() => { ed.setPane('selection'); close(); }} />
    </>
  );
}

export function AlignItems({ ed, close }: { ed: Ed; close: () => void }) {
  const sel = ed.selEls.map((e) => e.id);
  const [toSlide, setToSlide] = useState(sel.length < 2);
  const act = (fn: (els: SlideElement[]) => SlideElement[]) => { ed.setElements(fn); close(); };
  const none = !sel.length;
  return (
    <>
      <MenuItem label="왼쪽 맞춤" disabled={none} onClick={() => act((e) => alignSelection(e, sel, 'left', toSlide))} />
      <MenuItem label="가운데 맞춤" disabled={none} onClick={() => act((e) => alignSelection(e, sel, 'center', toSlide))} />
      <MenuItem label="오른쪽 맞춤" disabled={none} onClick={() => act((e) => alignSelection(e, sel, 'right', toSlide))} />
      <MenuItem label="위쪽 맞춤" disabled={none} onClick={() => act((e) => alignSelection(e, sel, 'top', toSlide))} />
      <MenuItem label="중간 맞춤" disabled={none} onClick={() => act((e) => alignSelection(e, sel, 'middle', toSlide))} />
      <MenuItem label="아래쪽 맞춤" disabled={none} onClick={() => act((e) => alignSelection(e, sel, 'bottom', toSlide))} />
      <MenuSep />
      <MenuItem label="가로 간격을 동일하게" disabled={none} onClick={() => act((e) => distributeSelection(e, sel, 'horizontal', toSlide))} />
      <MenuItem label="세로 간격을 동일하게" disabled={none} onClick={() => act((e) => distributeSelection(e, sel, 'vertical', toSlide))} />
      <MenuSep />
      <MenuItem label="슬라이드에 맞춤" on={toSlide} onClick={() => setToSlide(true)} />
      <MenuItem label="선택한 개체 맞춤" on={!toSlide} disabled={sel.length < 2} onClick={() => setToSlide(false)} />
    </>
  );
}

/** 도형 채우기 / 윤곽선 / 효과 / 빠른 스타일 for the selected shapes. */
export function ShapeStyleButtons({ ed, big }: { ed: Ed; big?: boolean }) {
  const shapes = ed.selEls.filter((e) => e.kind !== 'image' && e.kind !== 'video' && e.kind !== 'camera');
  const first = shapes[0];
  const set = (patch: Partial<SlideElement>) => ed.setElements((els) => els.map((e) => (shapes.some((s) => s.id === e.id) ? { ...e, ...patch } : e)));
  const none = !shapes.length;
  const styles = shapeQuickStyles(ed.p?.colorScheme);
  return (
    <>
      <DropButton big={big} icon={RI.quickStyles} label="빠른 스타일" disabled={none} wide render={(close) => (
        <>
          <MenuHead>테마 스타일</MenuHead>
          <div className="quick-style-grid">
            {styles.map((s) => (
              <button key={`${s.row}-${s.col}`} type="button" className="quick-style" title={s.label} style={{ background: s.gradient ? `linear-gradient(${s.gradient[0]}, ${s.gradient[1]})` : s.fill, border: s.stroke ? `2px solid ${s.stroke}` : '2px solid transparent', color: s.text, boxShadow: s.shadow ? '0 3px 6px rgba(0,0,0,.35)' : undefined }}
                onClick={() => { set({ fill: s.fill, stroke: s.stroke ?? undefined, strokeWidth: s.stroke ? 3 : undefined, gradient: s.gradient, gradientAngle: s.gradient ? 90 : undefined, dropShadow: s.shadow || undefined, color: s.text }); close(); }}>Abc</button>
            ))}
          </div>
        </>
      )} />
      <Col>
        <ColorButton icon={RI.fill} label={big ? undefined : '도형 채우기'} title="도형 채우기" disabled={none} value={first?.fill} onPick={(c) => set({ fill: c, gradient: undefined })} onNone={() => set({ fill: 'transparent', gradient: undefined })} noneLabel="채우기 없음" />
        <DropButton icon={RI.outline} label="도형 윤곽선" disabled={none} render={(close) => (
          <>
            <ColorButtonInline value={first?.stroke} onPick={(c) => { set({ stroke: c, strokeWidth: first?.strokeWidth ?? 4 }); close(); }} onNone={() => { set({ stroke: undefined, strokeWidth: undefined }); close(); }} />
            <MenuHead>두께</MenuHead>
            {[1, 2, 3, 4, 6, 9, 12, 18].map((w) => <MenuItem key={w} label={<span className="line-sample" style={{ borderTopWidth: Math.max(1, w / 2) }}>{w / 2} pt</span>} on={first?.strokeWidth === w} onClick={() => { set({ strokeWidth: w, stroke: first?.stroke ?? '#ffffff' }); close(); }} />)}
            <MenuHead>대시</MenuHead>
            {(['solid', 'dash', 'dot', 'dashDot'] as const).map((d) => <MenuItem key={d} label={{ solid: '실선', dash: '파선', dot: '둥근 점선', dashDot: '파선-점선' }[d]} on={(first?.dash ?? 'solid') === d} onClick={() => { set({ dash: d === 'solid' ? undefined : d }); close(); }} />)}
            <MenuHead>화살표</MenuHead>
            <MenuItem label="화살표 없음" onClick={() => { set({ arrowStart: undefined, arrowEnd: undefined }); close(); }} />
            <MenuItem label="끝 화살표 →" onClick={() => { set({ arrowStart: undefined, arrowEnd: true }); close(); }} />
            <MenuItem label="양쪽 화살표 ↔" onClick={() => { set({ arrowStart: true, arrowEnd: true }); close(); }} />
          </>
        )} />
        <DropButton icon={RI.effects} label="도형 효과" disabled={none} wide render={(close) => <EffectsMenu first={first} set={set} close={close} />} />
      </Col>
    </>
  );
}

/** Shape Format › Shape Effects: shadow, reflection, glow, soft edges, bevel, 3-D rotation. */
export function EffectsMenu({ first, set, close }: { first?: SlideElement; set: (p: Partial<SlideElement>) => void; close: () => void }) {
  const GLOWS = ['#ffd966', '#9cc3e6', '#a9d18e', '#f4b183', '#ff7c80', '#c9b6f0'];
  const ROT: [string, { x: number; y: number } | undefined][] = [['없음', undefined], ['평행 투시: 왼쪽', { x: 0, y: 25 }], ['평행 투시: 오른쪽', { x: 0, y: -25 }], ['원근감: 위', { x: 30, y: 0 }], ['원근감: 아래', { x: -30, y: 0 }], ['등각: 왼쪽 아래', { x: 20, y: 30 }]];
  return (
    <div className="effects-menu">
      <MenuHead>그림자</MenuHead>
      <MenuItem label="그림자 없음" on={!first?.dropShadow} onClick={() => { set({ dropShadow: undefined, shadowKind: undefined }); close(); }} />
      <MenuItem label="바깥쪽" on={!!first?.dropShadow && (first.shadowKind ?? 'outer') === 'outer'} onClick={() => { set({ dropShadow: true, shadowKind: 'outer' }); close(); }} />
      <MenuItem label="안쪽" on={first?.shadowKind === 'inner'} onClick={() => { set({ dropShadow: true, shadowKind: 'inner' }); close(); }} />
      <MenuItem label="원근감" on={first?.shadowKind === 'perspective'} onClick={() => { set({ dropShadow: true, shadowKind: 'perspective' }); close(); }} />
      <MenuHead>반사</MenuHead>
      <MenuItem label={first?.reflection ? '반사 없음' : '근접 반사'} onClick={() => { set({ reflection: first?.reflection ? undefined : true }); close(); }} />
      <MenuHead>네온</MenuHead>
      <div className="rb-chip-row">{GLOWS.map((c) => <button key={c} type="button" className="rb-chip" style={{ background: c }} onClick={() => { set({ glow: c }); close(); }} />)}</div>
      <div className="rb-chip-row">{[8, 18, 32].map((g) => <button key={g} type="button" className="mini-btn" onClick={() => { set({ glowSize: g, glow: first?.glow ?? GLOWS[0] }); close(); }}>{g / 2} pt</button>)}</div>
      <MenuItem label="네온 없음" onClick={() => { set({ glow: undefined, glowSize: undefined }); close(); }} />
      <MenuHead>부드러운 가장자리</MenuHead>
      <div className="rb-chip-row">{[0, 5, 10, 25, 50].map((v) => <button key={v} type="button" className={`mini-btn ${(first?.softEdge ?? 0) === v ? 'on' : ''}`} onClick={() => { set({ softEdge: v || undefined }); close(); }}>{v ? `${v / 2} pt` : '없음'}</button>)}</div>
      <MenuHead>입체 효과</MenuHead>
      <MenuItem label={first?.bevel ? '입체 효과 없음' : '원형 입체'} onClick={() => { set({ bevel: first?.bevel ? undefined : true }); close(); }} />
      <MenuHead>3차원 회전</MenuHead>
      {ROT.map(([l, r]) => <MenuItem key={l} label={l} on={JSON.stringify(first?.rotate3d) === JSON.stringify(r)} onClick={() => { set({ rotate3d: r }); close(); }} />)}
      <MenuSep />
      <MenuItem label="효과 모두 없애기" onClick={() => { set({ dropShadow: undefined, shadowKind: undefined, glow: undefined, glowSize: undefined, reflection: undefined, softEdge: undefined, bevel: undefined, rotate3d: undefined }); close(); }} />
    </div>
  );
}

function ColorButtonInline({ value, onPick, onNone }: { value?: string; onPick: (c: string) => void; onNone: () => void }) {
  return (
    <>
      <MenuItem label="윤곽선 없음" onClick={onNone} />
      <div className="rb-chip-row">{['#ffffff', '#000000', '#7f7f7f', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#00b050', '#0070c0', '#7030a0'].map((c) => <button key={c} type="button" className={`rb-chip ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} />)}</div>
    </>
  );
}

export function HomeTab({ ed, onFind, onReplace }: { ed: Ed; onFind: () => void; onReplace: () => void }) {
  useTextSelectionTick();
  const t = textTarget(ed);
  const sel = ed.selEls.map((e) => e.id);
  const paste = () => {
    if (blocked(ed)) return;
    const clip = objectClipboard();
    if (!clip.length) return ed.cmd.notify('붙여넣을 개체가 없습니다 — 슬라이드의 개체를 복사(Ctrl+C)하거나 Ctrl+V로 붙여넣으세요');
    const copies = cloneElements(clip, ed.elements.some((e) => clip.some((c) => c.id === e.id)) ? 30 : 0);
    ed.setElements((els) => [...els, ...copies]);
    ed.setSel(copies.map((c) => c.id));
  };
  const one = ed.selEls[0];
  return (
    <>
      <Group label="클립보드">
        <PasteButton ed={ed} paste={paste} />
        <Col>
          <Small icon={RI.cut} label="잘라내기" title="잘라내기 (Ctrl+X)" disabled={!sel.length || !ed.canEdit} onClick={() => { copyObjects(ed.selEls); if (ed.slide) ed.updateSlide(deleteSelection(ed.slide, sel)); ed.setSel([]); }} />
          <Small icon={RI.copy} label="복사" title="복사 (Ctrl+C)" disabled={!sel.length} onClick={() => copyObjects(ed.selEls)} />
          <span onDoubleClick={() => one && ed.setTool({ kind: 'painter', style: copyStyle(one), keep: true })}>
            <Small icon={RI.painter} label="서식 복사" title="서식 복사 — 개체를 고르고 누른 뒤, 서식을 바꿀 개체를 클릭 (두 번 누르면 계속)" active={ed.tool?.kind === 'painter'} disabled={!one}
              onClick={() => (ed.tool?.kind === 'painter' ? ed.setTool(null) : one && ed.setTool({ kind: 'painter', style: copyStyle(one) }))} />
          </span>
        </Col>
      </Group>
      <Group label="슬라이드">
        <NewSlideButton ed={ed} />
        <Col>
          <Small icon={RI.reset} label="다시 설정" title="이 슬라이드의 글꼴 · 전환 · 배경 설정을 테마대로" disabled={!ed.slide || !ed.canEdit} onClick={() => ed.updateSlide({ style: undefined, transition: undefined, preferredFontSize: undefined })} />
          <Small icon={RI.section} label="구역" title="구역(섹션) 추가" disabled={!ed.slide || !ed.canEdit} onClick={() => ed.makeSection()} />
        </Col>
      </Group>
      <Group label="글꼴" className="rb-font" launcher={t ? () => ed.setDialog('font') : undefined}>
        {t ? <TextFormatPanel part="font" value={t.value} onChange={t.onChange} onChangeCase={t.onChangeCase} onClear={t.onClear} shortcuts /> : <span className="rb-disabled-note">텍스트 없음</span>}
      </Group>
      <Group label="단락" className="rb-para" launcher={t ? () => ed.setDialog('paragraph') : undefined}>
        {t ? <TextFormatPanel part="paragraph" value={t.value} onChange={t.onChange} onChangeCase={t.onChangeCase} onClear={t.onClear} shortcuts={false} /> : <span className="rb-disabled-note">텍스트 없음</span>}
      </Group>
      <Group label="그리기">
        <Gallery rows={3} className="rb-shape-strip">
          {QUICK_SHAPES.map((n) => <button key={n} type="button" className="shape-cell" title={shapeLabel(n, shapeCatalog().find((p) => p.name === n)?.label ?? n)} onClick={() => !blocked(ed) && ed.setTool({ kind: 'shape', name: n })}><ShapeThumb name={n} size={16} /></button>)}
          <DropButton icon={<span className="rb-more">▾</span>} title="모든 도형" render={(close) => <ShapeGallery onPick={(n) => { if (!blocked(ed)) ed.setTool({ kind: 'shape', name: n }); close(); }} onFreeform={(scribble) => { if (!blocked(ed)) ed.setTool({ kind: 'freeform', scribble }); close(); }} />} wide />
        </Gallery>
        <DropButton big icon={RI.arrange} label="정렬" render={(close) => <ArrangeMenu ed={ed} close={close} />} />
        <ShapeStyleButtons ed={ed} big />
      </Group>
      <Group label="편집">
        <Col>
          <Small icon={RI.find} label="찾기" title="찾기 (Ctrl+F)" onClick={onFind} />
          <DropButton icon={RI.replace} label="바꾸기" render={(close) => (
            <>
              <MenuItem label="바꾸기…" hint="Ctrl+H" onClick={() => { onReplace(); close(); }} />
              <MenuItem label="글꼴 바꾸기…" disabled={!ed.p} onClick={() => { ed.setDialog('replaceFonts'); close(); }} />
            </>
          )} />
          <DropButton icon={RI.select} label="선택" render={(close) => (
            <>
              <MenuItem label="모두 선택" hint="Ctrl+A" onClick={() => { ed.setSel(ed.elements.filter((e) => !e.hidden).map((e) => e.id)); close(); }} />
              <MenuItem label="개체 선택" onClick={() => { ed.setTool(null); close(); }} />
              <MenuItem icon={RI.selectionPane} label="선택 창…" onClick={() => { ed.setPane('selection'); close(); }} />
            </>
          )} />
        </Col>
      </Group>
    </>
  );
}

/** 붙여넣기 ▾ — the objects copied on a slide, or (Paste Special) the system clipboard's text only or its picture. */
function PasteButton({ ed, paste }: { ed: Ed; paste: () => void }) {
  const pasteText = async () => {
    if (blocked(ed)) return;
    const text = await navigator.clipboard.readText().catch(() => '');
    if (!text.trim()) return ed.cmd.notify('클립보드에 텍스트가 없습니다');
    ed.addElement({ id: uid('el'), kind: 'text', text: text.replace(/\r\n/g, '\n').trim(), x: 220, y: 380, w: 1000, h: 320, fontSize: 56, color: '#ffffff', align: 'left' });
  };
  const pastePicture = async () => {
    if (blocked(ed)) return;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        const id = uid('m');
        await putMedia(id, blob);
        ed.dispatch({ type: 'media/add', media: { id, name: '붙여넣은 그림.png', type: 'image' } });
        ed.addElement({ id: uid('el'), kind: 'image', mediaId: id, fit: 'contain', x: 320, y: 240, w: 800, h: 600, name: '그림' });
        return;
      }
    } catch { /* clipboard not readable */ }
    ed.cmd.notify('클립보드에 그림이 없습니다');
  };
  return (
    <DropButton big icon={RI.paste} label="붙여넣기" title="붙여넣기 (Ctrl+V)" split onMain={paste} render={(close) => (
      <>
        <MenuHead>붙여넣기 옵션</MenuHead>
        <MenuItem label="원본 서식 유지" hint="Ctrl+V" onClick={() => { paste(); close(); }} />
        <MenuItem label="텍스트만 유지" onClick={() => { void pasteText(); close(); }} />
        <MenuItem label="그림" onClick={() => { void pastePicture(); close(); }} />
      </>
    )} />
  );
}

const SYMBOLS = '©®™°±×÷≠≤≥∞→←↑↓↔⇒★☆♥♡♪♫✓✔✝☩✞☀☁☂☺♠♣♦•·…—–「」『』《》〈〉※§¶€£¥₩'.split('');
const WORDART = [
  { label: '채우기: 흰색, 그림자', patch: { color: '#ffffff', shadow: true, bold: true } },
  { label: '채우기: 검정', patch: { color: '#111111', bold: true } },
  { label: '채우기: 주황', patch: { color: '#f59f00', bold: true, shadow: true } },
  { label: '채우기: 파랑', patch: { color: '#2e6fd8', bold: true, shadow: true } },
  { label: '채우기: 금색', patch: { color: '#e3b21c', bold: true, shadow: true } },
  { label: '채우기: 빨강', patch: { color: '#d83f6b', bold: true, shadow: true } },
] as const;
const CHARTS: [ChartKind, string][] = [['column', '세로 막대형'], ['columnStacked', '누적 세로 막대형'], ['bar', '가로 막대형'], ['barStacked', '누적 가로 막대형'], ['line', '꺾은선형'], ['area', '영역형'], ['pie', '원형'], ['doughnut', '도넛형'], ['scatter', '분산형']];

export function InsertTab({ ed, onLink, onComment }: { ed: Ed; onLink: () => void; onComment: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const kind = useRef<'image' | 'video'>('image');
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const add = (el: SlideElement | null) => { if (el && !blocked(ed)) ed.addElement(el); };
  const insertMedia = async (file: File | undefined) => {
    if (!file || blocked(ed)) return;
    const id = uid('m');
    await putMedia(id, file);
    ed.dispatch({ type: 'media/add', media: { id, name: file.name, type: kind.current } });
    ed.addElement({ id: uid('el'), kind: kind.current, mediaId: id, fit: kind.current === 'video' ? 'cover' : 'contain', x: 220, y: 240, w: 1000, h: 600, name: file.name });
  };
  const insertSymbol = (c: string) => {
    if (document.activeElement?.classList.contains('ce-rich')) document.execCommand('insertText', false, c);
    else add({ id: uid('el'), kind: 'text', text: c, x: 620, y: 440, w: 200, h: 200, fontSize: 120, color: '#ffffff', align: 'center' });
  };
  return (
    <>
      <Group label="슬라이드"><NewSlideButton ed={ed} /></Group>
      <Group label="표">
        <DropButton big icon={RI.table} label="표" render={(close) => (
          <div className="table-picker" onMouseLeave={() => setHover([0, 0])}>
            <MenuHead>{hover[0] ? `${hover[1]}x${hover[0]} 표` : '표 삽입'}</MenuHead>
            <div className="table-picker-grid">
              {Array.from({ length: 8 }, (_, r) => Array.from({ length: 10 }, (_, c) => (
                <span key={`${r}-${c}`} className={`tp-cell ${r < hover[0] && c < hover[1] ? 'on' : ''}`} onMouseEnter={() => setHover([r + 1, c + 1])} onClick={() => { add(makeTable(r + 1, c + 1)); close(); }} />
              )))}
            </div>
          </div>
        )} />
      </Group>
      <Group label="이미지">
        <Big icon={RI.picture} label="그림" title="이 장치의 그림 삽입" onClick={() => { kind.current = 'image'; if (fileRef.current) { fileRef.current.accept = 'image/*'; fileRef.current.click(); } }} />
      </Group>
      <Group label="일러스트레이션">
        <DropButton big icon={RI.shapes} label="도형" wide render={(close) => <ShapeGallery onPick={(n) => { if (!blocked(ed)) ed.setTool({ kind: 'shape', name: n }); close(); }} onFreeform={(scribble) => { if (!blocked(ed)) ed.setTool({ kind: 'freeform', scribble }); close(); }} />} />
        <DropButton big icon={RI.icons} label="아이콘" wide render={(close) => <IconGallery onPick={(n) => { add(makeIcon(n)); close(); }} />} />
        <DropButton big icon={RI.chart} label="차트" render={(close) => <>{CHARTS.map(([k, l]) => <MenuItem key={k} label={l} onClick={() => { add(makeChart(k)); close(); }} />)}</>} />
      </Group>
      <Group label="링크">
        <Big icon={RI.link} label="링크" title="선택한 개체에 링크 연결 (슬라이드 쇼에서 클릭하면 열림)" disabled={!ed.selEls.length} onClick={onLink} />
      </Group>
      <Group label="메모">
        <Big icon={RI.comment} label="메모" title="새 메모" disabled={!ed.slide} onClick={onComment} />
      </Group>
      <Group label="텍스트">
        <Big icon={RI.textBox} label="텍스트 상자" title="텍스트 상자 그리기" onClick={() => !blocked(ed) && ed.setTool({ kind: 'shape', name: 'textBox' })} />
        <DropButton big icon={RI.wordArt} label="WordArt" render={(close) => <>{WORDART.map((w) => (
          <MenuItem key={w.label} label={<span style={{ color: w.patch.color, fontWeight: 800, textShadow: 'shadow' in w.patch ? '0 2px 3px rgba(0,0,0,.5)' : undefined, fontSize: 18, background: w.patch.color === '#ffffff' ? '#555' : undefined, padding: '0 4px' }}>가나다 Abc</span>} onClick={() => { add({ id: uid('el'), kind: 'text', text: '여기에 텍스트 입력', x: 220, y: 420, w: 1000, h: 240, fontSize: 110, align: 'center', ...w.patch }); close(); }} />
        ))}</>} />
        <Col>
          <Small icon={RI.date} label="날짜 및 시간" disabled={!ed.slide} onClick={() => add({ id: uid('el'), kind: 'text', text: '{date}', x: 940, y: 980, w: 460, h: 70, fontSize: 36, color: '#ffffff', align: 'right' })} />
          <Small icon="🕒" label="현재 시각" disabled={!ed.slide} onClick={() => add({ id: uid('el'), kind: 'text', text: '{time}', x: 940, y: 900, w: 460, h: 70, fontSize: 36, color: '#ffffff', align: 'right' })} />
        </Col>
      </Group>
      <Group label="기호">
        <DropButton big icon={RI.symbol} label="기호" render={(close) => <div className="symbol-grid">{SYMBOLS.map((c) => <button key={c} type="button" className="symbol-cell" onMouseDown={(e) => e.preventDefault()} onClick={() => { insertSymbol(c); close(); }}>{c}</button>)}</div>} />
      </Group>
      <Group label="미디어">
        <Big icon={RI.video} label="비디오" onClick={() => { kind.current = 'video'; if (fileRef.current) { fileRef.current.accept = 'video/*'; fileRef.current.click(); } }} />
        <Col>
          <Small icon={RI.camera} label="카메라" onClick={() => add({ id: uid('el'), kind: 'camera', deviceId: '', x: 320, y: 315, w: 800, h: 450 })} />
          <Small icon={RI.qr} label="QR 코드" onClick={() => { const { id: _id, ...qr } = qrElement('', (ed.slide?.elements ?? []).filter((e) => e.kind === 'qr').length); add({ ...qr, id: uid('el') }); ed.setPane('format'); }} />
        </Col>
      </Group>
      <Group label="말씀">
        <Big icon={RI.bible} label="성경" title="“요 3:16”처럼 찾아서 본문이 채워진 슬라이드로 넣거나 바로 띄웁니다" onClick={() => ed.cmd.open('bible')} />
      </Group>
      <input ref={fileRef} type="file" hidden onChange={(e) => { void insertMedia(e.target.files?.[0]); e.target.value = ''; }} />
    </>
  );
}

const PENS = ['#000000', '#ffffff', '#e81123', '#0078d4', '#107c10', '#ffb900', '#8764b8'];
const HIGHLIGHTERS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ff8c00'];

export function DrawTab({ ed }: { ed: Ed }) {
  const pen = ed.tool?.kind === 'pen' ? ed.tool : null;
  const [toShape, setToShape] = useState(false);
  const usePen = (color: string, width: number, highlighter = false) => { if (!blocked(ed)) ed.setTool({ kind: 'pen', color, width, highlighter, toShape: !highlighter && toShape }); };
  return (
    <>
      <Group label="도구">
        <Big icon={RI.lasso} label="그리기 선택" title="그리기를 멈추고 개체 선택" active={!ed.tool} onClick={() => ed.setTool(null)} />
        <Big icon={RI.eraser} label="지우개" title="잉크를 클릭해 지웁니다" active={ed.tool?.kind === 'eraser'} onClick={() => !blocked(ed) && ed.setTool({ kind: 'eraser' })} />
        <div className="pen-row">
          {PENS.map((c) => <button key={c} type="button" className={`pen-btn ${pen && !pen.highlighter && pen.color === c ? 'on' : ''}`} title="펜" onClick={() => usePen(c, pen?.width && !pen.highlighter ? pen.width : 6)}>{RI.pen(c)}</button>)}
          {HIGHLIGHTERS.map((c) => <button key={c} type="button" className={`pen-btn ${pen?.highlighter && pen.color === c ? 'on' : ''}`} title="형광펜" onClick={() => usePen(c, 24, true)}>{RI.highlighter(c)}</button>)}
        </div>
        <DropButton icon={<span className="pen-width" />} label={`두께 ${pen ? pen.width / 2 : 3} pt`} disabled={!pen} render={(close) => <>{[2, 4, 6, 10, 16, 24, 36].map((w) => <MenuItem key={w} label={<span className="line-sample" style={{ borderTopWidth: Math.max(1, w / 3) }}>{w / 2} pt</span>} on={pen?.width === w} onClick={() => { if (pen) ed.setTool({ ...pen, width: w }); close(); }} />)}</>} />
      </Group>
      <Group label="변환">
        <Big icon={RI.inkShape} label="잉크를 셰이프로" title="켜면 손으로 그린 선·사각형·원·삼각형이 반듯한 도형으로 바뀝니다" active={toShape} onClick={() => { const v = !toShape; setToShape(v); if (pen && !pen.highlighter) ed.setTool({ ...pen, toShape: v }); }} />
      </Group>
      <Group label="잉크">
        <Big icon={RI.deleteIcon} label="모든 잉크 지우기" disabled={!ed.elements.some((e) => e.kind === 'ink') || !ed.canEdit} onClick={() => ed.setElements((els) => els.filter((e) => e.kind !== 'ink'))} />
      </Group>
    </>
  );
}

export { SLIDE_TEXT };
