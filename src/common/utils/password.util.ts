import { compare, hash } from 'bcryptjs';

export const DEFAULT_BCRYPT_ROUNDS = 12;

/** bcrypt (pure JS implementation, no native build). Also used by the seed script. */
export function hashPassword(
  plain: string,
  rounds: number = DEFAULT_BCRYPT_ROUNDS,
): Promise<string> {
  return hash(plain, rounds);
}

export function verifyPassword(
  plain: string,
  hashed: string,
): Promise<boolean> {
  return compare(plain, hashed);
}
