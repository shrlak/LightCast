import { useRef, useState, type Dispatch } from 'react';
import type { Library } from '../domain/types';
import type { Action } from '../domain/reducer';
import { buildTemplatePack, importTemplatePack, parseTemplatePack } from '../domain/templatePack';

/** 🛍 슬라이드 템플릿 마켓 (실험 기능): share designs between churches as a file. */
export function TemplateMarketModal({ library, dispatch, notify, onClose }: { library: Library; dispatch: Dispatch<Action>; notify: (m: string) => void; onClose: () => void }) {
  const templates = library.presentations.filter((p) => p.folder === 'Templates' || p.folder?.startsWith('Templates/'));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [name, setName] = useState('우리 교회 템플릿');
  const file = useRef<HTMLInputElement>(null);
  const toggle = (id: string) => setChosen((c) => { const n = new Set(c); if (!n.delete(id)) n.add(id); return n; });
  const exportPack = () => {
    const pack = buildTemplatePack(library, [...chosen], name, Date.now());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    a.download = `freecast-templates-${name.replace(/[^\w가-힣-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify(pack.mediaDropped ? `내보냈습니다 — 이 컴퓨터에만 있는 사진·영상 ${pack.mediaDropped}개는 빠졌습니다` : '템플릿 파일을 내보냈습니다');
  };
  const importPack = async (f: File | undefined) => {
    if (!f) return;
    try {
      const pack = parseTemplatePack(JSON.parse(await f.text()));
      if (!pack) return notify('LightCast 템플릿 파일이 아닙니다');
      const { presentations, themes } = importTemplatePack(library, pack);
      for (const theme of themes) dispatch({ type: 'theme/upsert', theme });
      dispatch({ type: 'presentation/createMany', presentations });
      notify(`“${pack.name}”에서 템플릿 ${presentations.length}개를 가져왔습니다 (Templates/가져온 템플릿)`);
    } catch {
      notify('템플릿 파일을 읽지 못했습니다');
    }
    if (file.current) file.current.value = '';
  };
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-label="슬라이드 템플릿 마켓">
      <header className="modal-head"><h2>🛍 슬라이드 템플릿 마켓</h2><button onClick={onClose} aria-label="닫기">✕</button></header>
      <div className="wizard-body stack">
        <h3>가져오기</h3>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void importPack(e.target.files?.[0])} />
        <button onClick={() => file.current?.click()}>다른 교회의 템플릿 파일 열기</button>
        <p className="hint">가져온 템플릿은 새 자료로 들어가며, 이미 있는 자료는 바뀌지 않습니다.</p>
        <h3>내보내기</h3>
        <label>모음 이름<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        {!templates.length && <p className="muted">내보낼 템플릿이 없습니다.</p>}
        {templates.map((p) => <label key={p.id} className="check small"><input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} /> {p.title} <small className="muted">· 슬라이드 {p.slides.length}장</small></label>)}
        <button className="primary" disabled={!chosen.size} onClick={exportPack}>선택한 {chosen.size}개 내보내기</button>
      </div>
    </div>
  </div>;
}
