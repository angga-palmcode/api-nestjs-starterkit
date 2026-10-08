import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

/**
 * A setting the env validation guarantees for the chosen mode (e.g. `S3_BUCKET` when
 * `STORAGE_DRIVER=s3`). Throws a clear error if that guarantee is ever broken.
 */
export function requireEnv<K extends keyof Env>(
  config: ConfigService<Env, true>,
  key: K,
): NonNullable<Env[K]> {
  const value = config.get(key, { infer: true });
  if (value === undefined || value === null || value === '') {
    throw new Error(`${String(key)} is required but not set`);
  }
  return value;
}
