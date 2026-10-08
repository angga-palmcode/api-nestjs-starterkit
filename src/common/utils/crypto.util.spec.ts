import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, randomDigits } from './crypto.util';

const key = randomBytes(32).toString('base64');

describe('encryptSecret / decryptSecret', () => {
  it('round-trips and never stores plaintext', () => {
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(encrypted, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });

  it('fails on tampering, a wrong key and unknown formats', () => {
    const encrypted = encryptSecret('secret', key);
    const parts = encrypted.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() =>
      decryptSecret(encrypted, randomBytes(32).toString('base64')),
    ).toThrow();
    expect(() => decryptSecret('v2.a.b.c', key)).toThrow(/Unsupported/);
    expect(() => decryptSecret('garbage', key)).toThrow(/Unsupported/);
  });
});

describe('randomDigits', () => {
  it('returns a numeric string of the requested length', () => {
    for (let i = 0; i < 50; i++) expect(randomDigits(6)).toMatch(/^\d{6}$/);
  });
});
