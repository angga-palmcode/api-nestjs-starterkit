import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException, ErrorDetail } from '../errors/app.exception';
import { ErrorCode, codeForStatus } from '../errors/error-code';
import { ERROR_REPORTER } from '../errors/error-reporter';
import type { ErrorReporter } from '../errors/error-reporter';
import { AppLogger } from '../logger/app.logger';
import { requestContext } from '../request-context/request-context';

export interface ErrorBody {
  message: string;
  error_code: ErrorCode;
  timestamp: string;
  request_id?: string;
  errors?: ErrorDetail[];
}

interface Normalised {
  status: number;
  code: ErrorCode;
  message: string;
  errors?: ErrorDetail[];
}

/** Shape of errors thrown by body-parser / http-errors (not `HttpException`s). */
interface HttpErrorLike {
  status?: number;
  statusCode?: number;
  type?: string;
}

const INTERNAL_MESSAGE = 'Internal server error';

/**
 * Maps every thrown value to the standard error body (Blueprint A9):
 * `{ message, error_code, timestamp, request_id, errors? }`. Unknown errors become
 * a generic 500 (details only in logs); 5xx are also passed to the `ErrorReporter`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLogger,
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;

    const { status, code, message, errors } = this.normalise(exception);
    const request_id = requestContext.getRequestId();
    const path = req.originalUrl.split('?')[0];

    if (status >= 500) {
      this.logger.error(
        { message: 'unhandled_exception', error: describe(exception), path },
        exception instanceof Error ? exception.stack : undefined,
        'ExceptionFilter',
      );
      this.reporter.report(exception, {
        request_id,
        method: req.method,
        path,
        status,
      });
    }

    const body: ErrorBody = {
      message,
      error_code: code,
      timestamp: new Date().toISOString(),
      request_id,
      ...(errors?.length ? { errors } : {}),
    };
    res.status(status).json(body);
  }

  private normalise(exception: unknown): Normalised {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        errors: exception.errors,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: codeForStatus(status),
        message:
          status >= 500
            ? INTERNAL_MESSAGE
            : status === 429
              ? 'Too many requests'
              : messageOf(exception),
      };
    }
    const like = exception as HttpErrorLike | null;
    const status = like?.status ?? like?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        status,
        code: codeForStatus(status),
        message:
          like?.type === 'entity.parse.failed'
            ? 'Malformed JSON body'
            : status === 413
              ? 'Request body too large'
              : 'Bad request',
      };
    }
    return {
      status: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: INTERNAL_MESSAGE,
    };
  }
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : exception.message;
}

function describe(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception);
}
