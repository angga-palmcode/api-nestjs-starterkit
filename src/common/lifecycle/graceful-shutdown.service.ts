import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { AppLogger } from '../logger/app.logger';

/**
 * On SIGTERM/SIGINT (via `app.enableShutdownHooks()`), Nest stops accepting
 * connections and drains in-flight requests. This adds a watchdog so a stuck
 * connection cannot hang the process forever. `HealthService` flips `/readyz`
 * to 503 at the same moment so load balancers stop routing first.
 */
@Injectable()
export class GracefulShutdownService implements BeforeApplicationShutdown {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: AppLogger,
  ) {}

  beforeApplicationShutdown(signal?: string): void {
    // `signal` is undefined for programmatic `app.close()` (tests, CLI): no watchdog then.
    if (!signal) return;

    const timeout = this.config.get('SHUTDOWN_TIMEOUT_MS', { infer: true });
    this.logger.log(
      { message: 'shutdown_started', signal, timeout_ms: timeout },
      'Lifecycle',
    );
    if (timeout > 0) {
      setTimeout(() => {
        this.logger.error(
          'Graceful shutdown timed out; forcing exit',
          'Lifecycle',
        );
        process.exit(1);
      }, timeout).unref();
    }
  }
}
