import { HealthStatus as HealthStatusBody, HealthStatusSchema } from '@front-burner/shared-contracts';
import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ReadinessService } from './readiness.service';

// Named like the schema's OpenAPI id. nestjs-zod cannot clean up a document
// whose DTO schema is a bare reference to a schema with an id ("multiple
// schemas with name HealthStatus"), so the DTO is built from the same shape
// without the id; clone() would keep it.
export class HealthStatus extends createZodDto(z.object(HealthStatusSchema.shape)) {}

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
  @ApiOkResponse({ type: HealthStatus })
  live(): HealthStatusBody {
    return { status: 'ok' };
  }

  /** The instance can serve requests. */
  @Get('ready')
  @ApiOkResponse({ type: HealthStatus })
  @ApiServiceUnavailableResponse({ type: HealthStatus })
  ready(@Res({ passthrough: true }) res: Response): HealthStatusBody {
    const status = this.readiness.check();
    if (status === 'fail') {
      res.status(503);
    }
    return { status };
  }
}
