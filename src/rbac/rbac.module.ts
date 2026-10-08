import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { RbacController } from './rbac.controller';

/**
 * Optional module (Blueprint A6). Deleting `src/rbac/` is supported: see docs/how-to/remove-rbac.md,
 * verified by `npm run check:rbac-removable`. Import it AFTER `AuthModule` so its guard runs
 * after the JWT guard.
 */
@Module({
  controllers: [RbacController],
  providers: [
    PermissionsGuard,
    // `useExisting` lets tests override PermissionsGuard.
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class RbacModule {}
