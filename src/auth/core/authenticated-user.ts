import type { Role } from '@prisma/client';

/**
 * The only thing the rest of the app knows about the caller; `JwtAuthGuard`
 * puts exactly this shape on `request.user`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  /** Session the access token belongs to (derived from the token, never from a header). */
  session_id: string;
}
