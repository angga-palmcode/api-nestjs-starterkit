import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { AppLogger } from '../common/logger/app.logger';
import { hashPassword, verifyPassword } from '../common/utils/password.util';
import { generateToken, hashToken } from '../common/utils/token.util';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { notDeleted } from '../prisma/soft-delete';
import { UserDto, toUserDto } from '../users/dto/user.dto';
import type { AuthenticatedUser } from './core/authenticated-user';
import { SessionService } from './core/session.service';
import { TokenService } from './core/token.service';
import type {
  AcceptInviteDto,
  ChangePasswordDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth-requests.dto';
import { AUTH_NOTIFIER } from './providers/auth-messaging';
import type { AuthNotifier } from './providers/auth-messaging';

const invalidLink = (what: string) =>
  new AppException(
    ErrorCode.INVALID_TOKEN,
    `${what} is invalid or has expired`,
    {
      status: 400,
    },
  );

/** Account lifecycle: registration, email verification, password reset/change, invitation acceptance. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
    @Inject(AUTH_NOTIFIER) private readonly notifier: AuthNotifier,
  ) {}

  // ── Registration & email verification ─────────────────────────────────

  /** Open registration (AUTH_ALLOW_REGISTRATION). Always answers the same, so it cannot probe for accounts. */
  async register(dto: RegisterDto): Promise<void> {
    if (!this.config.get('AUTH_ALLOW_REGISTRATION', { infer: true })) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Not found');
    }
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) return;

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        role: Role.user,
        password_hash: await this.hash(dto.password),
      },
    });
    this.audit.record({
      actor_id: user.id,
      action: 'auth.register',
      entity_type: 'user',
      entity_id: user.id,
    });
    if (this.config.get('AUTH_REQUIRE_EMAIL_VERIFICATION', { infer: true })) {
      this.sendVerification(user);
    }
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), ...notDeleted },
    });
    if (user && user.is_active && !user.email_verified_at) {
      this.sendVerification(user);
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const claims = this.tokens.verifyEmailVerification(token);
    const user = await this.prisma.user.findFirst({
      where: { id: claims.sub, email: claims.email, ...notDeleted },
    });
    if (!user) throw invalidLink('Verification link');
    if (user.email_verified_at) return; // idempotent
    await this.prisma.user.update({
      where: { id: user.id },
      data: { email_verified_at: new Date() },
    });
    this.audit.record({
      actor_id: user.id,
      action: 'auth.email_verified',
      entity_type: 'user',
      entity_id: user.id,
    });
  }

  // ── Password reset / change ───────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), ...notDeleted },
    });
    if (!user || !user.is_active) return; // same response either way

    const now = new Date();
    const token = generateToken();
    const expires_at = new Date(
      now.getTime() +
        this.config.get('AUTH_RESET_TTL_MINUTES', { infer: true }) * 60_000,
    );
    // Latest wins: older unused links stop working.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { user_id: user.id, used_at: null },
        data: { used_at: now },
      }),
      this.prisma.passwordResetToken.create({
        data: { user_id: user.id, token_hash: hashToken(token), expires_at },
      }),
    ]);
    this.fireAndForget(
      this.notifier.sendPasswordReset({
        email: user.email,
        name: user.name,
        link: `${this.frontend()}/reset-password?token=${token}`,
        expires_at,
      }),
      'password_reset_send_failed',
    );
    this.audit.record({
      actor_id: user.id,
      action: 'auth.password_reset_requested',
      entity_type: 'user',
      entity_id: user.id,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const now = new Date();
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: hashToken(dto.token) },
    });
    if (!record || record.used_at || record.expires_at <= now) {
      throw invalidLink('Reset link');
    }
    // Single use, race safe: only one request can flip used_at.
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { id: record.id, used_at: null },
      data: { used_at: now },
    });
    if (claimed.count !== 1) throw invalidLink('Reset link');

    const user = await this.prisma.user.findFirst({
      where: { id: record.user_id, ...notDeleted },
    });
    if (!user) throw invalidLink('Reset link');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: await this.hash(dto.password),
        failed_login_attempts: 0,
        locked_until: null,
        // The link came from the mailbox, so it also proves the address.
        email_verified_at: user.email_verified_at ?? now,
      },
    });
    await this.sessions.revokeAllForUser(user.id);
    this.audit.record({
      actor_id: user.id,
      action: 'auth.password_reset',
      entity_type: 'user',
      entity_id: user.id,
    });
  }

  async changePassword(
    actor: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    if (
      !user.password_hash ||
      !(await verifyPassword(dto.current_password, user.password_hash))
    ) {
      throw new AppException(
        ErrorCode.INVALID_CREDENTIALS,
        'Current password is incorrect',
      );
    }
    if (dto.current_password === dto.new_password) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
        errors: [
          {
            field: 'new_password',
            message: 'new_password must differ from the current password',
          },
        ],
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: await this.hash(dto.new_password),
        updated_by: user.id,
      },
    });
    // Signs out every device, including this one.
    await this.sessions.revokeAllForUser(user.id);
  }

  // ── Invitations ───────────────────────────────────────────────────────

  async acceptInvite(dto: AcceptInviteDto): Promise<UserDto> {
    const now = new Date();
    const password_hash = await this.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.userInvitation.findUnique({
        where: { token_hash: hashToken(dto.token) },
      });
      if (
        !invitation ||
        invitation.accepted_at ||
        invitation.revoked_at ||
        invitation.expires_at <= now
      ) {
        throw invalidLink('Invitation');
      }
      // Claim first: two simultaneous acceptances cannot both pass (finding 3.10).
      const claimed = await tx.userInvitation.updateMany({
        where: { id: invitation.id, accepted_at: null, revoked_at: null },
        data: { accepted_at: now },
      });
      if (claimed.count !== 1) throw invalidLink('Invitation');

      if (await tx.user.findUnique({ where: { email: invitation.email } })) {
        throw new AppException(ErrorCode.CONFLICT, 'Email already in use');
      }
      return tx.user.create({
        data: {
          email: invitation.email,
          name: dto.name ?? invitation.name ?? invitation.email.split('@')[0],
          role: invitation.role,
          password_hash,
          // Following the emailed link proves the address.
          email_verified_at: now,
          created_by: invitation.invited_by_id,
        },
      });
    });
    this.audit.record({
      actor_id: user.id,
      action: 'auth.invitation_accepted',
      entity_type: 'user',
      entity_id: user.id,
    });
    return toUserDto(user);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private sendVerification(user: User): void {
    const { token, expires_at } = this.tokens.signEmailVerification({
      userId: user.id,
      email: user.email,
    });
    this.fireAndForget(
      this.notifier.sendEmailVerification({
        email: user.email,
        name: user.name,
        link: `${this.frontend()}/verify-email?token=${token}`,
        expires_at,
      }),
      'verification_send_failed',
    );
  }

  private hash(password: string): Promise<string> {
    return hashPassword(
      password,
      this.config.get('AUTH_BCRYPT_ROUNDS', { infer: true }),
    );
  }

  private frontend(): string {
    return this.config.get('FRONTEND_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Delivery problems are logged, never surfaced: the response must not depend on them. */
  private fireAndForget(promise: Promise<void>, event: string): void {
    promise.catch((error: unknown) =>
      this.logger.error(
        {
          message: event,
          error: error instanceof Error ? error.message : String(error),
        },
        undefined,
        'Account',
      ),
    );
  }
}
