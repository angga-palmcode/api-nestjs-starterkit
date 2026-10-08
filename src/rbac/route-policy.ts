import { INestApplication } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { AUTHENTICATED_ONLY } from '../auth/core/authenticated.decorator';
import { IS_PUBLIC } from '../auth/core/public.decorator';
import { PERMISSIONS_KEY, ROLES_KEY } from './rbac.decorators';

/**
 * Routes that declare no access policy (`@Public`, `@Authenticated`, `@Roles`,
 * `@Permissions`). At runtime the guard denies them; this lets CI catch the mistake
 * before it ships (asserted empty in `test/rbac.e2e-spec.ts`).
 */
export function findRoutesWithoutPolicy(app: INestApplication): string[] {
  const scanner = new MetadataScanner();
  const keys = [IS_PUBLIC, AUTHENTICATED_ONLY, ROLES_KEY, PERMISSIONS_KEY];
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
        const declared = keys.some(
          (key) =>
            Reflect.getMetadata(key, handler) !== undefined ||
            Reflect.getMetadata(key, controller) !== undefined,
        );
        if (!declared) result.push(`${controller.name}.${name}`);
      }
    }
  }
  return result.sort();
}
