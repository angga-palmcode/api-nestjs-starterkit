import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  AUTH_ACCESS_SECRET: 'a'.repeat(32),
  AUTH_MFA_CHALLENGE_SECRET: 'b'.repeat(32),
  AUTH_EMAIL_VERIFY_SECRET: 'c'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults for an empty environment', () => {
    const env = validateEnv({ ...base });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'log',
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
      SHUTDOWN_TIMEOUT_MS: 10_000,
    });
    expect(env.LOG_FORMAT).toBeUndefined();
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(env.INVITATION_TTL_HOURS).toBe(72);
    expect(env.FRONTEND_URL).toBe('http://localhost:5173');
  });

  it('coerces and parses values', () => {
    const env = validateEnv({
      ...base,
      PORT: '8080',
      TRUST_PROXY: '1',
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com,',
      LOG_FORMAT: 'json',
    });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.CORS_ORIGINS).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(env.LOG_FORMAT).toBe('json');
  });

  it.each([
    ['true', true],
    ['false', false],
    ['loopback', 'loopback'],
  ])('parses TRUST_PROXY=%s', (raw, expected) => {
    expect(validateEnv({ ...base, TRUST_PROXY: raw }).TRUST_PROXY).toBe(
      expected,
    );
  });

  it('treats empty strings as unset', () => {
    const env = validateEnv({ ...base, REDIS_URL: '', LOG_FORMAT: '' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.LOG_FORMAT).toBeUndefined();
  });

  it('fails fast with every problem listed', () => {
    const attempt = () =>
      validateEnv({ ...base, PORT: 'abc', NODE_ENV: 'staging' });
    expect(attempt).toThrow(/Invalid environment configuration/);
    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/NODE_ENV/);
  });

  it('parses Swagger settings', () => {
    expect(validateEnv({ ...base }).SWAGGER_ENABLED).toBeUndefined();
    expect(
      validateEnv({ ...base, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
    expect(
      validateEnv({ ...base, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED,
    ).toBe(false);
    expect(() => validateEnv({ ...base, SWAGGER_ENABLED: 'yes' })).toThrow(
      /SWAGGER_ENABLED/,
    );
  });

  it('requires Swagger basic-auth credentials together', () => {
    expect(() => validateEnv({ ...base, SWAGGER_USER: 'docs' })).toThrow(
      /SWAGGER_PASSWORD/,
    );
    expect(() =>
      validateEnv({ ...base, SWAGGER_USER: 'docs', SWAGGER_PASSWORD: 'short' }),
    ).toThrow(/SWAGGER_PASSWORD/);
    expect(
      validateEnv({
        ...base,
        SWAGGER_USER: 'docs',
        SWAGGER_PASSWORD: 'long-enough-pw',
      }),
    ).toMatchObject({ SWAGGER_USER: 'docs' });
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects wildcard CORS', () => {
    expect(() => validateEnv({ ...base, CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS/,
    );
  });
});
