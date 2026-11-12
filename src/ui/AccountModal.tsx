import { useEffect, useState } from 'react';
import { CloudStoragePanel } from './CloudStoragePanel';
import { DeviceProfileFields } from './DeviceProfileFields';
import type { CloudSync } from './useCloudSync';

/** Sign in to the church cloud library (or create an account with the 관리자 password). */
export function AccountModal({ cloud, onClose, onActivity, onSync }: { cloud: CloudSync; onClose: () => void; onActivity: () => void; onSync: () => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { status, device } = cloud;
  useEffect(() => { if (status.session) void cloud.refreshStorage(); }, [status.session?.token, cloud.refreshStorage]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'register') {
        const { cloudApi } = await import('../domain/cloud');
        await cloudApi.register(username.trim(), password, admin);
        setDone(`계정 “${username.trim()}”을(를) 만들었습니다. 이제 로그인하세요.`);
        setTab('login');
        setAdmin('');
      } else {
        await cloud.login(username.trim(), password);
        setDone('로그인했습니다.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal account-modal" role="dialog" aria-label="Account">
        <header className="modal-head">
          <h2>☁ 교회 클라우드 라이브러리</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="wizard-body">
          {status.session ? (
            <div className="stack">
              <p><b>{status.session.username}</b>(으)로 로그인됨</p>
              {done && <p role="status">{done}</p>}
              <CloudStoragePanel cloud={cloud} />
              <h3>현재 기기</h3>
              <p className="small">{device.platform}{device.computerName ? ` · ${device.computerName}` : ''}{device.appVersion ? ` · LightCast ${device.appVersion}` : ''}<br />기기 ID: {device.id}</p>
              <DeviceProfileFields cloud={cloud} />
              {error && <p role="alert">{error}</p>}
              <p className="hint">입력하면 자동으로 저장됩니다. 이 설정은 이 기기에만 적용됩니다. 브라우저별로 별도 기기로 등록되며, 이름은 이후 사용기록에 적용됩니다.</p>
              <h3>라이브러리에 등록된 기기</h3>
              <ul>{cloud.registeredDevices.map((d) => <li key={d.id}>{d.name}{d.id === device.id ? ' (현재 기기)' : ''} · {d.userName || '사용자 미등록'} · {d.platform}<br /><span className="muted small">마지막 접속 {new Date(d.lastSeen).toLocaleString()} · {d.account ?? '계정 정보 없음'}</span></li>)}</ul>
              <p className="muted small">
                {status.state === 'syncing' ? `동기화 중… ${status.message ?? ''}` : status.state === 'error' ? `동기화 오류: ${status.message}` : status.state === 'offline' ? '오프라인 — 연결되면 자동으로 동기화합니다' : status.lastSync ? `마지막 동기화 ${new Date(status.lastSync).toLocaleString()}` : '대기 중'}
              </p>
              <p className="hint">이 컴퓨터의 프레젠테이션·재생목록·테마·미디어가 교회 서버(Cloudflare Worker)에 저장되고, 같은 계정으로 로그인한 모든 기기에서 열립니다. 두 기기에서 같은 프레젠테이션을 동시에 고치면 둘 다 남깁니다.</p>
              <div className="row gap-s">
                <button onClick={onActivity}>사용기록 보기</button>
                <button onClick={onSync} title="오프라인·보내지 못한 변경·충돌·미디어 준비 확인">⇅ 동기화 상태{cloud.conflicts.length > 0 ? ` · 충돌 ${cloud.conflicts.length}건` : ''}</button>
                <button className="primary" onClick={cloud.syncNow} disabled={status.state === 'syncing'}>지금 동기화</button>
                <button className="danger" onClick={async () => { await cloud.logout(); onClose(); }}>로그아웃</button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="seg light">
                <button className={tab === 'login' ? 'on' : ''} onClick={() => setTab('login')}>로그인</button>
                <button className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>계정 만들기</button>
              </div>
              {done && <div className="fmt-flash">{done}</div>}
              <label className="stack">아이디<input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
              <label className="stack">비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                onKeyDown={(e) => e.key === 'Enter' && tab === 'login' && submit()} /></label>
              {tab === 'register' && (
                <label className="stack">관리자 비밀번호 <span className="muted small">(주일예배 생성기 관리자 설정과 같은 비밀번호)</span>
                  <input type="password" value={admin} onChange={(e) => setAdmin(e.target.value)} autoComplete="off" />
                </label>
              )}
              {error && <div className="warn">{error}</div>}
              <button className="primary" disabled={busy || !username.trim() || password.length < (tab === 'register' ? 6 : 1) || (tab === 'register' && !admin)} onClick={submit}>
                {busy ? '…' : tab === 'login' ? '로그인' : '계정 만들기'}
              </button>
              <p className="hint">로그인하면 슬라이드가 교회 서버에 저장되어 다른 컴퓨터에서도 열 수 있습니다. 로그인하지 않으면 이 컴퓨터에만 저장됩니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
