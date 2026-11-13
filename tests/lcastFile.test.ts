import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, PasswordRequiredError, WrongPasswordError, NotLightCastFileError, decryptBytes, encryptBytes, isEncryptedFile, openNative, passwordProblem, saveNative } from '../src/domain/io/lcastFile';
import type { Presentation } from '../src/domain/types';

const pres: Presentation = { id: 'p1', title: '비밀 설교', themeId: 'theme_classic', slides: [{ id: 's1', group: 'g', text: '내용', background: { kind: 'media', mediaId: 'm1', mediaType: 'image' } }] };
const media = [{ meta: { id: 'm1', name: 'a.png', type: 'image' as const }, bytes: Uint8Array.from([1, 2, 3, 4]), mime: 'image/png' }];

describe('LightCast file encryption', () => {
  it('encrypts with a header and decrypts with the right password', async () => {
    const plain = new TextEncoder().encode('hello 안녕');
    const enc = await encryptBytes(plain, '암호1234', 1000);
    expect(isEncryptedFile(enc)).toBe(true);
    expect(new TextDecoder().decode(enc.slice(0, 5))).toBe('LCENC');
    expect(enc.length).toBe(38 + plain.length + 16);
    expect(await decryptBytes(enc, '암호1234')).toEqual(plain);
  });

  it('uses a fresh salt and IV each time', async () => {
    const a = await encryptBytes(new Uint8Array([1]), 'pw', 1000);
    const b = await encryptBytes(new Uint8Array([1]), 'pw', 1000);
    expect(a).not.toEqual(b);
  });

  it('fails clearly on a wrong password, a changed header or a damaged body', async () => {
    const enc = await encryptBytes(new TextEncoder().encode('secret'), 'right', 1000);
    await expect(decryptBytes(enc, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptBytes(enc, 'wrong')).rejects.toThrow('암호가 올바르지 않');
    const body = enc.slice(); body[body.length - 1] ^= 1;
    await expect(decryptBytes(body, 'right')).rejects.toBeInstanceOf(WrongPasswordError);
    const head = enc.slice(); head[9] ^= 1; // iterations changed
    await expect(decryptBytes(head, 'right')).rejects.toThrow();
  });

  it('saves a presentation with its media and opens it again', async () => {
    const file = await saveNative(pres, media);
    expect(isEncryptedFile(file)).toBe(false);
    const back = await openNative(file);
    expect(back.presentation).toEqual(pres);
    expect(back.media[0]).toMatchObject({ meta: media[0].meta, mime: 'image/png' });
    expect(back.media[0].bytes).toEqual(media[0].bytes);
  });

  it('asks for the password of an encrypted file, and opens it with the right one', async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const file = await saveNative(pres, media, 'pass');
    expect(isEncryptedFile(file)).toBe(true);
    await expect(openNative(file)).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(openNative(file, 'nope')).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await openNative(file, 'pass')).presentation.title).toBe('비밀 설교');
  });

  it('refuses other files', async () => {
    await expect(openNative(new TextEncoder().encode('plain text'))).rejects.toBeInstanceOf(NotLightCastFileError);
  });

  it('checks the password a person types', () => {
    expect(passwordProblem('', '')).toBeTruthy();
    expect(passwordProblem('abc', 'abc')).toBeTruthy();
    expect(passwordProblem('abcd', 'abce')).toBeTruthy();
    expect(passwordProblem('abcd', 'abcd')).toBeNull();
  });
});
