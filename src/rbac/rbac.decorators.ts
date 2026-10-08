import { SetMetadata } from '@nestjs/common';
import type { Role } from '../auth/core/roles';
import type { Permission } from './permissions';

export const ROLES_KEY = 'rbac_roles';
export const PERMISSIONS_KEY = 'rbac_permissions';

/** Allow only these roles: `@Roles(Role.admin)`. Prefer `@Permissions` (it reads the matrix). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Require every listed permission: `@Permissions('users.read')`. Keep it on ONE line (see docs/how-to/remove-rbac). */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
