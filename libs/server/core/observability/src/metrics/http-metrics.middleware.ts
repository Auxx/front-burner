import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Histogram, Registry } from 'prom-client';
import { METRICS_PREFIX } from './metrics-registry';

export const HTTP_REQUEST_DURATION = `${METRICS_PREFIX}http_request_duration_seconds`;

/** The `route` of a request that no route answered, such as an unknown path: one label value, whatever the path. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * The route pattern that answered, such as `/api/v1/repositories/:id`; never
 * the path, which may name a file. Express leaves `req.route` at the last
 * route that matched. Nest registers each handler of a controller as a route
 * of its one method, and middleware for `RequestMethod.ALL`, such as the auth
 * middleware's `/api/v1/*path`, with `app.all()`, a route of every method (no
 * controller uses `@All()`): a request whose last route has more than one
 * method reached no handler.
 */
function routeOf(req: Request): string {
  const route = req.route as { path?: unknown; methods?: Record<string, boolean>; } | undefined;
  const methods = Object.values(route?.methods ?? {}).filter(Boolean).length;
  return typeof route?.path === 'string' && methods === 1 ? route.path : UNMATCHED_ROUTE;
}

/**
 * Times every API request into `front_burner_http_request_duration_seconds`
 * by method, route pattern and status (NF-10.11). An Express middleware rather
 * than a Nest interceptor, so that it also times what guards refuse (`401`,
 * `429`), what the body parser refuses and unknown routes. Requests outside
 * `/api/`, the web client's, are left out. Attached at startup before the
 * routes, when metrics are on.
 */
export function httpMetrics(registry: Registry): RequestHandler {
  const histogram = new Histogram({
    name: HTTP_REQUEST_DURATION,
    help: 'Duration of API requests in seconds, by method, route pattern and status.',
    labelNames: [ 'method', 'route', 'status' ] as const,
    registers: [ registry ]
  });
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      const end = histogram.startTimer();
      res.once('finish', () => {
        end({ method: req.method, route: routeOf(req), status: String(res.statusCode) });
      });
    }
    next();
  };
}
