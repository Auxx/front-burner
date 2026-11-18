import { HEALTH_ROUTES } from './health/health.controller';
import { METRICS_ROUTE } from './metrics/metrics.controller';

/**
 * The routes outside the API version: the health probes (NF-10.7) and the
 * metrics (NF-10.10). The startup keeps them out of the global prefix and the
 * version header (NF-10.9), both from this one list.
 */
export const UNVERSIONED_ROUTES: readonly string[] = [ ...HEALTH_ROUTES, METRICS_ROUTE ];
