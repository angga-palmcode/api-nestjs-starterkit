import type { Request, Response } from 'express';
import { basicAuth } from './swagger.setup';

function run(authorization?: string) {
  const req = { header: () => authorization } as unknown as Request;
  const setHeader = jest.fn();
  const send = jest.fn();
  const status = jest.fn(() => ({ send }));
  const res = { setHeader, status } as unknown as Response;
  const next = jest.fn();
  basicAuth('docs', 'long-enough-pw')(req, res, next);
  return { next, status, setHeader };
}

const basic = (creds: string) =>
  `Basic ${Buffer.from(creds).toString('base64')}`;

describe('swagger basicAuth', () => {
  it('lets correct credentials through', () => {
    const { next, status } = run(basic('docs:long-enough-pw'));
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('supports colons inside the password', () => {
    const middleware = basicAuth('docs', 'pw:with:colons');
    const next = jest.fn();
    middleware(
      { header: () => basic('docs:pw:with:colons') } as unknown as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Bearer abc'],
    ['scheme without credentials', 'Basic'],
    ['wrong password', basic('docs:nope')],
    ['wrong user', basic('other:long-enough-pw')],
    ['no colon', basic('docslong-enough-pw')],
  ])('rejects: %s', (_label, header) => {
    const { next, status, setHeader } = run(header);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Basic'),
    );
  });
});
