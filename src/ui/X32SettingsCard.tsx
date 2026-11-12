import { useState } from 'react';
import type { X32Settings } from '../domain/x32';
import { useX32, x32 } from './x32';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** ⚙ 설정 → 장비 · 연결: connect LightCast to a Behringer X32 over Wi-Fi, to operate the mixer. */
export function X32SettingsCard({ settings, onChange }: { settings: X32Settings; onChange: (s: X32Settings) => void }) {
  const mixer = useX32();
  const [ip, setIp] = useState(settings.ip);
  const [found, setFound] = useState<{ ip: string; name: string | null; model: string | null }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectTo = (address: string) => {
    const v = address.trim();
    if (!IPV4.test(v)) { setError('IP 주소를 192.168.0.64처럼 넣으세요.'); return; }
    setError(null);
    setFound(null);
    setIp(v);
    onChange({ on: true, ip: v });
  };
  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const list = await x32.scan();
      setFound(list);
      if (list.length === 1) connectTo(list[0].ip);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const on = settings.on && !!settings.ip;
  const label = mixer.status === 'unavailable' ? 'X32 연결은 LightCast 데스크톱 앱에서 됩니다.'
    : !on ? '연결 안 함'
    : mixer.status === 'connected' ? `X32 연결됨 · ${mixer.ip}${mixer.name ? ` · ${mixer.name}` : ''}${mixer.model ? ` (${mixer.model})` : ''}`
    : mixer.status === 'lost' ? `X32 응답 없음 · ${mixer.ip ?? settings.ip} — 같은 Wi-Fi인지, X32가 켜져 있는지 확인하세요. 계속 다시 시도합니다.`
    : `X32 찾는 중 · ${settings.ip}…`;

  return (
    <section className="settings-card">
      <h4>Behringer X32 믹서 (Wi-Fi)</h4>
      <p className="hint">LightCast에서 믹서를 조작합니다 — 뮤트 · 페이더 · 장면 불러오기. 라이브 패널의 <b>Mixer</b> 탭에서 직접 조작하고, 매크로와 슬라이드 동작에도 넣을 수 있습니다 (예: 설교 슬라이드에서 설교자 마이크 켜기).</p>
      <p className="row gap-xs small"><span className={`dot ${on && mixer.status === 'connected' ? 'on' : ''}`} /><span className={on && (mixer.status === 'lost' || mixer.status === 'unavailable') ? 'warn' : ''}>{label}</span></p>
      <form className="row gap-xs wrap" onSubmit={(e) => { e.preventDefault(); connectTo(ip); }}>
        <input className="grow" inputMode="decimal" aria-label="X32 IP 주소" placeholder="X32 IP 주소 (예: 192.168.0.64)" value={ip} onChange={(e) => setIp(e.target.value)} />
        <button type="button" disabled={scanning || mixer.status === 'unavailable'} onClick={scan}>{scanning ? '찾는 중…' : 'X32 찾기'}</button>
        {on
          ? <button type="button" onClick={() => onChange({ ...settings, on: false })}>연결 끊기</button>
          : <button type="submit" className="primary">연결</button>}
      </form>
      {(error || mixer.error) && <p className="warn small">{error ?? mixer.error}</p>}
      {found && found.length === 0 && <p className="hint">찾은 X32가 없습니다. 이 컴퓨터와 X32가 같은 네트워크에 있는지 확인하거나, X32 SETUP → network의 IP 주소를 직접 넣으세요.</p>}
      {found && found.length > 1 && (
        <div className="row gap-xs wrap">{found.map((f) => <button key={f.ip} onClick={() => connectTo(f.ip)}>{f.name ?? f.model ?? 'X32'} · {f.ip}</button>)}</div>
      )}
      <details className="hint">
        <summary>연결 방법</summary>
        <ol>
          <li>X32 뒷면의 <b>ETHERNET</b> 포트를 교회 Wi-Fi 공유기(라우터)에 랜선으로 연결합니다.</li>
          <li>이 컴퓨터를 같은 Wi-Fi에 연결하고 <b>X32 찾기</b>를 누릅니다. 찾지 못하면 X32 <b>SETUP → network</b>에 나온 IP 주소를 넣고 <b>연결</b>을 누르세요. (IP가 바뀌지 않도록 X32에 고정 IP를 정해 두면 좋습니다.)</li>
          <li>Mac에서 처음 연결할 때 “로컬 네트워크” 접근을 물으면 <b>허용</b>하세요.</li>
          <li>연결되면 채널 이름 · 뮤트 · 페이더 · 장면 이름을 믹서에서 읽어 오고, 믹서에서 바꾼 것도 바로 따라옵니다.</li>
        </ol>
      </details>
    </section>
  );
}
