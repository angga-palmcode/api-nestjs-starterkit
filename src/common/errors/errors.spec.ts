import { AppException } from './app.exception';
import { ERROR_STATUS, ErrorCode, codeForStatus } from './error-code';

describe('error codes', () => {
  it('every code has a default status', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_STATUS[code]).toEqual(expect.any(Number));
    }
  });

  it.each([
    [400, ErrorCode.BAD_REQUEST],
    [401, ErrorCode.UNAUTHENTICATED],
    [403, ErrorCode.FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [409, ErrorCode.CONFLICT],
    [413, ErrorCode.PAYLOAD_TOO_LARGE],
    [422, ErrorCode.VALIDATION_ERROR],
    [429, ErrorCode.RATE_LIMITED],
    [500, ErrorCode.INTERNAL_ERROR],
    [502, ErrorCode.INTERNAL_ERROR],
    [503, ErrorCode.SERVICE_UNAVAILABLE],
    [418, ErrorCode.BAD_REQUEST],
  ])('maps status %i to %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe('AppException', () => {
  it('uses the default status of its code', () => {
    const e = new AppException(ErrorCode.NOT_FOUND, 'nope');
    expect(e.getStatus()).toBe(404);
    expect(e.code).toBe(ErrorCode.NOT_FOUND);
    expect(e.message).toBe('nope');
  });

  it('accepts a status override and field errors', () => {
    const e = new AppException(ErrorCode.BAD_REQUEST, 'x', {
      status: 418,
      errors: [{ field: 'a', message: 'bad' }],
    });
    expect(e.getStatus()).toBe(418);
    expect(e.errors).toEqual([{ field: 'a', message: 'bad' }]);
  });
});
