import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { generateToken, hashToken } from '../../common/utils/token.util';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { notDeleted } from '../../prisma/soft-delete';

export interface ClientMeta {
  ip?: string;
  user_agent?: string;
}

const invalidRefresh = () =>
  new AppException(
    ErrorCode.INVALID_TOKEN,
    'Refresh token is invalid or expired',
  );

/**
 * Sessions and opaque rotating refresh tokens. A session owns a chain ("family") of
 * refresh tokens; each is single use. Presenting a used token again means it leaked, so
 * the whole family and its session are revoked (findings 3.6 / 3.8).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    meta: ClientMeta,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const session = await this.prisma.userSession.create({
      data: { user_id: userId, ip: meta.ip, user_agent: meta.user_agent },
    });
    const refreshToken = await this.issueRefreshToken(
      userId,
      session.id,
      randomUUID(),
    );
    return { sessionId: session.id, refreshToken };
  }

  /** Exchanges a refresh token for a new one (same session and family). */
  async rotate(
    rawToken: string,
  ): Promise<{ userId: string; sessionId: string; refreshToken: string }> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { token_hash: hashToken(rawToken) },
    });
    if (!token || token.revoked_at) throw invalidRefresh();

    if (token.used_at) return this.reuseDetected(token);
    if (token.expires_at <= new Date()) throw invalidRefresh();

    // Claim atomically: of two concurrent requests with the same token only one wins.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, used_at: null, revoked_at: null },
      data: { used_at: new Date() },
    });
    if (claimed.count !== 1) return this.reuseDetected(token);

    const [session, user] = await Promise.all([
      this.prisma.userSession.findUnique({ where: { id: token.session_id } }),
      this.prisma.user.findFirst({
        where: { id: token.user_id, ...notDeleted },
      }),
    ]);
    if (!session || session.revoked_at || !user || !user.is_active) {
      await this.revokeFamily(token.family_id, token.session_id);
      throw invalidRefresh();
    }

    const refreshToken = await this.issueRefreshToken(
      user.id,
      session.id,
      token.family_id,
    );
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { last_seen_at: new Date() },
    });
    return { userId: user.id, sessionId: session.id, refreshToken };
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { session_id: sessionId, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.userSession.updateMany({
        where: { id: sessionId, revoked_at: null },
        data: { revoked_at: now },
      }),
    ]);
  }

  /** Revokes every session and refresh token and bumps `token_version` (kills all access tokens). */
  async revokeAllForUser(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.userSession.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { token_version: { increment: 1 } },
      }),
    ]);
  }

  listActive(userId: string) {
    return this.prisma.userSession.findMany({
      where: { user_id: userId, revoked_at: null },
      orderBy: [{ last_seen_at: 'desc' }, { id: 'desc' }],
    });
  }

  /** Revokes one of the user's own sessions; false if it is not theirs / already revoked. */
  async revokeOwn(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, user_id: userId, revoked_at: null },
    });
    if (!session) return false;
    await this.revokeSession(sessionId);
    return true;
  }

  private async issueRefreshToken(
    userId: string,
    sessionId: string,
    familyId: string,
  ): Promise<string> {
    const raw = generateToken();
    const days = this.config.get('AUTH_REFRESH_TTL_DAYS', { infer: true });
    await this.prisma.refreshToken.create({
      data: {
        user_id: userId,
        session_id: sessionId,
        family_id: familyId,
        token_hash: hashToken(raw),
        expires_at: new Date(Date.now() + days * 86_400_000),
      },
    });
    return raw;
  }

  private async revokeFamily(
    familyId: string,
    sessionId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { family_id: familyId, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.userSession.updateMany({
        where: { id: sessionId, revoked_at: null },
        data: { revoked_at: now },
      }),
    ]);
  }

  private async reuseDetected(token: {
    user_id: string;
    family_id: string;
    session_id: string;
  }): Promise<never> {
    await this.revokeFamily(token.family_id, token.session_id);
    this.audit.record({
      actor_id: token.user_id,
      action: 'auth.refresh_reuse_detected',
      entity_type: 'user_session',
      entity_id: token.session_id,
    });
    throw invalidRefresh();
  }
}
