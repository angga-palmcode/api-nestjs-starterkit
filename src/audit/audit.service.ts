import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../common/logger/app.logger';
import { requestContext } from '../common/request-context/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Null for system actions or anonymous attempts. */
  actor_id?: string | null;
  /** Dotted verb, e.g. `user.deactivate`. */
  action: string;
  entity_type?: string;
  entity_id?: string;
  /** Small, non-sensitive context. Never put passwords, tokens or request bodies here. */
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  user_agent?: string;
  request_id?: string;
}

/**
 * Audit trail writer. `record()` is fire-and-forget and can never fail the
 * request (awaiting an unguarded insert would let an audit failure break the request); `log()` is the awaitable form used by tests.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  record(entry: AuditEntry): void {
    void this.log(entry);
  }

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor_id: entry.actor_id ?? null,
          action: entry.action,
          entity_type: entry.entity_type,
          entity_id: entry.entity_id,
          metadata: entry.metadata,
          ip: entry.ip,
          user_agent: entry.user_agent,
          request_id: entry.request_id ?? requestContext.getRequestId(),
        },
      });
    } catch (error) {
      this.logger.warn(
        {
          message: 'audit_write_failed',
          action: entry.action,
          error: error instanceof Error ? error.message : String(error),
        },
        'Audit',
      );
    }
  }
}
