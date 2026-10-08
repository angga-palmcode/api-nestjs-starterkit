import { HealthService } from './health.service';

describe('HealthService', () => {
  it('is ready with no checks registered', async () => {
    await expect(new HealthService().readiness()).resolves.toEqual({
      ready: true,
      checks: {},
    });
  });

  it('reports each check and is not ready when one fails', async () => {
    const svc = new HealthService();
    svc.registerCheck('db', () => Promise.resolve());
    svc.registerCheck('cache', () => Promise.reject(new Error('down')));
    await expect(svc.readiness()).resolves.toEqual({
      ready: false,
      checks: { db: 'up', cache: 'down' },
    });
  });

  it('treats a hanging check as down', async () => {
    jest.useFakeTimers();
    try {
      const svc = new HealthService();
      svc.registerCheck('slow', () => new Promise<void>(() => undefined));
      const pending = svc.readiness();
      await jest.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toMatchObject({
        ready: false,
        checks: { slow: 'down' },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('is not ready once shutdown has begun', async () => {
    const svc = new HealthService();
    svc.beforeApplicationShutdown();
    expect(svc.isShuttingDown()).toBe(true);
    await expect(svc.readiness()).resolves.toMatchObject({ ready: false });
  });
});
