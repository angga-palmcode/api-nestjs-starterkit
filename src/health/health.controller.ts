import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/core/public.decorator';
import { SkipEnvelope } from '../common/envelope/skip-envelope.decorator';
import { HealthService } from './health.service';

class LivenessDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

class ReadinessDto {
  @ApiProperty({
    example: 'ready',
    enum: ['ready', 'unavailable', 'shutting_down'],
  })
  status!: string;

  @ApiProperty({
    example: { database: 'up' },
    description: 'Per-dependency state',
    additionalProperties: { type: 'string', enum: ['up', 'down'] },
  })
  checks!: Record<string, string>;
}

/**
 * Probe endpoints. Plain bodies on purpose: orchestrators read the status code,
 * so these stay outside the `{ data }` envelope and the error filter (the 503 is
 * written directly, not thrown).
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@SkipEnvelope()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe: the process is up' })
  @ApiOkResponse({ type: LivenessDto })
  liveness(): LivenessDto {
    return { status: 'ok' };
  }

  @Get('readyz')
  @ApiOperation({
    summary:
      'Readiness probe: dependencies are reachable and not shutting down',
  })
  @ApiOkResponse({ type: ReadinessDto })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'A dependency is down or the app is shutting down',
    type: ReadinessDto,
  })
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessDto> {
    const { ready, checks } = await this.health.readiness();
    if (ready) return { status: 'ready', checks };
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: this.health.isShuttingDown() ? 'shutting_down' : 'unavailable',
      checks,
    };
  }
}
