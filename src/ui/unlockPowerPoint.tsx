// Opening a password-protected PowerPoint file (.pptx / .ppsx / .potx …): asks for the password in a Korean
// dialog, says so when it is wrong, and hands back the plain package for the normal import.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OfficeIntegrityError, OfficePasswordError, OfficeUnsupportedError, decryptOfficeFile, isEncryptedOfficeFile } from '../domain/io/officeCrypto';
import { Dialog, Field } from './ppt/dialogs';

/** The password the person types for this file, or null when they cancel. `wrong` shows the wrong-password message. */
export function askOfficePassword(fileName: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (pw: string | null) => { root.unmount(); host.remove(); resolve(pw); };
    root.render(<PasswordAsk name={fileName} wrong={wrong} onDone={done} />);
  });
}

function PasswordAsk({ name, wrong, onDone }: { name: string; wrong: boolean; onDone: (pw: string | null) => void }) {
  const [pw, setPw] = useState('');
  return (
    <Dialog title="암호 입력" onClose={() => onDone(null)} onOk={() => pw && onDone(pw)} okLabel="열기" okDisabled={!pw}>
      <p>“{name}” 파일은 암호로 보호되어 있습니다. 파일을 열 암호를 입력하세요.</p>
      <Field label="암호:"><input type="password" autoFocus autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pw) onDone(pw); }} /></Field>
      {wrong && <p role="alert" className="bs-note" style={{ color: '#a4262c' }}><b>암호가 올바르지 않습니다. 다시 입력해 주세요.</b></p>}
      <p className="bs-note">암호를 잊어버리면 파일을 열 수 없습니다. 암호는 이 컴퓨터에서만 사용되며 저장되지 않습니다.</p>
    </Dialog>
  );
}

/**
 * The bytes of a PowerPoint file ready for import. An ordinary .pptx comes back as it is; a password-protected one
 * (PowerPoint's "Encrypt with Password") is decrypted after asking for the password, as often as it takes.
 * Throws a Korean message when the person cancels, the file is damaged, or its encryption is not supported.
 */
export async function unlockPowerPoint(file: Blob, name: string, ask: typeof askOfficePassword = askOfficePassword): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isEncryptedOfficeFile(bytes)) return bytes;
  let wrong = false;
  for (;;) {
    const pw = await ask(name, wrong);
    if (pw === null) throw new Error(`${name}: 암호를 입력하지 않아 열지 않았습니다. 기존 자료는 유지됩니다.`);
    try {
      return await decryptOfficeFile(bytes, pw);
    } catch (e) {
      if (e instanceof OfficePasswordError) { wrong = true; continue; }
      if (e instanceof OfficeUnsupportedError || e instanceof OfficeIntegrityError) throw new Error(`${name}: ${e.message} 기존 자료는 유지됩니다.`);
      throw e;
    }
  }
}
