import { InjectionToken } from '@nestjs/common';
import type { Registry } from 'prom-client';

/**
 * The instance's one Prometheus registry, where every library registers its
 * own metrics (NF-10.11). It exists whether metrics are on or off, so that
 * nothing else needs to know.
 */
export const METRICS_REGISTRY: InjectionToken<Registry> = 'front-burner:metrics-registry';

/** The bearer token that `/api/metrics` requires (`Config.metricsToken`). */
export const METRICS_TOKEN: InjectionToken<string> = 'front-burner:metrics-token';

/** Every metric's name starts with it. */
export const METRICS_PREFIX = 'front_burner_';
