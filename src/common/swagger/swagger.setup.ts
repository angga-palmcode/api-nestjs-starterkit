import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfigService } from '../../config/config.types';
import { AppLogger } from '../logger/app.logger';
import { safeEqual } from '../utils/timing-safe-equal.util';
import { operationIdFactory } from './operation-id';

export const SWAGGER_PATH = 'docs';

/** Explicit `SWAGGER_ENABLED` wins; otherwise on everywhere except production. */
export function isSwaggerEnabled(config: AppConfigService): boolean {
  return (
    config.get('SWAGGER_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'production'
  );
}

export function basicAuth(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      // Evaluate both so timing does not reveal which part was wrong.
      const userOk = safeEqual(decoded.slice(0, i), user);
      const passOk = safeEqual(decoded.slice(i + 1), password);
      if (i >= 0 && userOk && passOk) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="API docs"');
    res.status(401).send('Authentication required');
  };
}

/** Mounts Swagger UI at `/docs` and the JSON at `/docs-json` (optionally behind basic auth). */
export function setupSwagger(
  app: NestExpressApplication,
  config: AppConfigService,
  logger: AppLogger,
): void {
  if (!isSwaggerEnabled(config)) return;

  const user = config.get('SWAGGER_USER', { infer: true });
  const password = config.get('SWAGGER_PASSWORD', { infer: true });
  if (user && password) {
    app.use(
      [`/${SWAGGER_PATH}`, `/${SWAGGER_PATH}-json`],
      basicAuth(user, password),
    );
  } else if (config.get('NODE_ENV', { infer: true }) === 'production') {
    logger.warn(
      'Swagger is enabled in production without SWAGGER_USER/SWAGGER_PASSWORD',
      'Swagger',
    );
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(config.get('APP_NAME', { infer: true }))
      .setVersion(config.get('APP_VERSION', { infer: true }))
      .setDescription(config.get('APP_DESCRIPTION', { infer: true }))
      .addBearerAuth()
      .build(),
    { operationIdFactory },
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
