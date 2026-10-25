import { HealthStatus, HealthStatusSchema } from '@front-burner/shared-contracts';
import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { ReadinessService } from './readiness.service';

export class HealthStatusDto extends createZodDto(HealthStatusSchema) {}

/**
 * Probes for the container's orchestrator (NF-10.7, NF-10.8). Open to anyone
 * and free of version or internals (NF-10.9).
 */
@ApiTags('health')
@SkipThrottle()
@Controller('api/health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /** The process is up. */
  @Get('live')
  @ApiOkResponse({ type: HealthStatusDto })
  live(): HealthStatus {
    return { status: 'ok' };
  }

  /** The instance can serve requests. */
  @Get('ready')
  @ApiOkResponse({ type: HealthStatusDto })
  @ApiServiceUnavailableResponse({ type: HealthStatusDto })
  ready(@Res({ passthrough: true }) res: Response): HealthStatus {
    const status = this.readiness.check();
    if (status === 'fail') {
      res.status(503);
    }
    return { status };
  }
}
