import { accountsFromEnv } from './seed-accounts';

const PW = 'a-long-enough-password';

describe('accountsFromEnv', () => {
  it('requires the superadmin', () => {
    expect(() => accountsFromEnv({})).toThrow(/SEED_SUPERADMIN_EMAIL/);
  });

  it('builds only the accounts that are configured, lower-casing emails', () => {
    const accounts = accountsFromEnv({
      SEED_SUPERADMIN_EMAIL: 'Root@Example.com ',
      SEED_SUPERADMIN_PASSWORD: PW,
      SEED_USER_EMAIL: 'user@example.com',
      SEED_USER_PASSWORD: PW,
    });
    expect(accounts.map((a) => [a.role, a.email])).toEqual([
      ['superadmin', 'root@example.com'],
      ['user', 'user@example.com'],
    ]);
  });

  it('rejects half-configured accounts', () => {
    expect(() =>
      accountsFromEnv({
        SEED_SUPERADMIN_EMAIL: 'root@example.com',
        SEED_SUPERADMIN_PASSWORD: PW,
        SEED_ADMIN_EMAIL: 'admin@example.com',
      }),
    ).toThrow(/SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set together/);
  });

  it('rejects short passwords without echoing them', () => {
    try {
      accountsFromEnv({
        SEED_SUPERADMIN_EMAIL: 'root@example.com',
        SEED_SUPERADMIN_PASSWORD: 'short-pw',
      });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/at least 12 characters/);
      expect((e as Error).message).not.toContain('short-pw');
    }
  });
});
