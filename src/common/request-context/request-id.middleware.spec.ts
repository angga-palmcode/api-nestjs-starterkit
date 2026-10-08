import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { createRequestIdMiddleware } from './request-id.middleware';
import { requestContext } from './request-context';

function fakes(headers: Record<string, string> = {}, url = '/things?token=s3') {
  const req = {
    method: 'GET',
    originalUrl: url,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const setHeader = jest.fn((_name: string, _value: string) => undefined);
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader,
  }) as unknown as Response & EventEmitter;
  return { req, res, setHeader };
}

describe('request id middleware', () => {
  const logger = {
    log: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
  const middleware = createRequestIdMiddleware(logger);

  beforeEach(() => jest.clearAllMocks());

  it('generates an id, sets the header and exposes it via context', () => {
    const { req, res, setHeader } = fakes();
    let seen: string | undefined;
    middleware(req, res, () => {
      seen = requestContext.getRequestId();
    });
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', seen);
  });

  it('honours a safe incoming id', () => {
    const { req, res } = fakes({ 'x-request-id': 'abc12345-trace' });
    let seen: string | undefined;
    middleware(req, res, () => {
      seen = requestContext.getRequestId();
    });
    expect(seen).toBe('abc12345-trace');
  });

  it('replaces an unsafe incoming id', () => {
    const { req, res, setHeader } = fakes({
      'x-request-id': 'bad id\nforged=1',
    });
    middleware(req, res, () => undefined);
    expect(setHeader.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs completion without the query string', () => {
    const { req, res } = fakes();
    middleware(req, res, () => undefined);
    res.emit('finish');
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'http_request',
        path: '/things',
        status: 200,
      }),
      'HTTP',
    );
  });

  it('logs health probes at debug level', () => {
    const { req, res } = fakes({}, '/healthz');
    middleware(req, res, () => undefined);
    res.emit('finish');
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });
});
