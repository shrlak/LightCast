// LightCast's own presentation file (.lcast): a zip of the presentation and its pictures / media,
// optionally encrypted with a password (AES-256-GCM, key from PBKDF2-SHA-256 via WebCrypto).
//
// This is LightCast-file encryption. It is NOT PowerPoint's "Encrypt with Password" and PowerPoint
// cannot open these files; .pptx saves stay unencrypted.
import JSZip from 'jszip';
import type { MediaMeta, Presentation } from '../types';

export const LCAST_EXT = '.lcast';
const FORMAT = 'lightcast-presentation';
const VERSION = 1;

// Header layout: magic "LCENC" (5) · version (1) · PBKDF2 iterations (u32) · salt (16) · iv (12) · ciphertext + 16-byte GCM tag.
const MAGIC = [0x4c, 0x43, 0x45, 0x4e, 0x43];
const SALT_LEN = 16;
const IV_LEN = 12;
const HEADER_LEN = MAGIC.length + 1 + 4 + SALT_LEN + IV_LEN;
export const PBKDF2_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000;

export class PasswordRequiredError extends Error {
  constructor() { super('암호로 보호된 LightCast 파일입니다. 암호를 입력해 주세요.'); this.name = 'PasswordRequiredError'; }
}
export class WrongPasswordError extends Error {
  constructor() { super('암호가 올바르지 않거나 파일이 손상되었습니다.'); this.name = 'WrongPasswordError'; }
}
export class NotLightCastFileError extends Error {
  constructor() { super('LightCast 파일(.lcast)이 아니거나 지원하지 않는 버전입니다.'); this.name = 'NotLightCastFileError'; }
}

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('이 환경에서는 암호화를 사용할 수 없습니다.');
  return s;
};
const asBuf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: asBuf(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function isEncryptedFile(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_LEN && MAGIC.every((b, i) => bytes[i] === b);
}

/** Encrypt bytes with a password; the header (magic, version, iterations, salt, IV) is authenticated too. */
export async function encryptBytes(plain: Uint8Array, password: string, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  if (!password) throw new Error('암호를 입력해 주세요.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const header = new Uint8Array(HEADER_LEN);
  header.set(MAGIC, 0);
  header[MAGIC.length] = VERSION;
  new DataView(header.buffer).setUint32(MAGIC.length + 1, iterations);
  header.set(salt, MAGIC.length + 5);
  header.set(iv, MAGIC.length + 5 + SALT_LEN);
  const key = await deriveKey(password, salt, iterations);
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: asBuf(iv), additionalData: asBuf(header) }, key, asBuf(plain)));
  const out = new Uint8Array(HEADER_LEN + cipher.length);
  out.set(header, 0);
  out.set(cipher, HEADER_LEN);
  return out;
}

/** Decrypt a file made by encryptBytes. Throws WrongPasswordError for a wrong password (or a damaged file). */
export async function decryptBytes(file: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncryptedFile(file)) throw new NotLightCastFileError();
  if (file[MAGIC.length] !== VERSION) throw new NotLightCastFileError();
  const header = file.slice(0, HEADER_LEN);
  const iterations = new DataView(header.buffer).getUint32(MAGIC.length + 1);
  if (iterations < 1 || iterations > MAX_ITERATIONS) throw new NotLightCastFileError();
  const salt = header.slice(MAGIC.length + 5, MAGIC.length + 5 + SALT_LEN);
  const iv = header.slice(MAGIC.length + 5 + SALT_LEN, HEADER_LEN);
  const key = await deriveKey(password, salt, iterations);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: asBuf(iv), additionalData: asBuf(header) }, key, asBuf(file.slice(HEADER_LEN))));
  } catch {
    throw new WrongPasswordError();
  }
}

// ── The file's content ────────────────────────────────────────────────────────────────────────
export interface NativeMedia { meta: MediaMeta; bytes: Uint8Array; mime: string }
export interface NativeContent { presentation: Presentation; media: NativeMedia[] }

/** Pack a presentation and its media into LightCast's zip; with a password the zip is encrypted. */
export async function saveNative(
  presentation: Presentation,
  media: NativeMedia[],
  password?: string,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('lightcast.json', JSON.stringify({ format: FORMAT, version: VERSION, presentation, media: media.map((m) => ({ ...m.meta, mime: m.mime })) }));
  for (const m of media) zip.file(`media/${m.meta.id}`, m.bytes);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return password ? encryptBytes(bytes, password) : bytes;
}

/** Open a .lcast file. An encrypted one needs the password (PasswordRequiredError when none is given). */
export async function openNative(file: Uint8Array, password?: string): Promise<NativeContent> {
  let bytes = file;
  if (isEncryptedFile(file)) {
    if (!password) throw new PasswordRequiredError();
    bytes = await decryptBytes(file, password);
  }
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new NotLightCastFileError(); }
  const json = zip.file('lightcast.json');
  if (!json) throw new NotLightCastFileError();
  let doc: { format?: string; version?: number; presentation?: Presentation; media?: (MediaMeta & { mime?: string })[] };
  try { doc = JSON.parse(await json.async('string')); } catch { throw new NotLightCastFileError(); }
  if (doc.format !== FORMAT || doc.version !== VERSION || !doc.presentation || !Array.isArray(doc.presentation.slides)) throw new NotLightCastFileError();
  const media: NativeMedia[] = [];
  for (const { mime, ...meta } of doc.media ?? []) {
    const f = zip.file(`media/${meta.id}`);
    if (f && /^[\w-]+$/.test(meta.id)) media.push({ meta, bytes: await f.async('uint8array'), mime: mime ?? 'application/octet-stream' });
  }
  return { presentation: doc.presentation, media };
}

/** A password's strength as a label for the dialog: PowerPoint warns that a lost password cannot be recovered. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (!password) return '암호를 입력해 주세요.';
  if (password.length < 4) return '암호는 4자 이상이어야 합니다.';
  if (password !== confirm) return '암호 확인이 일치하지 않습니다.';
  return null;
}
