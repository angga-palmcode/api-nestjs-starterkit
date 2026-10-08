import { createHash, randomBytes } from 'node:crypto';

/** 256-bit URL-safe random token for invitations, resets and refresh tokens. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hex digest. Tokens are high-entropy, so a fast hash is sufficient (and
 * lets us look a token up by hash). Never store the raw token; use bcrypt only for passwords.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
