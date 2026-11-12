import { useEffect, useState } from 'react';
import { ai, type AiUsage as Usage, type AiUsageModel } from '../domain/ai';

const PROVIDER: Record<string, string> = { gemini: 'Gemini (Google)', openrouter: 'OpenRouter (무료 모델)', nvidia: 'NVIDIA' };
/** When each provider's free quota starts over (as the Worker counts it). */
const RESET: Record<string, string> = { gemini: '매일 미국 태평양 시간 자정에 초기화 (동부 새벽 3시)', openrouter: '매일 UTC 자정에 초기화 (동부 저녁 8시 · 겨울엔 7시)' };
const num = (n: number) => n.toLocaleString('ko-KR');

function Row({ m }: { m: AiUsageModel }) {
  const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
  const level = pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'low';
  return (
    <tr>
      <td className="ai-usage-model">{m.model}</td>
      <td>
        <div className="ai-usage-meter" title={`${pct}%`}><i className={level} style={{ width: `${pct}%` }} /></div>
        <span className="ai-usage-num">{num(m.used)}{m.limit ? ` / ${num(m.limit)}` : ''}</span>
      </td>
      <td className="ai-usage-num">{num(m.successfulRequests)}</td>
      <td className={`ai-usage-num ${m.failedRequests ? 'bad' : ''}`}>{num(m.failedRequests)}</td>
      <td className="ai-usage-num">{num(m.totalTokens)}</td>
    </tr>
  );
}

/**
 * AI usage, as counted by the church Cloudflare Worker that holds the Gemini / OpenRouter keys
 * (the same counts the ppt site shows): per model, today's requests against the free daily limit.
 */
export function AiUsage({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    ai.usage().then(setData, (e: Error) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const groups = new Map<string, AiUsageModel[]>();
  for (const m of data?.models ?? []) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
  const total = (data?.models ?? []).reduce((a, m) => ({ req: a.req + m.requests, ok: a.ok + m.successfulRequests, fail: a.fail + m.failedRequests, tok: a.tok + m.totalTokens }), { req: 0, ok: 0, fail: 0, tok: 0 });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ai-usage-modal" role="dialog" aria-label="AI 사용량">
        <header className="modal-head">
          <h2>📊 AI 사용량</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="wizard-body stack">
          <p className="hint">
            AI는 교회 Cloudflare Worker에 저장된 Gemini · OpenRouter 키로 작동합니다 (주일예배 생성기와 같은 키). 그래서 어느 컴퓨터에서든 키를 따로 넣지 않아도 되고,
            사용량도 LightCast와 주일예배 생성기를 합쳐서 셉니다. 무료 한도는 매일 새로 시작합니다.
          </p>
          {data?.ownKeys && <p className="warn">이 컴퓨터는 설정에서 자체 API 키를 쓰고 있어서, 여기서 쓴 양은 아래 숫자에 들어가지 않습니다.</p>}
          {error && <p className="warn">{error}</p>}
          {data && (
            <>
              <div className="ai-usage-total">
                <div><b>{num(total.req)}</b><span>오늘 요청</span></div>
                <div><b>{num(total.ok)}</b><span>성공</span></div>
                <div className={total.fail ? 'bad' : ''}><b>{num(total.fail)}</b><span>실패</span></div>
                <div><b>{num(total.tok)}</b><span>토큰</span></div>
              </div>
              <table className="ai-usage-table">
                <thead><tr><th>모델</th><th>사용 / 한도</th><th>성공</th><th>실패</th><th>토큰</th></tr></thead>
                {[...groups].map(([provider, models]) => (
                  <tbody key={provider}>
                    <tr className="ai-usage-group"><td colSpan={5}>{PROVIDER[provider] ?? provider} · {models[0]?.period === 'month' ? `이번 달 (${models[0].periodKey})` : `오늘 (${models[0]?.periodKey})`}<span className="muted small"> — {RESET[provider] ?? '매달 초기화'}</span></td></tr>
                    {models.map((m) => <Row key={`${m.provider}:${m.model}`} m={m} />)}
                  </tbody>
                ))}
              </table>
              <p className="muted small">AI는 Gemini 모델을 먼저 쓰고, 한도에 닿거나 실패하면 다음 모델(OpenRouter 무료 모델 포함)로 넘어갑니다. 업데이트: {new Date(data.generatedAt).toLocaleTimeString('ko-KR')}</p>
            </>
          )}
          <div className="row gap-s">
            <button onClick={load} disabled={loading}>{loading ? '불러오는 중…' : '⟳ 새로고침'}</button>
            <button className="primary" onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
