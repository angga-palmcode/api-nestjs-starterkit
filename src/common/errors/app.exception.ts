import { HttpException } from '@nestjs/common';
import { ERROR_STATUS, ErrorCode } from './error-code';

export interface ErrorDetail {
  /** Dotted path of the offending input, e.g. `address.city`. */
  field?: string;
  message: string;
}

export interface AppExceptionOptions {
  /** Overrides the code's default HTTP status. */
  status?: number;
  /** Per-field details (validation failures). */
  errors?: ErrorDetail[];
}

/**
 * The one exception to throw for expected failures:
 * `throw new AppException(ErrorCode.NOT_FOUND, 'Item not found')`.
 * The global filter renders it as `{ message, error_code, timestamp, request_id, errors? }`.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly errors?: ErrorDetail[];

  constructor(
    code: ErrorCode,
    message: string,
    options: AppExceptionOptions = {},
  ) {
    super(message, options.status ?? ERROR_STATUS[code]);
    this.code = code;
    this.errors = options.errors;
  }
}
