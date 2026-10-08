import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '../src/auth/core/jwt-auth.guard';
import {
  findUndocumentedRoutes,
  listPublicRoutes,
} from '../src/common/swagger/route-documentation';
import { createApp } from './helpers/create-app';

interface OpenApi {
  info: { title: string; version: string };
  paths: Record<string, Record<string, { operationId: string }>>;
}

describe('Swagger (e2e)', () => {
  let app: NestExpressApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('every route in the app is documented (@ApiOperation + a response decorator)', async () => {
    ({ app } = await createApp());
    expect(findUndocumentedRoutes(app)).toEqual([]);
  });

  it('serves the OpenAPI document with stable operation ids', async () => {
    ({ app } = await createApp({
      env: { APP_NAME: 'Test API', APP_VERSION: '9.9.9' },
    }));
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const doc = res.body as OpenApi;
    expect(doc.info).toMatchObject({ title: 'Test API', version: '9.9.9' });
    expect(doc.paths['/healthz'].get.operationId).toBe('health_liveness');
    expect(doc.paths['/readyz'].get.operationId).toBe('health_readiness');
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('documents an example for every state of the login state machine', async () => {
    ({ app } = await createApp());
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const doc = res.body as {
      paths: Record<
        string,
        Record<
          string,
          {
            responses: Record<
              string,
              {
                content: Record<string, { examples?: Record<string, unknown> }>;
              }
            >;
          }
        >
      >;
    };
    for (const path of ['/auth/login', '/auth/login/otp', '/auth/mfa/verify']) {
      const examples =
        doc.paths[path].post.responses['200'].content['application/json']
          .examples;
      expect(Object.keys(examples ?? {})).toEqual([
        'authenticated',
        'otp_required',
        'mfa_required_totp',
        'mfa_required_otp',
      ]);
    }
  });

  it('is disabled when SWAGGER_ENABLED=false', async () => {
    ({ app } = await createApp({ env: { SWAGGER_ENABLED: 'false' } }));
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });

  it('protects the docs with basic auth when credentials are configured', async () => {
    ({ app } = await createApp({
      env: { SWAGGER_USER: 'docs', SWAGGER_PASSWORD: 'long-enough-pw' },
    }));
    const server = app.getHttpServer();
    await request(server).get('/docs-json').expect(401);
    await request(server)
      .get('/docs-json')
      .auth('docs', 'wrong-password')
      .expect(401);
    await request(server)
      .get('/docs-json')
      .auth('docs', 'long-enough-pw')
      .expect(200);
  });

  describe('authentication coverage (every route guarded or explicitly @Public)', () => {
    // Adding a public route must be a conscious change: update this list in the same PR.
    const APPROVED_PUBLIC = [
      'AccountController.acceptInvite',
      'AccountController.forgotPassword',
      'AccountController.register',
      'AccountController.resendVerification',
      'AccountController.resetPassword',
      'AccountController.verifyEmail',
      'AuthController.login',
      'AuthController.refresh',
      'AuthController.verifyMfa',
      'AuthController.verifyOtp',
      'HealthController.liveness',
      'HealthController.readiness',
    ];

    it('the public routes are exactly the approved ones', async () => {
      ({ app } = await createApp());
      expect(listPublicRoutes(app)).toEqual(APPROVED_PUBLIC);
    });

    it('JwtAuthGuard is registered globally, so everything else needs a token', async () => {
      ({ app } = await createApp());
      const guard = app.get(JwtAuthGuard);
      expect(guard).toBeInstanceOf(JwtAuthGuard);
      // registered as APP_GUARD: an unauthenticated call to a non-public route is a 401
      await request(app.getHttpServer()).get('/users').expect(401);
      await request(app.getHttpServer()).get('/auth/me').expect(401);
      await request(app.getHttpServer())
        .post('/auth/mfa/totp/setup')
        .expect(401);
      expect(APP_GUARD).toBeDefined();
    });
  });
});
