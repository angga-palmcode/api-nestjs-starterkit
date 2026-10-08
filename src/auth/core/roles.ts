import { Role } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';

export { Role };

/**
 * Single source of truth for role order. `Record<Role, number>` makes adding a
 * role to the Prisma enum a compile error until it is ranked here.
 */
export const ROLE_LEVEL: Record<Role, number> = {
  [Role.user]: 1,
  [Role.admin]: 2,
  [Role.superadmin]: 3,
};

export const levelOf = (role: Role): number => ROLE_LEVEL[role];

export const hasAtLeast = (role: Role, minimum: Role): boolean =>
  levelOf(role) >= levelOf(minimum);

/** Hierarchy rule: you may only act on someone strictly below your own level. */
export const canActOn = (actor: Role, target: Role): boolean =>
  levelOf(actor) > levelOf(target);

/** Roles the actor may hand out (always strictly below the actor's own level). */
export const assignableRoles = (actor: Role): Role[] =>
  (Object.keys(ROLE_LEVEL) as Role[]).filter((r) => canActOn(actor, r));

export function assertCanActOnRole(actor: Role, target: Role): void {
  if (!canActOn(actor, target)) {
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'You cannot manage a user at or above your own role',
    );
  }
}

export function assertCanAssignRole(actor: Role, role: Role): void {
  if (!canActOn(actor, role)) {
    throw new AppException(
      ErrorCode.FORBIDDEN,
      `You cannot assign the role "${role}"`,
    );
  }
}
