import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { setupSwagger } from './common/swagger/swagger.setup';
import { AppLogger } from './common/logger/app.logger';
import {
  REQUEST_ID_HEADER,
  createRequestIdMiddleware,
} from './common/request-context/request-id.middleware';
import { Env } from './config/env.schema';

/**
 * Everything that configures the HTTP app beyond module wiring. Shared by
 * `main.ts` and the e2e tests so tests exercise the real pipeline.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = app.get(AppLogger);

  app.useLogger(logger);
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  // Express 5 defaults to the flat parser; the query builder needs `filter[x]=y` as nested objects.
  app.set('query parser', 'extended');

  // First, so every later middleware, guard and log line sees the request id.
  app.use(createRequestIdMiddleware(logger));
  app.use(helmet());

  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    // Empty allow-list => CORS disabled (no Access-Control-* headers at all).
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  app.useGlobalPipes(createValidationPipe());
  setupSwagger(app, config, logger);

  app.enableShutdownHooks();
}
