import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../../config/config.types';
import { safeEqual } from '../utils/timing-safe-equal.util';
import { operationIdFactory } from './operation-id';
import { findUndocumentedRoutes } from './route-documentation';
import { isSwaggerEnabled } from './swagger.setup';

describe('operationIdFactory', () => {
  it('builds <module>_<action> in snake_case', () => {
    expect(operationIdFactory('UsersController', 'listUsers')).toBe(
      'users_list_users',
    );
    expect(operationIdFactory('AuthMfaController', 'verifyTotp')).toBe(
      'auth_mfa_verify_totp',
    );
  });
});

describe('isSwaggerEnabled', () => {
  const config = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as AppConfigService;

  it('defaults to on outside production and off in production', () => {
    expect(isSwaggerEnabled(config({ NODE_ENV: 'development' }))).toBe(true);
    expect(isSwaggerEnabled(config({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('an explicit flag wins either way', () => {
    expect(
      isSwaggerEnabled(
        config({ NODE_ENV: 'production', SWAGGER_ENABLED: true }),
      ),
    ).toBe(true);
    expect(
      isSwaggerEnabled(
        config({ NODE_ENV: 'development', SWAGGER_ENABLED: false }),
      ),
    ).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('findUndocumentedRoutes', () => {
  @Controller('bad')
  class BadController {
    @Get('none')
    none() {
      return 1;
    }
    @ApiOperation({ summary: 'only operation' })
    @Get('half')
    half() {
      return 1;
    }
    @ApiOperation({ summary: 'both' })
    @ApiOkResponse({ description: 'ok' })
    @Get('full')
    full() {
      return 1;
    }
    helper() {
      return 1; // not a route
    }
  }

  it('reports routes missing @ApiOperation and/or a response decorator', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BadController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const found = findUndocumentedRoutes(app);
    await app.close();

    expect(found.map((f) => [f.route.split(' ')[0], f.missing])).toEqual([
      ['BadController.none', ['@ApiOperation', 'response decorator']],
      ['BadController.half', ['response decorator']],
    ]);
  });
});
