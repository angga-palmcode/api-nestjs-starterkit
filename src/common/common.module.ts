import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { EnvelopeInterceptor } from './envelope/envelope.interceptor';
import { ERROR_REPORTER, NoopErrorReporter } from './errors/error-reporter';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

/** Cross-cutting HTTP behaviour: error filter, success envelope, error reporter seam. */
@Global()
@Module({
  providers: [
    { provide: ERROR_REPORTER, useClass: NoopErrorReporter },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
  exports: [ERROR_REPORTER],
})
export class CommonModule {}
