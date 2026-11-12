/** Shown once when the last run of LightCast ended without closing (crash, power cut, killed). */
export function RecoveryNotice({ saveFailed, onRestorePoints, onClose }: { saveFailed: boolean; onRestorePoints: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="alertdialog" aria-label="복구 안내" aria-describedby="recovery-text">
        <header className="modal-head">
          <h2>🛟 지난번에 정상 종료되지 않았습니다</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="wizard-body stack">
          <p id="recovery-text">
            {saveFailed
              ? '마지막 변경 일부가 이 컴퓨터에 저장되지 않았을 수 있습니다(저장 공간 부족). 아래 복원 지점에서 가장 최근 상태를 확인하세요.'
              : 'LightCast는 바꾸는 즉시 저장하므로 작업 내용은 그대로 남아 있습니다. 혹시 빠진 내용이 있으면 복원 지점에서 되돌릴 수 있습니다.'}
          </p>
          <div className="row gap-s">
            <button className="primary" onClick={onRestorePoints}>복원 지점 열기</button>
            <button onClick={onClose}>계속</button>
          </div>
        </div>
      </div>
    </div>
  );
}
