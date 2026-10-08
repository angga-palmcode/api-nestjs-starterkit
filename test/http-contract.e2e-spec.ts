import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsEmail, ValidateNested } from 'class-validator';
import request from 'supertest';
import { paginated } from '../src/common/envelope/envelope.types';
import { AppException } from '../src/common/errors/app.exception';
import { ErrorCode } from '../src/common/errors/error-code';
import { Public } from '../src/auth/core/public.decorator';
import { createApp } from './helpers/create-app';

class AddressDto {
  @IsEmail()
  contact!: string;
}
class BodyDto {
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

@Public()
@Controller('contract')
class ContractController {
  @Get('one')
  one() {
    return { id: 1 };
  }
  @Get('null')
  nothing() {
    return null;
  }
  @Get('list')
  list() {
    return paginated([{ id: 1 }, { id: 2 }], {
      page: 1,
      page_size: 25,
      total: 2,
    });
  }
  @Get('empty-list')
  emptyList() {
    return paginated([], { page: 1, page_size: 25, total: 0 });
  }
  @Post('noop')
  @HttpCode(204)
  noop() {
    return undefined;
  }
  @Get('app-error')
  appError() {
    throw new AppException(ErrorCode.NOT_FOUND, 'Item not found');
  }
  @Get('conflict')
  conflict() {
    throw new ConflictException('Email already in use');
  }
  @Get('boom')
  boom() {
    throw new Error('secret database password leaked');
  }
  @Post('nested')
  nested(@Body() body: BodyDto) {
    return body;
  }
}

@Module({ controllers: [ContractController] })
class ContractModule {}

describe('HTTP contract (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app } = await createApp({ extraModules: [ContractModule] }));
  });
  afterAll(async () => {
    await app.close();
  });

  describe('success envelope', () => {
    it('wraps a single resource in { data }', async () => {
      await http()
        .get('/contract/one')
        .expect(200, { data: { id: 1 } });
    });
    it('wraps null as { data: null }', async () => {
      await http().get('/contract/null').expect(200, { data: null });
    });
    it('renders paginated results as { data, meta }', async () => {
      await http()
        .get('/contract/list')
        .expect(200, {
          data: [{ id: 1 }, { id: 2 }],
          meta: { current_page: 1, page_size: 25, total: 2, last_page: 1 },
        });
    });
    it('last_page is never below 1', async () => {
      const res = await http().get('/contract/empty-list').expect(200);
      expect((res.body as { meta: { last_page: number } }).meta.last_page).toBe(
        1,
      );
    });
    it('leaves 204 responses empty', async () => {
      const res = await http().post('/contract/noop').expect(204);
      expect(res.text).toBe('');
    });
  });

  describe('error shape', () => {
    it('renders AppException with request_id matching the header', async () => {
      const res = await http().get('/contract/app-error').expect(404);
      expect(res.body).toEqual({
        message: 'Item not found',
        error_code: 'NOT_FOUND',
        timestamp: expect.any(String) as string,
        request_id: res.headers['x-request-id'],
      });
    });
    it('maps framework exceptions by status', async () => {
      const res = await http().get('/contract/conflict').expect(409);
      expect(res.body).toMatchObject({
        error_code: 'CONFLICT',
        message: 'Email already in use',
      });
    });
    it('maps unknown routes to NOT_FOUND', async () => {
      const res = await http().get('/nope').expect(404);
      expect((res.body as { error_code: string }).error_code).toBe('NOT_FOUND');
    });
    it('hides internals of unexpected errors (500)', async () => {
      const res = await http().get('/contract/boom').expect(500);
      expect(res.body).toMatchObject({
        message: 'Internal server error',
        error_code: 'INTERNAL_ERROR',
      });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });
    it('returns 400 BAD_REQUEST for malformed JSON', async () => {
      const res = await http()
        .post('/contract/nested')
        .set('Content-Type', 'application/json')
        .send('{"address":')
        .expect(400);
      // Nest maps the parser's SyntaxError to BadRequestException(parser message).
      expect(res.body).toMatchObject({ error_code: 'BAD_REQUEST' });
    });
    it('returns 422 VALIDATION_ERROR with dotted field paths', async () => {
      const res = await http()
        .post('/contract/nested')
        .send({ address: { contact: 'nope' } })
        .expect(422);
      expect(res.body).toMatchObject({
        error_code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: [
          { field: 'address.contact', message: 'contact must be an email' },
        ],
      });
    });
  });
});
