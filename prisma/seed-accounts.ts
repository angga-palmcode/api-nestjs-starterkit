import { Role } from '@prisma/client';

const MIN_PASSWORD_LENGTH = 12;

export interface SeedAccount {
  role: Role;
  name: string;
  email: string;
  password: string;
}

type Env = Record<string, string | undefined>;

export function accountsFromEnv(env: Env): SeedAccount[] {
  const accounts: SeedAccount[] = [];
  const defs: Array<[Role, string, string, boolean]> = [
    [Role.superadmin, 'Super Admin', 'SEED_SUPERADMIN', true],
    [Role.admin, 'Admin', 'SEED_ADMIN', false],
    [Role.user, 'User', 'SEED_USER', false],
  ];

  for (const [role, name, prefix, required] of defs) {
    const email = env[`${prefix}_EMAIL`]?.trim().toLowerCase();
    const password = env[`${prefix}_PASSWORD`];
    if (!email && !password) {
      if (required) {
        throw new Error(`${prefix}_EMAIL and ${prefix}_PASSWORD are required`);
      }
      continue;
    }
    if (!email || !password) {
      throw new Error(
        `${prefix}_EMAIL and ${prefix}_PASSWORD must be set together`,
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `${prefix}_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    accounts.push({ role, name, email, password });
  }
  return accounts;
}
