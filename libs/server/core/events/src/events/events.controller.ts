import { ApiErrorException } from '@front-burner/server-core-observability';
import '@front-burner/server-core-security';
import type { PushEvent } from '@front-burner/shared-contracts';
import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { EventsHub } from './events-hub';

/** Keeps proxies from closing an idle stream (A-3.10). */
export const KEEP_ALIVE_MS = 30_000;

/** One event in the SSE wire format. */
export function formatEvent(event: PushEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * The push channel (A-3.10): a Server-Sent Events stream of the logged-in
 * user's events. Clients read it with `fetch`, so it is left out of the
 * OpenAPI document (A-8.5). The global auth guard refuses it without a token.
 */
@ApiExcludeController()
@Controller('events')
export class EventsController {
  constructor(private readonly hub: EventsHub) {}

  @Get()
  stream(@Req() req: Request, @Res() res: Response): void {
    if (req.auth === undefined) {
      // The global auth guard already refuses such requests.
      throw new ApiErrorException(401, 'unauthenticated');
    }
    const { userId, sessionId, authTokenExpiresAt } = req.auth;
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive'
    });
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
    // The client reconnects with a fresh token (A-3.10).
    const expiry = setTimeout(() => end(), Math.max(0, authTokenExpiresAt - Date.now()));
    const remove = this.hub.open({
      userId,
      sessionId,
      send: event => res.write(formatEvent(event)),
      close: () => end()
    });

    function cleanUp(): void {
      clearInterval(keepAlive);
      clearTimeout(expiry);
      remove();
    }
    function end(): void {
      cleanUp();
      res.end();
    }
    res.on('close', cleanUp);
  }
}
