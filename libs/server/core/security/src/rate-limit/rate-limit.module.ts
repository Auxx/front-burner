import { ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import '../auth/request-auth';
import { RATE_LIMIT_GROUP } from './rate-limit-group.decorator';
import { AppThrottlerGuard } from './throttler.guard';

const groupOf = (context: ExecutionContext): string | undefined =>
  Reflect.getMetadata(RATE_LIMIT_GROUP, context.getHandler()) as string | undefined;

const isAuthenticated = (context: ExecutionContext): boolean =>
  context.switchToHttp().getRequest<Request>().auth !== undefined;

/**
 * NF-11.4: 600 requests per user per minute for authenticated requests, 60 per
 * IP per minute for the others. The authentication middleware sets `req.auth`
 * before any guard runs; the IP is `req.ip`, which honours `trust proxy`.
 *
 * Routes in a {@link RateLimitGroup} also count against the `group` throttler:
 * 10 requests per IP per minute, shared by every route of the group (AO-37).
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: context => (isAuthenticated(context) ? 600 : 60) },
        {
          name: 'group',
          ttl: 60_000,
          limit: 10,
          skipIf: context => groupOf(context) === undefined,
          // One counter per group and client, whichever route of the group is called.
          generateKey: (context, tracker, name) => `${name}:${groupOf(context)}:${tracker}`
        }
      ],
      setHeaders: false
    })
  ],
  providers: [ { provide: APP_GUARD, useClass: AppThrottlerGuard } ]
})
export class RateLimitModule {}
