import { Public } from '@front-burner/server-core-security';
import { type HealthStatus, HealthStatusSchema } from '@front-burner/shared-contracts';
import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiSchema, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ReadinessService } from './readiness.service';

// The OpenAPI component keeps the schema's id, `HealthStatus`. nestjs-zod
// cannot clean up a document whose DTO schema is a bare reference to a schema
// with an id ("multiple schemas with name HealthStatus"), so the DTO is built
// from the same shape without the id; clone() would keep it.
@ApiSchema({ name: 'HealthStatus' })
export class HealthStatusDto extends createZodDto(z.object(HealthStatusSchema.shape)) {}

const HEALTH_BASE = 'api/health';
const LIVE = 'live';
const READY = 'ready';

/**
 * The probes' paths, outside the API version (NF-10.7). The startup keeps them
 * out of the global prefix and the version header (NF-10.9).
 */
export const HEALTH_ROUTES: readonly string[] = [ `${HEALTH_BASE}/${LIVE}`, `${HEALTH_BASE}/${READY}` ];

/**
 * Probes for the container's orchestrator (NF-10.7, NF-10.8). Open to anyone
 * and free of version or internals (NF-10.9).
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller(HEALTH_BASE)
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /** The process is up. */
  @Get(LIVE)
  @ApiOkResponse({ type: HealthStatusDto })
  live(): HealthStatus {
    return { status: 'ok' };
  }

  /** The instance can serve requests. */
  @Get(READY)
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
