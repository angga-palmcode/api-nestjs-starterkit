import { Env, validateEnv } from '../../src/config/env.schema';

/** Minimal valid environment for tests; override what a test cares about. */
export const baseEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app?schema=public',
  AUTH_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghijkl',
  AUTH_MFA_CHALLENGE_SECRET: 'test-challenge-secret-0123456789-abcdefghi',
  AUTH_EMAIL_VERIFY_SECRET: 'test-email-verify-secret-0123456789-abcdef',
  // 32 zero bytes: fine for tests, never for real use.
  AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  AUTH_BCRYPT_ROUNDS: '4',
  LOG_LEVEL: 'fatal',
  THROTTLE_ENABLED: 'false',
};

export function testEnv(overrides: Record<string, string> = {}): Env {
  return validateEnv({ ...baseEnv, ...overrides });
}
