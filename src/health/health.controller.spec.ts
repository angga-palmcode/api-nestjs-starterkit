import type { Response } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

function fakeRes() {
  const status = jest.fn();
  return { res: { status } as unknown as Response, status };
}

describe('HealthController', () => {
  it('liveness is always ok', () => {
    expect(new HealthController(new HealthService()).liveness()).toEqual({
      status: 'ok',
    });
  });

  it('readiness returns ready with check details', async () => {
    const svc = new HealthService();
    svc.registerCheck('db', () => Promise.resolve());
    const { res, status } = fakeRes();
    await expect(new HealthController(svc).readiness(res)).resolves.toEqual({
      status: 'ready',
      checks: { db: 'up' },
    });
    expect(status).not.toHaveBeenCalled();
  });

  it('readiness sets 503 when a check fails', async () => {
    const svc = new HealthService();
    svc.registerCheck('db', () => Promise.reject(new Error('x')));
    const { res, status } = fakeRes();
    await expect(new HealthController(svc).readiness(res)).resolves.toEqual({
      status: 'unavailable',
      checks: { db: 'down' },
    });
    expect(status).toHaveBeenCalledWith(503);
  });

  it('readiness reports shutting_down', async () => {
    const svc = new HealthService();
    svc.beforeApplicationShutdown();
    const { res, status } = fakeRes();
    await expect(
      new HealthController(svc).readiness(res),
    ).resolves.toMatchObject({ status: 'shutting_down' });
    expect(status).toHaveBeenCalledWith(503);
  });
});
