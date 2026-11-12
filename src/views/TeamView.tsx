import { useEffect, useRef, useState } from 'react';
import { useRelay } from '../ui/hooks';
import { trackViewportHeight } from '../ui/viewportHeight';
import { phoneIdentity } from '../domain/phoneIdentity';
import type { TeamRequest } from '../domain/teamRequests';
import type { LiveState } from '../domain/types';
import { SlideCanvas } from '../ui/SlideCanvas';
import { liveCanvasProps } from '../ui/liveProps';
import { TeamRequestPanel } from '../ui/TeamRequestPanel';
import { ConnectionQualityBadge } from '../ui/ConnectionQualityBadge';

/** A request-only connection, independent of the controller or rehearsal preview. */
export function TeamView() {
  const [name, setName] = useState(() => localStorage.getItem('freecast.team.deviceName') || '무대팀');
  const [token] = useState(() => phoneIdentity('team'));
  const initialName = useRef(name);
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [host, setHost] = useState(false);
  const [appearance, setAppearance] = useState(() => localStorage.getItem('freecast.team.appearance') === 'light' ? 'light' : 'dark');
  const [pin, setPin] = useState(() => localStorage.getItem('freecast.pin') ?? '');
  const [pinError, setPinError] = useState(false);
  const relay = useRelay({ type: 'hello', role: 'team', clientToken: token, name: initialName.current, pin }, (m) => {
    if (m.type === 'state') setLive(m.state as LiveState);
    if (m.type === 'host-status') setHost(m.connected === true);
    if (m.type === 'team-requests') { setRequests(m.requests as TeamRequest[]); setError(null); }
    if (m.type === 'team-request-error') setError(String(m.message));
    if (m.type === 'error') { setError(String(m.error)); setPinError(true); }
    if (m.type === 'welcome') relay.send({ type: 'remote-control', action: 'rename', name });
  });
  const ready = relay.connected && host;
  useEffect(() => { document.title = 'LightCast 무대팀'; document.body.dataset.remoteAppearance = appearance; }, [appearance]);
  useEffect(() => trackViewportHeight(), []);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => { if (e.source === window.parent && e.origin === location.origin && e.data?.type === 'freecast:remote-appearance' && ['light', 'dark'].includes(e.data.appearance)) setAppearance(e.data.appearance); };
    window.addEventListener('message', onMessage); return () => window.removeEventListener('message', onMessage);
  }, []);
  const send = (m: unknown) => { setError(null); if (ready) relay.send(m); };
  return <main className="remote-root team-console">
    <header className="remote-head"><strong className="grow">{window.self === window.top ? 'LightCast 무대팀' : '무대팀 · 요청 전용'}</strong><ConnectionQualityBadge quality={relay.quality} connected={ready} compact />{window.self === window.top && <button onClick={() => { const next = appearance === 'dark' ? 'light' : 'dark'; setAppearance(next); localStorage.setItem('freecast.team.appearance', next); }}>{appearance === 'dark' ? '☀ 밝게' : '☾ 어둡게'}</button>}<span className={`remote-connection ${ready ? 'connected' : 'disconnected'}`} role="status" aria-label={ready ? '컴퓨터 연결됨' : '컴퓨터 연결 대기'}><span className="remote-connection-dot" /></span></header>
    <label className="row gap-s">보내는 사람<input aria-label="무대팀 이름" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { localStorage.setItem('freecast.team.deviceName', name); relay.send({ type: 'remote-control', action: 'rename', name }); }} /></label>
    {pinError && <form onSubmit={(e) => { e.preventDefault(); const next = String(new FormData(e.currentTarget).get('pin') ?? ''); localStorage.setItem('freecast.pin', next); setPin(next); setPinError(false); }}><label>PIN<input name="pin" inputMode="numeric" /></label><button>다시 연결</button></form>}
    <details className="team-preview"><summary>현재 송출 보기 · {live?.title ?? '대기 중'}</summary>{live?.slide ? <SlideCanvas {...liveCanvasProps(live)} animate={false} /> : <p className="hint">송출 중인 슬라이드가 없습니다.</p>}{live?.nextText && <p className="hint">다음: {live.nextText}</p>}</details>
    <TeamRequestPanel requests={requests} error={error} ready={ready} send={send} />
  </main>;
}
