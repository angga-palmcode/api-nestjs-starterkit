import { HttpStatus } from '@nestjs/common';

/** Every `error_code` the API can return. Add new codes here (see docs/how-to/add-error-code). */
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  INVALID_QUERY = 'INVALID_QUERY',
  UNKNOWN_FILTER = 'UNKNOWN_FILTER',
  UNKNOWN_SORT = 'UNKNOWN_SORT',
  UNKNOWN_INCLUDE = 'UNKNOWN_INCLUDE',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_TOKEN = 'INVALID_TOKEN',
  INVALID_CODE = 'INVALID_CODE',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

/** Default HTTP status for each code (an `AppException` may override it). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ErrorCode.INVALID_QUERY]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNKNOWN_FILTER]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNKNOWN_SORT]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNKNOWN_INCLUDE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.VALIDATION_ERROR]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.INVALID_TOKEN]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.INVALID_CODE]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.EMAIL_NOT_VERIFIED]: HttpStatus.FORBIDDEN,
  [ErrorCode.ACCOUNT_DISABLED]: HttpStatus.FORBIDDEN,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.PAYLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.SERVICE_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
};

/** Best-effort mapping for exceptions that carry only an HTTP status. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 422:
      return ErrorCode.VALIDATION_ERROR;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
  }
}
