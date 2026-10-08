import { Body, Controller, Module, Post } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Public } from '../src/auth/core/public.decorator';
import { createApp } from './helpers/create-app';

class EchoDto {
  @IsEmail()
  email!: string;
}

@Public()
@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: EchoDto) {
    return body;
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('App bootstrap (e2e)', () => {
  let app: NestExpressApplication;
  let health: Awaited<ReturnType<typeof createApp>>['health'];

  const boot = async (env: Record<string, string> = {}) => {
    ({ app, health } = await createApp({ env, extraModules: [EchoModule] }));
    return app;
  };

  afterEach(async () => {
    await app?.close();
  });

  it('GET /healthz -> 200 plain body (no envelope)', async () => {
    await boot();
    await request(app.getHttpServer())
      .get('/healthz')
      .expect(200, { status: 'ok' });
  });

  it('GET /readyz -> 200 with no checks, 503 when a check fails', async () => {
    await boot();
    await request(app.getHttpServer())
      .get('/readyz')
      .expect(200, { status: 'ready', checks: {} });

    health.registerCheck('db', () => Promise.reject(new Error('x')));
    const res = await request(app.getHttpServer()).get('/readyz').expect(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { db: 'down' } });
  });

  it('sets security headers and a request id', async () => {
    await boot();
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends a CSP; `upgrade-insecure-requests` only in production (keeps Swagger UI working over http in dev)', async () => {
    await boot();
    const dev = await request(app.getHttpServer()).get('/healthz');
    expect(dev.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(dev.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
    await app.close();

    await boot({ NODE_ENV: 'production' });
    const prod = await request(app.getHttpServer()).get('/healthz');
    expect(prod.headers['content-security-policy']).toContain(
      'upgrade-insecure-requests',
    );
  });

  it('echoes a safe incoming request id', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('X-Request-ID', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('disables CORS when no origins are configured', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows only listed CORS origins', async () => {
    await boot({ CORS_ORIGINS: 'https://app.example.com' });
    const ok = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'https://app.example.com');
    expect(ok.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    const bad = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'https://evil.example.com');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validation pipe: 422 on invalid body and on unknown properties', async () => {
    await boot();
    await request(app.getHttpServer())
      .post('/echo')
      .send({ email: 'nope' })
      .expect(422);
    await request(app.getHttpServer())
      .post('/echo')
      .send({ email: 'a@example.com', extra: 1 })
      .expect(422);
    await request(app.getHttpServer())
      .post('/echo')
      .send({ email: 'a@example.com' })
      .expect(201, { data: { email: 'a@example.com' } });
  });
});
