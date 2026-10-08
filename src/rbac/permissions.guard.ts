import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTHENTICATED_ONLY } from '../auth/core/authenticated.decorator';
import type { RequestWithUser } from '../auth/core/current-user.decorator';
import { IS_PUBLIC } from '../auth/core/public.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { AppLogger } from '../common/logger/app.logger';
import { Role } from '../auth/core/roles';
import { Permission, can } from './permissions';
import { PERMISSIONS_KEY, ROLES_KEY } from './rbac.decorators';

const forbidden = (message = 'You do not have permission to do this') =>
  new AppException(ErrorCode.FORBIDDEN, message);

/**
 * Global authorization guard, **fail-closed**: a route is reachable only if it declares
 * its policy: `@Public()`, `@Authenticated()`, `@Roles(...)` or `@Permissions(...)`.
 * A route with none of them is denied (a guard that lets undeclared routes through is a classic fail-open bug).
 * It runs after `JwtAuthGuard`, which has already put the user on the request.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: AppLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const get = <T>(key: string) =>
      this.reflector.getAllAndOverride<T | undefined>(key, targets);

    if (get<boolean>(IS_PUBLIC)) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      // JwtAuthGuard should have rejected the request already; never allow without a user.
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
      );
    }

    const roles = get<Role[]>(ROLES_KEY);
    const permissions = get<Permission[]>(PERMISSIONS_KEY);

    if (roles && !roles.includes(user.role)) throw forbidden();
    if (permissions && !permissions.every((p) => can(user.role, p))) {
      throw forbidden();
    }
    if (roles || permissions) return true;
    if (get<boolean>(AUTHENTICATED_ONLY)) return true;

    this.logger.error(
      {
        message: 'route_without_access_policy',
        route: `${context.getClass().name}.${context.getHandler().name}`,
      },
      undefined,
      'Rbac',
    );
    throw forbidden('This route has no access policy');
  }
}
