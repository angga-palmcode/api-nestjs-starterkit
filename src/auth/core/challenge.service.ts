import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, OtpToken } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { AppLogger } from '../../common/logger/app.logger';
import { randomDigits } from '../../common/utils/crypto.util';
import { safeEqual } from '../../common/utils/timing-safe-equal.util';
import { hashToken } from '../../common/utils/token.util';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_SENDER } from '../providers/auth-messaging';
import type { OtpSender } from '../providers/auth-messaging';
import {
  ChallengeClaims,
  ChallengeStage,
  PrimaryMethod,
  TokenService,
} from './token.service';

export type ChallengeMethod = 'otp' | 'totp';

const OTP_LENGTH = 6;
const deadChallenge = () =>
  new AppException(
    ErrorCode.INVALID_TOKEN,
    'Challenge is invalid or expired. Please sign in again.',
  );

/**
 * A login challenge is one `OtpToken` row (its id is the JWT `jti`): single use and
 * attempt limited, whether the code is emailed (OTP) or comes from an authenticator (TOTP).
 * This avoids the classic flaw of a reusable MFA token with unlimited guesses.
 */
@Injectable()
export class ChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    private readonly logger: AppLogger,
  ) {}

  /** Creates the challenge (and emails a code for the `otp` method); returns the signed challenge token. */
  async issue(
    user: { id: string; email: string },
    stage: ChallengeStage,
    amr: PrimaryMethod,
    method: ChallengeMethod,
  ): Promise<string> {
    const purpose: OtpPurpose = stage === 'otp' ? 'login' : 'mfa';
    const code = method === 'otp' ? randomDigits(OTP_LENGTH) : undefined;
    const expires_at = new Date(
      Date.now() +
        this.config.get('AUTH_CHALLENGE_TTL_SECONDS', { infer: true }) * 1000,
    );
    const row = await this.prisma.otpToken.create({
      data: {
        user_id: user.id,
        purpose,
        code_hash: code ? this.hashCode(user.id, code) : 'totp',
        expires_at,
      },
    });
    if (code) {
      this.sender
        .send({ email: user.email, code, purpose, expires_at })
        .catch((error: unknown) =>
          this.logger.error(
            {
              message: 'otp_send_failed',
              error: error instanceof Error ? error.message : String(error),
            },
            undefined,
            'Challenge',
          ),
        );
    }
    return this.tokens.signChallenge({
      userId: user.id,
      challengeId: row.id,
      stage,
      amr,
    });
  }

  /**
   * A challenge for an address that cannot log in. Indistinguishable from a real one
   * until it is used, so `otp_required` does not reveal whether an account exists.
   */
  decoy(stage: ChallengeStage, amr: PrimaryMethod): string {
    return this.tokens.signChallenge({
      userId: randomUUID(),
      challengeId: randomUUID(),
      stage,
      amr,
    });
  }

  /**
   * Spends one attempt, then runs `check`. On success the challenge is consumed atomically.
   * Returns false for a wrong code; throws INVALID_TOKEN when the challenge is gone, used,
   * expired or out of attempts (the client must restart the login).
   */
  async attempt(
    claims: ChallengeClaims,
    check: (row: OtpToken) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    const purpose: OtpPurpose = claims.stage === 'otp' ? 'login' : 'mfa';
    const now = new Date();
    const row = await this.prisma.otpToken.findFirst({
      where: {
        id: claims.jti,
        user_id: claims.sub,
        purpose,
        consumed_at: null,
        expires_at: { gt: now },
      },
    });
    const max = this.config.get('AUTH_OTP_MAX_ATTEMPTS', { infer: true });
    if (!row || row.attempts >= max) throw deadChallenge();

    // Count the attempt first (atomic), so a crash or race cannot grant a free guess.
    const spent = await this.prisma.otpToken.updateMany({
      where: { id: row.id, consumed_at: null, attempts: { lt: max } },
      data: { attempts: { increment: 1 } },
    });
    if (spent.count !== 1) throw deadChallenge();

    if (!(await check(row))) return false;

    const consumed = await this.prisma.otpToken.updateMany({
      where: { id: row.id, consumed_at: null },
      data: { consumed_at: new Date() },
    });
    if (consumed.count !== 1) throw deadChallenge();
    return true;
  }

  /** Constant-time comparison of a submitted email code against the stored hash. */
  matchesCode(row: OtpToken, userId: string, code: string): boolean {
    return safeEqual(row.code_hash, this.hashCode(userId, code));
  }

  private hashCode(userId: string, code: string): string {
    return hashToken(`${userId}:${code}`);
  }
}
