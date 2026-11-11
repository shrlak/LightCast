// View › Slide Master: the master is edited like a slide — whatever is placed on it shows on every
// slide of the presentation (Insert › Text Box / Shape / Picture, Format Background).
import { useRef, useState } from 'react';
import type { Background, Slide, SlideElement } from '../../domain/types';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { syncMaster } from '../../domain/master';
import { CanvasEditor, type CanvasTool } from './CanvasEditor';
import type { Ed } from './editor';

export function MasterView({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (!p || !ed.theme) return null;
  const master = p.master ?? { elements: [] };
  const slide: Slide = { id: '__master', group: '', text: '', elements: master.elements, background: master.background };
  const save = (elements: SlideElement[], background: Background | undefined = master.background) => {
    const next = { elements, ...(background ? { background } : {}) };
    ed.updatePres({ master: elements.length || background ? next : undefined, slides: syncMaster(p.slides, elements) });
  };
  const add = (el: SlideElement) => { save([...master.elements, el]); setSel([el.id]); };
  const picture = async (f: File | undefined) => {
    if (!f) return;
    const id = uid('m');
    await putMedia(id, f);
    ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image' } });
    add({ id: uid('el'), kind: 'image', mediaId: id, fit: 'contain', x: 1180, y: 40, w: 220, h: 160, name: f.name });
  };
  return (
    <div className="master-view" role="dialog" aria-label="슬라이드 마스터">
      <div className="master-bar">
        <b>슬라이드 마스터</b>
        <button type="button" onClick={() => setTool({ kind: 'shape', name: 'textBox' })}>텍스트 상자</button>
        <button type="button" onClick={() => setTool({ kind: 'shape', name: 'rect' })}>사각형</button>
        <button type="button" onClick={() => setTool({ kind: 'shape', name: 'line' })}>선</button>
        <button type="button" onClick={() => file.current?.click()}>그림</button>
        <button type="button" onClick={() => add({ id: uid('el'), kind: 'text', text: '{slide}', x: 1240, y: 1000, w: 160, h: 60, fontSize: 28, color: '#ffffff', align: 'right' })}>슬라이드 번호</button>
        <label className="rb-check">배경 <input type="color" value={master.background?.kind === 'color' ? master.background.value : '#000000'} onChange={(e) => save(master.elements, { kind: 'color', value: e.target.value })} /></label>
        <button type="button" disabled={!sel.length} onClick={() => { save(master.elements.filter((e) => !sel.includes(e.id))); setSel([]); }}>삭제</button>
        <span className="grow" />
        <span className="dlg-note">여기에 놓은 개체는 모든 슬라이드에 나옵니다</span>
        <button type="button" className="primary" onClick={onClose}>마스터 보기 닫기</button>
      </div>
      <div className="master-stage">
        <CanvasEditor slide={slide} theme={ed.theme} background={master.background ?? null} selected={sel} onSelect={setSel} tool={tool} onToolDone={() => setTool(null)}
          readOnly={!!p.protected} onChange={(patch) => { if (patch.elements !== undefined || 'elements' in patch) save(patch.elements ?? []); if (patch.background) save(master.elements, patch.background); }} />
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void picture(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
