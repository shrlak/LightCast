import { useEffect, useState } from 'react';
import type { Library } from '../domain/types';
import { emptySlide, referencedAssets, serviceDecks, type ReadinessItem } from '../domain/serviceReadiness';
import { getMedia } from '../domain/media';
import { inspectMediaBlob } from '../domain/mediaReadiness';
import { openOutput } from './outputWindows';
import { desktop } from '../domain/desktop';

const TASKS = ['콘티 확인', '찬양 가사·순서 확인', '기도제목 확인', '설교 PPT 확인', '광고 확인'];
function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }

export function ServicePreparationModal({ library, playlistId, onClose, onSettings, mode = 'preparation' }: {
  library: Library; playlistId: string | null; onClose: () => void; onSettings: () => void; mode?: 'preparation' | 'preflight';
}) {
  const pl = library.playlists.find((p) => p.id === playlistId);
  const key = `freecast.preparation.${pl?.id ?? 'none'}`;
  const [done, setDone] = useState<string[]>([]);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [soundChecked, setSoundChecked] = useState(false);
  const [orderChecked, setOrderChecked] = useState(false);
  const [results, setResults] = useState<ReadinessItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projector, setProjector] = useState(false);
  useEffect(() => {
    try { const v: unknown = JSON.parse(read(key) ?? '[]'); setDone(Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && TASKS.includes(s)) : []); }
    catch { setDone([]); }
    setResults(null); setProjector(false); setSoundChecked(false); setOrderChecked(false); setCheckedAt(null);
  }, [key]);
  const persist = (k: string, v: string): boolean => {
    try { localStorage.setItem(k, v); setError(''); return true; }
    catch { setError('저장하지 못했습니다. 브라우저 저장 공간 또는 접근 권한을 확인하세요.'); return false; }
  };
  const toggle = (task: string) => {
    const next = done.includes(task) ? done.filter((t) => t !== task) : [...done, task];
    if (persist(key, JSON.stringify(next))) setDone(next);
  };
  const check = async () => {
    setBusy(true); setResults(null); setError(''); setProjector(false);
    try {
      const decks = serviceDecks(library, playlistId);
      const slides = decks.flatMap((p) => p.slides);
      const missingRefs = pl?.items.filter((i) => i.kind !== 'header' && !library.presentations.some((p) => p.id === i.presentationId)).length ?? 0;
      const report: ReadinessItem[] = [{ label: '예배 순서', ok: !!decks.length && !missingRefs, detail: `${decks.length}개 프레젠테이션 · 누락된 순서 ${missingRefs}개` }];
      const empty = slides.filter((s) => !s.disabled && emptySlide(s)).length;
      report.push({ label: '빈 슬라이드', ok: slides.length > 0 && empty === 0, detail: `슬라이드 ${slides.length}장 · 내용 없는 슬라이드 ${empty}장 (의도한 빈 화면인지 직접 확인)` });
      const assets = referencedAssets(decks);
      const missing: string[] = [];
      for (let i = 0; i < assets.media.length; i += 4) {
        await Promise.all(assets.media.slice(i, i + 4).map(async (id) => {
          const meta = library.media.find((m) => m.id === id);
          const blob = await getMedia(id);
          if (!blob || !(await inspectMediaBlob(blob, meta?.type ?? 'image'))) missing.push(meta?.name ?? id);
        }));
      }
      for (const url of assets.images) {
        try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/') || !(await inspectMediaBlob(await r.blob(), 'image'))) missing.push(url); }
        catch { missing.push(url); }
      }
      report.push({ label: '이미지·동영상·오디오 파일', ok: !missing.length, detail: missing.length ? `누락/읽기 실패: ${missing.join(', ')}` : `미디어 ${assets.media.length}개 · 배경 이미지 ${assets.images.length}개 읽기 확인 (동영상 전체 재생·소리는 직접 확인)` });
      if (desktop) {
        const info = await desktop.info();
        const outputs = library.screens.filter((s, i) => i === 0 || info.outputDisplays[s.id] != null);
        const missingDisplays = outputs.filter((s) => !info.displays.some((d) => d.id === info.outputDisplays[s.id]));
        report.push({ label: '발표 화면 설정', ok: outputs.length > 0 && !missingDisplays.length, detail: `연결 화면 ${info.displays.length}개 · 지정된 출력 ${outputs.length}개${missingDisplays.length ? ` · 화면 지정 필요: ${missingDisplays.map((s) => s.name).join(', ')}` : ''}` });
      } else report.push({ label: '프로젝터·발표 화면', ok: false, detail: '데스크톱 앱의 화면 설정에서 확인하세요. 브라우저에서는 연결된 화면을 자동 점검할 수 없습니다.' });
      setResults(report); setCheckedAt(Date.now());
    } catch (e) { setError(`점검 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-label={mode === 'preflight' ? '예배 시작 전 점검' : '예배 준비 · 점검'}>
      <header className="modal-head"><h2>{mode === 'preflight' ? '예배 시작 전 점검' : '예배 준비 · 점검'} · {pl?.name ?? '예배를 먼저 선택하세요'}</h2><button onClick={onClose} aria-label="닫기">✕</button></header>
      <div className="wizard-body stack">
        {mode === 'preparation' && <><h3>준비 체크리스트 · {done.length}/{TASKS.length}</h3>
        <p className="hint">선택한 예배별로 이 컴퓨터에 저장됩니다. 새 예배를 만들면 새 목록으로 시작합니다. 파일 내용과 순서를 직접 확인한 뒤 표시하세요.</p>
        {TASKS.map((task) => <label key={task}><input type="checkbox" disabled={!pl} checked={done.includes(task)} onChange={() => toggle(task)} /> {task}</label>)}</>}
        <h3>예배 시작 전 점검</h3>
        <p className="hint">현재 컴퓨터에서 바로 실행할 수 있습니다. 누락 파일·미디어 읽기·빈 슬라이드·발표 화면을 확인합니다. 실제 프로젝터와 소리는 교회 컴퓨터에서 직접 확인하세요. 점검은 발표를 자동으로 막지 않습니다.</p>
        <div className="row"><button onClick={onSettings}>화면 설정 열기</button><button disabled={!pl || busy} onClick={() => void check()}>{busy ? '점검 중…' : '지금 점검'}</button>
          <button disabled={!library.screens.length} onClick={() => openOutput('output', `&screen=${encodeURIComponent(library.screens[0].id)}`)}>출력 화면 열기</button></div>
        {error && <p role="alert">{error}</p>}
        {results && <><p className="small">점검 시각: {checkedAt ? new Date(checkedAt).toLocaleString() : ''} · 자료 수정 후에는 다시 점검하세요.</p><ul>{results.map((r) => <li key={r.label}>{r.ok ? '✓' : '⚠'} {r.label}: {r.detail}</li>)}</ul>
          <label><input type="checkbox" checked={projector} onChange={(e) => setProjector(e.target.checked)} /> 프로젝터에 실제 발표 화면이 정상 표시됩니다</label>
          <label><input type="checkbox" checked={soundChecked} onChange={(e) => setSoundChecked(e.target.checked)} /> 동영상 재생과 소리를 현장에서 직접 확인했습니다 (미사용 시에도 확인 표시)</label>
          <label><input type="checkbox" checked={orderChecked} onChange={(e) => setOrderChecked(e.target.checked)} /> 예배 순서와 의도한 빈 화면을 직접 확인했습니다</label>
          <p role="status">{results.every((r) => r.ok) && projector && soundChecked && orderChecked ? '점검 완료' : '위 항목을 확인해 주세요. 자동 점검만으로 실제 투사 화면과 소리는 확인할 수 없습니다.'}</p></>}
      </div>
    </div>
  </div>;
}
