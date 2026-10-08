import { Injectable, BeforeApplicationShutdown } from '@nestjs/common';

export type ReadinessCheck = () => Promise<void>;

const CHECK_TIMEOUT_MS = 2_000;

export interface ReadinessResult {
  ready: boolean;
  checks: Record<string, 'up' | 'down'>;
}

/**
 * Readiness registry. Infrastructure modules (Prisma, Redis, ...) call
 * `registerCheck` on init; `/readyz` reports 503 if any check fails or the
 * process has begun shutting down (so load balancers drain it first).
 */
@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private readonly checks = new Map<string, ReadinessCheck>();
  private shuttingDown = false;

  registerCheck(name: string, check: ReadinessCheck): void {
    this.checks.set(name, check);
  }

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async readiness(): Promise<ReadinessResult> {
    const names = [...this.checks.keys()];
    const settled = await Promise.all(
      names.map((name) => this.run(this.checks.get(name)!)),
    );
    const checks = Object.fromEntries(
      names.map((name, i) => [name, settled[i] ? 'up' : 'down']),
    ) as ReadinessResult['checks'];
    return {
      ready: !this.shuttingDown && settled.every(Boolean),
      checks,
    };
  }

  private async run(check: ReadinessCheck): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('readiness check timed out')),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
