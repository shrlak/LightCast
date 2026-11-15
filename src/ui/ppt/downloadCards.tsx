// 저장 › 현재 프레젠테이션을 .pptx / .ppt로 내려받기 (the .ppt card only where the desktop app can convert).
import type { ReactNode } from 'react';
import { canTryPpt, downloadDeck, type DeckFormat } from '../../domain/io/pptDownload';
import { RI } from './ribbonParts';
import type { Ed } from './editor';

function Card({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text?: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="bs-card" disabled={disabled} onClick={onClick}><span className="bs-card-icon">{icon}</span><b>{title}</b>{text && <small>{text}</small>}</button>;
}

export function DeckDownloadCards({ ed }: { ed: Ed }) {
  const p = ed.p;
  const go = async (format: DeckFormat) => {
    if (!p) return;
    ed.cmd.notify(format === 'ppt' ? '.ppt로 바꾸는 중… (PowerPoint 또는 LibreOffice)' : '.pptx 만드는 중…');
    try {
      const name = await downloadDeck(ed.state.library, { presentation: p }, p.title, format);
      ed.cmd.notify(`${name} 내려받았습니다`);
    } catch (e) {
      ed.cmd.notify((e as Error).message);
    }
  };
  return (
    <>
      <Card icon={RI.paste} title="내려받기 (.pptx)" text="현재 프레젠테이션을 PowerPoint 파일로" disabled={!p} onClick={() => void go('pptx')} />
      {canTryPpt() && <Card icon={RI.paste} title="내려받기 (.ppt)" text="구형 PowerPoint 97–2003 (PowerPoint 또는 LibreOffice 필요)" disabled={!p} onClick={() => void go('ppt')} />}
    </>
  );
}
