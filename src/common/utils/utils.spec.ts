import { escapeLike } from './like.util';
import { hashPassword, verifyPassword } from './password.util';
import { generateToken, hashToken } from './token.util';

describe('token util', () => {
  it('generates unique url-safe 256-bit tokens', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes deterministically to a sha-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('password util', () => {
  it('hashes and verifies', async () => {
    const hashed = await hashPassword('correct horse battery');
    expect(hashed).not.toContain('correct');
    await expect(verifyPassword('correct horse battery', hashed)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('wrong', hashed)).resolves.toBe(false);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%_done\\ok')).toBe('100\\%\\_done\\\\ok');
    expect(escapeLike('plain')).toBe('plain');
  });
});
