import { useEffect, useState, type FormEvent } from 'react';
import { cloudApi, type CloudClearPreview } from '../domain/cloud';
import { formatStorageBytes } from '../domain/cloudStorage';
import type { CloudSync } from './useCloudSync';

export function CloudClearPanel({ cloud }: { cloud: CloudSync }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CloudClearPreview | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const token = cloud.status.session?.token;
  useEffect(() => {
    if (!open || !token) return;
    cloud.pauseSync(); let cancelled = false;
    setPreview(null); setError(null);
    cloudApi.clearPreview(token).then((p) => { if (!cancelled) setPreview(p); }).catch((e) => {
      if (!cancelled) setError(e.status === 404 ? '서버 전체 삭제 기능을 사용하려면 서버 업데이트가 필요합니다.' : e.message);
    });
    return () => { cancelled = true; cloud.resumeSync(); };
  }, [open, token, cloud.pauseSync, cloud.resumeSync]);
  if (!token) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!preview || busy || !password) return;
    setBusy(true); setError(null);
    try { await cloud.clearAll(password, preview.revision); setOpen(false); setPreview(null); setDone(true); }
    catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409) {
        try { setPreview(await cloudApi.clearPreview(token)); } catch { setPreview(null); }
      }
    } finally { setPassword(''); setBusy(false); }
  };
  return <section className="cloud-clear" aria-label="서버 전체 자료 삭제">
    <h3>서버 자료 삭제</h3>
    {done && <p role="status">서버의 LightCast 자료를 모두 삭제했습니다.</p>}
    {!open ? <button className="danger" onClick={() => { setDone(false); setOpen(true); }}>서버 전체 자료 삭제…</button> : <form onSubmit={submit} className="stack">
      <p role="alert">이 서버를 사용하는 모든 사용자의 LightCast 재생목록·찬양·미디어·휴지통을 영구 삭제합니다. 보호된 자료도 포함하며 실행 취소할 수 없습니다.</p>
      <p className="hint">공용 찬양/PPT 사이트 자료, 로그인 계정과 서버 설정은 유지합니다. 다른 기기는 다시 로그인해야 하며, 예전 동기화로 삭제한 파일이 다시 올라오지 않게 처리합니다.</p>
      {preview ? <>
        <p>삭제할 서버: <b>{preview.server}</b></p>
        <p>자료 {preview.presentations}개 · 재생목록 {preview.playlists}개 · 휴지통 {preview.trash}개 · 미디어 {preview.mediaCount}개 ({formatStorageBytes(preview.mediaBytes)})</p>
      </> : !error && <p role="status">서버의 삭제 대상을 확인하고 있습니다…</p>}
      <label className="stack">로그인 비밀번호 재입력<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="row gap-s"><button type="button" disabled={busy} onClick={() => { setOpen(false); setPassword(''); }}>취소</button><button type="submit" className="danger" disabled={busy || !preview || !password}>{busy ? '전체 삭제 중…' : '비밀번호 확인 후 전체 삭제'}</button></div>
    </form>}
  </section>;
}
