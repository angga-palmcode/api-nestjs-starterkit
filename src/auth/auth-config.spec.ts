import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  EmailTransportHolder,
  resolveEmailTransport,
} from '../common/email/email-delivery';
import { PrismaService } from '../prisma/prisma.service';
import { validateEnv } from '../config/env.schema';
import { AppModule } from '../app.module';
import { createPrismaMock } from '../../test/helpers/prisma-mock';
import { baseEnv, testEnv } from '../../test/helpers/test-env';
import { AUTH_NOTIFIER, OTP_SENDER } from './providers/auth-messaging';
import { EmailAuthNotifier, EmailOtpSender } from './providers/email-adapters';
import {
  ConsoleAuthNotifier,
  ConsoleOtpSender,
} from './providers/console-adapters';

const env = (overrides: Record<string, string | undefined>) =>
  validateEnv({ ...baseEnv, ...overrides });

describe('auth environment validation (boot-time, Blueprint A5)', () => {
  it('defaults are the safe ones', () => {
    expect(env({})).toMatchObject({
      AUTH_METHODS: ['password'],
      AUTH_MFA: 'none',
      AUTH_REQUIRE_EMAIL_VERIFICATION: true,
      AUTH_ALLOW_REGISTRATION: false,
      AUTH_VERIFY_USER_PER_REQUEST: true,
      AUTH_DELIVERY: 'console',
      AUTH_ACCESS_TTL_SECONDS: 900,
      AUTH_REFRESH_TTL_DAYS: 7,
      AUTH_BCRYPT_ROUNDS: 4, // from the test base env; production default is 12
    });
    expect(
      validateEnv({ ...baseEnv, AUTH_BCRYPT_ROUNDS: undefined })
        .AUTH_BCRYPT_ROUNDS,
    ).toBe(12);
  });

  it('parses and validates AUTH_METHODS', () => {
    expect(env({ AUTH_METHODS: 'password, otp' }).AUTH_METHODS).toEqual([
      'password',
      'otp',
    ]);
    expect(() => env({ AUTH_METHODS: 'otp' })).toThrow(/AUTH_METHODS/);
    expect(() => env({ AUTH_METHODS: 'password,sms' })).toThrow(/AUTH_METHODS/);
    expect(() => env({ AUTH_METHODS: '' })).not.toThrow(); // empty = unset? treated as default
  });

  it.each(['yes', '1', 'TRUE'])(
    'rejects non-boolean flag value %s',
    (value) => {
      expect(() => env({ AUTH_ALLOW_REGISTRATION: value })).toThrow(
        /AUTH_ALLOW_REGISTRATION/,
      );
    },
  );

  it('requires three distinct secrets of at least 32 characters', () => {
    expect(() => env({ AUTH_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() =>
      env({ AUTH_MFA_CHALLENGE_SECRET: baseEnv.AUTH_ACCESS_SECRET }),
    ).toThrow(/must all differ/);
    expect(() => env({ AUTH_EMAIL_VERIFY_SECRET: undefined })).toThrow(
      /AUTH_EMAIL_VERIFY_SECRET/,
    );
  });

  it('rejects the documented placeholder secrets in production only', () => {
    const placeholders = {
      AUTH_ACCESS_SECRET: 'change-me-access-secret-at-least-32-characters',
      AUTH_MFA_CHALLENGE_SECRET: 'change-me-challenge-secret-at-least-32-chars',
      AUTH_EMAIL_VERIFY_SECRET:
        'change-me-email-verify-secret-at-least-32-chars',
    };
    expect(() =>
      env({ ...placeholders, NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() => env({ ...placeholders, NODE_ENV: 'production' })).toThrow(
      /placeholder/,
    );
  });

  it('AUTH_MFA=totp needs a 32-byte base64 encryption key', () => {
    expect(() =>
      env({ AUTH_MFA: 'totp', AUTH_MFA_ENCRYPTION_KEY: undefined }),
    ).toThrow(/AUTH_MFA_ENCRYPTION_KEY/);
    expect(() =>
      env({ AUTH_MFA: 'totp', AUTH_MFA_ENCRYPTION_KEY: 'c2hvcnQ=' }),
    ).toThrow(/AUTH_MFA_ENCRYPTION_KEY/);
    expect(() => env({ AUTH_MFA: 'totp' })).not.toThrow();
    // not needed for other modes
    expect(() =>
      env({ AUTH_MFA: 'otp', AUTH_MFA_ENCRYPTION_KEY: undefined }),
    ).not.toThrow();
  });

  it('OTP flows in production need AUTH_DELIVERY=email (console cannot deliver codes)', () => {
    for (const flow of [
      { AUTH_METHODS: 'password,otp' },
      { AUTH_MFA: 'otp' },
    ]) {
      expect(() => env({ ...flow, NODE_ENV: 'production' })).toThrow(
        /AUTH_DELIVERY=email/,
      );
      expect(() =>
        env({ ...flow, NODE_ENV: 'production', AUTH_DELIVERY: 'email' }),
      ).not.toThrow();
      expect(() => env({ ...flow, NODE_ENV: 'development' })).not.toThrow();
    }
    // no OTP flow: console delivery is tolerated in production
    expect(() => env({ NODE_ENV: 'production' })).not.toThrow();
  });
});

describe('delivery adapter selection (AUTH_DELIVERY)', () => {
  const compile = (delivery: 'console' | 'email') =>
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(testEnv({ AUTH_DELIVERY: delivery })))
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .compile();

  it('console adapters by default', async () => {
    const moduleRef = await compile('console');
    expect(moduleRef.get(OTP_SENDER)).toBeInstanceOf(ConsoleOtpSender);
    expect(moduleRef.get(AUTH_NOTIFIER)).toBeInstanceOf(ConsoleAuthNotifier);
    await moduleRef.close();
  });

  it("email adapters over the mail module's transport", async () => {
    const moduleRef = await compile('email');
    expect(moduleRef.get(OTP_SENDER)).toBeInstanceOf(EmailOtpSender);
    expect(moduleRef.get(AUTH_NOTIFIER)).toBeInstanceOf(EmailAuthNotifier);
    await moduleRef.close();
  });
});

describe('resolveEmailTransport (boot-time check)', () => {
  const config = (delivery: string) =>
    ({ get: () => delivery }) as unknown as ConfigService<never, true>;
  const transport = { send: jest.fn() };

  it('is null unless AUTH_DELIVERY=email', () => {
    expect(
      resolveEmailTransport(
        config('console') as never,
        new EmailTransportHolder(),
      ),
    ).toBeNull();
  });

  it('returns the provided transport', () => {
    expect(
      resolveEmailTransport(
        config('email') as never,
        new EmailTransportHolder(transport),
      ),
    ).toBe(transport);
  });

  it('refuses to boot with AUTH_DELIVERY=email and no EMAIL_TRANSPORT (e.g. mail module removed)', () => {
    expect(() =>
      resolveEmailTransport(
        config('email') as never,
        new EmailTransportHolder(),
      ),
    ).toThrow(/AUTH_DELIVERY=email requires an EMAIL_TRANSPORT/);
  });
});
