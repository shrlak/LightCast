import { useState } from 'react';
import { CAPTION_LANGS } from '../domain/captions';
import { desktop } from '../domain/desktop';
import { PROVIDER_CHOICES, speechStatusText } from '../domain/speech/settings';
import type { DesktopSettingsState } from './DesktopSettings';
import { currentProvider, refreshCloudInfo, setSpeechSettings, speechService, useCloudInfo, useSpeechSettings, useSpeechStatus } from './speechService';

/** 자막 설정: who listens (자동 / 브라우저 / 클라우드), the language, the cloud key, and what is happening right now. */
export function SpeechSettingsCard({ info, refresh }: DesktopSettingsState) {
  const s = useSpeechSettings();
  const status = useSpeechStatus();
  const cloud = useCloudInfo();
  const [key, setKey] = useState('');
  const resolved = currentProvider();
  const bad = status.state === 'error';
  const save = async (patch: Parameters<NonNullable<typeof desktop>['setAiConfig']>[0]) => { await desktop!.setAiConfig(patch); await refreshCloudInfo(); await refresh(); speechService.retry(); };
  return (
    <section className="settings-card speech-card">
      <h4>자막 설정 <span className="muted small">말을 글자로</span></h4>
      <p className="hint">자막, 말로 성경 찾기, 가사 따라가기가 마이크와 음성 인식을 함께 씁니다. 데스크톱 앱에는 브라우저 음성 인식이 없어 클라우드를 씁니다.</p>
      <div className="row gap-xs speech-choices" role="radiogroup" aria-label="음성 인식 제공자">
        {PROVIDER_CHOICES.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={s.provider === p.id} className={s.provider === p.id ? 'on' : ''} title={p.hint} onClick={() => setSpeechSettings({ provider: p.id })}>{p.label}</button>
        ))}
      </div>
      <p className="hint">{PROVIDER_CHOICES.find((p) => p.id === s.provider)?.hint}</p>
      <div className="row gap-xs" role="radiogroup" aria-label="자막 언어">
        {CAPTION_LANGS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={s.lang === l.id} className={s.lang === l.id ? 'on' : ''} onClick={() => setSpeechSettings({ lang: l.id })}>{l.label}</button>
        ))}
      </div>
      <p className={`speech-status${bad ? ' bad' : status.state === 'listening' ? ' ok' : ''}`} role={bad ? 'alert' : 'status'}>
        {speechStatusText(status, resolved)}
        {bad && <button type="button" className="link" onClick={() => speechService.retry()}> 다시 시도</button>}
      </p>
      <p className="hint">클라우드 음성 인식: {cloud === null ? '확인하는 중…' : cloud.configured ? `설정됨 · ${cloud.via === 'gemini' ? 'Gemini' : cloud.via} · ${cloud.model}` : '키가 없습니다'}</p>
      <label className="stack small">서버 주소 (OpenAI 호환 /audio/transcriptions, 비우면 OpenAI)
        <input placeholder="https://api.openai.com/v1" defaultValue={info.ai.speechBaseUrl ?? ''} onBlur={(e) => { if (e.target.value !== (info.ai.speechBaseUrl ?? '')) void save({ speechBaseUrl: e.target.value }); }} />
      </label>
      <label className="stack small">모델 (비우면 기본값)
        <input placeholder="whisper-1" defaultValue={info.ai.speechModel ?? ''} onBlur={(e) => { if (e.target.value !== (info.ai.speechModel ?? '')) void save({ speechModel: e.target.value }); }} />
      </label>
      <div className="row gap-xs">
        <input className="grow" type="password" autoComplete="off" placeholder={info.ai.hasSpeechKey ? '✓ 음성 인식 키 저장됨' : '음성 인식 API 키 (없으면 위의 Gemini 키를 씁니다)'} value={key} onChange={(e) => setKey(e.target.value)} />
        <button disabled={!key.trim()} onClick={async () => { await save({ speechKey: key }); setKey(''); }}>저장</button>
        {info.ai.hasSpeechKey && <button className="danger" onClick={() => void save({ speechKey: '' })}>삭제</button>}
      </div>
      <p className="hint">키는 이 컴퓨터에 암호화되어 저장되고 화면으로 다시 보내지지 않습니다. 소리는 2~3초씩 잘려 설정한 서버로 보내집니다.</p>
    </section>
  );
}
