import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ONLY = 'authenticated_only';

/**
 * Declares that any signed-in user may call the route (`/auth/me`, logout, ...).
 * With the RBAC module installed every route must declare its access policy
 * (`@Public`, `@Authenticated`, `@Roles` or `@Permissions`), otherwise it is denied.
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_ONLY, true);
