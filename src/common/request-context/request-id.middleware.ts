import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { LoggerService } from '@nestjs/common';
import { requestContext } from './request-context';

export const REQUEST_ID_HEADER = 'X-Request-ID';

/** Accept a client/proxy supplied id only if it is short and boring (log-injection safe). */
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

const QUIET_PATHS = new Set(['/healthz', '/readyz']);

/**
 * Assigns a request id (honouring an incoming `X-Request-ID`), echoes it in the
 * response, exposes it to the logger via AsyncLocalStorage, and logs one line
 * per completed request. The query string is never logged (it may hold tokens).
 */
export function createRequestIdMiddleware(logger: LoggerService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const request_id =
      incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, request_id);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0];
      const line = {
        message: 'http_request',
        method: req.method,
        path,
        status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      };
      const level = QUIET_PATHS.has(path) ? 'debug' : 'log';
      requestContext.run({ request_id }, () => {
        logger[level]?.(line, 'HTTP');
      });
    });

    requestContext.run({ request_id }, next);
  };
}
