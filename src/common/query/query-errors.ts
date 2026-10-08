import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code';

/** A query parameter has a bad value (400 INVALID_QUERY). `field` is how the client wrote it, e.g. `filter[status]`. */
export const invalidQuery = (field: string, message: string): AppException =>
  new AppException(ErrorCode.INVALID_QUERY, 'Invalid query parameters', {
    errors: [{ field, message }],
  });

/** A parameter name is not whitelisted (400 UNKNOWN_FILTER / UNKNOWN_SORT / UNKNOWN_INCLUDE). */
export const unknownParameter = (
  code:
    | ErrorCode.UNKNOWN_FILTER
    | ErrorCode.UNKNOWN_SORT
    | ErrorCode.UNKNOWN_INCLUDE,
  field: string,
  what: string,
  allowed: readonly string[],
): AppException =>
  new AppException(code, 'Invalid query parameters', {
    errors: [
      {
        field,
        message: `${what} is not allowed. Allowed: ${allowed.join(', ') || '(none)'}`,
      },
    ],
  });
