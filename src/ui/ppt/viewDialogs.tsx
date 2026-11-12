// View › 눈금 및 안내선 (DeckCraft view.gridOptions + guide.*) and View › 확대/축소 (view.zoomDialog).
import { useState } from 'react';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { addGuide, DEFAULT_GRID_PX, defaultGuides, guideCount, GRID_PRESETS, MAX_GUIDES, parseGridSpacing, type Guides } from '../../domain/guides';
import { clampZoom } from '../../domain/viewOptions';
import { Check, Dialog, Num } from './dialogs';
import type { Ed } from './editor';

/**
 * Turn View › Guides on or off. As in PowerPoint and DeckCraft, a presentation without guides gets
 * the two centre guides the first time they are shown.
 */
export function showGuides(ed: Ed, on: boolean) {
  ed.setView({ ...ed.view, guides: on });
  if (on && ed.p && !guideCount(ed.p.guides) && ed.canEdit) ed.updatePres({ guides: defaultGuides() });
}

/** View › Show › 눈금 및 안내선. */
export function GridGuidesDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const v = ed.view;
  const [snap, setSnap] = useState(v.snapToGrid ?? !!v.grid);
  const [smart, setSmart] = useState(v.smartGuides !== false);
  const [spacing, setSpacing] = useState(String(Math.round(((v.gridSpacing ?? DEFAULT_GRID_PX) / 2) * 100) / 100));
  const [grid, setGrid] = useState(!!v.grid);
  const [guides, setGuides] = useState(!!v.guides);
  const [list, setList] = useState<Guides>(ed.p?.guides ?? { v: [], h: [] });
  const [error, setError] = useState('');
  const editable = !!ed.p && ed.canEdit;
  const ok = () => {
    const sp = parseGridSpacing(spacing);
    if ('error' in sp) return setError(sp.error);
    const next = { ...ed.view, snapToGrid: snap, smartGuides: smart, gridSpacing: sp.px, grid, guides };
    ed.setView(next);
    if (editable) {
      // Turning guides on gives a presentation without any the two centre guides.
      const g = guides && !guideCount(list) && !guideCount(ed.p!.guides) ? defaultGuides() : list;
      if (JSON.stringify(g) !== JSON.stringify(ed.p!.guides ?? { v: [], h: [] })) ed.updatePres({ guides: guideCount(g) ? g : undefined });
    }
    onClose();
  };
  const row = (axis: 'v' | 'h') => (
    <fieldset className="dlg-set">
      <legend>{axis === 'v' ? '세로 안내선 (왼쪽에서, pt)' : '가로 안내선 (위에서, pt)'}</legend>
      {list[axis].map((x, i) => (
        <div key={i} className="dlg-row">
          <Num value={x / 2} min={0} max={(axis === 'v' ? CANVAS_W : CANVAS_H) / 2} disabled={!editable}
            onChange={(n) => setList({ ...list, [axis]: list[axis].map((y, j) => (j === i ? Math.min(axis === 'v' ? CANVAS_W : CANVAS_H, Math.max(0, Math.round(n * 2))) : y)) })} />
          <button type="button" disabled={!editable} onClick={() => setList({ ...list, [axis]: list[axis].filter((_, j) => j !== i) })}>삭제</button>
        </div>
      ))}
      <button type="button" disabled={!editable || guideCount(list) >= MAX_GUIDES} onClick={() => { const g = addGuide(list, axis); if (g) { setList(g); setGuides(true); } }}>＋ {axis === 'v' ? '세로' : '가로'} 안내선 추가</button>
    </fieldset>
  );
  return (
    <Dialog title="눈금 및 안내선" onClose={onClose} onOk={ok}>
      <fieldset className="dlg-set">
        <legend>맞춤</legend>
        <Check label="개체를 눈금에 맞춤" checked={snap} onChange={setSnap} />
        <Check label="도형 맞춤 시 스마트 가이드 표시 (다른 개체에 맞춤)" checked={smart} onChange={setSmart} />
      </fieldset>
      <fieldset className="dlg-set">
        <legend>눈금 설정</legend>
        <div className="dlg-row">
          <span>간격:</span>
          <select value={GRID_PRESETS.find(([, pt]) => Math.abs(pt - Number(spacing)) < 0.01)?.[0] ?? ''} onChange={(e) => { const p = GRID_PRESETS.find(([l]) => l === e.target.value); if (p) { setSpacing(String(Math.round(p[1] * 100) / 100)); setError(''); } }}>
            <option value="" disabled>사용자 지정</option>
            {GRID_PRESETS.map(([l]) => <option key={l} value={l}>{l}</option>)}
          </select>
          <input className="dlg-num" value={spacing} onChange={(e) => { setSpacing(e.target.value); setError(''); }} aria-label="간격 (pt)" /> <span>pt</span>
        </div>
        <Check label="화면에 눈금 표시" checked={grid} onChange={setGrid} />
      </fieldset>
      <fieldset className="dlg-set">
        <legend>안내선 설정</legend>
        <Check label="화면에 그리기 안내선 표시" checked={guides} onChange={setGuides} />
        <p className="dlg-note">안내선은 슬라이드에서 끌어 옮기고, 슬라이드 밖으로 끌어 놓으면 삭제됩니다. Alt를 누른 채 끌면 1pt 단위에 맞추지 않습니다.</p>
      </fieldset>
      {row('v')}
      {row('h')}
      {error && <p className="dlg-error">{error}</p>}
    </Dialog>
  );
}

/** View › Zoom › 확대/축소 dialog: a preset or a percentage (10–400 %), or fit to the window. */
export function ViewZoomDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const [pick, setPick] = useState<number | 'fit' | 'custom'>(ed.zoom === null ? 'fit' : [400, 200, 100, 66, 50, 33].includes(Math.round(ed.zoom * 100)) ? Math.round(ed.zoom * 100) : 'custom');
  const [pct, setPct] = useState(Math.round((ed.zoom ?? 1) * 100));
  const ok = () => {
    if (pick === 'fit') ed.setZoom(null);
    else ed.setZoom(clampZoom(pick === 'custom' ? pct : pick));
    onClose();
  };
  return (
    <Dialog title="확대/축소" onClose={onClose} onOk={ok}>
      <div className="zoom-dlg">
        <fieldset className="dlg-set">
          <legend>배율</legend>
          <label className="rb-check"><input type="radio" checked={pick === 'fit'} onChange={() => setPick('fit')} /> 맞춤</label>
          {[400, 200, 100, 66, 50, 33].map((z) => <label key={z} className="rb-check"><input type="radio" checked={pick === z} onChange={() => { setPick(z); setPct(z); }} /> {z}%</label>)}
        </fieldset>
        <label className="dlg-field"><span>백분율:</span>
          <span className="dlg-row"><input type="number" min={10} max={400} value={pct} onChange={(e) => { setPct(Number(e.target.value)); setPick('custom'); }} />%</span>
        </label>
      </div>
    </Dialog>
  );
}
