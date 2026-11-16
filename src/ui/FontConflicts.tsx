// 글꼴 충돌: faces for which two computers hold different files. The rule (larger file, then earlier upload) already
// decided which one every computer keeps; here the person sees it and can fetch the other one too, under a suffix.
import { useState, useSyncExternalStore } from 'react';
import { getFontConflicts, subscribeFontConflicts } from '../domain/fontConflictStore';
import { KEEP_BOTH_SUFFIX, type CloudFont } from '../domain/fontSync';
import { createFontCloud, createFontStore } from '../domain/fontSyncStore';
import { weightLabel } from '../domain/fontWeight';
import { loadSession } from '../domain/cloud';

export function FontConflictsPanel() {
  const list = useSyncExternalStore(subscribeFontConflicts, getFontConflicts);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (!list.length) return null;
  const keepBoth = async (e: CloudFont) => {
    const session = loadSession();
    if (!session) { setMsg('먼저 클라우드에 로그인해 주세요.'); return; }
    setBusy(e.id);
    try {
      const blob = await createFontCloud(session.token).download(e.id);
      const ok = await createFontStore('keep-both').add(e, await blob.arrayBuffer(), KEEP_BOTH_SUFFIX);
      setMsg(ok ? `“${e.family}${KEEP_BOTH_SUFFIX}”으로 함께 보관했습니다.` : '보관하지 못했습니다(저장 공간 확인).');
    } catch (err) { setMsg(`받지 못했습니다: ${err instanceof Error ? err.message : '오류'}`); }
    finally { setBusy(null); }
  };
  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))}KB`;
  return <div className="font-conflicts" role="status" style={{ borderLeft: '3px solid #f9a825', background: '#fffde7', padding: '4px 8px', marginBottom: 6, fontSize: 12 }}>
    <strong>같은 글꼴의 다른 파일 {list.length}건</strong>
    <p className="muted" style={{ margin: '2px 0' }}>컴퓨터마다 같은 글꼴·굵기의 파일이 달라, 더 큰 파일(같으면 먼저 올린 파일)로 모든 컴퓨터를 맞춥니다. 다른 파일은 서버에 남아 있습니다.</p>
    {list.map((c) => <div key={c.winner.id} style={{ marginTop: 3 }}>
      {c.family} {weightLabel(c.weight)}{c.italic ? ' · 기울임' : ''} — 사용: {kb(c.winner.bytes)}{c.holdsWinner ? '' : ' (아직 받지 않음)'}
      {c.others.map((o) => <span key={o.id}> · 다른 파일 {kb(o.bytes)} {c.holdsOthers.includes(o.id) ? '(보관 중)' : <button type="button" className="btn small" disabled={busy !== null} onClick={() => void keepBoth(o)}>{busy === o.id ? '받는 중…' : `둘 다 보관 (${KEEP_BOTH_SUFFIX.trim()})`}</button>}</span>)}
    </div>)}
    {msg && <div>{msg}</div>}
  </div>;
}
