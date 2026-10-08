import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { RequestWithUser } from '../auth/core/current-user.decorator';
import { requestContext } from '../common/request-context/request-context';
import { AuditService } from './audit.service';
import { AUDITED, AuditedOptions } from './audit.constants';

/** Writes the audit entry for handlers marked `@Audited(...)`, only when they succeed. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(
      AUDITED,
      context.getHandler(),
    );
    if (!options || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    return next.handle().pipe(
      tap((result: unknown) => {
        const params = req.params as Record<string, string | undefined>;
        this.audit.record({
          actor_id: req.user?.id,
          action: options.action,
          entity_type: options.entity_type,
          entity_id: params.id ?? idOf(result),
          ip: req.ip,
          user_agent: req.header('user-agent'),
          request_id: requestContext.getRequestId(),
        });
      }),
    );
  }
}

function idOf(result: unknown): string | undefined {
  if (result !== null && typeof result === 'object' && 'id' in result) {
    const id = result.id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
