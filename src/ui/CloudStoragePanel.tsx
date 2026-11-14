import { CloudMediaList } from './CloudMediaList';
import { CloudFontList } from './CloudFontList';
import { CloudClearPanel } from './CloudClearPanel';
import type { CloudSync } from './useCloudSync';
import { formatStorageBytes, formatStoragePercent, formatQuotaBytes } from '../domain/cloudStorage';

export function CloudStoragePanel({ cloud }: { cloud: CloudSync }) {
  const { usage, loading, error } = cloud.storage;
  const server = usage?.server;
  return <section className="cloud-storage" aria-label="서버 저장공간">
    <div className="row"><h3 className="grow">서버 저장공간</h3><button disabled={loading} onClick={() => void cloud.refreshStorage()}>{loading ? '확인 중…' : '용량 새로고침'}</button></div>
    {usage ? <>
      {server ? <>
        <p><b>{formatStoragePercent(server.usedPercent)}%</b> 사용 · {formatStorageBytes(server.usedBytes)} / 무료 계정 한도 {formatQuotaBytes(server.limitBytes)}</p>
        <div className={`cloud-storage-bar ${server.usedPercent >= 90 ? 'critical' : server.usedPercent >= 80 ? 'warning' : ''}`} role="progressbar" aria-label="교회 서버 저장 사용률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(server.usedPercent, 100)} aria-valuetext={`${formatStoragePercent(server.usedPercent)}% 사용`}>
          <span className="cloud-storage-media" style={{ width: `${Math.min(server.usedPercent, 100)}%` }} />
        </div>
        <p className="small">라이브러리 DB {formatStorageBytes(server.freecastBytes)} · 공용 자료·AI 기록 DB {formatStorageBytes(server.sharedBytes)}</p>
        {server.usedPercent >= 80 && <p role="alert">{server.usedPercent >= 100 ? '저장 한도에 도달했습니다.' : '저장공간이 부족해지고 있습니다.'} 불필요한 자료를 정리하세요.</p>}
        <p className="hint">데이터베이스 부가 공간을 포함한 교회 Worker의 실제 사용량입니다. 무료 플랜의 Durable Objects 저장 한도는 계정 전체에서 5 GB를 공유합니다.{!server.accountUsageComplete && ' 다른 Worker의 사용분은 이 수치에 포함되지 않으므로 계정 전체의 남은 공간을 뜻하지 않습니다.'} KV·R2는 별도 한도이며 로컬 복원 지점도 제외됩니다.</p>
      </> : <>
        <p><b>{formatStorageBytes(usage.totalBytes)}</b> 라이브러리 데이터 저장됨 · 미디어 {usage.mediaCount}개</p>
        <p className="hint">무료 계정의 Durable Objects 한도는 5 GB입니다. 서버 용량 측정 API가 아직 없어 전체 데이터베이스 사용률은 표시할 수 없습니다. 서버 업데이트 후 자동으로 표시됩니다.</p>
      </>}
      <p className="small">파일 데이터: 미디어 {formatStorageBytes(usage.mediaBytes)} · 슬라이드·설정·기록 {formatStorageBytes(usage.libraryBytes)}</p>
      <p className="muted small">확인: {new Date(usage.checkedAt).toLocaleString()}{error ? ' · 이전 조회 결과' : ''} · 30초마다 자동 갱신</p>
    </> : !error && <p role="status">{loading ? '서버 용량을 확인하고 있습니다…' : '서버 저장공간을 조회합니다.'}</p>}
    {error && <p role="alert">서버 용량 조회 실패: {error}</p>}
    {cloud.status.session && <CloudMediaList key={cloud.status.session.token} token={cloud.status.session.token} />}
    {cloud.status.session && <CloudFontList key={`f${cloud.status.session.token}`} cloud={cloud} token={cloud.status.session.token} />}
    <CloudClearPanel cloud={cloud} />
  </section>;
}
