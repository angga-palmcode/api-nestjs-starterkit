import { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';

// Metadata keys written by @nestjs/swagger (its constants module is not exported).
const DECORATORS = {
  API_OPERATION: 'swagger/apiOperation',
  API_RESPONSE: 'swagger/apiResponse',
  API_EXCLUDE_ENDPOINT: 'swagger/apiExcludeEndpoint',
  API_EXCLUDE_CONTROLLER: 'swagger/apiExcludeController',
} as const;

export interface UndocumentedRoute {
  route: string;
  missing: Array<'@ApiOperation' | 'response decorator'>;
}

/**
 * Lists every route handler that lacks `@ApiOperation` or any response decorator
 * (`@ApiOkEnvelope`, `@ApiOkResponse`, ...). Controllers/routes hidden with
 * `@ApiExcludeController/@ApiExcludeEndpoint` are skipped. Used by the
 * "every route is documented" test (Blueprint A8).
 */
/** `Controller.handler` of every route marked `@Public()` (on the handler or its controller). */
export function listPublicRoutes(app: INestApplication): string[] {
  const scanner = new MetadataScanner();
  const result: string[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller?.prototype) continue;
      const proto = controller.prototype as Record<string, object>;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined)
          continue;
        if (
          Reflect.getMetadata('is_public', handler) ||
          Reflect.getMetadata('is_public', controller)
        ) {
          result.push(`${controller.name}.${name}`);
        }
      }
    }
  }
  return result.sort();
}

export function findUndocumentedRoutes(
  app: INestApplication,
): UndocumentedRoute[] {
  const scanner = new MetadataScanner();
  const result: UndocumentedRoute[] = [];

  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller?.prototype) continue;
      if (Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, controller)) {
        continue;
      }
      const base = (Reflect.getMetadata(PATH_METADATA, controller) ??
        '') as string;

      const proto = controller.prototype as Record<string, object>;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        const verb: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue; // not a route
        if (Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, handler)) {
          continue;
        }
        const meta = (key: string): unknown =>
          Reflect.getMetadata(key, handler) ??
          Reflect.getMetadata(key, controller);

        const missing: UndocumentedRoute['missing'] = [];
        if (!meta(DECORATORS.API_OPERATION)) missing.push('@ApiOperation');
        if (!meta(DECORATORS.API_RESPONSE)) missing.push('response decorator');
        if (missing.length) {
          result.push({
            route: `${controller.name}.${name} (/${base})`,
            missing,
          });
        }
      }
    }
  }
  return result;
}
