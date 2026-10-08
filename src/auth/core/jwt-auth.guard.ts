import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { notDeleted } from '../../prisma/soft-delete';
import type { RequestWithUser } from './current-user.decorator';
import { IS_PUBLIC } from './public.decorator';
import { TokenService } from './token.service';

const unauthenticated = () =>
  new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication required');

/**
 * Global guard: every route needs a valid Bearer access token unless it is
 * `@Public()`. With `AUTH_VERIFY_USER_PER_REQUEST` (default) the user and session
 * are re-read from the database, so deactivation, role changes, force-logout and
 * logout take effect immediately instead of when the token expires (finding 3.7).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthenticated();

    const claims = this.tokens.verifyAccess(token);

    if (!this.config.get('AUTH_VERIFY_USER_PER_REQUEST', { infer: true })) {
      request.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        session_id: claims.sid,
      };
      return true;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sid },
    });
    if (!session || session.revoked_at || session.user_id !== claims.sub) {
      throw unauthenticated();
    }
    const user = await this.prisma.user.findFirst({
      where: { id: claims.sub, ...notDeleted },
    });
    if (!user || !user.is_active || user.token_version !== claims.ver) {
      throw unauthenticated();
    }
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      session_id: session.id,
    };
    return true;
  }
}
