/**
 * Idempotent seed: `npm run seed`.
 *
 * Standalone script (outside the Nest app), so it reads the environment directly.
 *   SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD   required
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD             optional demo account
 *   SEED_USER_EMAIL / SEED_USER_PASSWORD               optional demo account
 *   SEED_RESET_PASSWORDS=true                          overwrite passwords of existing accounts
 *
 * Re-running never duplicates rows and never changes an existing account's password
 * unless SEED_RESET_PASSWORDS=true. Passwords are never printed.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';
import { accountsFromEnv } from './seed-accounts';

async function main(): Promise<void> {
  const accounts = accountsFromEnv(process.env);
  const reset = process.env.SEED_RESET_PASSWORDS === 'true';
  const prisma = new PrismaClient();

  try {
    for (const account of accounts) {
      const existing = await prisma.user.findUnique({
        where: { email: account.email },
      });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            role: account.role,
            is_active: true,
            deleted_at: null,
            email_verified_at: existing.email_verified_at ?? new Date(),
            ...(reset
              ? { password_hash: await hashPassword(account.password) }
              : {}),
          },
        });
        console.log(
          `updated ${account.role}: ${account.email}${reset ? ' (password reset)' : ''}`,
        );
      } else {
        await prisma.user.create({
          data: {
            email: account.email,
            name: account.name,
            role: account.role,
            password_hash: await hashPassword(account.password),
            email_verified_at: new Date(),
          },
        });
        console.log(`created ${account.role}: ${account.email}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
