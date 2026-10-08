# Dynamic (database-managed) roles

> **Status: a design guide, not a feature.** The kit ships a **fixed** role enum plus a code-defined permission matrix, on purpose: it is simple, reviewable in a pull request and type-checked. Build dynamic roles only when customers must define their own roles at runtime. Nothing below is implemented or tested here.

## What is fixed today

| Piece | Where | Dynamic version |
| :-- | :-- | :-- |
| Role identity | Prisma enum `Role` (`superadmin`, `admin`, `user`) | `roles` table |
| Role order and hierarchy | `ROLE_LEVEL` in `src/auth/core/roles.ts` | `roles.level` integer |
| Who may do what | `PERMISSION_ROLES` in `src/rbac/permissions.ts` | `role_permissions` table |
| Which role a user has | `users.role` | `users.role_id` (or a `user_roles` join table for several) |
| Permission names | Strings used in `@Permissions('x.y')` | **Stay in code** |

Keep permission *names* in code. Routes reference them; a database-defined permission no route checks is meaningless, and a route checking a permission that is not in the database must be caught at boot, not by a user.

## Plan

**1. Schema.**

```prisma
model Role {
  id          String   @id @default(uuid()) @db.Uuid
  key         String   @unique            // 'admin', 'support_agent'...
  name        String
  level       Int                          // hierarchy: you may act only on strictly lower levels
  is_system   Boolean  @default(false)     // the three built-ins cannot be deleted or edited
  permissions RolePermission[]
  users       User[]
  @@map("roles")
}
model RolePermission {
  role_id    String @db.Uuid
  permission String                         // must be one of ALL_PERMISSIONS
  role       Role   @relation(fields: [role_id], references: [id], onDelete: Cascade)
  @@id([role_id, permission])
  @@map("role_permissions")
}
// User: replace `role Role` with `role_id String @db.Uuid` + relation
```

Migration: create the three built-in roles with their current levels (3, 2, 1) and the current matrix rows, set `users.role_id` from the old enum column, then drop the enum column. Do it in one reviewed migration.

**2. Code that changes.**

- `ROLE_LEVEL` / `levelOf` / `canActOn` / `assertCanActOnRole` / `assignableRoles` read the level from the loaded role instead of the constant map. They become functions of role *objects* (or load by id), so callers pass the role record, not a string.
- `AuthenticatedUser.role` becomes `{ key, level }` (and a permissions list, see below). `JwtAuthGuard` already reloads the user on each request: load the role and its permissions there.
- `PermissionsGuard` asks `request.user.permissions.includes(p)` instead of `can(role, p)`.
- `GET /rbac/permissions` returns the loaded permissions.
- `UsersService` (invite, update role): validate the target role exists and has a lower level than the actor; keep the "never on yourself" rule.
- The seed creates the built-in roles.

**3. Caching.** One extra query per request is acceptable at first (the guard already makes two). If it matters, cache `role_id -> { level, permissions }` in memory with a short TTL and invalidate on role edits (with several instances, use Redis pub/sub or accept a TTL-length delay). Bump `users.token_version` for affected users when a role's permissions change if you need immediate effect.

**4. Management API.** CRUD for roles (`roles.read`, `roles.manage` permissions in code), with rules: system roles are immutable; a role cannot be given a permission its editor does not hold; a role cannot be raised above the editor's level; deleting a role in use is a 409. Audit every change (`@Audited('roles.update', 'role')`).

**5. Tests.** Hierarchy and permission checks with custom roles; an editor cannot escalate; removing a permission takes effect on the next request (per-request verification is on) or after the cache TTL; the boot-time check that every `@Permissions` name is a known permission. Real PostgreSQL for the migration.

## Still true after the change

The fail-closed guard, the policy-coverage test and `npm run check:rbac-removable` keep working; update the latter's expectations if `src/auth/core/roles.ts` starts depending on `prisma`-loaded data in a way the removal script cannot strip.
