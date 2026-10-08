import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { Env } from '../../config/env.schema';

/** Audiences keep the three token kinds non-interchangeable even if secrets were ever shared. */
const AUD = {
  access: 'access',
  challenge: 'login-challenge',
  emailVerify: 'email-verify',
} as const;

export type ChallengeStage = 'otp' | 'mfa';
export type PrimaryMethod = 'password' | 'otp';

export interface AccessClaims {
  sub: string;
  email: string;
  role: Role;
  /** Session id: logout/force-logout revoke the session, which kills this token. */
  sid: string;
  /** `User.token_version` at issue time. */
  ver: number;
}

export interface ChallengeClaims {
  sub: string;
  /** Id of the OtpToken row backing this challenge (single use, attempt limited). */
  jti: string;
  stage: ChallengeStage;
  /** How the user passed the first step; MFA-by-email is skipped after an OTP login. */
  amr: PrimaryMethod;
}

const ALGORITHM = 'HS256' as const;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  signAccess(input: {
    userId: string;
    email: string;
    role: Role;
    sessionId: string;
    tokenVersion: number;
  }): { token: string; expires_in: number } {
    const expires_in = this.config.get('AUTH_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    const claims: Omit<AccessClaims, 'sub'> = {
      email: input.email,
      role: input.role,
      sid: input.sessionId,
      ver: input.tokenVersion,
    };
    const token = this.jwt.sign(claims, {
      subject: input.userId,
      secret: this.config.get('AUTH_ACCESS_SECRET', { infer: true }),
      algorithm: ALGORITHM,
      audience: AUD.access,
      expiresIn: expires_in,
    });
    return { token, expires_in };
  }

  /** Throws 401 UNAUTHENTICATED for anything that is not a valid, unexpired access token. */
  verifyAccess(token: string): AccessClaims {
    try {
      return this.jwt.verify<AccessClaims>(token, {
        secret: this.config.get('AUTH_ACCESS_SECRET', { infer: true }),
        algorithms: [ALGORITHM],
        audience: AUD.access,
      });
    } catch {
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'Invalid or expired token',
      );
    }
  }

  signChallenge(input: {
    userId: string;
    challengeId: string;
    stage: ChallengeStage;
    amr: PrimaryMethod;
  }): string {
    return this.jwt.sign(
      { stage: input.stage, amr: input.amr },
      {
        subject: input.userId,
        jwtid: input.challengeId,
        secret: this.config.get('AUTH_MFA_CHALLENGE_SECRET', { infer: true }),
        algorithm: ALGORITHM,
        audience: AUD.challenge,
        expiresIn: this.config.get('AUTH_CHALLENGE_TTL_SECONDS', {
          infer: true,
        }),
      },
    );
  }

  verifyChallenge(token: string, stage: ChallengeStage): ChallengeClaims {
    try {
      const claims = this.jwt.verify<ChallengeClaims>(token, {
        secret: this.config.get('AUTH_MFA_CHALLENGE_SECRET', { infer: true }),
        algorithms: [ALGORITHM],
        audience: AUD.challenge,
      });
      if (claims.stage !== stage) throw new Error('wrong stage');
      return claims;
    } catch {
      throw new AppException(
        ErrorCode.INVALID_TOKEN,
        'Challenge is invalid or expired. Please sign in again.',
      );
    }
  }

  signEmailVerification(input: { userId: string; email: string }): {
    token: string;
    expires_at: Date;
  } {
    const hours = this.config.get('AUTH_EMAIL_VERIFY_TTL_HOURS', {
      infer: true,
    });
    const token = this.jwt.sign(
      { email: input.email },
      {
        subject: input.userId,
        secret: this.config.get('AUTH_EMAIL_VERIFY_SECRET', { infer: true }),
        algorithm: ALGORITHM,
        audience: AUD.emailVerify,
        expiresIn: hours * 3600,
      },
    );
    return { token, expires_at: new Date(Date.now() + hours * 3_600_000) };
  }

  verifyEmailVerification(token: string): { sub: string; email: string } {
    try {
      return this.jwt.verify<{ sub: string; email: string }>(token, {
        secret: this.config.get('AUTH_EMAIL_VERIFY_SECRET', { infer: true }),
        algorithms: [ALGORITHM],
        audience: AUD.emailVerify,
      });
    } catch {
      throw new AppException(
        ErrorCode.INVALID_TOKEN,
        'Verification link is invalid or has expired',
        { status: 400 },
      );
    }
  }
}
