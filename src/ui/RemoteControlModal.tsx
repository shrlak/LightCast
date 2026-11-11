import { ConnectionQualityBadge } from './ConnectionQualityBadge';
import type { RemoteControlState } from '../domain/remoteControl';

export function RemoteControlModal({ control, send, onClose }: { control: RemoteControlState | null; send: (m: unknown) => void; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal control-modal" role="dialog" aria-modal="true" aria-label="리모컨 조작권" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <header className="modal-head"><h2>리모컨 조작권</h2><button autoFocus aria-label="닫기" onClick={onClose}>✕</button></header>
    <p>첫 리모컨은 바로 조작할 수 있습니다. 다른 기기는 보기 전용으로 연결되며, 조작권을 요청하거나 넘겨받을 수 있습니다. 컴퓨터는 항상 조작할 수 있습니다.</p>
    <div className="feature-scroll">{control?.clients.map((c) => <article className="trash-row" key={c.id}><div className="grow"><strong>{c.name}</strong><div>{!c.connected ? '연결 끊김' : c.role === 'team' ? '무대팀 · 요청 전용' : c.id === control.controllerId ? '● 조작 중' : c.requested ? '조작권 요청 중' : '보기 전용'}</div><ConnectionQualityBadge quality={c.quality} connected={c.connected} /></div>
      {c.role !== 'team' && <button disabled={!c.connected || c.id === control.controllerId} onClick={() => send({ type: 'remote-control', action: 'grant', id: c.id })}>조작권 주기</button>}
      {c.id === control.controllerId && <button onClick={() => send({ type: 'remote-control', action: 'revoke', id: c.id })}>보기 전용으로 전환</button>}
    </article>)}{!control?.clients.length && <p className="empty">연결된 리모컨이 없습니다.</p>}</div><footer className="modal-foot"><button onClick={onClose}>닫기</button></footer>
  </section></div>;
}
