// PowerPoint-compatible password protection for .pptx (ECMA-376 / MS-OFFCRYPTO), with WebCrypto.
//
// An encrypted Office file is a compound file (OLE2 / CFB) holding an `EncryptionInfo` stream (how it was
// encrypted) and an `EncryptedPackage` stream (the ordinary .pptx zip, encrypted).
//   • Writing: "Agile Encryption" (Office 2010+): AES-256-CBC, SHA-512, spinCount 100000, key data and a
//     password key encryptor in an XML descriptor, an HMAC over the encrypted package, and the package in
//     4096-byte segments, each with its own IV (MS-OFFCRYPTO 2.3.4.10 – 2.3.4.15).
//   • Reading: Agile Encryption (any AES size / SHA-1/256/384/512 the descriptor names) and "Standard
//     Encryption" (Office 2007: AES-ECB, SHA-1, MS-OFFCRYPTO 2.3.4.5 – 2.3.4.9). The older RC4 variants and
//     certificate-protected files are reported as unsupported.
import { isCfb, readCfb } from './cfb';
import { writeCfb, type CfbNode } from './cfbWrite';

export class OfficePasswordError extends Error {
  constructor() { super('암호가 올바르지 않습니다.'); this.name = 'OfficePasswordError'; }
}
export class OfficeIntegrityError extends Error {
  constructor() { super('파일이 손상되었거나 변경되었습니다. (무결성 검사 실패)'); this.name = 'OfficeIntegrityError'; }
}
export class OfficeUnsupportedError extends Error {
  constructor(message: string) { super(message); this.name = 'OfficeUnsupportedError'; }
}

export const AGILE_SPIN_COUNT = 100_000;
const SEGMENT = 4096;
const MAX_SPIN = 10_000_000;

const subtle = () => globalThis.crypto.subtle;
const bs = (b: Uint8Array) => b as unknown as BufferSource;
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// Block keys (MS-OFFCRYPTO 2.3.4.11 – 2.3.4.14).
const BK_VERIFIER_INPUT = Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79);
const BK_VERIFIER_VALUE = Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e);
const BK_KEY_VALUE = Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6);
const BK_HMAC_KEY = Uint8Array.of(0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6);
const BK_HMAC_VALUE = Uint8Array.of(0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33);

// ---- small helpers ----------------------------------------------------------------------------------------

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const utf16le = (s: string) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
const toBase64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (s: string) => { const bin = atob(s.replace(/\s+/g, '')); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
const sameBytes = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
/** Truncate, or pad with `fill`, to exactly n bytes. */
const fit = (b: Uint8Array, n: number, fill: number) => { if (b.length >= n) return b.slice(0, n); const out = new Uint8Array(n).fill(fill); out.set(b); return out; };

const HASHES: Record<string, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' };
const hashName = (alg: string) => { const h = HASHES[alg.toUpperCase().replace('-', '')]; if (!h) throw new OfficeUnsupportedError(`지원하지 않는 해시 방식입니다: ${alg}`); return h; };
const digest = async (hash: string, ...parts: Uint8Array[]) => new Uint8Array(await subtle().digest(hash, bs(concat(...parts))));

// ---- AES-CBC without padding / AES-ECB on top of WebCrypto (which only does PKCS#7 CBC) ---------------------------

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (![16, 24, 32].includes(raw.length)) throw new OfficeUnsupportedError('지원하지 않는 AES 키 길이입니다.');
  return subtle().importKey('raw', bs(raw), 'AES-CBC', false, ['encrypt', 'decrypt']);
}
/** AES-CBC encrypt data whose length is a multiple of 16, with no padding added. */
async function cbcEncrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (!data.length) return new Uint8Array(0);
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: bs(iv) }, key, bs(data)));
  return out.subarray(0, data.length); // the last block is WebCrypto's PKCS#7 padding
}
/** AES-CBC decrypt data whose length is a multiple of 16, with no padding expected. */
async function cbcDecrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (!data.length) return new Uint8Array(0);
  if (data.length % 16) throw new OfficeIntegrityError();
  // Append a block that decrypts to valid PKCS#7 padding: encrypting nothing with the last ciphertext block as IV makes exactly that.
  const pad = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: bs(data.subarray(data.length - 16)) }, key, new ArrayBuffer(0)));
  const out = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: bs(iv) }, key, bs(concat(data, pad))));
  return out.subarray(0, data.length);
}
/** AES-ECB decrypt (Standard Encryption): CBC with a zero IV, then undo the chaining by XOR with the previous ciphertext block. */
async function ecbDecrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const chained = await cbcDecrypt(key, new Uint8Array(16), data);
  for (let i = 0; i < chained.length; i++) chained[i] ^= i >= 16 ? data[i - 16] : 0;
  return chained;
}

// ---- Agile Encryption: key derivation ---------------------------------------------------------------------------

/** The password hash after the spin loop: H0 = H(salt + password), then spinCount times H(iterator + previous). Shared by every block key. */
export async function spinPasswordHash(hash: string, salt: Uint8Array, password: string, spinCount: number): Promise<Uint8Array> {
  let h = await digest(hash, salt, utf16le(password));
  for (let i = 0; i < spinCount; i++) h = await digest(hash, le32(i), h);
  return h;
}
/** The key for a block key: H(spun + blockKey), cut or padded (0x36) to the key size. */
export async function blockKey(hash: string, spun: Uint8Array, block: Uint8Array, keyBytes: number): Promise<Uint8Array> {
  return fit(await digest(hash, spun, block), keyBytes, 0x36);
}
/** Full derivation as MS-OFFCRYPTO 2.3.4.11 words it. */
export async function deriveAgileKey(opts: { hashAlgorithm: string; salt: Uint8Array; password: string; spinCount: number; blockKey: Uint8Array; keyBits: number }): Promise<Uint8Array> {
  const hash = hashName(opts.hashAlgorithm);
  return blockKey(hash, await spinPasswordHash(hash, opts.salt, opts.password, opts.spinCount), opts.blockKey, opts.keyBits / 8);
}
/** IV of a data segment (and of the integrity values): H(keyDataSalt + blockKey), cut or padded (0x36) to the block size. */
const segmentIv = async (hash: string, keySalt: Uint8Array, index: Uint8Array) => fit(await digest(hash, keySalt, index), 16, 0x36);

// ---- Agile Encryption: descriptor XML -----------------------------------------------------------------------

const attrsOf = (xml: string, tag: string): Record<string, string> | null => {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*?)/?>`).exec(xml);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[a[1]] = a[2];
  return out;
};
const num = (a: Record<string, string>, k: string) => { const n = Number(a[k]); if (!Number.isFinite(n)) throw new OfficeIntegrityError(); return n; };

/** A password-protected Office file (compound file with an EncryptedPackage stream)? */
export function isEncryptedOfficeFile(bytes: Uint8Array): boolean {
  if (!isCfb(bytes)) return false;
  const cfb = readCfb(bytes);
  return !!cfb && cfb.entries.some((e) => e.type === 2 && e.name === 'EncryptedPackage') && cfb.entries.some((e) => e.type === 2 && e.name === 'EncryptionInfo');
}

/** Decrypt an encrypted Office file to the plain package (the .pptx zip). Throws OfficePasswordError for a wrong password. */
export async function decryptOfficeFile(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const cfb = readCfb(bytes);
  const info = cfb?.stream('EncryptionInfo');
  const pkg = cfb?.stream('EncryptedPackage');
  if (!cfb || !info || !pkg || info.length < 8) throw new OfficeIntegrityError();
  const v = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const major = v.getUint16(0, true), minor = v.getUint16(2, true), flags = v.getUint32(4, true);
  if (major === 4 && minor === 4) return decryptAgile(info, pkg, password);
  if (minor === 2 && major >= 2 && major <= 4) return decryptStandard(info, pkg, password, flags);
  if (major === 4 && minor === 3) throw new OfficeUnsupportedError('확장 암호화(Extensible Encryption)로 보호된 파일은 지원하지 않습니다. PowerPoint에서 암호를 해제한 뒤 가져와 주세요.');
  throw new OfficeUnsupportedError(`지원하지 않는 암호화 방식입니다 (버전 ${major}.${minor}). PowerPoint에서 암호를 해제한 뒤 가져와 주세요.`);
}

async function decryptAgile(info: Uint8Array, pkg: Uint8Array, password: string): Promise<Uint8Array> {
  const xml = new TextDecoder().decode(info.subarray(8)).replace(/^﻿/, '');
  const keyData = attrsOf(xml, 'keyData');
  const enc = attrsOf(xml, 'encryptedKey');
  if (!keyData || !enc) {
    if (/keyEncryptor[^>]*certificate/i.test(xml)) throw new OfficeUnsupportedError('인증서로 보호된 파일은 지원하지 않습니다.');
    throw new OfficeIntegrityError();
  }
  if (/uri="[^"]*keyEncryptor\/certificate"/.test(xml) && !/uri="[^"]*keyEncryptor\/password"/.test(xml)) throw new OfficeUnsupportedError('인증서로 보호된 파일은 지원하지 않습니다.');
  if (keyData.cipherAlgorithm !== 'AES' || keyData.cipherChaining !== 'ChainingModeCBC' || enc.cipherAlgorithm !== 'AES' || enc.cipherChaining !== 'ChainingModeCBC') {
    throw new OfficeUnsupportedError('AES-CBC 이외의 암호화 방식은 지원하지 않습니다.');
  }
  const dataHash = hashName(keyData.hashAlgorithm);
  const keyHash = hashName(enc.hashAlgorithm);
  const spinCount = num(enc, 'spinCount');
  if (spinCount < 0 || spinCount > MAX_SPIN) throw new OfficeIntegrityError();
  const keyBytes = num(enc, 'keyBits') / 8;
  const dataKeyBytes = num(keyData, 'keyBits') / 8;
  const dataSalt = fromBase64(keyData.saltValue);
  const salt = fromBase64(enc.saltValue);
  const hashSize = num(enc, 'hashSize');

  // The password: decrypt the verifier and check its hash.
  const spun = await spinPasswordHash(keyHash, salt, password, spinCount);
  const inputKey = await aesKey(await blockKey(keyHash, spun, BK_VERIFIER_INPUT, keyBytes));
  const valueKey = await aesKey(await blockKey(keyHash, spun, BK_VERIFIER_VALUE, keyBytes));
  const keyKey = await aesKey(await blockKey(keyHash, spun, BK_KEY_VALUE, keyBytes));
  const verifier = await cbcDecrypt(inputKey, fit(salt, 16, 0x36), fromBase64(enc.encryptedVerifierHashInput));
  const verifierHash = await cbcDecrypt(valueKey, fit(salt, 16, 0x36), fromBase64(enc.encryptedVerifierHashValue));
  const expected = await digest(keyHash, verifier.subarray(0, num(enc, 'saltSize')));
  if (!sameBytes(expected, verifierHash.subarray(0, hashSize))) throw new OfficePasswordError();
  const secret = (await cbcDecrypt(keyKey, fit(salt, 16, 0x36), fromBase64(enc.encryptedKeyValue))).subarray(0, dataKeyBytes);
  const dataKey = await aesKey(secret);

  // Integrity: HMAC of the whole EncryptedPackage stream, with a key and value stored encrypted.
  const integrity = attrsOf(xml, 'dataIntegrity');
  if (integrity) {
    const hmacSize = num(keyData, 'hashSize');
    const hmacKey = (await cbcDecrypt(dataKey, await segmentIv(dataHash, dataSalt, BK_HMAC_KEY), fromBase64(integrity.encryptedHmacKey))).subarray(0, hmacSize);
    const hmacValue = (await cbcDecrypt(dataKey, await segmentIv(dataHash, dataSalt, BK_HMAC_VALUE), fromBase64(integrity.encryptedHmacValue))).subarray(0, hmacSize);
    const mac = await subtle().importKey('raw', bs(hmacKey), { name: 'HMAC', hash: dataHash }, false, ['sign']);
    const actual = new Uint8Array(await subtle().sign('HMAC', mac, bs(pkg)));
    if (!sameBytes(actual, hmacValue)) throw new OfficeIntegrityError();
  }

  // Data: u64 length, then 4096-byte segments, each with IV = H(keyDataSalt + segment number).
  if (pkg.length < 8) throw new OfficeIntegrityError();
  const pv = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
  const size = pv.getUint32(0, true) + pv.getUint32(4, true) * 2 ** 32;
  const body = pkg.subarray(8);
  if (size > body.length) throw new OfficeIntegrityError();
  const out = new Uint8Array(Math.ceil(body.length / SEGMENT) * SEGMENT);
  const segments = Math.ceil(body.length / SEGMENT);
  for (let first = 0; first < segments; first += 64) {
    await Promise.all(Array.from({ length: Math.min(64, segments - first) }, async (_, k) => {
      const i = first + k;
      const part = body.subarray(i * SEGMENT, (i + 1) * SEGMENT);
      out.set(await cbcDecrypt(dataKey, await segmentIv(dataHash, dataSalt, le32(i)), part), i * SEGMENT);
    }));
  }
  return out.slice(0, size);
}

/** Standard Encryption (Office 2007): AES-ECB, key from SHA-1 with 50000 iterations. RC4 variants are not read. */
async function decryptStandard(info: Uint8Array, pkg: Uint8Array, password: string, flags: number): Promise<Uint8Array> {
  const v = new DataView(info.buffer, info.byteOffset, info.byteLength);
  if (flags & 0x10) throw new OfficeUnsupportedError('외부 암호화 방식의 파일은 지원하지 않습니다.');
  const headerSize = v.getUint32(8, true);
  if (12 + headerSize + 4 > info.length) throw new OfficeIntegrityError();
  const algId = v.getUint32(12 + 8, true);
  const keySize = v.getUint32(12 + 16, true);
  if (algId === 0x6801) {
    throw new OfficeUnsupportedError('PowerPoint 2003 이전 방식(RC4)으로 암호화된 파일은 지원하지 않습니다. PowerPoint에서 암호를 해제하거나 새 형식(.pptx)으로 저장한 뒤 가져와 주세요.');
  }
  if (algId !== 0x660e && algId !== 0x660f && algId !== 0x6610) throw new OfficeUnsupportedError('지원하지 않는 암호화 방식입니다. PowerPoint에서 암호를 해제한 뒤 가져와 주세요.');
  const vo = 12 + headerSize;
  const saltSize = v.getUint32(vo, true);
  if (saltSize !== 16 || vo + 4 + 16 + 16 + 4 + 32 > info.length) throw new OfficeIntegrityError();
  const salt = info.subarray(vo + 4, vo + 20);
  const encVerifier = info.subarray(vo + 20, vo + 36);
  const hashSize = v.getUint32(vo + 36, true);
  const encVerifierHash = info.subarray(vo + 40, vo + 72);

  let h = await digest('SHA-1', salt, utf16le(password));
  for (let i = 0; i < 50_000; i++) h = await digest('SHA-1', le32(i), h);
  const final = await digest('SHA-1', h, le32(0));
  const x = (pad: number) => { const b = new Uint8Array(64).fill(pad); for (let i = 0; i < final.length; i++) b[i] ^= final[i]; return b; };
  const derived = concat(await digest('SHA-1', x(0x36)), await digest('SHA-1', x(0x5c))).subarray(0, keySize / 8);
  const key = await aesKey(derived);
  const verifier = await ecbDecrypt(key, encVerifier);
  const verifierHash = await ecbDecrypt(key, encVerifierHash);
  if (!sameBytes(await digest('SHA-1', verifier), verifierHash.subarray(0, Math.min(hashSize, 20)))) throw new OfficePasswordError();

  if (pkg.length < 8) throw new OfficeIntegrityError();
  const pv = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
  const size = pv.getUint32(0, true) + pv.getUint32(4, true) * 2 ** 32;
  const body = pkg.subarray(8, 8 + Math.floor((pkg.length - 8) / 16) * 16);
  if (size > body.length) throw new OfficeIntegrityError();
  return (await ecbDecrypt(key, body)).slice(0, size);
}

// ---- Writing (Agile) --------------------------------------------------------------------------------------------------

const lpp4 = (s: string) => { const b = utf16le(s); return concat(le32(b.length), b, new Uint8Array((4 - (b.length % 4)) % 4)); };
const versionPair = () => concat(Uint8Array.of(1, 0), Uint8Array.of(0, 0)); // major 1, minor 0

/** The fixed "data spaces" streams every encrypted Office file carries (MS-OFFCRYPTO 2.3.4.1 – 2.3.4.4). */
function dataSpaces(): CfbNode {
  const entry = concat(le32(1), le32(0), lpp4('EncryptedPackage'), lpp4('StrongEncryptionDataSpace'));
  return {
    name: '\x06DataSpaces',
    children: [
      { name: 'Version', data: concat(lpp4('Microsoft.Container.DataSpaces'), versionPair(), versionPair(), versionPair()) },
      { name: 'DataSpaceMap', data: concat(le32(8), le32(1), le32(entry.length + 4), entry) },
      { name: 'DataSpaceInfo', children: [{ name: 'StrongEncryptionDataSpace', data: concat(le32(8), le32(1), lpp4('StrongEncryptionTransform')) }] },
      {
        name: 'TransformInfo',
        children: [{
          name: 'StrongEncryptionTransform',
          children: [{
            name: '\x06Primary',
            data: concat(le32(0x58), le32(1), lpp4('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}'), lpp4('Microsoft.Container.EncryptionTransform'), versionPair(), versionPair(), versionPair(), le32(0), le32(0), le32(0), le32(4)),
          }],
        }],
      },
    ],
  };
}

export interface EncryptOptions {
  /** Hash iterations of the password key (PowerPoint writes 100000). Lower only in tests. */
  spinCount?: number;
}

/** Wrap a plain .pptx (or any OOXML zip) in PowerPoint's Agile Encryption with this password. Returns the compound file. */
export async function encryptOfficePackage(zip: Uint8Array, password: string, opts: EncryptOptions = {}): Promise<Uint8Array> {
  const hash = 'SHA-512';
  const spinCount = opts.spinCount ?? AGILE_SPIN_COUNT;
  const keyBits = 256;
  const dataSalt = random(16);
  const salt = random(16);
  const secret = random(keyBits / 8);
  const verifier = random(16);
  const hmacSalt = random(64);

  // Password key encryptor.
  const spun = await spinPasswordHash(hash, salt, password, spinCount);
  const keyOf = async (block: Uint8Array) => aesKey(await blockKey(hash, spun, block, keyBits / 8));
  const encVerifierInput = await cbcEncrypt(await keyOf(BK_VERIFIER_INPUT), salt, verifier);
  const encVerifierValue = await cbcEncrypt(await keyOf(BK_VERIFIER_VALUE), salt, fit(await digest(hash, verifier), 64, 0));
  const encKeyValue = await cbcEncrypt(await keyOf(BK_KEY_VALUE), salt, secret);

  // The package: u64 length, then segments.
  const dataKey = await aesKey(secret);
  const segments = Math.ceil(zip.length / SEGMENT);
  const encrypted = new Uint8Array(8 + Math.ceil(zip.length / 16) * 16);
  new DataView(encrypted.buffer).setUint32(0, zip.length >>> 0, true);
  new DataView(encrypted.buffer).setUint32(4, Math.floor(zip.length / 2 ** 32), true);
  for (let first = 0; first < segments; first += 64) {
    await Promise.all(Array.from({ length: Math.min(64, segments - first) }, async (_, k) => {
      const i = first + k;
      const part = zip.subarray(i * SEGMENT, (i + 1) * SEGMENT);
      const padded = new Uint8Array(Math.ceil(part.length / 16) * 16);
      padded.set(part);
      encrypted.set(await cbcEncrypt(dataKey, await segmentIv(hash, dataSalt, le32(i)), padded), 8 + i * SEGMENT);
    }));
  }

  // Integrity: HMAC-SHA-512 over the whole EncryptedPackage stream, key and value encrypted with the data key.
  const mac = await subtle().importKey('raw', bs(hmacSalt), { name: 'HMAC', hash }, false, ['sign']);
  const hmac = new Uint8Array(await subtle().sign('HMAC', mac, bs(encrypted)));
  const encHmacKey = await cbcEncrypt(dataKey, await segmentIv(hash, dataSalt, BK_HMAC_KEY), hmacSalt);
  const encHmacValue = await cbcEncrypt(dataKey, await segmentIv(hash, dataSalt, BK_HMAC_VALUE), hmac);

  const common = (salt64: Uint8Array) => `saltSize="16" blockSize="16" keyBits="${keyBits}" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${toBase64(salt64)}"`;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
    + '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">'
    + `<keyData ${common(dataSalt)}/>`
    + `<dataIntegrity encryptedHmacKey="${toBase64(encHmacKey)}" encryptedHmacValue="${toBase64(encHmacValue)}"/>`
    + '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">'
    + `<p:encryptedKey spinCount="${spinCount}" ${common(salt)} encryptedVerifierHashInput="${toBase64(encVerifierInput)}" encryptedVerifierHashValue="${toBase64(encVerifierValue)}" encryptedKeyValue="${toBase64(encKeyValue)}"/>`
    + '</keyEncryptor></keyEncryptors></encryption>';
  const encryptionInfo = concat(Uint8Array.of(4, 0, 4, 0), le32(0x40), new TextEncoder().encode(xml));

  return writeCfb([
    { name: 'EncryptionInfo', data: encryptionInfo },
    { name: 'EncryptedPackage', data: encrypted },
    dataSpaces(),
  ]);
}
