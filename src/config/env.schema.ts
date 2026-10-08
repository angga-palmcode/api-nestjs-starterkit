import { z } from 'zod';

/** Treat an empty string (`FOO=` in .env) as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const trustProxy = z
  .string()
  .default('false')
  .transform((v): boolean | number | string => {
    if (v === 'true') return true;
    if (v === 'false') return false;
    return /^\d+$/.test(v) ? Number(v) : v;
  });

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const boolString = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Boolean env with a default: `AUTH_X=true|false`. */
const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true');

export const AUTH_METHOD_VALUES = ['password', 'otp'] as const;
export type AuthMethod = (typeof AUTH_METHOD_VALUES)[number];

const authMethods = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z
    .string()
    .default('password')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(AUTH_METHOD_VALUES)).min(1))
    .refine((methods) => methods.includes('password'), {
      message: 'must include "password" (allowed: password | password,otp)',
    }),
);

/** Signing secrets: long, and never the documented placeholder in production (checked below). */
const secret = z.string().min(32, 'must be at least 32 characters');

/**
 * Single source of truth for environment variables. Every variable the app
 * reads must be declared here; reading `process.env` elsewhere is a lint error.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_NAME: z.string().min(1).default('Nest Starter Kit'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    APP_DESCRIPTION: z.string().default('REST API'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])
      .default('log'),
    /** Defaults to `json` in production and `pretty` otherwise. */
    LOG_FORMAT: optional(z.enum(['json', 'pretty'])),
    /** Express `trust proxy`: `true`, `false`, a hop count, or a CIDR/keyword list. */
    TRUST_PROXY: trustProxy,
    /** Comma-separated CORS allow-list. Empty disables CORS. `*` is rejected. */
    CORS_ORIGINS: csv,
    /** Forced exit if graceful shutdown takes longer than this (0 = no watchdog). */
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    /** Swagger UI at /docs. Unset = on except in production. */
    SWAGGER_ENABLED: optional(boolString),
    /** Optional basic auth for /docs; set both or neither. */
    SWAGGER_USER: optional(z.string().min(1)),
    SWAGGER_PASSWORD: optional(z.string().min(8)),
    /** `password` or `password,otp` (adds passwordless email-OTP login). */
    AUTH_METHODS: authMethods,
    /** Second factor after the primary login: none | totp | otp (email code). */
    AUTH_MFA: z.enum(['none', 'totp', 'otp']).default('none'),
    /** Block login until the email address is verified. */
    AUTH_REQUIRE_EMAIL_VERIFICATION: flag(true),
    /** Open self-registration (POST /auth/register). Default is invite-only. */
    AUTH_ALLOW_REGISTRATION: flag(false),
    /** Re-check the user (active, role, token_version, session) in the DB on every request. */
    AUTH_VERIFY_USER_PER_REQUEST: flag(true),
    /** How OTP codes and account emails are delivered. Defaults to `console` (dev only). */
    AUTH_DELIVERY: z.enum(['console', 'email']).default('console'),
    /** Three separate secrets: a leaked one must not forge the others (findings 3.9). */
    AUTH_ACCESS_SECRET: secret,
    AUTH_MFA_CHALLENGE_SECRET: secret,
    AUTH_EMAIL_VERIFY_SECRET: secret,
    /** base64 of 32 bytes; encrypts TOTP secrets at rest. Required when AUTH_MFA=totp. */
    AUTH_MFA_ENCRYPTION_KEY: optional(z.string().min(1)),
    /** bcrypt cost. 12 is a sound default; lower it only in tests. */
    AUTH_BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
    AUTH_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
    AUTH_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(1).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    AUTH_RESET_TTL_MINUTES: z.coerce.number().int().min(5).default(60),
    AUTH_EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().min(1).default(24),
    /** Request throttling (in-memory; Redis storage arrives with the optional modules). */
    THROTTLE_ENABLED: flag(true),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(100),
    THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    /** Optional mail module: `console` (dev) or `smtp` (nodemailer). */
    MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: optional(z.string().min(3)),
    SMTP_HOST: optional(z.string().min(1)),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    /** true = implicit TLS (usually port 465); false = STARTTLS when offered. */
    SMTP_SECURE: flag(false),
    SMTP_USER: optional(z.string().min(1)),
    SMTP_PASSWORD: optional(z.string().min(1)),
    /** Optional storage module: `local` (directory) or `s3` (S3-compatible). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./storage-data'),
    S3_BUCKET: optional(z.string().min(1)),
    S3_REGION: optional(z.string().min(1)),
    /** For S3-compatible services (MinIO, Backblaze B2, R2...). */
    S3_ENDPOINT: optional(z.string().url()),
    S3_ACCESS_KEY_ID: optional(z.string().min(1)),
    S3_SECRET_ACCESS_KEY: optional(z.string().min(1)),
    S3_FORCE_PATH_STYLE: flag(false),
    /** Optional jobs module: run scheduled jobs on THIS instance (enable on exactly one). */
    ENABLE_CRON: flag(false),
    /** The cleanup job deletes expired tokens/sessions older than this. */
    JOBS_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    /** PostgreSQL connection string (Prisma). Required: the app refuses to boot without it. */
    DATABASE_URL: z.string().min(1),
    /** Base URL of the frontend; used to build links in emails (invitations, resets). */
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    /** How long an invitation link stays valid. */
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).default(72),
    /** Optional; throttler storage / cache (fail-open when unset). */
    REDIS_URL: optional(z.string().min(1)),
  })
  .refine((env) => !env.CORS_ORIGINS.includes('*'), {
    path: ['CORS_ORIGINS'],
    message: 'wildcard "*" is not allowed; list explicit origins',
  })
  .refine(
    (env) =>
      new Set([
        env.AUTH_ACCESS_SECRET,
        env.AUTH_MFA_CHALLENGE_SECRET,
        env.AUTH_EMAIL_VERIFY_SECRET,
      ]).size === 3,
    {
      path: ['AUTH_ACCESS_SECRET'],
      message:
        'AUTH_ACCESS_SECRET, AUTH_MFA_CHALLENGE_SECRET and AUTH_EMAIL_VERIFY_SECRET must all differ',
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      ![
        env.AUTH_ACCESS_SECRET,
        env.AUTH_MFA_CHALLENGE_SECRET,
        env.AUTH_EMAIL_VERIFY_SECRET,
      ].some((s) => s.startsWith('change-me')),
    {
      path: ['AUTH_ACCESS_SECRET'],
      message:
        'placeholder "change-me..." secrets are not allowed in production',
    },
  )
  .refine(
    (env) => {
      const key = env.AUTH_MFA_ENCRYPTION_KEY;
      if (env.AUTH_MFA !== 'totp') return true;
      return !!key && Buffer.from(key, 'base64').length === 32;
    },
    {
      path: ['AUTH_MFA_ENCRYPTION_KEY'],
      message:
        'AUTH_MFA=totp requires AUTH_MFA_ENCRYPTION_KEY (base64 of 32 bytes, e.g. `openssl rand -base64 32`)',
    },
  )
  .refine(
    (env) => {
      const otpFlows =
        env.AUTH_METHODS.includes('otp') || env.AUTH_MFA === 'otp';
      return !(
        otpFlows &&
        env.NODE_ENV === 'production' &&
        env.AUTH_DELIVERY !== 'email'
      );
    },
    {
      path: ['AUTH_DELIVERY'],
      message:
        'OTP login/MFA in production needs AUTH_DELIVERY=email (the console sender cannot deliver codes)',
    },
  )
  .refine(
    (env) =>
      env.MAIL_TRANSPORT !== 'smtp' || (!!env.SMTP_HOST && !!env.MAIL_FROM),
    {
      path: ['SMTP_HOST'],
      message: 'MAIL_TRANSPORT=smtp requires SMTP_HOST and MAIL_FROM',
    },
  )
  .refine((env) => !env.SMTP_USER === !env.SMTP_PASSWORD, {
    path: ['SMTP_PASSWORD'],
    message: 'SMTP_USER and SMTP_PASSWORD must be set together',
  })
  .refine(
    (env) =>
      env.STORAGE_DRIVER !== 's3' ||
      (!!env.S3_BUCKET &&
        !!env.S3_REGION &&
        !!env.S3_ACCESS_KEY_ID &&
        !!env.S3_SECRET_ACCESS_KEY),
    {
      path: ['S3_BUCKET'],
      message:
        'STORAGE_DRIVER=s3 requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    },
  )
  .refine((env) => !env.SWAGGER_USER === !env.SWAGGER_PASSWORD, {
    path: ['SWAGGER_PASSWORD'],
    message: 'SWAGGER_USER and SWAGGER_PASSWORD must be set together',
  });

export type Env = z.infer<typeof envSchema>;

/** Used as `ConfigModule.forRoot({ validate })`. Throws (aborting boot) on invalid env. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
