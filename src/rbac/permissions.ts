import { Role } from '../auth/core/roles';

/**
 * THE permission matrix: permission -> roles that hold it (Blueprint A6). It is the only
 * place that says who may do what; guards, `GET /rbac/permissions` and tests all read it.
 *
 * To add a permission: add a row here and put `@Permissions('x.y')` on the route.
 * The role hierarchy (who may act on whom) is separate: see `auth/core/roles.ts`.
 */
export const PERMISSION_ROLES = {
  'users.read': [Role.admin, Role.superadmin],
  'users.invite': [Role.admin, Role.superadmin],
  'users.update': [Role.admin, Role.superadmin],
  'users.activate': [Role.admin, Role.superadmin],
  'users.deactivate': [Role.admin, Role.superadmin],
  'users.force_logout': [Role.admin, Role.superadmin],
  // Destructive: superadmin only.
  'users.delete': [Role.superadmin],
  // Reference module: every role may read (plain users only see published items, see
  // ExampleService), admins write.
  'example.read': [Role.user, Role.admin, Role.superadmin],
  'example.create': [Role.admin, Role.superadmin],
  'example.update': [Role.admin, Role.superadmin],
  'example.delete': [Role.admin, Role.superadmin],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSION_ROLES;

export const ALL_PERMISSIONS = Object.keys(PERMISSION_ROLES) as Permission[];

export const can = (role: Role, permission: Permission): boolean =>
  (PERMISSION_ROLES[permission] as readonly Role[]).includes(role);

export const permissionsOf = (role: Role): Permission[] =>
  ALL_PERMISSIONS.filter((permission) => can(role, permission));
