export interface ErrorReportContext {
  request_id?: string;
  method: string;
  path: string;
  status: number;
}

/**
 * Seam for external error tracking (Sentry, Rollbar, ...). The filter calls it
 * for every 5xx. Provide your own implementation under `ERROR_REPORTER`.
 */
export interface ErrorReporter {
  report(error: unknown, context: ErrorReportContext): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

export class NoopErrorReporter implements ErrorReporter {
  report(): void {
    // intentionally empty
  }
}
