import { useEffect, useState } from 'react';
import type { Screen } from '../domain/types';
import { desktop, type DesktopInfo } from '../domain/desktop';
import { openOutput } from './outputWindows';
import { UpdateCheck } from './UpdateBanner';
import { qrDataUrl } from '../domain/io/qr';

export interface DesktopSettingsState {
  info: DesktopInfo;
  refresh: () => Promise<void> | undefined;
}

/** Desktop-app only: the app's settings (displays, AI keys, network access), kept fresh while settings are open. */
export function useDesktopInfo(): DesktopSettingsState | null {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const refresh = () => desktop?.info().then(setInfo);

  useEffect(() => {
    refresh();
    return desktop?.onDisplays(() => refresh());
  }, []);
  // The internet address appears a few seconds after switching on, and can change if the connection drops.
  const waiting = info?.internet.on;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [waiting]);

  return desktop && info ? { info, refresh } : null;
}

export function DesktopUpdate({ info }: { info: DesktopInfo }) {
  return (
    <section className="settings-card">
      <h4>소프트웨어 업데이트 <span className="muted small">현재 FreeCast {info.version}</span></h4>
      <UpdateCheck />
      <p className="hint">FreeCast는 macOS(또는 Windows)가 업데이트된 뒤 처음 켤 때 새 버전을 확인하고, 앱을 종료할 때 설치합니다. 예배 중에는 저절로 재시작하지 않습니다.</p>
    </section>
  );
}

/** Which display each output opens on. */
export function DesktopDisplays({ info, refresh, screens }: DesktopSettingsState & { screens: Screen[] }) {
  const displayFor = (id: string) => info.outputDisplays[id] ?? '';
  const targets = [...screens.map((s) => ({ id: s.id, name: s.name, view: 'output' as const, extra: `&screen=${s.id}` }))];
  return (
    <section className="settings-card">
      <h4>어느 모니터에 띄울까요?</h4>
      <p className="hint">화면마다 모니터를 고르면 그 모니터에 전체 화면으로 열리고, 다음에도 기억합니다.</p>
      <div className="settings-rows">
        {targets.map((t) => (
          <div key={t.id} className="settings-row">
            <span className="grow truncate">{t.name}</span>
            <select value={displayFor(t.id)} onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              openOutput(t.view, t.extra, v);
              setTimeout(refresh, 300);
            }}>
              <option value="">창으로 열기</option>
              {info.displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <button onClick={() => openOutput(t.view, t.extra)}>열기</button>
          </div>
        ))}
      </div>
      <div><button onClick={() => desktop!.closeOutputs()}>모든 출력 창 닫기</button></div>
    </section>
  );
}

export function DesktopAi({ info, refresh }: DesktopSettingsState) {
  const [key, setKey] = useState('');
  const [orKey, setOrKey] = useState('');
  return (
    <>
      <section className="settings-card">
        <h4>교회 AI 서버</h4>
        <p className="hint">기본으로 교회 Cloudflare Worker(lyrics-ai-proxy)를 통해 관리자가 정한 모델 순서로 요청합니다. 키가 없어도 됩니다. 주일예배 생성기와 같은 설정입니다.</p>
        <label className="stack small">Worker 주소 (비우면 기본값)
          <input placeholder="https://lyrics-ai-proxy.spencerkim1235.workers.dev" defaultValue={info.ai.proxyUrl} onBlur={async (e) => { await desktop!.setAiConfig({ proxyUrl: e.target.value }); refresh(); }} />
        </label>
      </section>
      <section className="settings-card">
        <h4>내 API 키 <span className="muted small">선택</span></h4>
        <p className="hint">자신의 키를 넣으면 Google Gemini / OpenRouter로 바로 요청합니다. 키는 이 컴퓨터에 암호화되어 저장됩니다.</p>
        <div className="row gap-xs">
          <input className="grow" type="password" autoComplete="off" placeholder={info.ai.hasGeminiKey ? '✓ Gemini 키 저장됨' : 'Gemini API 키'} value={key} onChange={(e) => setKey(e.target.value)} />
          <button disabled={!key.trim()} onClick={async () => { await desktop!.setAiConfig({ geminiKey: key }); setKey(''); refresh(); }}>저장</button>
          {info.ai.hasGeminiKey && <button className="danger" onClick={async () => { await desktop!.setAiConfig({ geminiKey: '' }); refresh(); }}>삭제</button>}
        </div>
        <div className="row gap-xs">
          <input className="grow" type="password" autoComplete="off" placeholder={info.ai.hasOpenrouterKey ? '✓ OpenRouter 키 저장됨' : 'OpenRouter API 키'} value={orKey} onChange={(e) => setOrKey(e.target.value)} />
          <button disabled={!orKey.trim()} onClick={async () => { await desktop!.setAiConfig({ openrouterKey: orKey }); setOrKey(''); refresh(); }}>저장</button>
          {info.ai.hasOpenrouterKey && <button className="danger" onClick={async () => { await desktop!.setAiConfig({ openrouterKey: '' }); refresh(); }}>삭제</button>}
        </div>
      </section>
    </>
  );
}

/** Phones and tablets: on this network, over the internet, and the fixed web-app links. */
export function DesktopRemote({ info, refresh }: DesktopSettingsState) {
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => { setCopyStatus(''); }, [info.internet.connectionCode]);
  const toggle = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    await refresh();
    setBusy(false);
  };

  return (
    <>
      <section className="settings-card">
        <label className="settings-switch">
          <span>
            <b>같은 Wi-Fi의 휴대폰 · 태블릿</b>
            <small className="muted">이 네트워크의 다른 기기에서 리모컨을 열 수 있습니다. 끄면 이 컴퓨터에서만 접속됩니다.</small>
          </span>
          <input type="checkbox" checked={info.networkRemote} disabled={busy} onChange={(e) => toggle(() => desktop!.setNetworkRemote(e.target.checked))} />
        </label>
        {info.networkRemote && info.lanUrls.map((u) => <code key={u} className="small selectable">{u}/?view=remote</code>)}
      </section>

      <section className="settings-card">
        <label className="settings-switch">
          <span>
            <b>어디서나 리모컨 (인터넷)</b>
            <small className="muted">다른 Wi-Fi나 휴대폰 데이터로도 FreeCast를 조작합니다.</small>
          </span>
          <input type="checkbox" checked={info.internet.on} disabled={busy} onChange={(e) => toggle(() => desktop!.setInternetRemote(e.target.checked))} />
        </label>
        {info.internet.on && info.internet.status === 'connecting' && <p className="hint">{info.internet.note ?? '연결하는 중…'}</p>}
        {info.internet.on && info.internet.status === 'error' && <p className="hint warn">{info.internet.error}</p>}
      </section>

      <section className="settings-card">
        <h4>FreeCast Remote 웹앱</h4>
        <code className="small selectable">{info.internet.webAppUrl ?? `${info.ai.proxyUrl.replace(/\/+$/, '')}/freecast/remote/`}</code>
        <p className="hint">Windows·Mac 어느 컴퓨터를 사용하든 웹앱 주소는 같습니다. iPhone Safari에서 열고 공유 → 홈 화면에 추가를 선택하세요.</p>
        {!info.internet.on && <p className="hint">이 컴퓨터를 연결하려면 위의 <b>어디서나 리모컨</b>을 켜세요.</p>}
        {info.internet.on && info.internet.linkStatus === 'ok' && info.internet.link && (
          <div className="settings-pair">
            <img src={qrDataUrl(info.internet.pairingUrl ?? info.internet.link)} alt="FreeCast Remote 컴퓨터 연결 QR 코드" width={150} height={150} />
            <div className="stack grow">
              <b>이 컴퓨터 연결</b>
              <p className="hint">QR 코드를 한 번 스캔하면 이 컴퓨터가 웹앱에 저장됩니다. 이후 고정 웹앱 주소에서 저장한 컴퓨터를 선택하세요.</p>
              {info.internet.connectionCode && <>
                <label className="stack small">연결 코드 (QR 대신 웹앱의 ‘컴퓨터 변경 → 연결 코드’에 붙여 넣기)
                  <input className="selectable" readOnly value={info.internet.connectionCode} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
                </label>
                <div className="row gap-xs wrap">
                  <button onClick={async () => {
                    try {
                      if (!await desktop!.copyRemoteCode()) throw new Error('Code unavailable');
                      setCopyStatus('연결 코드를 복사했습니다.');
                    } catch {
                      setCopyStatus('복사하지 못했습니다. 위 연결 코드를 선택한 뒤 직접 복사해 주세요.');
                    }
                  }}>연결 코드 복사</button>
                  <button onClick={async () => { if (!confirm('연결 키를 재발급할까요? 기존에 연결한 휴대폰은 새 QR 코드를 스캔해야 합니다. 웹앱 주소는 그대로 유지됩니다.')) return; await desktop!.newRemoteLink(); refresh(); }}>연결 키 재발급</button>
                </div>
                <p className="hint" role="status">{copyStatus}</p>
              </>}
              <code className="small selectable">{info.internet.pairingUrl ?? info.internet.link}</code>
            </div>
          </div>
        )}
        {info.internet.on && info.internet.linkStatus === 'pending' && <p className="hint">이 컴퓨터의 고정 연결을 등록하고 있습니다…</p>}
        {info.internet.on && (info.internet.linkStatus === 'error' || info.internet.linkStatus === 'unavailable') && <p className="hint">{info.internet.linkError ?? '연결 등록을 다시 시도하고 있습니다.'}</p>}
        <p className="hint">🔐 연결 QR 코드는 컴퓨터를 조작할 수 있는 개인 연결 정보입니다. 미디어팀에만 공유하세요.</p>
      </section>

    </>
  );
}
