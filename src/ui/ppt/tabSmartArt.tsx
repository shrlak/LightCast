// SmartArt 디자인 — the contextual tab PowerPoint (and DeckCraft's ribbon/smartart.rs, "Diagram Design") adds while
// a SmartArt graphic is selected: 그래픽 만들기 (텍스트 창, 도형 추가, 수준 올리기/내리기, 그림 삽입), 레이아웃,
// SmartArt 스타일 (색 변경, 스타일), 원래대로 (그래픽 원래대로, 변환) and 정렬.
import type { SlideElement } from '../../domain/types';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { editSmartArt, relayoutSmartArt, smartArtOwner, type OutlineOp, type SmartArtSpec } from '../../domain/smartArt';
import { smartArtCatalog } from '../../engine';
import type { Ed } from './editor';
import { Big, Col, DropButton, Group, MenuHead, MenuItem, MenuSep, Small } from './ribbonParts';
import { SMARTART_CATEGORIES, SMARTART_LAYOUT, SMARTART_STYLE, smartArtColorLabel } from './ko';
import { ArrangeGroup } from './tabsContext';

/** The positions of 도형 추가's menu, in DeckCraft's order. */
export const ADD_SHAPE: readonly (readonly [Extract<OutlineOp, { kind: 'add' }>['position'], string])[] = [
  ['after', '뒤에 도형 추가'], ['before', '앞에 도형 추가'], ['above', '위에 도형 추가'], ['below', '아래에 도형 추가'], ['assistant', '어시스턴트 추가'],
];

/** 3-D styles follow a separator, as in DeckCraft's Diagram Styles menu. */
const STYLE_3D = new Set(['polished', 'inset', 'cartoon', 'powder', 'brick']);
/** A new block of colour choices starts at these (색상형 범위, 강조 1, 그라데이션). */
const COLOR_BREAKS = new Set(['range23', 'accent1', 'accent1Grad']);

/** SmartArt › Convert to Text: the outline as one bulleted text box where the graphic was. */
export function smartArtToText(els: SlideElement[], owner: SlideElement): { elements: SlideElement[]; id: string } | null {
  const sa = owner.smartArt;
  if (!sa) return null;
  const box: SlideElement = { id: uid('el'), kind: 'text', text: sa.nodes.map((n) => '\t'.repeat(n.level) + n.text).join('\n'), x: sa.box.x, y: sa.box.y, w: sa.box.w, h: sa.box.h, fontSize: 48, color: '#ffffff', align: 'left', list: 'bullet' };
  const g = owner.groupId;
  return { elements: [...els.filter((e) => (g ? e.groupId !== g : e.id !== owner.id)), box], id: box.id };
}

export function SmartArtDesignTab({ ed }: { ed: Ed }) {
  const owner = smartArtOwner(ed.elements, ed.selEls);
  const spec = owner?.smartArt;
  const cat = smartArtCatalog();
  const off = !owner || !ed.canEdit;
  const scheme = ed.p?.colorScheme;
  const go = (op: OutlineOp) => {
    if (!owner) return;
    const r = editSmartArt(ed.elements, owner, ed.sel.find((id) => id !== owner.id) ?? ed.sel[0], op, scheme);
    if (!r) return ed.cmd.notify('이 도형에는 적용할 수 없습니다');
    ed.setElements(() => r.elements); ed.setSel(r.ids);
  };
  const relayout = (patch: Partial<SmartArtSpec>) => {
    if (!owner) return;
    const r = relayoutSmartArt(ed.elements, owner.id, patch, scheme);
    if (r) { ed.setElements(() => r.elements); ed.setSel(r.ids); }
  };
  const pictureLayout = !!spec?.kind.startsWith('picture');
  const insertPicture = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,.wmf,.emf,.svgz';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const id = uid('m');
      void putMedia(id, f).then(() => {
        ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image', backgroundHidden: true } });
        ed.setElements((els) => els.map((e) => (e.id === ed.sel[0] ? { ...e, fillImage: id, pattern: undefined, gradient: undefined } : e)));
      });
    };
    inp.click();
  };
  return (
    <>
      <Group label="그래픽 만들기">
        <Big icon="⧉" label="텍스트 창" title="SmartArt의 텍스트를 입력하고 정리합니다" disabled={!owner} onClick={() => ed.setDialog('smartArt')} />
        <Col>
          <DropButton icon="＋" label="도형 추가" disabled={off} render={(close) => (
            <>{ADD_SHAPE.map(([position, l]) => <MenuItem key={position} label={l} onClick={() => { go({ kind: 'add', position }); close(); }} />)}</>
          )} />
          <Small icon="⇦" label="수준 올리기" disabled={off} onClick={() => go({ kind: 'promote' })} />
          <Small icon="⇨" label="수준 내리기" disabled={off} onClick={() => go({ kind: 'demote' })} />
        </Col>
        <Col>
          <Small icon="⇄" label="오른쪽에서 왼쪽" active={!!spec?.rtl} disabled={off} onClick={() => go({ kind: 'rtl' })} />
          <Small icon="▲" label="위로 이동" disabled={off} onClick={() => go({ kind: 'up' })} />
          <Small icon="▼" label="아래로 이동" disabled={off} onClick={() => go({ kind: 'down' })} />
        </Col>
        <Small icon="🖼" label="그림 삽입" title="선택한 SmartArt 도형의 그림 자리에 그림을 넣습니다 (그림 레이아웃)" disabled={off || !pictureLayout || ed.sel.length !== 1} onClick={insertPicture} />
      </Group>
      <Group label="레이아웃">
        <DropButton big icon="▦" label="레이아웃" disabled={off || !cat} wide render={(close) => (
          <div className="smartart-menu">
            {SMARTART_CATEGORIES.map((c) => {
              const items = (cat?.layouts ?? []).filter((l) => (SMARTART_LAYOUT[l.id]?.[1] ?? '목록형') === c);
              return items.length ? (
                <div key={c}>
                  <MenuHead>{c}</MenuHead>
                  {items.map((l) => <MenuItem key={l.id} label={SMARTART_LAYOUT[l.id]?.[0] ?? l.label} on={spec?.kind === l.id} onClick={() => { relayout({ kind: l.id }); close(); }} />)}
                </div>
              ) : null;
            })}
          </div>
        )} />
      </Group>
      <Group label="SmartArt 스타일">
        <DropButton big icon="🎨" label="색 변경" disabled={off || !cat} render={(close) => (
          <>
            {(cat?.colors ?? []).map((s) => [
              COLOR_BREAKS.has(s.id) ? <MenuSep key={`${s.id}-sep`} /> : null,
              <MenuItem key={s.id} label={smartArtColorLabel(s.id, s.label)} on={(spec?.colors || 'colorful') === s.id} onClick={() => { relayout({ colors: s.id }); close(); }} />,
            ])}
          </>
        )} />
        <DropButton big icon="◆" label="스타일" title="SmartArt 스타일" disabled={off || !cat} render={(close) => (
          <>
            <MenuHead>문서에 가장 적합한 스타일</MenuHead>
            {(cat?.styles ?? []).filter((s) => !STYLE_3D.has(s.id)).map((s) => <MenuItem key={s.id} label={SMARTART_STYLE[s.id] ?? s.label} on={(spec?.style || 'flat') === s.id} onClick={() => { relayout({ style: s.id }); close(); }} />)}
            <MenuHead>3차원</MenuHead>
            {(cat?.styles ?? []).filter((s) => STYLE_3D.has(s.id)).map((s) => <MenuItem key={s.id} label={SMARTART_STYLE[s.id] ?? s.label} on={spec?.style === s.id} onClick={() => { relayout({ style: s.id }); close(); }} />)}
          </>
        )} />
      </Group>
      <Group label="원래대로">
        <Big icon="↺" label="그래픽 원래대로" title="스타일 · 색 · 방향을 기본으로 되돌립니다" disabled={off} onClick={() => go({ kind: 'reset' })} />
        <DropButton big icon="⇄" label="변환" disabled={off} render={(close) => (
          <>
            <MenuItem label="텍스트로 변환" onClick={() => { if (owner) { const r = smartArtToText(ed.elements, owner); if (r) { ed.setElements(() => r.elements); ed.setSel([r.id]); } } close(); }} />
            <MenuItem label="도형으로 변환" onClick={() => { if (owner) ed.setElements((els) => els.map((e) => (e.id === owner.id ? { ...e, smartArt: undefined } : e))); close(); }} />
          </>
        )} />
      </Group>
      <ArrangeGroup ed={ed} />
    </>
  );
}
