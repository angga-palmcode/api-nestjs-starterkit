import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code';
import { AppLogger } from '../logger/app.logger';
import { requestContext } from '../request-context/request-context';
import { AllExceptionsFilter, ErrorBody } from './all-exceptions.filter';

function setup(overrides: { headersSent?: boolean; type?: string } = {}) {
  const json = jest.fn((_body: ErrorBody) => undefined);
  const status = jest.fn(() => ({ json }));
  const res = { headersSent: overrides.headersSent ?? false, status };
  const req = { method: 'GET', originalUrl: '/things?token=secret' };
  const host = {
    getType: () => overrides.type ?? 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const error = jest.fn();
  const report = jest.fn();
  const filter = new AllExceptionsFilter({ error } as unknown as AppLogger, {
    report,
  });
  const body = () => json.mock.calls[0][0];
  return { filter, host, status, json, body, error, report };
}

describe('AllExceptionsFilter', () => {
  it('renders AppException with its code, status and field errors', () => {
    const { filter, host, status, body } = setup();
    filter.catch(
      new AppException(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
        errors: [{ field: 'email', message: 'bad' }],
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(422);
    expect(body()).toMatchObject({
      message: 'Validation failed',
      error_code: 'VALIDATION_ERROR',
      errors: [{ field: 'email', message: 'bad' }],
    });
    expect(new Date(body().timestamp).toString()).not.toBe('Invalid Date');
  });

  it('omits errors when empty and includes the request id from context', () => {
    const { filter, host, body } = setup();
    requestContext.run({ request_id: 'req-12345678' }, () =>
      filter.catch(new AppException(ErrorCode.CONFLICT, 'dup'), host),
    );
    expect(body().request_id).toBe('req-12345678');
    expect(body()).not.toHaveProperty('errors');
  });

  it('maps HttpException by status and joins message arrays', () => {
    const a = setup();
    a.filter.catch(new ForbiddenException('nope'), a.host);
    expect(a.status).toHaveBeenCalledWith(403);
    expect(a.body()).toMatchObject({
      error_code: 'FORBIDDEN',
      message: 'nope',
    });

    const b = setup();
    b.filter.catch(new BadRequestException(['a is bad', 'b is bad']), b.host);
    expect(b.body().message).toBe('a is bad; b is bad');
  });

  it('hides HttpException details at 5xx and reports them', () => {
    const { filter, host, body, report, error } = setup();
    filter.catch(new ServiceUnavailableException('db at 10.0.0.5 down'), host);
    expect(body()).toMatchObject({
      error_code: 'SERVICE_UNAVAILABLE',
      message: 'Internal server error',
    });
    expect(error).toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.any(ServiceUnavailableException),
      expect.objectContaining({ path: '/things', status: 503 }),
    );
  });

  it('turns unknown errors into a generic 500 and never leaks the message', () => {
    const { filter, host, status, body, report } = setup();
    filter.catch(new Error('connection string postgres://u:p@h'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(body()).toMatchObject({
      error_code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body())).not.toContain('postgres');
    expect(report).toHaveBeenCalled();
  });

  it('handles non-Error throwables', () => {
    const { filter, host, status } = setup();
    filter.catch('a string', host);
    expect(status).toHaveBeenCalledWith(500);
    filter.catch(null, host);
  });

  it('maps body-parser style errors without leaking parser messages', () => {
    const a = setup();
    a.filter.catch(
      Object.assign(new SyntaxError('Unexpected token } in JSON'), {
        status: 400,
        type: 'entity.parse.failed',
      }),
      a.host,
    );
    expect(a.body()).toMatchObject({
      error_code: 'BAD_REQUEST',
      message: 'Malformed JSON body',
    });

    const b = setup();
    b.filter.catch(
      Object.assign(new Error('too big'), { statusCode: 413 }),
      b.host,
    );
    expect(b.body()).toMatchObject({
      error_code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body too large',
    });

    const c = setup();
    c.filter.catch(Object.assign(new Error('x'), { status: 418 }), c.host);
    expect(c.body().message).toBe('Bad request');
  });

  it('ignores non-http contexts and already-sent responses', () => {
    const rpc = setup({ type: 'rpc' });
    rpc.filter.catch(new Error('x'), rpc.host);
    expect(rpc.status).not.toHaveBeenCalled();

    const sent = setup({ headersSent: true });
    sent.filter.catch(new Error('x'), sent.host);
    expect(sent.status).not.toHaveBeenCalled();
  });
});
