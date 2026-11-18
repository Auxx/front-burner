import { constantTimeEquals, Public } from '@front-burner/server-core-security';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Registry } from 'prom-client';
import { ApiErrorException } from '../errors/api-error.exception';
import { METRICS_REGISTRY, METRICS_TOKEN } from './metrics-registry';

/**
 * The metrics' path, outside the API version as the health probes (NF-10.7).
 * The startup keeps it out of the global prefix and the version header.
 */
export const METRICS_ROUTE = 'api/metrics';

const BEARER = /^Bearer (.+)$/i;

/**
 * Prometheus metrics for the operator's scraper (NF-10.10). Only the bearer
 * token opens it: no login, so `@Public()`, and the unauthenticated rate limit
 * applies. Left out of the OpenAPI document: it is not part of the API.
 */
@ApiExcludeController()
@Public()
@Controller(METRICS_ROUTE)
export class MetricsController {
  constructor(
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
    @Inject(METRICS_TOKEN) private readonly token: string
  ) {}

  /**
   * @throws ApiErrorException `unauthenticated` (401) without the right token,
   * whether it is missing, malformed or wrong.
   */
  @Get()
  async metrics(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<string> {
    const sent = BEARER.exec(req.headers.authorization ?? '')?.[1] ?? '';
    // Compared even when none was sent (the token is never empty), so that a missing one is refused like a wrong one.
    if (!constantTimeEquals(sent, this.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      throw new ApiErrorException(401, 'unauthenticated');
    }
    res.type(this.registry.contentType);
    return this.registry.metrics();
  }
}
