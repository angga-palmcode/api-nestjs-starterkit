import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { AppLogger } from './app.logger';

@Global()
@Module({
  providers: [
    {
      provide: AppLogger,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AppLogger({
          level: config.get('LOG_LEVEL', { infer: true }),
          format:
            config.get('LOG_FORMAT', { infer: true }) ??
            (config.get('NODE_ENV', { infer: true }) === 'production'
              ? 'json'
              : 'pretty'),
        }),
    },
  ],
  exports: [AppLogger],
})
export class LoggerModule {}
