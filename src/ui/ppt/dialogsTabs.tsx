// Home › Paragraph › Tabs… (DeckCraft format.tabs): default tab spacing and the tab stops of the
// selected text boxes, in centimetres as PowerPoint shows them.
import { useState } from 'react';
import { DEFAULT_TAB, TAB_ALIGNS, clampDefaultTab, cmToPx, editTabs, pxToCm, tabsPatch, type TabAlign, type TabStop } from '../../domain/tabStops';
import { Dialog, Field, Num } from './dialogs';
import type { Ed } from './editor';

export function TabsDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const boxes = ed.selEls.filter((e) => e.kind === 'text' || e.kind === 'shape');
  const first = boxes[0];
  const [stops, setStops] = useState<TabStop[]>(first?.tabStops ?? []);
  const [def, setDef] = useState(pxToCm(first?.defaultTab ?? DEFAULT_TAB));
  const [pos, setPos] = useState(stops[0] ? pxToCm(stops[0].pos) : 2);
  const [align, setAlign] = useState<TabAlign>('left');
  if (!first) return <Dialog title="탭" onClose={onClose}><p>탭을 설정할 텍스트 상자를 고르세요.</p></Dialog>;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const ok = () => {
    const patch = { ...tabsPatch(stops), defaultTab: Math.abs(cmToPx(def) - DEFAULT_TAB) < 0.5 ? undefined : clampDefaultTab(cmToPx(def)) };
    ed.setElements((els) => els.map((e) => (boxes.some((b) => b.id === e.id) ? { ...e, ...patch } : e)));
    onClose();
  };
  return (
    <Dialog title="탭" onClose={onClose} onOk={ok} okDisabled={!ed.canEdit}>
      <Field label="기본 탭 간격 (cm)"><Num value={r2(def)} min={0.1} max={50} step={0.25} onChange={setDef} /></Field>
      <div className="dlg-list">
        {stops.length ? stops.map((t) => (
          <button key={t.pos} type="button" className={Math.abs(pxToCm(t.pos) - pos) < 0.01 ? 'on' : ''} onClick={() => { setPos(r2(pxToCm(t.pos))); setAlign(t.align); }}>
            {r2(pxToCm(t.pos))} cm · {TAB_ALIGNS.find(([a]) => a === t.align)?.[1]}
          </button>
        )) : <span className="dlg-note">탭 정지 위치가 없습니다 (기본 간격마다 이동).</span>}
      </div>
      <div className="dlg-cols">
        <Field label="탭 정지 위치 (cm)"><Num value={pos} min={0} max={60} step={0.25} onChange={setPos} /></Field>
        <Field label="맞춤"><select value={align} onChange={(e) => setAlign(e.target.value as TabAlign)}>{TAB_ALIGNS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select></Field>
      </div>
      <div className="dlg-row">
        <button type="button" onClick={() => setStops(editTabs(stops, { add: { pos: cmToPx(pos), align } }))}>설정</button>
        <button type="button" disabled={!stops.length} onClick={() => setStops(editTabs(stops, { remove: cmToPx(pos) }))}>지우기</button>
        <button type="button" disabled={!stops.length} onClick={() => setStops([])}>모두 지우기</button>
      </div>
    </Dialog>
  );
}
