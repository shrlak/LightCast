import { useState } from 'react';
import { useAutosave } from './hooks';
import type { CloudSync } from './useCloudSync';
import { isChurchDevice } from '../domain/sundayBackup';

/**
 * 기기 이름 + 기기 사용자 이름, saved by themselves while typing (no save button). A name left empty
 * is not saved; the last good one stays until it is filled in again.
 */
export function DeviceProfileFields({ cloud, initialName, autoFocus = false }: { cloud: CloudSync; initialName?: string; autoFocus?: boolean }) {
  const [name, setName] = useState(initialName ?? cloud.device.name);
  const [userName, setUserName] = useState(cloud.device.userName);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [church, setChurch] = useState(() => isChurchDevice(cloud.device));
  const save = ({ name, userName }: { name: string; userName: string }) => {
    try {
      cloud.renameDevice(name, userName);
      setNote({ ok: true, text: '✓ 자동 저장됨' });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
  };
  const flush = useAutosave({ name, userName }, save, { delay: 600 });
  return (
    <div className="stack">
      <label className="stack">기기 이름<input maxLength={60} autoFocus={autoFocus} value={name} onChange={(e) => setName(e.target.value)} onBlur={flush} placeholder="예: 교회 본당 Mac" /></label>
      <label className="stack">기기 사용자 이름<input maxLength={60} value={userName} onChange={(e) => setUserName(e.target.value)} onBlur={flush} placeholder="예: 김철수" /></label>
      <label className="row gap-xs" title="주일 오후 1시 55분에 이번 주일예배가 발표 중이 아니면, 이 컴퓨터가 켜져 있을 때 이 컴퓨터가 PPTX 사본을 다운로드 폴더에 저장합니다">
        <input type="checkbox" checked={church} onChange={(e) => { setChurch(e.target.checked); cloud.markChurch(e.target.checked); }} />
        교회 컴퓨터 (주일 1시 55분 자동 PPTX 저장)
      </label>
      {note && <p className={note.ok ? 'muted small' : 'warn'} role="status">{note.text}</p>}
    </div>
  );
}
