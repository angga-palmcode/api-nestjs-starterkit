import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { PaginatedResult } from '../common/envelope/envelope.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { AppLogger } from '../common/logger/app.logger';
import type { RawQuery } from '../common/query';
import { userQuery } from './users.query';
import { generateToken, hashToken } from '../common/utils/token.util';
import { Env } from '../config/env.schema';
import { notDeleted, softDeleteData } from '../prisma/soft-delete';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanActOnRole,
  assertCanAssignRole,
  hasAtLeast,
} from '../auth/core/roles';
import { InvitationDto, InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDto, toUserDto } from './dto/user.dto';
import { INVITATION_SENDER } from './invitation-sender';
import type { InvitationSender } from './invitation-sender';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(INVITATION_SENDER) private readonly sender: InvitationSender,
    private readonly logger: AppLogger,
  ) {}

  async list(
    actor: AuthenticatedUser,
    raw: RawQuery,
  ): Promise<PaginatedResult<UserDto>> {
    this.assertCanManageUsers(actor);
    const q = userQuery.parse(raw);
    // One transaction so the page and the total describe the same snapshot.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany(q.args),
      this.prisma.user.count({ where: q.where }),
    ]);
    return q.paginate(rows.map(toUserDto), total);
  }

  async get(actor: AuthenticatedUser, id: string): Promise<UserDto> {
    this.assertCanManageUsers(actor);
    return toUserDto(await this.findOrFail(id));
  }

  async invite(
    actor: AuthenticatedUser,
    dto: InviteUserDto,
  ): Promise<InvitationDto> {
    this.assertCanManageUsers(actor);
    assertCanAssignRole(actor.role, dto.role);

    const email = dto.email.trim().toLowerCase();
    // Includes soft-deleted users: their email stays reserved (unique constraint).
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new AppException(ErrorCode.CONFLICT, 'Email already in use');
    }

    const token = generateToken();
    const expires_at = new Date(
      Date.now() +
        this.config.get('INVITATION_TTL_HOURS', { infer: true }) * 3_600_000,
    );
    // A new invitation supersedes any pending one for the same email.
    const [, invitation] = await this.prisma.$transaction([
      this.prisma.userInvitation.updateMany({
        where: { email, accepted_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
      this.prisma.userInvitation.create({
        data: {
          email,
          name: dto.name,
          role: dto.role,
          token_hash: hashToken(token),
          invited_by_id: actor.id,
          expires_at,
        },
      }),
    ]);

    // Fire-and-forget: a delivery failure is logged and must not fail the request.
    const base = this.config
      .get('FRONTEND_URL', { infer: true })
      .replace(/\/$/, '');
    this.sender
      .send({
        email,
        name: dto.name,
        role: dto.role,
        link: `${base}/accept-invite?token=${token}`,
        expires_at,
      })
      .catch((error: unknown) =>
        this.logger.error(
          {
            message: 'invitation_send_failed',
            invitation_id: invitation.id,
            error: error instanceof Error ? error.message : String(error),
          },
          undefined,
          'Invitations',
        ),
      );

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expires_at: invitation.expires_at,
      created_at: invitation.created_at,
    };
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
  ): Promise<UserDto> {
    const target = await this.loadManageable(actor, id);
    const roleChanged = dto.role !== undefined && dto.role !== target.role;
    if (roleChanged) assertCanAssignRole(actor.role, dto.role as Role);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(roleChanged
          ? { role: dto.role, token_version: { increment: 1 } }
          : {}),
        updated_by: actor.id,
      },
    });
    return toUserDto(updated);
  }

  async activate(actor: AuthenticatedUser, id: string): Promise<UserDto> {
    await this.loadManageable(actor, id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        is_active: true,
        failed_login_attempts: 0,
        locked_until: null,
        updated_by: actor.id,
      },
    });
    return toUserDto(updated);
  }

  async deactivate(actor: AuthenticatedUser, id: string): Promise<UserDto> {
    await this.loadManageable(actor, id);
    return toUserDto(
      await this.revokeAccess(id, { is_active: false, updated_by: actor.id }),
    );
  }

  async forceLogout(actor: AuthenticatedUser, id: string): Promise<void> {
    await this.loadManageable(actor, id);
    await this.revokeAccess(id, { updated_by: actor.id });
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    await this.loadManageable(actor, id);
    await this.revokeAccess(id, {
      is_active: false,
      ...softDeleteData(actor.id),
    });
  }

  /** Admin-level gate. Replaced by the permission matrix in Phase 5. */
  private assertCanManageUsers(actor: AuthenticatedUser): void {
    if (!hasAtLeast(actor.role, Role.admin)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Insufficient permissions');
    }
  }

  private async findOrFail(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...notDeleted },
    });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
    return user;
  }

  /** Loads a user the actor is allowed to manage: not themselves, strictly below their role. */
  private async loadManageable(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<User> {
    this.assertCanManageUsers(actor);
    const target = await this.findOrFail(id);
    if (target.id === actor.id) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'You cannot perform this action on your own account',
      );
    }
    assertCanActOnRole(actor.role, target.role);
    return target;
  }

  /**
   * Revokes every session and refresh token and bumps `token_version`, so access
   * tokens already issued stop working at the next per-request check.
   */
  private async revokeAccess(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User> {
    const now = new Date();
    const [, , user] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.userSession.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.user.update({
        where: { id },
        data: { ...data, token_version: { increment: 1 } },
      }),
    ]);
    return user;
  }
}
