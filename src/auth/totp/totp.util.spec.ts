import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpStep,
  verifyTotp,
} from './totp.util';

// RFC 6238 appendix B (SHA-1), secret "12345678901234567890", 6-digit truncation of the 8-digit vectors.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('matches RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw6ytboi======').toString()).toBe('foobar');
  });

  it('rejects invalid characters', () => {
    expect(() => base32Decode('MZXW6!')).toThrow(/Invalid base32/);
  });

  it('round-trips random secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe('TOTP', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at t=%i', (seconds, code) => {
    expect(hotp(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  });

  it('verifies within the window and returns the matched step', () => {
    const now = 1234567890 * 1000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, '005924', now)).toBe(step);
    // previous step's code still accepted (clock skew), a code two steps old is not
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(
      step - 1,
    );
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(
      step + 1,
    );
  });

  it('rejects malformed codes', () => {
    const now = 1234567890 * 1000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '00592 ']) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBeNull();
    }
  });

  it('builds an otpauth URI', () => {
    const uri = otpauthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'My App',
      account: 'ani@example.com',
    });
    expect(uri).toBe(
      'otpauth://totp/My%20App:ani%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=My+App&algorithm=SHA1&digits=6&period=30',
    );
  });
});
