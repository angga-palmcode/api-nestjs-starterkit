import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { requireEnv } from '../config/require-env';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { STORAGE } from './storage.types';

/**
 * Optional module: provides `STORAGE` (inject with `@Inject(STORAGE) storage: StorageService`),
 * selected by `STORAGE_DRIVER`. Nothing else in the kit depends on it, so `src/storage/` can
 * be deleted (docs/how-to/optional-modules.md).
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        if (config.get('STORAGE_DRIVER', { infer: true }) === 's3') {
          // Presence of these is guaranteed by the env validation (STORAGE_DRIVER=s3).
          const client = new S3Client({
            region: requireEnv(config, 'S3_REGION'),
            endpoint: config.get('S3_ENDPOINT', { infer: true }),
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
            credentials: {
              accessKeyId: requireEnv(config, 'S3_ACCESS_KEY_ID'),
              secretAccessKey: requireEnv(config, 'S3_SECRET_ACCESS_KEY'),
            },
          });
          return new S3Storage(client, requireEnv(config, 'S3_BUCKET'));
        }
        return new LocalStorage(
          config.get('STORAGE_LOCAL_DIR', { infer: true }),
        );
      },
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
