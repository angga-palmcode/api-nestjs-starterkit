import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { AppLogger } from '../common/logger/app.logger';
import { hashPassword, verifyPassword } from '../common/utils/password.util';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { notDeleted } from '../prisma/soft-delete';
import { UserDto, toUserDto } from '../users/dto/user.dto';
import type { AuthenticatedUser } from './core/authenticated-user';
import { ChallengeService } from './core/challenge.service';
import { ClientMeta, SessionService } from './core/session.service';
import { TokenService } from './core/token.service';
import type { PrimaryMethod } from './core/token.service';
import {
  LoginResponseDto,
  LoginStatus,
  NextStep,
  TokenPairDto,
} from './dto/auth-responses.dto';
import type {
  LoginDto,
  RefreshDto,
  VerifyMfaDto,
  VerifyOtpDto,
} from './dto/auth-requests.dto';
import { MfaService } from './mfa.service';
import { AUTH_NOTIFIER } from './providers/auth-messaging';
import type { AuthNotifier } from './providers/auth-messaging';

const MAX_LOCK_MINUTES = 24 * 60;

const invalidCredentials = () =>
  new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');

const invalidCode = () =>
  new AppException(ErrorCode.INVALID_CODE, 'Invalid or expired code');

/**
 * The login state machine (Blueprint A5):
 *
 *   credentials ──► [otp_required] ──► [mfa_required] ──► authenticated
 *
 * Flags (`AUTH_METHODS`, `AUTH_MFA`) decide which states appear; the response
 * contract (`LoginResponseDto`) is identical for all of them.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly challenges: ChallengeService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
    @Inject(AUTH_NOTIFIER) private readonly notifier: AuthNotifier,
  ) {
    // Spends the same bcrypt time when the account does not exist (no timing oracle).
    this.decoyHash = hashPassword(
      'decoy-password-for-timing-only',
      this.config.get('AUTH_BCRYPT_ROUNDS', { infer: true }),
    );
  }

  private readonly decoyHash: Promise<string>;

  // ── Step 1: credentials ───────────────────────────────────────────────

  async login(dto: LoginDto, meta: ClientMeta): Promise<LoginResponseDto> {
    if (dto.password === undefined) return this.startOtpLogin(dto.email, meta);

    const user = await this.findByEmail(dto.email);
    if (!user?.password_hash) {
      await this.spendDecoyTime(dto.password);
      this.failed(null, meta, 'unknown_account');
      throw invalidCredentials();
    }
    if (this.isLocked(user)) {
      // Do not check the password and do not extend the lock (that would let anyone lock a user out forever).
      await this.spendDecoyTime(dto.password);
      this.failed(user, meta, 'locked');
      throw invalidCredentials();
    }
    if (!(await verifyPassword(dto.password, user.password_hash))) {
      await this.registerFailure(user);
      this.failed(user, meta, 'bad_password');
      throw invalidCredentials();
    }
    this.assertLoginAllowed(user);
    return this.afterPrimary(user, 'password', meta);
  }

  private async startOtpLogin(
    email: string,
    meta: ClientMeta,
  ): Promise<LoginResponseDto> {
    if (!this.config.get('AUTH_METHODS', { infer: true }).includes('otp')) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
        errors: [{ field: 'password', message: 'password is required' }],
      });
    }
    const user = await this.findByEmail(email);
    const eligible = !!user && user.is_active && !this.isLocked(user);
    // Same response whether or not the account exists (no enumeration through this endpoint).
    const challenge = eligible
      ? await this.challenges.issue(user, 'otp', 'otp', 'otp')
      : this.challenges.decoy('otp', 'otp');
    if (!eligible) this.failed(user ?? null, meta, 'otp_not_eligible');
    return this.challengeResponse(LoginStatus.otp_required, challenge);
  }

  // ── Step 2a: emailed login code ───────────────────────────────────────

  async verifyOtp(
    dto: VerifyOtpDto,
    meta: ClientMeta,
  ): Promise<LoginResponseDto> {
    const claims = this.tokens.verifyChallenge(dto.challenge_token, 'otp');
    const found = await this.findById(claims.sub);
    if (!found || !found.is_active || this.isLocked(found)) throw invalidCode();

    const ok = await this.challenges.attempt(claims, (row) =>
      this.challenges.matchesCode(row, found.id, dto.code),
    );
    if (!ok) {
      await this.registerFailure(found);
      this.failed(found, meta, 'bad_otp');
      throw invalidCode();
    }
    // Receiving the code proves control of the mailbox.
    const user = found.email_verified_at
      ? found
      : await this.prisma.user.update({
          where: { id: found.id },
          data: { email_verified_at: new Date() },
        });
    this.assertLoginAllowed(user);
    return this.afterPrimary(user, 'otp', meta);
  }

  // ── Step 2b: second factor ────────────────────────────────────────────

  async verifyMfa(
    dto: VerifyMfaDto,
    meta: ClientMeta,
  ): Promise<LoginResponseDto> {
    const claims = this.tokens.verifyChallenge(dto.challenge_token, 'mfa');
    const user = await this.findById(claims.sub);
    if (!user || !user.is_active || this.isLocked(user)) throw invalidCode();

    const method = this.config.get('AUTH_MFA', { infer: true });
    if (method === 'none') {
      throw new AppException(
        ErrorCode.INVALID_TOKEN,
        'Challenge is invalid or expired',
      );
    }
    const ok = await this.challenges.attempt(claims, (row) =>
      method === 'otp'
        ? this.challenges.matchesCode(row, user.id, dto.code)
        : this.mfa.verifyCode(user, dto.code),
    );
    if (!ok) {
      await this.registerFailure(user);
      this.failed(user, meta, 'bad_mfa');
      throw invalidCode();
    }
    // The same checks as step 1 (a common mistake is to skip lockout / verification at this step).
    this.assertLoginAllowed(user);
    return this.complete(user, meta);
  }

  // ── Tokens ────────────────────────────────────────────────────────────

  async refresh(dto: RefreshDto): Promise<TokenPairDto> {
    const { userId, sessionId, refreshToken } = await this.sessions.rotate(
      dto.refresh_token,
    );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const access = this.tokens.signAccess({
      userId,
      email: user.email,
      role: user.role,
      sessionId,
      tokenVersion: user.token_version,
    });
    return {
      access_token: access.token,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: access.expires_in,
    };
  }

  async logout(actor: AuthenticatedUser): Promise<void> {
    await this.sessions.revokeSession(actor.session_id);
  }

  async logoutAll(actor: AuthenticatedUser): Promise<void> {
    await this.sessions.revokeAllForUser(actor.id);
  }

  // ── Profile & sessions ────────────────────────────────────────────────

  async me(actor: AuthenticatedUser): Promise<UserDto> {
    return toUserDto(
      await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    );
  }

  async updateMe(actor: AuthenticatedUser, name: string): Promise<UserDto> {
    return toUserDto(
      await this.prisma.user.update({
        where: { id: actor.id },
        data: { name, updated_by: actor.id },
      }),
    );
  }

  async listSessions(actor: AuthenticatedUser) {
    const sessions = await this.sessions.listActive(actor.id);
    return sessions.map((s) => ({
      id: s.id,
      user_agent: s.user_agent,
      ip: s.ip,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      current: s.id === actor.session_id,
    }));
  }

  async revokeSession(
    actor: AuthenticatedUser,
    sessionId: string,
  ): Promise<void> {
    if (!(await this.sessions.revokeOwn(actor.id, sessionId))) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Session not found');
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Decides between another factor and tokens, once the first step succeeded. */
  private async afterPrimary(
    user: User,
    amr: PrimaryMethod,
    meta: ClientMeta,
  ): Promise<LoginResponseDto> {
    const mfa = this.config.get('AUTH_MFA', { infer: true });

    if (mfa === 'totp' && user.mfa_enabled) {
      const challenge = await this.challenges.issue(user, 'mfa', amr, 'totp');
      return this.challengeResponse(
        LoginStatus.mfa_required,
        challenge,
        'totp',
      );
    }
    // After an emailed-code login the mailbox is already proven, so an email second factor adds nothing.
    if (mfa === 'otp' && amr !== 'otp') {
      const challenge = await this.challenges.issue(user, 'mfa', amr, 'otp');
      return this.challengeResponse(LoginStatus.mfa_required, challenge, 'otp');
    }
    return this.complete(user, meta);
  }

  private async complete(
    user: User,
    meta: ClientMeta,
  ): Promise<LoginResponseDto> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
      },
    });
    const { sessionId, refreshToken } = await this.sessions.create(
      user.id,
      meta,
    );
    const access = this.tokens.signAccess({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      tokenVersion: updated.token_version,
    });
    this.audit.record({
      actor_id: user.id,
      action: 'auth.login',
      entity_type: 'user',
      entity_id: user.id,
      ip: meta.ip,
      user_agent: meta.user_agent,
    });
    return {
      status: LoginStatus.authenticated,
      next_step: null,
      access_token: access.token,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: access.expires_in,
      user: toUserDto(updated),
    };
  }

  private challengeResponse(
    status: LoginStatus.otp_required | LoginStatus.mfa_required,
    challenge_token: string,
    mfa_method?: 'totp' | 'otp',
  ): LoginResponseDto {
    return {
      status,
      next_step:
        status === LoginStatus.otp_required
          ? NextStep.verify_otp
          : NextStep.verify_mfa,
      challenge_token,
      ...(mfa_method ? { mfa_method } : {}),
      expires_in: this.config.get('AUTH_CHALLENGE_TTL_SECONDS', {
        infer: true,
      }),
    };
  }

  /** Checks shared by every path that ends in tokens (login, OTP, MFA). */
  private assertLoginAllowed(user: User): void {
    if (!user.is_active || user.deleted_at) {
      throw new AppException(
        ErrorCode.ACCOUNT_DISABLED,
        'This account is disabled',
      );
    }
    if (
      this.config.get('AUTH_REQUIRE_EMAIL_VERIFICATION', { infer: true }) &&
      !user.email_verified_at
    ) {
      throw new AppException(
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Please verify your email address before signing in',
      );
    }
  }

  private isLocked(user: User): boolean {
    return !!user.locked_until && user.locked_until > new Date();
  }

  /**
   * Counts a failure and locks with progressive back-off: the first lock lasts
   * AUTH_LOCKOUT_MINUTES, every further failure after it doubles (capped at 24h).
   * The owner is told once, when the first lock starts.
   */
  private async registerFailure(user: User): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failed_login_attempts: { increment: 1 } },
    });
    const max = this.config.get('AUTH_MAX_FAILED_LOGINS', { infer: true });
    if (updated.failed_login_attempts < max) return;

    const over = updated.failed_login_attempts - max;
    const base = this.config.get('AUTH_LOCKOUT_MINUTES', { infer: true });
    const minutes = Math.min(base * 2 ** Math.min(over, 20), MAX_LOCK_MINUTES);
    const locked_until = new Date(Date.now() + minutes * 60_000);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { locked_until },
    });
    this.audit.record({
      actor_id: user.id,
      action: 'auth.account_locked',
      entity_type: 'user',
      entity_id: user.id,
      metadata: { minutes },
    });
    if (over === 0) {
      this.notifier
        .sendAccountLocked({ email: user.email, locked_until })
        .catch((error: unknown) =>
          this.logger.error(
            {
              message: 'lock_notice_failed',
              error: error instanceof Error ? error.message : String(error),
            },
            undefined,
            'Auth',
          ),
        );
    }
  }

  private failed(user: User | null, meta: ClientMeta, reason: string): void {
    this.audit.record({
      actor_id: null,
      action: 'auth.login_failed',
      entity_type: user ? 'user' : undefined,
      entity_id: user?.id,
      metadata: { reason },
      ip: meta.ip,
      user_agent: meta.user_agent,
    });
  }

  private async spendDecoyTime(password: string): Promise<void> {
    await verifyPassword(password, await this.decoyHash);
  }

  private findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), ...notDeleted },
    });
  }

  private findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, ...notDeleted } });
  }
}
