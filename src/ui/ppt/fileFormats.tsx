// File › Open / Save / Info: OpenDocument (.odp), LightCast's own password-protected file (.lcast) and
// PowerPoint-compatible password protection of .pptx (Agile Encryption, src/domain/io/officeCrypto.ts).
// The .lcast password protects LightCast's own file only; "PowerPoint 암호로 저장" makes a .pptx PowerPoint asks the password for.
import { collectDeckFonts, restoreNativeFonts } from '../../domain/importedFonts';
import { useRef, useState, type ReactNode } from 'react';
import { mediaIdsOf } from '../../domain/filePrint';
import { getMedia, putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { writeOdp } from '../../domain/io/odp';
import { encryptOfficePackage } from '../../domain/io/officeCrypto';
import { exportPptxBytes } from '../../domain/io/pptxExport';
import { LCAST_EXT, PasswordRequiredError, WrongPasswordError, openNative, passwordProblem, saveNative, type NativeMedia } from '../../domain/io/lcastFile';
import type { Presentation } from '../../domain/types';
import { Dialog, Field } from './dialogs';
import type { Ed } from './editor';

function Card({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text?: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="bs-card" disabled={disabled} onClick={onClick}><span className="bs-card-icon">{icon}</span><b>{title}</b>{text && <small>{text}</small>}</button>;
}

const fileName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'LightCast';

function saveBytes(name: string, bytes: Uint8Array, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** The presentation's pictures and media as stored on this computer. */
async function collectMedia(ed: Ed, p: Presentation): Promise<NativeMedia[]> {
  const out: NativeMedia[] = [];
  for (const id of mediaIdsOf(p)) {
    const blob = await getMedia(id).catch(() => undefined);
    const meta = ed.state.library.media.find((m) => m.id === id);
    if (blob && meta) out.push({ meta, bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'application/octet-stream' });
  }
  return out;
}

/** 저장 › OpenDocument 프레젠테이션 (.odp) */
export function OdpSaveCard({ ed }: { ed: Ed }) {
  const p = ed.p;
  const save = async () => {
    if (!p) return;
    try {
      ed.cmd.notify('OpenDocument 파일 만드는 중…');
      const bytes = await writeOdp(p, {
        loadMedia: async (id) => {
          const blob = await getMedia(id).catch(() => undefined);
          return blob && blob.type.startsWith('image/') ? { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type } : null;
        },
      });
      saveBytes(`${fileName(p.title)}.odp`, bytes, 'application/vnd.oasis.opendocument.presentation');
      ed.cmd.notify(`${fileName(p.title)}.odp 저장했습니다`);
    } catch (e) {
      ed.cmd.notify(`OpenDocument 저장 실패: ${(e as Error).message}`);
    }
  };
  return <Card icon="📄" title="OpenDocument 프레젠테이션 (.odp)" text="현재 프레젠테이션을 다른 이름으로 저장" disabled={!p} onClick={() => void save()} />;
}

/** 저장 › PowerPoint 암호로 저장 (.pptx): the deck exported as .pptx, then wrapped in PowerPoint's Agile Encryption. */
function PptxPasswordSaveCard({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [dialog, setDialog] = useState(false);
  const save = async (password: string) => {
    if (!p) return;
    try {
      ed.cmd.notify('PowerPoint 암호화 파일 만드는 중… (잠시 걸릴 수 있습니다)');
      const plain = await exportPptxBytes(ed.state.library, { presentation: p });
      const bytes = await encryptOfficePackage(plain, password);
      saveBytes(`${fileName(p.title)}.pptx`, bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      ed.cmd.notify(`${fileName(p.title)}.pptx 를 PowerPoint 암호로 보호해 저장했습니다. 암호를 잊으면 복구할 수 없습니다`);
    } catch (e) {
      ed.cmd.notify(`PowerPoint 암호 저장 실패: ${(e as Error).message}`);
    }
  };
  return (
    <>
      <Card icon="🔐" title="PowerPoint 암호로 저장 (.pptx)" text="PowerPoint에서 암호를 물어보는 파일로 저장" disabled={!p} onClick={() => setDialog(true)} />
      {dialog && p && <PasswordDialog kind="pptx" title={p.title} onClose={() => setDialog(false)} onDone={(pw) => { setDialog(false); void save(pw); }} />}
    </>
  );
}

/** 저장 › LightCast 파일 (.lcast), with or without a password. */
export function NativeSaveCards({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [dialog, setDialog] = useState(false);
  const saveNow = async (password?: string) => {
    if (!p) return;
    try {
      const bytes = await saveNative(p, await collectMedia(ed, p), password, await collectDeckFonts(p));
      saveBytes(`${fileName(p.title)}${LCAST_EXT}`, bytes, 'application/octet-stream');
      ed.cmd.notify(password ? `${fileName(p.title)}${LCAST_EXT} 암호로 보호해 저장했습니다` : `${fileName(p.title)}${LCAST_EXT} 저장했습니다`);
    } catch (e) {
      ed.cmd.notify(`LightCast 파일 저장 실패: ${(e as Error).message}`);
    }
  };
  return (
    <>
      <Card icon="💾" title="LightCast 파일 저장 (.lcast)" text="미디어까지 한 파일로" disabled={!p} onClick={() => void saveNow()} />
      <Card icon="🔑" title="암호로 보호하여 저장 (.lcast)" text="LightCast 파일 암호화" disabled={!p} onClick={() => setDialog(true)} />
      {dialog && p && <PasswordDialog kind="lcast" title={p.title} onClose={() => setDialog(false)} onDone={(pw) => { setDialog(false); void saveNow(pw); }} />}
      <PptxPasswordSaveCard ed={ed} />
    </>
  );
}

/** 정보 › 프레젠테이션 보호 › 암호 설정 */
export function PasswordProtectCard({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <Card icon="🔑" title="암호 설정" text="프레젠테이션 보호 · LightCast 파일(.lcast)을 암호로 저장" disabled={!p} onClick={() => setDialog(true)} />
      <PptxPasswordSaveCard ed={ed} />
      {dialog && p && (
        <PasswordDialog
          kind="lcast"
          title={p.title}
          onClose={() => setDialog(false)}
          onDone={async (pw) => {
            setDialog(false);
            try {
              const bytes = await saveNative(p, await collectMedia(ed, p), pw, await collectDeckFonts(p));
              saveBytes(`${fileName(p.title)}${LCAST_EXT}`, bytes, 'application/octet-stream');
              ed.cmd.notify(`${fileName(p.title)}${LCAST_EXT} 암호로 보호해 저장했습니다`);
            } catch (e) {
              ed.cmd.notify(`암호 설정 실패: ${(e as Error).message}`);
            }
          }}
        />
      )}
    </>
  );
}

function PasswordDialog({ kind, title, onClose, onDone }: { kind: 'lcast' | 'pptx'; title: string; onClose: () => void; onDone: (password: string) => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const problem = passwordProblem(pw, again);
  const pptx = kind === 'pptx';
  return (
    <Dialog title={pptx ? 'PowerPoint 암호로 저장' : '문서 암호화'} onClose={onClose} onOk={() => !problem && onDone(pw)} okDisabled={!!problem} okLabel={pptx ? '암호화하여 저장' : '확인'}>
      {pptx
        ? <p>“{title}”을(를) .pptx로 내보낸 뒤 PowerPoint 방식(AES-256)으로 암호화합니다. PowerPoint 2010 이상에서 이 암호로 열 수 있습니다.</p>
        : <p>“{title}”을(를) 암호로 보호해 LightCast 파일(.lcast)로 저장합니다.</p>}
      <Field label="암호(P):"><input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="암호 확인(C):"><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !problem) onDone(pw); }} /></Field>
      {pw && again && problem && <p role="alert" className="bs-note">{problem}</p>}
      <p className="bs-note" style={{ background: '#fff4ce', border: '1px solid #e8d48a', borderRadius: 4, padding: '6px 8px', color: '#5c4a00' }}>
        <b>주의:</b> 암호를 잊어버리면 복구할 수 없습니다. LightCast도, Microsoft도 암호를 되찾아 드릴 수 없으니 안전한 곳에 적어 두세요.
        {pptx ? ' 암호화한 .pptx는 암호 없이는 열 수 없으니, 암호화하지 않은 원본은 따로 보관하는 것이 좋습니다.' : ' 이 암호는 LightCast 파일(.lcast)에만 적용되며 PowerPoint 암호화가 아닙니다. PowerPoint에서 열려면 “PowerPoint 암호로 저장 (.pptx)”을 사용하세요.'}
      </p>
    </Dialog>
  );
}

/** 열기 › LightCast 파일 (.lcast): asks for the password of a protected file. */
export function NativeOpenCard({ ed, onOpened }: { ed: Ed; onOpened?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');

  const open = async (name: string, bytes: Uint8Array, password?: string) => {
    try {
      const { presentation, media, fonts } = await openNative(bytes, password);
      const nFonts = await restoreNativeFonts(fonts, `lcast:${name}`);
      for (const m of media) {
        await putMedia(m.meta.id, new Blob([m.bytes.buffer.slice(m.bytes.byteOffset, m.bytes.byteOffset + m.bytes.byteLength) as ArrayBuffer], { type: m.mime }));
        if (!ed.state.library.media.some((x) => x.id === m.meta.id)) ed.dispatch({ type: 'media/add', media: m.meta });
      }
      ed.dispatch({ type: 'presentation/create', presentation: { ...presentation, id: uid('p'), folder: presentation.folder ?? 'Imported' } });
      setPending(null);
      setPw('');
      setError('');
      ed.cmd.notify(`${name} 열었습니다${nFonts ? ` (글꼴 ${nFonts}개 가져옴)` : ''}`);
      onOpened?.();
    } catch (e) {
      if (e instanceof PasswordRequiredError) { setPending({ name, bytes }); setError(''); }
      else if (e instanceof WrongPasswordError && password !== undefined) { setPending({ name, bytes }); setError(e.message); }
      else { setPending(null); ed.cmd.notify(`열기 실패: ${(e as Error).message} 기존 자료는 유지됩니다.`); }
    }
  };

  return (
    <>
      <Card icon="🔑" title="LightCast 파일 (.lcast)" text="암호로 보호한 파일도 열기" onClick={() => input.current?.click()} />
      <input ref={input} type="file" accept={LCAST_EXT} hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) await open(f.name, new Uint8Array(await f.arrayBuffer()));
      }} />
      {pending && (
        <Dialog title="암호" onClose={() => { setPending(null); setPw(''); setError(''); }} onOk={() => void open(pending.name, pending.bytes, pw)} okDisabled={!pw}>
          <p>“{pending.name}” 파일은 암호로 보호되어 있습니다. 암호를 입력하세요.</p>
          <Field label="암호:"><input type="password" autoFocus autoComplete="off" value={pw} onChange={(e) => { setPw(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter' && pw) void open(pending.name, pending.bytes, pw); }} /></Field>
          {error && <p role="alert" className="bs-note"><b>{error}</b></p>}
        </Dialog>
      )}
    </>
  );
}
