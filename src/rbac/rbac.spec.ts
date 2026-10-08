import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../auth/core/roles';
import { AUTHENTICATED_ONLY } from '../auth/core/authenticated.decorator';
import { IS_PUBLIC } from '../auth/core/public.decorator';
import { AppException } from '../common/errors/app.exception';
import { AppLogger } from '../common/logger/app.logger';
import {
  ALL_PERMISSIONS,
  PERMISSION_ROLES,
  can,
  permissionsOf,
} from './permissions';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY, ROLES_KEY } from './rbac.decorators';

describe('permission matrix', () => {
  it('only references real roles and has no empty rows', () => {
    const roles = Object.values(Role);
    for (const permission of ALL_PERMISSIONS) {
      const holders = PERMISSION_ROLES[permission] as readonly Role[];
      expect(holders.length).toBeGreaterThan(0);
      holders.forEach((r) => expect(roles).toContain(r));
    }
  });

  it('superadmin holds everything admin holds (hierarchy sanity)', () => {
    for (const permission of permissionsOf(Role.admin)) {
      expect(can(Role.superadmin, permission)).toBe(true);
    }
  });

  it('a plain user holds no user-management permission, only reads the example module', () => {
    expect(permissionsOf(Role.user)).toEqual(['example.read']);
  });

  it('delete is superadmin-only; the rest is admin and up', () => {
    expect(can(Role.admin, 'users.delete')).toBe(false);
    expect(can(Role.superadmin, 'users.delete')).toBe(true);
    expect(can(Role.admin, 'users.read')).toBe(true);
    expect(permissionsOf(Role.superadmin)).toEqual(ALL_PERMISSIONS);
  });
});

describe('PermissionsGuard (fail-closed)', () => {
  const error = jest.fn();
  const guard = (metadata: Record<string, unknown>) => {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    return new PermissionsGuard(reflector, { error } as unknown as AppLogger);
  };
  const context = (user?: { role: Role }, type = 'http') =>
    ({
      getType: () => type,
      getHandler: () => function handlerName() {},
      getClass: () => class ControllerName {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const status = (fn: () => unknown): number | undefined => {
    try {
      fn();
    } catch (e) {
      return (e as AppException).getStatus();
    }
    return undefined;
  };

  beforeEach(() => error.mockClear());

  it('lets @Public routes through, even without a user', () => {
    expect(guard({ [IS_PUBLIC]: true }).canActivate(context())).toBe(true);
  });

  it('lets @Authenticated routes through for any signed-in user', () => {
    expect(
      guard({ [AUTHENTICATED_ONLY]: true }).canActivate(
        context({ role: Role.user }),
      ),
    ).toBe(true);
  });

  it('DENIES a route that declares no policy, and logs it (finding 3.13)', () => {
    expect(
      status(() => guard({}).canActivate(context({ role: Role.superadmin }))),
    ).toBe(403);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'route_without_access_policy',
        route: 'ControllerName.handlerName',
      }),
      undefined,
      'Rbac',
    );
  });

  it('never allows a non-public route without a user', () => {
    expect(
      status(() =>
        guard({ [AUTHENTICATED_ONLY]: true }).canActivate(context()),
      ),
    ).toBe(401);
  });

  it('@Roles: allows listed roles only', () => {
    const g = guard({ [ROLES_KEY]: [Role.admin] });
    expect(g.canActivate(context({ role: Role.admin }))).toBe(true);
    expect(status(() => g.canActivate(context({ role: Role.user })))).toBe(403);
    expect(
      status(() => g.canActivate(context({ role: Role.superadmin }))),
    ).toBe(403);
  });

  it('@Permissions: needs every listed permission', () => {
    const one = guard({ [PERMISSIONS_KEY]: ['users.delete'] });
    expect(one.canActivate(context({ role: Role.superadmin }))).toBe(true);
    expect(status(() => one.canActivate(context({ role: Role.admin })))).toBe(
      403,
    );

    const both = guard({ [PERMISSIONS_KEY]: ['users.read', 'users.delete'] });
    expect(status(() => both.canActivate(context({ role: Role.admin })))).toBe(
      403,
    );
    expect(both.canActivate(context({ role: Role.superadmin }))).toBe(true);
  });

  it('a role and a permission requirement must both hold', () => {
    const g = guard({
      [ROLES_KEY]: [Role.admin],
      [PERMISSIONS_KEY]: ['users.delete'],
    });
    expect(status(() => g.canActivate(context({ role: Role.admin })))).toBe(
      403,
    );
    expect(
      status(() => g.canActivate(context({ role: Role.superadmin }))),
    ).toBe(403);
  });

  it('ignores non-http contexts', () => {
    expect(guard({}).canActivate(context(undefined, 'rpc'))).toBe(true);
  });
});
