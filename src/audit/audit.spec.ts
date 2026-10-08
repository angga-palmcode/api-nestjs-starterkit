import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { AppLogger } from '../common/logger/app.logger';
import { requestContext } from '../common/request-context/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaMock } from '../../test/helpers/prisma-mock';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const warn = jest.fn();
  const make = () => {
    const prisma = createPrismaMock();
    const service = new AuditService(
      prisma as unknown as PrismaService,
      { warn } as unknown as AppLogger,
    );
    return { prisma, service };
  };

  beforeEach(() => warn.mockClear());

  it('writes an entry', async () => {
    const { prisma, service } = make();
    await service.log({
      actor_id: 'u-1',
      action: 'user.update',
      entity_type: 'user',
      entity_id: 'e-1',
      ip: '10.0.0.1',
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_id: 'u-1',
        action: 'user.update',
        entity_type: 'user',
        entity_id: 'e-1',
        ip: '10.0.0.1',
      }) as object,
    });
  });

  it('stamps the current request id when none is given', async () => {
    const { prisma, service } = make();
    await requestContext.run({ request_id: 'req-abcdef12' }, () =>
      service.log({ action: 'auth.login' }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ request_id: 'req-abcdef12' }) as object,
    });
  });

  it('anonymous actions store a null actor', async () => {
    const { prisma, service } = make();
    await service.log({ action: 'auth.login_failed' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actor_id: null }) as object,
    });
  });

  it('never throws when the insert fails (logs a warning instead)', async () => {
    const { prisma, service } = make();
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.log({ action: 'x' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'audit_write_failed', action: 'x' }),
      'Audit',
    );
  });

  it('record() is fire-and-forget and swallows failures', async () => {
    const { prisma, service } = make();
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    expect(() => service.record({ action: 'x' })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalled();
  });
});

describe('AuditInterceptor', () => {
  const record = jest.fn<void, [Record<string, unknown>]>();
  const run = async (
    options: object | undefined,
    result: unknown,
    req: object = {},
  ) => {
    const reflector = { get: () => options } as unknown as Reflector;
    const interceptor = new AuditInterceptor(reflector, {
      record,
    } as unknown as AuditService);
    const ctx = {
      getType: () => 'http',
      getHandler: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          params: {},
          ip: '10.0.0.9',
          header: () => 'jest-agent',
          ...req,
        }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(result) };
    return lastValueFrom(interceptor.intercept(ctx, next));
  };

  beforeEach(() => record.mockClear());

  it('records after success with actor, entity id from the route param and request id', async () => {
    await requestContext.run({ request_id: 'req-12345678' }, () =>
      run(
        { action: 'user.deactivate', entity_type: 'user' },
        { id: 'ignored' },
        {
          user: { id: 'actor-1' },
          params: { id: 'target-1' },
        },
      ),
    );
    expect(record).toHaveBeenCalledWith({
      actor_id: 'actor-1',
      action: 'user.deactivate',
      entity_type: 'user',
      entity_id: 'target-1',
      ip: '10.0.0.9',
      user_agent: 'jest-agent',
      request_id: 'req-12345678',
    });
  });

  it('falls back to the id of the returned object', async () => {
    await run({ action: 'user.invite' }, { id: 'inv-1' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: 'inv-1', actor_id: undefined }),
    );
  });

  it('tolerates results without an id', async () => {
    await run({ action: 'a' }, undefined);
    await run({ action: 'a' }, { id: 42 });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0]).toMatchObject({ entity_id: undefined });
    expect(record.mock.calls[1][0]).toMatchObject({ entity_id: undefined });
  });

  it('does nothing for routes without @Audited', async () => {
    await run(undefined, { id: 'x' });
    expect(record).not.toHaveBeenCalled();
  });
});
