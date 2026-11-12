import { useEffect, useState } from 'react';
import { desktop, type UpdateState } from '../domain/desktop';

/**
 * Update notice (desktop app), on screen over the console: LightCast looks for a new release every
 * 30 minutes while it is open, and as soon as one is found this says so ("새 버전 … 내려받는 중"),
 * then offers to restart once it is ready. "숨기기" hides it only for that version and step: it comes
 * back when the download is ready or a newer version turns up. Nothing restarts by itself.
 */
export function UpdateBanner() {
  const [st, setSt] = useState<UpdateState | null>(null);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.updateState().then(setSt);
    return desktop.onUpdate(setSt);
  }, []);
  if (!desktop || !st || (st.status !== 'downloading' && st.status !== 'ready')) return null;
  const key = `${st.status}:${st.version}`;
  if (hiddenFor === key) return null;
  if (st.status === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <span><strong>🔔 새 버전 LightCast {st.version}이(가) 있습니다.</strong> 내려받는 중… {st.progress}%</span>
        <progress max={100} value={st.progress} />
        <button className="mini-btn" onClick={() => setHiddenFor(key)}>숨기기</button>
      </div>
    );
  }
  return (
    <div className="update-banner ready" role="alert">
      <span><strong>✅ LightCast {st.version} 업데이트가 준비되었습니다.</strong></span>
      <button className="primary" onClick={() => desktop!.installUpdate()}>지금 재시작하여 업데이트</button>
      <button onClick={() => setHiddenFor(key)}>나중에 (종료할 때 설치)</button>
    </div>
  );
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

/** "Check for updates" control for settings. */
export function UpdateCheck() {
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.updateState().then(setSt);
    return desktop.onUpdate(setSt);
  }, []);
  if (!desktop) return null;
  const label = !st ? '' : st.status === 'checking' ? '확인 중…' : st.status === 'none' ? '최신 버전입니다' : st.status === 'downloading' ? `내려받는 중 ${st.progress}%` : st.status === 'ready' ? `${st.version} 준비됨` : st.status === 'error' ? `오류: ${st.error}` : '';
  return (
    <div className="row gap-xs">
      <button onClick={() => desktop!.checkUpdates().then((s) => s && setSt(s))}>업데이트 확인</button>
      {st?.status === 'ready' && <button className="primary" onClick={() => desktop!.installUpdate()}>재시작하여 설치</button>}
      <span className="muted small">{label}{st?.checkedAt ? ` · 마지막 확인 ${clock(st.checkedAt)}` : ''} · 앱이 열려 있으면 30분마다 자동으로 확인합니다</span>
    </div>
  );
}
