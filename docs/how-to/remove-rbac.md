# Remove RBAC

The `src/rbac/` module is optional. Auth keeps working without it because the core only knows `AuthenticatedUser.role`; the role model and hierarchy live in `src/auth/core/roles.ts`, not in `rbac/`.

## Steps

1. Delete the folder `src/rbac/`.
2. In `src/app.module.ts`, remove the `RbacModule` import and its entry in `imports`.
3. Remove every `@Permissions('...')` / `@Roles(...)` decorator line and its import from `../rbac/rbac.decorators`. Each one is a single line on purpose, so this is a mechanical search-and-delete.
4. `npm run typecheck` and `npm test`. Delete tests that exercise `/rbac/permissions`, the permission matrix or the 403-by-permission cases (`test/rbac.e2e-spec.ts`, the `users.delete` case in `test/users.e2e-spec.ts`).

`npm run check:rbac-removable` performs steps 1 to 3 on a temporary copy and type-checks it. CI runs it, so the removal path cannot rot.

## What changes in behaviour

- **Routes are no longer authorization-checked by role or permission.** Any signed-in user can call any non-`@Public` route. The fail-closed rule ("a route without a declared policy is denied") disappears with the guard.
- **User management keeps two safeguards** because they live in `UsersService`, not in the guard: only admin-level users may manage users, and nobody may act on themselves or on someone at or above their own role (`src/auth/core/roles.ts`). The finer split (for example "only superadmin deletes") disappears with the matrix.
- Anything you protected with `@Permissions` in your own modules becomes open to every authenticated user. Replace it with your own guard before removing the module.
- `@Authenticated()` stays harmless: it is only a marker.

## Keeping RBAC but changing roles

Roles are the Prisma enum `Role` (`prisma/schema.prisma`). A new role needs: the enum value (plus a migration), a level in `ROLE_LEVEL` (`src/auth/core/roles.ts`, the compiler forces this), and rows in `PERMISSION_ROLES` (`src/rbac/permissions.ts`). Fully dynamic, database-managed roles are out of scope for the kit (see [dynamic-roles.md](dynamic-roles.md)).
