import { describe, expect, it } from 'vitest';
import { encryptOfficePackage } from '../src/domain/io/officeCrypto';
import { unlockPowerPoint } from '../src/ui/unlockPowerPoint';

const plain = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255);

describe('unlockPowerPoint', () => {
  it('returns an ordinary file unchanged without asking', async () => {
    let asked = 0;
    const out = await unlockPowerPoint(new Blob([plain]), 'a.pptx', async () => { asked++; return 'x'; });
    expect(out).toEqual(plain);
    expect(asked).toBe(0);
  });

  it('asks again after a wrong password, then decrypts', async () => {
    const file = new Blob([await encryptOfficePackage(plain, 'good', { spinCount: 20 }) as BlobPart]);
    const seen: boolean[] = [];
    const answers = ['bad', 'good'];
    const out = await unlockPowerPoint(file, 'a.pptx', async (_n, wrong) => { seen.push(wrong); return answers.shift()!; });
    expect(out).toEqual(plain);
    expect(seen).toEqual([false, true]);
  });

  it('stops with a Korean message when the person cancels', async () => {
    const file = new Blob([await encryptOfficePackage(plain, 'good', { spinCount: 20 }) as BlobPart]);
    await expect(unlockPowerPoint(file, 'a.pptx', async () => null)).rejects.toThrow('암호를 입력하지 않아');
  });
});
