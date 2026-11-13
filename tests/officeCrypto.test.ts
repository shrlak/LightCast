import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readCfb } from '../src/domain/io/cfb';
import { writeCfb } from '../src/domain/io/cfbWrite';
import {
  OfficeIntegrityError, OfficePasswordError, OfficeUnsupportedError, decryptOfficeFile, deriveAgileKey, encryptOfficePackage, isEncryptedOfficeFile,
} from '../src/domain/io/officeCrypto';

const FAST = { spinCount: 50 };
const bytesOf = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return b; };
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const sha = (alg: string, ...p: Uint8Array[]) => { const h = createHash(alg); for (const x of p) h.update(x); return h.digest(); };

describe('compound file writer', () => {
  it('writes files the reader reads back (mini stream, big streams, nested storages)', () => {
    const small = bytesOf(100), mid = bytesOf(4095), big = bytesOf(70_000);
    const file = writeCfb([
      { name: 'A', data: small }, { name: 'Mid', data: mid }, { name: 'Big', data: big }, { name: 'Empty', data: new Uint8Array(0) },
      { name: 'Dir', children: [{ name: 'Inner', data: bytesOf(5000) }] },
    ]);
    const cfb = readCfb(file)!;
    expect(cfb).toBeTruthy();
    expect(cfb.stream('A')).toEqual(small);
    expect(cfb.stream('Mid')).toEqual(mid);
    expect(cfb.stream('Big')).toEqual(big);
    expect(cfb.stream('Inner')).toEqual(bytesOf(5000));
    expect(cfb.stream('Empty')?.length).toBe(0);
  });

  it('uses a DIFAT when the file is larger than 109 FAT sectors (about 7 MB)', () => {
    const data = bytesOf(9_000_000);
    const cfb = readCfb(writeCfb([{ name: 'Big', data }]))!;
    expect(Buffer.from(cfb.stream('Big')!).equals(Buffer.from(data))).toBe(true);
  });
});

describe('Agile key derivation', () => {
  // MS-OFFCRYPTO 2.3.4.11 spelled out with node:crypto, independently of the WebCrypto implementation.
  const reference = (hash: string, salt: Uint8Array, password: string, spin: number, block: Uint8Array, keyBits: number) => {
    let h = sha(hash, salt, Buffer.from(password, 'utf16le'));
    for (let i = 0; i < spin; i++) h = sha(hash, le32(i), h);
    const f = sha(hash, h, block);
    const n = keyBits / 8;
    return new Uint8Array(f.length >= n ? f.subarray(0, n) : Buffer.concat([f, Buffer.alloc(n - f.length, 0x36)]));
  };
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i * 17 + 3);
  const block = Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79);

  it.each([['SHA512', 'sha512', 256], ['SHA512', 'sha512', 128], ['SHA256', 'sha256', 256], ['SHA1', 'sha1', 256], ['SHA1', 'sha1', 128]] as const)('%s / %i-bit key matches the reference', async (alg, node, bits) => {
    const key = await deriveAgileKey({ hashAlgorithm: alg, salt, password: 'Pässwörd 한글!', spinCount: 1000, blockKey: block, keyBits: bits });
    expect(key).toEqual(reference(node, salt, 'Pässwörd 한글!', 1000, block, bits));
  });

  it('matches the reference at the real spin count of 100000', async () => {
    const key = await deriveAgileKey({ hashAlgorithm: 'SHA512', salt, password: 'password', spinCount: 100_000, blockKey: block, keyBits: 256 });
    expect(key).toEqual(reference('sha512', salt, 'password', 100_000, block, 256));
  }, 60_000);
});

describe('Agile encryption of a package', () => {
  const sizes = [0, 1, 15, 16, 17, 4095, 4096, 4097, 8192, 100_000];
  it.each(sizes)('round-trips a %i-byte package', async (n) => {
    const plain = bytesOf(n);
    const file = await encryptOfficePackage(plain, 'secret', FAST);
    expect(isEncryptedOfficeFile(file)).toBe(true);
    expect(await decryptOfficeFile(file, 'secret')).toEqual(plain);
  });

  it('stores the package as 8-byte length + whole 16-byte blocks', async () => {
    for (const n of [0, 1, 4095, 4096, 4097]) {
      const cfb = readCfb(await encryptOfficePackage(bytesOf(n), 'x', FAST))!;
      const stream = cfb.stream('EncryptedPackage')!;
      expect(new DataView(stream.buffer, stream.byteOffset).getUint32(0, true)).toBe(n);
      expect(stream.length).toBe(8 + Math.ceil(n / 16) * 16);
    }
  });

  it('describes AES-256 / SHA-512 / spinCount 100000 by default', async () => {
    const info = new TextDecoder().decode(readCfb(await encryptOfficePackage(bytesOf(10), 'x', { spinCount: 100_000 }))!.stream('EncryptionInfo')!.subarray(8));
    expect(info).toContain('keyBits="256"');
    expect(info).toContain('hashAlgorithm="SHA512"');
    expect(info).toContain('spinCount="100000"');
    expect(info).toContain('encryptedHmacValue=');
  }, 60_000);

  it('has the version / flags header and data-space streams of a PowerPoint file', async () => {
    const cfb = readCfb(await encryptOfficePackage(bytesOf(10), 'x', FAST))!;
    expect([...cfb.stream('EncryptionInfo')!.subarray(0, 8)]).toEqual([4, 0, 4, 0, 0x40, 0, 0, 0]);
    for (const name of ['Version', 'DataSpaceMap', 'StrongEncryptionDataSpace', '\x06Primary']) expect(cfb.stream(name)?.length).toBeGreaterThan(0);
  });

  it('rejects a wrong password, and an empty one', async () => {
    const file = await encryptOfficePackage(bytesOf(500), 'right', FAST);
    await expect(decryptOfficeFile(file, 'wrong')).rejects.toBeInstanceOf(OfficePasswordError);
    await expect(decryptOfficeFile(file, '')).rejects.toBeInstanceOf(OfficePasswordError);
    await expect(decryptOfficeFile(file, 'Right')).rejects.toBeInstanceOf(OfficePasswordError);
  });

  it('works with Korean and emoji passwords', async () => {
    const plain = bytesOf(5000);
    const file = await encryptOfficePackage(plain, '비밀번호 🔑 1234', FAST);
    expect(await decryptOfficeFile(file, '비밀번호 🔑 1234')).toEqual(plain);
  });

  it('fails the HMAC check when the encrypted data is tampered with', async () => {
    const file = await encryptOfficePackage(bytesOf(9000), 'pw', FAST);
    const cfb = readCfb(file)!;
    const pkg = cfb.stream('EncryptedPackage')!.slice();
    pkg[8 + 4500] ^= 1;
    const tampered = writeCfb([{ name: 'EncryptionInfo', data: cfb.stream('EncryptionInfo')! }, { name: 'EncryptedPackage', data: pkg }]);
    await expect(decryptOfficeFile(tampered, 'pw')).rejects.toBeInstanceOf(OfficeIntegrityError);
    // the length prefix is covered too
    const pkg2 = cfb.stream('EncryptedPackage')!.slice();
    pkg2[0] ^= 1;
    await expect(decryptOfficeFile(writeCfb([{ name: 'EncryptionInfo', data: cfb.stream('EncryptionInfo')! }, { name: 'EncryptedPackage', data: pkg2 }]), 'pw')).rejects.toBeInstanceOf(OfficeIntegrityError);
  });

  it('is randomised: the same package and password never give the same file', async () => {
    const a = await encryptOfficePackage(bytesOf(100), 'pw', FAST);
    const b = await encryptOfficePackage(bytesOf(100), 'pw', FAST);
    expect(a).not.toEqual(b);
  });

  it('is not detected for ordinary zips and ordinary compound files', async () => {
    expect(isEncryptedOfficeFile(new Uint8Array(await new JSZip().file('a', 'b').generateAsync({ type: 'uint8array' })))).toBe(false);
    expect(isEncryptedOfficeFile(writeCfb([{ name: 'PowerPoint Document', data: bytesOf(5000) }]))).toBe(false);
  });

  it('keeps a real zip intact', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('ppt/slides/slide1.xml', '슬라이드'.repeat(3000));
    const plain = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
    const back = await decryptOfficeFile(await encryptOfficePackage(plain, 'pw', FAST), 'pw');
    expect(await (await JSZip.loadAsync(back)).file('ppt/slides/slide1.xml')!.async('string')).toBe('슬라이드'.repeat(3000));
  });
});

/** Agile encryption written independently with node:crypto, following MS-OFFCRYPTO 2.3.4.10-2.3.4.15 (not the code under test). */
function referenceAgileFile(plain: Buffer, password: string, spin: number): Uint8Array {
  const aes = (key: Buffer, iv: Buffer, data: Buffer) => { const c = createCipheriv(`aes-${key.length * 8}-cbc`, key, iv); c.setAutoPadding(false); return Buffer.concat([c.update(data), c.final()]); };
  const fit = (b: Buffer, n: number) => (b.length >= n ? b.subarray(0, n) : Buffer.concat([b, Buffer.alloc(n - b.length, 0x36)]));
  const keySalt = randomBytes(16), pwSalt = randomBytes(16), secret = randomBytes(32), verifier = randomBytes(16);
  let h = sha('sha512', pwSalt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < spin; i++) h = sha('sha512', le32(i), h);
  const k = (bk: number[]) => fit(sha('sha512', h, Buffer.from(bk)), 32);
  const encVin = aes(k([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]), pwSalt, verifier);
  const encVal = aes(k([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]), pwSalt, sha('sha512', verifier));
  const encKey = aes(k([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]), pwSalt, secret);
  const segs: Buffer[] = [];
  for (let i = 0; i * 4096 < plain.length; i++) {
    const part = plain.subarray(i * 4096, (i + 1) * 4096);
    const padded = Buffer.concat([part, Buffer.alloc((16 - (part.length % 16)) % 16)]);
    segs.push(aes(secret, fit(sha('sha512', keySalt, le32(i)), 16), padded));
  }
  const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(plain.length));
  const pkg = Buffer.concat([size, ...segs]);
  const hmacKey = randomBytes(64);
  const ivOf = (bk: number[]) => fit(sha('sha512', keySalt, Buffer.from(bk)), 16);
  const encHmacKey = aes(secret, ivOf([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]), hmacKey);
  const encHmacVal = aes(secret, ivOf([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]), createHmac('sha512', hmacKey).update(pkg).digest());
  const b64 = (b: Buffer) => b.toString('base64');
  const attrs = (salt: Buffer) => `saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(salt)}"`;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password"><keyData ${attrs(keySalt)}/><dataIntegrity encryptedHmacKey="${b64(encHmacKey)}" encryptedHmacValue="${b64(encHmacVal)}"/><keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password"><p:encryptedKey spinCount="${spin}" ${attrs(pwSalt)} encryptedVerifierHashInput="${b64(encVin)}" encryptedVerifierHashValue="${b64(encVal)}" encryptedKeyValue="${b64(encKey)}"/></keyEncryptor></keyEncryptors></encryption>`;
  return writeCfb([{ name: 'EncryptionInfo', data: Buffer.concat([Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]), Buffer.from(xml)]) }, { name: 'EncryptedPackage', data: pkg }]);
}

/** Standard (2007) encryption written with node:crypto (AES-128-ECB, SHA-1), MS-OFFCRYPTO 2.3.4.5-2.3.4.9. */
function referenceStandardFile(plain: Buffer, password: string): Uint8Array {
  const salt = randomBytes(16);
  let h = sha('sha1', salt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < 50_000; i++) h = sha('sha1', le32(i), h);
  const f = sha('sha1', h, le32(0));
  const x = (pad: number) => { const b = Buffer.alloc(64, pad); for (let i = 0; i < 20; i++) b[i] ^= f[i]; return b; };
  const key = Buffer.concat([sha('sha1', x(0x36)), sha('sha1', x(0x5c))]).subarray(0, 16);
  const ecb = (data: Buffer) => { const c = createCipheriv('aes-128-ecb', key, null); c.setAutoPadding(false); return Buffer.concat([c.update(data), c.final()]); };
  const verifier = randomBytes(16);
  const csp = Buffer.from('Microsoft Enhanced RSA and AES Cryptographic Provider\0', 'utf16le');
  const header = Buffer.concat([le32(0x24), le32(0), le32(0x660e), le32(0x8004), le32(128), le32(0x18), le32(0), le32(0), csp]);
  const info = Buffer.concat([Buffer.from([4, 0, 2, 0]), le32(0x24), le32(header.length), header, le32(16), salt, ecb(verifier), le32(20), ecb(Buffer.concat([sha('sha1', verifier), Buffer.alloc(12)]))]);
  const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(plain.length));
  const pkg = Buffer.concat([size, ecb(Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]))]);
  return writeCfb([{ name: 'EncryptionInfo', data: info }, { name: 'EncryptedPackage', data: pkg }]);
}

describe('compatibility with independently written files', () => {
  it.each([0, 1, 4095, 4096, 4097, 100_000])('reads an Agile file written by a separate implementation (%i bytes)', async (n) => {
    const plain = Buffer.from(bytesOf(n));
    const file = referenceAgileFile(plain, 'pa55 한글', 200);
    expect(Buffer.from(await decryptOfficeFile(file, 'pa55 한글'))).toEqual(plain);
    await expect(decryptOfficeFile(file, 'nope')).rejects.toBeInstanceOf(OfficePasswordError);
  });

  it('reads a Standard Encryption (AES-128 ECB) file', async () => {
    const plain = Buffer.from(bytesOf(10_001));
    const file = referenceStandardFile(plain, 'standard pw');
    expect(Buffer.from(await decryptOfficeFile(file, 'standard pw'))).toEqual(plain);
    await expect(decryptOfficeFile(file, 'wrong')).rejects.toBeInstanceOf(OfficePasswordError);
  }, 30_000);

  it('reports RC4 and unknown versions as unsupported', async () => {
    const rc4Header = Buffer.concat([le32(0x04), le32(0), le32(0x6801), le32(0x8004), le32(128), le32(1), le32(0), le32(0), Buffer.alloc(2)]);
    const info = Buffer.concat([Buffer.from([3, 0, 2, 0]), le32(0x04), le32(rc4Header.length), rc4Header, Buffer.alloc(80)]);
    const file = writeCfb([{ name: 'EncryptionInfo', data: info }, { name: 'EncryptedPackage', data: Buffer.alloc(32) }]);
    await expect(decryptOfficeFile(file, 'x')).rejects.toBeInstanceOf(OfficeUnsupportedError);
    const odd = writeCfb([{ name: 'EncryptionInfo', data: Buffer.from([9, 0, 9, 0, 0, 0, 0, 0]) }, { name: 'EncryptedPackage', data: Buffer.alloc(32) }]);
    await expect(decryptOfficeFile(odd, 'x')).rejects.toBeInstanceOf(OfficeUnsupportedError);
  });
});
