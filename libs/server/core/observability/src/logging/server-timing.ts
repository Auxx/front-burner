import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** The response header that carries the server's own duration (plan 150). */
export const SERVER_TIMING_HEADER = 'Server-Timing';

export interface ServerTimingOptions {
  /** Routes that never get the header, such as the health probes, without leading slash. */
  except: readonly string[];
}

/** A path as the router matches it: case-insensitive, with or without a slash at either end. */
function routeOf(path: string): string {
  return path.replace(/^\/|\/$/g, '').toLowerCase();
}

/**
 * Sets `Server-Timing: app;dur=<ms>` on every API response but those of
 * `except`: the time from this middleware to the moment the headers are
 * written, so that a measuring tool can leave the network out (NF-2). The
 * header holds only the duration, never a route or ID. Attached at startup,
 * right after the request logger, only when `FRONT_BURNER_SERVER_TIMING` is
 * `true`; requests outside `/api/`, the web client's, are left out.
 */
export function serverTiming(options: ServerTimingOptions): RequestHandler {
  const except = new Set(options.except.map(routeOf));
  return (req: Request, res: Response, next: NextFunction) => {
    const route = routeOf(req.path);
    if (route.startsWith('api/') && !except.has(route)) {
      const start = process.hrtime.bigint();
      // Node writes the headers through writeHead, also when a response ends without calling it.
      const writeHead = res.writeHead;
      res.writeHead = function(this: Response, ...args: Parameters<Response['writeHead']>) {
        if (!this.headersSent) {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          this.setHeader(SERVER_TIMING_HEADER, `app;dur=${ms.toFixed(1)}`);
        }
        return writeHead.apply(this, args);
      } as Response['writeHead'];
    }
    next();
  };
}
