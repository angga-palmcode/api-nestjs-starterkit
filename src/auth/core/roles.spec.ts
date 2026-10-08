import { AppException } from '../../common/errors/app.exception';
import {
  Role,
  ROLE_LEVEL,
  assertCanActOnRole,
  assertCanAssignRole,
  assignableRoles,
  canActOn,
  hasAtLeast,
} from './roles';

describe('role hierarchy', () => {
  it('ranks every Prisma role', () => {
    expect(Object.keys(ROLE_LEVEL).sort()).toEqual(Object.values(Role).sort());
  });

  it('only allows acting on strictly lower roles', () => {
    expect(canActOn(Role.superadmin, Role.admin)).toBe(true);
    expect(canActOn(Role.superadmin, Role.superadmin)).toBe(false);
    expect(canActOn(Role.admin, Role.user)).toBe(true);
    expect(canActOn(Role.admin, Role.admin)).toBe(false);
    expect(canActOn(Role.admin, Role.superadmin)).toBe(false);
    expect(canActOn(Role.user, Role.user)).toBe(false);
  });

  it('lists assignable roles below the actor', () => {
    expect(assignableRoles(Role.superadmin).sort()).toEqual(['admin', 'user']);
    expect(assignableRoles(Role.admin)).toEqual(['user']);
    expect(assignableRoles(Role.user)).toEqual([]);
  });

  it('hasAtLeast compares levels', () => {
    expect(hasAtLeast(Role.admin, Role.admin)).toBe(true);
    expect(hasAtLeast(Role.user, Role.admin)).toBe(false);
  });

  it('assert helpers throw 403 AppException', () => {
    expect(() => assertCanActOnRole(Role.admin, Role.admin)).toThrow(
      AppException,
    );
    expect(() => assertCanActOnRole(Role.admin, Role.user)).not.toThrow();
    expect(() => assertCanAssignRole(Role.admin, Role.admin)).toThrow(
      /cannot assign/,
    );
    expect(() =>
      assertCanAssignRole(Role.superadmin, Role.admin),
    ).not.toThrow();
  });
});
