import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import { AUDITED, AuditedOptions } from './audit.constants';

/**
 * Records an audit entry after the handler succeeds:
 * `@Audited('user.deactivate', 'user')`. The entity id is taken from the `:id`
 * route param, else from the returned object's `id`.
 */
export const Audited = (action: string, entity_type?: string) =>
  applyDecorators(
    SetMetadata(AUDITED, { action, entity_type } satisfies AuditedOptions),
    UseInterceptors(AuditInterceptor),
  );
