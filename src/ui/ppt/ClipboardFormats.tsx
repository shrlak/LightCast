// Home › 붙여넣기 › 클립보드 형식 보기…: every format on the clipboard with its size and what LightCast made of it
// (by signature, not by name), so a format that is not recognised can be reported for a follow-up fix.
import { useEffect, useState } from 'react';
import { formatBytes } from '../../domain/clipboardScan';
import { readClipboard, reportOf, type ClipboardRead } from '../clipboardSlides';
import { Dialog } from './dialogs';
import type { Ed } from './editor';

export function ClipboardFormatsDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const [read, setRead] = useState<ClipboardRead | null>(null);
  const [busy, setBusy] = useState(true);
  const scan = async () => {
    setBusy(true);
    setRead(await readClipboard({ browserRead: true }).catch(() => null));
    setBusy(false);
  };
  useEffect(() => { void scan(); }, []);
  const copy = () => {
    if (!read) return;
    navigator.clipboard.writeText(reportOf(read)).then(() => ed.cmd.notify('형식 목록을 복사했습니다'), () => ed.cmd.notify('형식 목록을 복사하지 못했습니다'));
  };
  const usable = read?.decks.length ? `슬라이드 ${read.decks.length}종을 읽을 수 있습니다 (${read.decks.map((d) => d.format).join(', ')}).` : read?.gvml ? 'PowerPoint 도형 묶음이 있습니다. 개체로 붙여넣을 수 있습니다.' : '슬라이드 데이터가 없습니다.';
  return (
    <Dialog title="클립보드 형식" onClose={onClose} wide>
      <p className="small">클립보드에 있는 모든 형식과, LightCast가 내용(서명)으로 알아본 종류입니다. 붙여넣기가 안 될 때 <b>목록 복사</b>로 복사해 보내 주시면 원인을 고칠 수 있습니다.</p>
      {busy ? <p role="status">클립보드 읽는 중…</p> : !read ? <p role="alert">클립보드를 읽지 못했습니다. 브라우저에서는 클립보드 읽기를 허용해 주세요.</p> : (
        <>
          <p role="status"><b>{usable}</b>{!read.decks.length && !read.gvml ? ' 슬라이드는 PowerPoint에서 .pptx로 저장한 뒤 파일 › 열기로 여세요.' : ''}</p>
          {read.rows.length === 0 ? <p>클립보드가 비어 있습니다.</p> : (
            <table className="clip-formats" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th align="left">형식 이름</th><th align="right">크기</th><th align="left">내용으로 알아본 종류</th></tr></thead>
              <tbody>
                {read.rows.map((r, i) => (
                  <tr key={`${r.name}:${i}`}>
                    <td style={{ wordBreak: 'break-all' }}>{r.name}</td>
                    <td align="right">{formatBytes(r.size)}</td>
                    <td>{r.label}{r.detail ? ` — ${r.detail}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button type="button" onClick={() => void scan()} disabled={busy}>다시 읽기</button>
        <button type="button" onClick={copy} disabled={!read}>목록 복사</button>
      </div>
    </Dialog>
  );
}
