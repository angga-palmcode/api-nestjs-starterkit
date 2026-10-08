import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/errors/app.exception';
import { baseEnv, testEnv } from '../../../test/helpers/test-env';
import { TokenService } from './token.service';

const service = (overrides: Record<string, string> = {}) =>
  new TokenService(
    new JwtService(),
    new ConfigService(testEnv(overrides)) as never,
  );

const input = {
  userId: 'u-1',
  email: 'a@example.com',
  role: 'admin' as const,
  sessionId: 's-1',
  tokenVersion: 3,
};

describe('access tokens', () => {
  it('round-trips the claims and reports the TTL', () => {
    const tokens = service({ AUTH_ACCESS_TTL_SECONDS: '600' });
    const { token, expires_in } = tokens.signAccess(input);
    expect(expires_in).toBe(600);
    expect(tokens.verifyAccess(token)).toMatchObject({
      sub: 'u-1',
      email: 'a@example.com',
      role: 'admin',
      sid: 's-1',
      ver: 3,
    });
  });

  it('throws 401 UNAUTHENTICATED for garbage and for other token kinds', () => {
    const tokens = service();
    expect(() => tokens.verifyAccess('nope')).toThrow(AppException);
    const challenge = tokens.signChallenge({
      userId: 'u-1',
      challengeId: 'c-1',
      stage: 'mfa',
      amr: 'password',
    });
    try {
      tokens.verifyAccess(challenge);
      throw new Error('should not verify');
    } catch (e) {
      expect((e as AppException).getStatus()).toBe(401);
      expect((e as AppException).code).toBe('UNAUTHENTICATED');
    }
  });

  it('uses separate secrets per kind (a leaked one forges nothing else)', () => {
    const a = service();
    const b = service({ AUTH_ACCESS_SECRET: 'z'.repeat(40) });
    expect(() => b.verifyAccess(a.signAccess(input).token)).toThrow(
      AppException,
    );
    expect(baseEnv.AUTH_ACCESS_SECRET).not.toBe(
      baseEnv.AUTH_MFA_CHALLENGE_SECRET,
    );
  });
});

describe('challenge tokens', () => {
  const claims = {
    userId: 'u-1',
    challengeId: 'c-1',
    stage: 'otp' as const,
    amr: 'otp' as const,
  };

  it('round-trips and carries the challenge id as jti', () => {
    const tokens = service();
    expect(
      tokens.verifyChallenge(tokens.signChallenge(claims), 'otp'),
    ).toMatchObject({ sub: 'u-1', jti: 'c-1', stage: 'otp', amr: 'otp' });
  });

  it('refuses the wrong stage and an access token', () => {
    const tokens = service();
    const challenge = tokens.signChallenge(claims);
    expect(() => tokens.verifyChallenge(challenge, 'mfa')).toThrow(
      /invalid or expired/,
    );
    expect(() =>
      tokens.verifyChallenge(tokens.signAccess(input).token, 'otp'),
    ).toThrow(AppException);
  });
});

describe('email verification tokens', () => {
  it('round-trips and expires per AUTH_EMAIL_VERIFY_TTL_HOURS', () => {
    const tokens = service({ AUTH_EMAIL_VERIFY_TTL_HOURS: '2' });
    const { token, expires_at } = tokens.signEmailVerification({
      userId: 'u-1',
      email: 'a@example.com',
    });
    expect(tokens.verifyEmailVerification(token)).toMatchObject({
      sub: 'u-1',
      email: 'a@example.com',
    });
    const hours = (expires_at.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThanOrEqual(2);
  });

  it('answers 400 INVALID_TOKEN for anything else', () => {
    const tokens = service();
    try {
      tokens.verifyEmailVerification(tokens.signAccess(input).token);
      throw new Error('should not verify');
    } catch (e) {
      expect((e as AppException).getStatus()).toBe(400);
      expect((e as AppException).code).toBe('INVALID_TOKEN');
    }
  });
});
