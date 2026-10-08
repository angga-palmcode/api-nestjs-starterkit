import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { PaginatedResult } from './envelope.types';
import { SKIP_ENVELOPE } from './skip-envelope.decorator';

/**
 * Wraps every success body as `{ data }` (lists as `{ data, meta }`).
 * `undefined` (e.g. 204) stays empty; streams/buffers and `@SkipEnvelope()` routes are untouched.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(
      SKIP_ENVELOPE,
      [context.getHandler(), context.getClass()],
    );
    if (context.getType() !== 'http' || skip) return next.handle();

    return next.handle().pipe(
      map((value: unknown) => {
        if (value === undefined) return value;
        if (value instanceof StreamableFile || Buffer.isBuffer(value)) {
          return value;
        }
        if (value instanceof PaginatedResult) {
          return { data: value.data, meta: value.meta };
        }
        return { data: value };
      }),
    );
  }
}
