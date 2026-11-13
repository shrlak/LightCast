import { TeamRequestPanel } from '../ui/TeamRequestPanel';
import { ConnectionQualityBadge } from '../ui/ConnectionQualityBadge';
import { HoldToEndButton } from '../ui/HoldToEndButton';
import type { TeamRequest } from '../domain/teamRequests';
import { phoneIdentity } from '../domain/phoneIdentity';
import type { RemoteControlState } from '../domain/remoteControl';
import type { Cursor } from '../domain/live';
import { Fragment, useEffect, useRef, useState } from 'react';
import { trackViewportHeight } from '../ui/viewportHeight';
import type { LiveState } from '../domain/types';
import { SlideCanvas } from '../ui/SlideCanvas';
import { liveCanvasProps } from '../ui/liveProps';
import { useRelay } from '../ui/hooks';

import { LASER_STALE_MS, laserDue, laserFromMessage, laserPointClamped, parseLaserMessage, type LaserPoint } from '../domain/laserPointer';
import { RemoteInfoReader, remoteSlideKey, type RemoteInfo } from '../domain/remoteSlides';
export type { RemoteInfo } from '../domain/remoteSlides';

/** Phone/tablet remote: tap slides, next/prev, clear layers, run macros. Open /?view=remote on the same network, or the internet address from Settings. */
export function RemoteView() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('freecast.remote.appearance') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  // Landscape on iPhone / iPad home-screen apps: size the remote from the real window height.
  useEffect(() => trackViewportHeight(), []);
  useEffect(() => {
    document.body.dataset.remoteAppearance = appearance;
    return () => { delete document.body.dataset.remoteAppearance; };
  }, [appearance]);
  useEffect(() => {
    const apply = (value: unknown) => { if (value === 'light' || value === 'dark') setAppearance(value); };
    const storage = (e: StorageEvent) => { if (e.key === 'freecast.remote.appearance') apply(e.newValue ?? 'dark'); };
    const message = (e: MessageEvent) => {
      if (e.source === window.parent && e.origin === location.origin && e.data?.type === 'freecast:remote-appearance') apply(e.data.appearance);
    };
    window.addEventListener('storage', storage);
    window.addEventListener('message', message);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('message', message); };
  }, []);
  const [pin, setPin] = useState(() => {
    // A scanned QR link carries the PIN: keep it, then take it out of the address bar.
    const fromLink = new URLSearchParams(location.search).get('pin');
    if (fromLink) {
      localStorage.setItem('freecast.pin', fromLink);
      history.replaceState(null, '', `${location.pathname}?view=remote`);
      return fromLink;
    }
    return localStorage.getItem('freecast.pin') ?? '';
  });
  const [deviceName, setDeviceName] = useState(() => localStorage.getItem('freecast.remote.deviceName') || (/iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone 리모컨' : '내 리모컨'));
  const initialName = useRef(deviceName);
  const [clientToken] = useState(() => phoneIdentity('remote'));
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [control, setControl] = useState<RemoteControlState | null>(null);
  const [rehearsal, setRehearsal] = useState<{ active: boolean; state?: LiveState; cursor?: Cursor | null } | null>(null);
  const [actualLive, setLive] = useState<LiveState | null>(null);
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const reader = useRef(new RemoteInfoReader());
  const [slideTab, setSlideTab] = useState<'all' | 'next'>('all');
  const list = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostConnected, setHostConnected] = useState(false);
  // 레이저 포인터: while it is on, dragging a finger over the slide preview moves the red dot on the audience screens.
  const [laserMode, setLaserMode] = useState(false);
  const [dot, setDot] = useState<LaserPoint | null>(null);
  const dragging = useRef(false);
  const laserSentAt = useRef(0);
  const dotTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);
  const showDot = (p: LaserPoint | null) => {
    clearTimeout(dotTimer.current);
    setDot(p);
    if (p) dotTimer.current = setTimeout(() => setDot(null), LASER_STALE_MS);
  };
  useEffect(() => () => clearTimeout(dotTimer.current), []);
  const { send, connected, status, quality } = useRelay({ type: 'hello', role: 'remote', pin, clientToken, name: initialName.current }, (m) => {
    if (m.type === 'team-requests') { setRequests(m.requests as TeamRequest[]); setRequestError(null); }
    if (m.type === 'team-request-error') setRequestError(String(m.message));
    if (m.type === 'remote-control') setControl(m as unknown as RemoteControlState);
    if (m.type === 'rehearsal') setRehearsal(m as unknown as { active: boolean; state?: LiveState; cursor?: Cursor | null });
    if (m.type === 'welcome') send({ type: 'remote-control', action: 'rename', name: deviceName });
    if (m.type === 'host-status') setHostConnected(m.connected === true);
    if (m.type === 'state') setLive(m.state as LiveState);
    // The dot as the audience sees it (the presenter's, or this phone's own coming back); while a finger is down the phone draws its own.
    if (m.type === 'laser' && !dragging.current) { const lm = parseLaserMessage(m); if (lm) showDot(laserFromMessage(lm)); }
    if (m.type === 'info' || m.type === 'info-chunk' || m.type === 'info-position') { const updated = reader.current.accept(m); if (updated) setInfo(updated); }
    if (m.type === 'error') setError(String(m.error));
  });
  useEffect(() => {
    document.title = 'LightCast Remote';
  }, []);
  // Do not carry an old host/controller state over a disconnected relay session.
  useEffect(() => { if (!connected) { setHostConnected(false); setControl(null); } }, [connected]);
  useEffect(() => { if (!control?.canControl || !connected) { setLaserMode(false); dragging.current = false; } }, [control?.canControl, connected]);
  useEffect(() => { if (!laserMode) { if (dragging.current) { dragging.current = false; send({ type: 'laser', off: true }); } showDot(null); } }, [laserMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const laserAt = (e: React.PointerEvent): LaserPoint | null => {
    const frame = previewRef.current?.querySelector('.canvas-frame');
    return frame ? laserPointClamped(frame.getBoundingClientRect(), e.clientX, e.clientY) : null;
  };
  const laserMove = (e: React.PointerEvent, first = false) => {
    if (!laserMode || !control?.canControl || !ready || (!dragging.current && !first)) return;
    const p = laserAt(e);
    if (!p) return;
    showDot(p);
    if (first || laserDue(laserSentAt.current, Date.now(), p)) { laserSentAt.current = Date.now(); send({ type: 'laser', x: p.x, y: p.y }); }
  };
  const laserEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    send({ type: 'laser', off: true });
    showDot(null);
  };
  const live = rehearsal?.active ? rehearsal.state ?? actualLive : actualLive;
  const ready = connected && hostConnected;
  const embedded = window.self !== window.top;
  const cmd = (command: Record<string, unknown>) => { if (ready && control?.canControl) send({ type: 'command', command }); };
  const connectionLabel = status === 'offline' ? '인터넷 연결 끊김 · 네트워크를 확인하세요' : status === 'reconnecting' ? '연결 끊김 · 자동 재연결 중…' : !connected ? '연결 중…' : !hostConnected ? '서버 연결됨 · 컴퓨터에서 LightCast를 열어 주세요' : '컴퓨터 연결됨';

  const all = info?.all ?? info?.upcoming ?? [];
  const slides = slideTab === 'all' ? all : info?.upcoming ?? [];
  const current = rehearsal?.active ? rehearsal.cursor : info?.current;
  const isCurrent = (item: typeof all[number]) => current
    ? item.presentationId === current.presentationId && item.seq === current.seq && (item.playlistIndex === null || item.playlistIndex === (current.playlistIndex ?? null))
    : info?.current === undefined && !!live?.slide && item.slide.id === live.slide.id;
  const hasCurrent = all.some(isCurrent);
  const locateCurrent = () => {
    setSlideTab('all');
    requestAnimationFrame(() => {
      const region = list.current, current = region?.querySelector<HTMLElement>('[aria-current="true"]');
      if (region && current) region.scrollTo({ top: region.scrollTop + current.getBoundingClientRect().top - region.getBoundingClientRect().top - (region.clientHeight - current.offsetHeight) / 2, behavior: 'auto' });
    });
  };
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [slideTab]);

  if (error) {
    const submit = (v: string) => {
      localStorage.setItem('freecast.pin', v);
      setError(null);
      setPin(v);
    };
    return (
      <div className="remote-root remote-pin">
        <h3>LightCast Remote</h3>
        <p>{pin ? `${error}. Enter the PIN shown in LightCast on the computer.` : 'Enter the PIN shown in LightCast on the computer.'}</p>
        <input id="remote-pin" inputMode="numeric" autoFocus placeholder="PIN" defaultValue={pin} onKeyDown={(e) => {
          if (e.key === 'Enter') submit((e.target as HTMLInputElement).value.trim());
        }} />
        <button className="primary" onClick={() => submit((document.getElementById('remote-pin') as HTMLInputElement).value.trim())}>Connect</button>
      </div>
    );
  }

  return (
    <div className={`remote-root remote-console${embedded ? ' remote-embedded' : ''}`}>
      <header className="remote-head">
        <strong>LightCast</strong>
        <span className="muted small truncate">{live?.title ?? 'Nothing live'}</span>
        {!embedded && <button className="remote-appearance-toggle" aria-label={appearance === 'dark' ? '밝은 화면으로 전환' : '어두운 화면으로 전환'} onClick={() => {
          const next = appearance === 'dark' ? 'light' : 'dark';
          setAppearance(next);
          try { localStorage.setItem('freecast.remote.appearance', next); } catch { /* usable for this session */ }
        }}>{appearance === 'dark' ? '☀ 밝게' : '☾ 어둡게'}</button>}
        <ConnectionQualityBadge quality={quality} connected={ready} compact />
        <span className={`remote-connection ${ready ? 'connected' : 'disconnected'}`} role="status" aria-live="polite" aria-label={connectionLabel} title={connectionLabel}>
          <span className="remote-connection-dot" aria-hidden="true" />
          <span className="remote-connection-text">{connectionLabel}</span>
        </span>
      </header>
      <section className="remote-access" aria-label="리모컨 조작권">
        <details className="remote-identity"><summary>기기</summary><label>기기 이름 <input aria-label="리모컨 기기 이름" maxLength={80} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} onBlur={() => { localStorage.setItem('freecast.remote.deviceName', deviceName); send({ type: 'remote-control', action: 'rename', name: deviceName }); }} /></label></details>
        <button onClick={() => setRequestsOpen(true)}>요청</button>
        <details className="remote-status-details"><summary>연결 상태</summary><div className="remote-status-popover" role="status">
          <p><strong>컴퓨터:</strong> {connectionLabel}</p>
          <p><strong>통신 품질:</strong> {!ready ? '연결 대기 중' : quality.level === 'good' ? '양호' : quality.level === 'fair' ? '지연 있음' : quality.level === 'poor' ? '불안정' : '측정 중'}</p>
          <p><strong>응답 속도:</strong> {ready && quality.latencyMs !== null ? `${quality.latencyMs}ms` : '측정 중'}</p>
          <p><strong>조작권:</strong> {!ready ? '연결 대기 중' : control?.canControl ? '조작 가능' : '보기 전용'}</p>
          <small>휴대폰과 컴퓨터가 모두 인터넷에 연결되어 있으면 다른 Wi-Fi나 모바일 데이터에서도 사용할 수 있습니다.</small>
        </div></details>
        <span role="status">{control?.canControl ? '● 내가 조작 중' : `보기 전용 · ${control?.clients.find((c) => c.id === control.controllerId)?.name ?? '조작권 없음'}`}</span>
        {!control?.canControl && <button disabled={!ready || control?.clients.find((c) => c.id === control.selfId)?.requested} onClick={() => send({ type: 'remote-control', action: 'request' })}>조작권 요청</button>}
        {control?.canControl && <select aria-label="조작권 넘기기" value="" onChange={(e) => { if (e.target.value) send({ type: 'remote-control', action: 'handoff', id: e.target.value }); }}><option value="">{control.clients.some((c) => c.requested && c.id !== control.selfId) ? '조작권 요청 있음' : '조작권 넘기기…'}</option>{control.clients.filter((c) => c.connected && c.id !== control.selfId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.requested ? ' (요청)' : ''}</option>)}</select>}
        {rehearsal?.active && <strong className="remote-rehearsal-label">리허설 · 실제 송출은 바뀌지 않습니다</strong>}
      </section>
      <fieldset disabled={!ready} className="remote-controls">
      <div className="remote-main">
      <section className="remote-handset" aria-label="Presentation controls"><fieldset className="remote-command-keys" disabled={!control?.canControl}>
      <div className="remote-show">
        <button className="remote-start" aria-label="Start slideshow" title="Start slideshow" disabled={!control?.canControl} onClick={() => cmd({ type: 'show/start' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 5.5a8 8 0 1 0 10 0" /></svg>
          <span>Start</span>
        </button>
        <HoldToEndButton disabled={!ready || !control?.canControl || requestsOpen} onConfirm={() => cmd({ type: 'show/end' })} />
      <button className={`remote-laser ${laserMode ? 'active' : ''}`} aria-label="레이저 포인터" aria-pressed={laserMode} title={laserMode ? '레이저 포인터 끄기' : '슬라이드 미리보기를 손가락으로 끌어 청중 화면에 레이저 표시'} disabled={!control?.canControl} onClick={() => setLaserMode(!laserMode)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>
        <span>레이저</span>
      </button>
      <button className={`remote-black ${live?.black ? 'active' : ''}`} aria-label="Black screen" aria-pressed={live?.black ?? false} title={live?.black ? 'Show slide' : 'Black screen'} disabled={!control?.canControl} onClick={() => cmd({ type: 'live/toggleBlack' })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>
        <span>{live?.black ? 'Show' : 'Black'}</span>
      </button>
      </div>
      <div className="remote-nav">
        <button aria-label="Previous slide" title="Previous slide" disabled={!control?.canControl} onClick={() => cmd({ type: 'live/prev' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <button aria-label="Next slide" title="Next slide" disabled={!control?.canControl} onClick={() => cmd({ type: 'live/next' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </div>
      </fieldset></section>
      <div ref={previewRef} className={`remote-current${laserMode ? ' remote-laser-on' : ''}`}
        onPointerDown={laserMode ? (e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); laserMove(e, true); } : undefined}
        onPointerMove={laserMode ? (e) => laserMove(e) : undefined} onPointerUp={laserMode ? laserEnd : undefined} onPointerCancel={laserMode ? laserEnd : undefined}>
        {laserMode && <span className="remote-laser-hint" aria-live="polite">{dot ? '' : '손가락으로 끌어 가리키세요'}</span>}
        {dot && (() => {
          const box = previewRef.current?.getBoundingClientRect(), fr = previewRef.current?.querySelector('.canvas-frame')?.getBoundingClientRect();
          return box && fr ? <div className="remote-laser-dot" style={{ left: fr.left - box.left + dot.x * fr.width, top: fr.top - box.top + dot.y * fr.height }} /> : null;
        })()}
        {live?.slide ? <SlideCanvas {...liveCanvasProps(live)} animate={!rehearsal?.active} /> : <div className="remote-empty">Nothing live</div>}
      </div>
      {(live?.nextText || live?.slide?.notes) && (
        <div className="remote-next">
          {live.nextText && <><label>다음</label>{live.nextText.replace(/\*\*/g, '')}</>}
          {live.slide?.notes && <><label>노트</label>{live.slide.notes}</>}
        </div>
      )}
      </div>
        <section className="remote-upcoming" aria-label="슬라이드 목록">
          <div className="remote-slide-toolbar">
            <div role="tablist" aria-label="표시할 슬라이드">
              <button role="tab" id="remote-all-tab" aria-selected={slideTab === 'all'} aria-controls="remote-slide-list" className={slideTab === 'all' ? 'active' : ''} onClick={() => setSlideTab('all')}>전체 슬라이드 <span>{all.length}</span></button>
              <button role="tab" id="remote-next-tab" aria-selected={slideTab === 'next'} aria-controls="remote-slide-list" className={slideTab === 'next' ? 'active' : ''} onClick={() => setSlideTab('next')}>Up next</button>
            </div>
            <button className="remote-locate" disabled={!hasCurrent} aria-label="현재 슬라이드로 스크롤" onClick={locateCurrent}>현재</button>
          </div>
          <div id="remote-slide-list" ref={list} className="remote-upcoming-scroll" tabIndex={0} role="tabpanel" aria-labelledby={slideTab === 'all' ? 'remote-all-tab' : 'remote-next-tab'}>
          {info?.name && <div className="remote-list-name">{info.name}</div>}
          <div className="remote-slides">
            {slides.map((u) => (
              <Fragment key={remoteSlideKey(u)}>
                {u.heading && <div className="remote-section">{u.section ? u.section + ' · ' : ''}{u.title}</div>}
                <button aria-label={`${u.title} · 슬라이드 ${u.seq + 1}${u.slide.disabled ? ' · 숨김' : ''}`} aria-current={isCurrent(u) ? 'true' : undefined}
                  disabled={!control?.canControl} onClick={() => cmd({ type: 'live/go', presentationId: u.presentationId, seq: u.seq, playlistIndex: u.playlistIndex })}>
                  <SlideCanvas slide={u.slide} theme={info!.themes[u.themeId]} background={u.background} bgEffect={u.bgEffect} />
                  <span className="remote-slide-num">{u.seq + 1}</span>
                  {isCurrent(u) ? <span className="remote-slide-state">현재</span> : u.slide.disabled && <span className="remote-slide-state hidden-slide">숨김</span>}
                </button>
              </Fragment>
            ))}
          </div>
          {!slides.length && <p className="muted small">{slideTab === 'all' ? '컴퓨터에서 재생목록이나 프레젠테이션을 선택해 주세요.' : '다음 슬라이드가 없습니다.'}</p>}
          </div>
        </section>
      </fieldset>
      {requestsOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setRequestsOpen(false)}><section className="modal team-sender-modal" role="dialog" aria-modal="true" aria-label="운영자 요청" onKeyDown={(e) => { if (e.key === 'Escape') setRequestsOpen(false); }}><header className="modal-head"><h2>운영자 요청</h2><button autoFocus aria-label="닫기" onClick={() => setRequestsOpen(false)}>✕</button></header><div className="feature-scroll"><TeamRequestPanel requests={requests} error={requestError} ready={ready} send={(m) => { setRequestError(null); send(m); }} /></div></section></div>}
    </div>
  );
}
