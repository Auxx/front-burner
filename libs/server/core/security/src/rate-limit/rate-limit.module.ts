import { ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import '../auth/request-auth';
import { RATE_LIMIT_GROUP } from './rate-limit-group.decorator';
import { AppThrottlerGuard } from './throttler.guard';

const groupOf = (context: ExecutionContext): string | undefined =>
  Reflect.getMetadata(RATE_LIMIT_GROUP, context.getHandler()) as string | undefined;

/**
 * Each group's limit per minute and what it counts. The login groups count per
 * client IP, whoever is logged in: holding sessions must not buy more login
 * attempts (LG-65). Access checks count per user (AR-55).
 */
export const RATE_LIMIT_GROUPS: Record<string, { limit: number; per: 'ip' | 'user'; }> = {
  'setup-token': { limit: 10, per: 'ip' },
  login: { limit: 10, per: 'ip' },
  oidc: { limit: 10, per: 'ip' },
  // Each attempt runs the key's KDF (AR-31).
  'ssh-key-unlock': { limit: 10, per: 'ip' },
  'access-check': { limit: 30, per: 'user' }
};

/** @throws Error for a group that is not in {@link RATE_LIMIT_GROUPS}. */
function groupSettings(context: ExecutionContext): { name: string; limit: number; per: 'ip' | 'user'; } {
  const name = groupOf(context) ?? '';
  const settings = RATE_LIMIT_GROUPS[name];
  if (settings === undefined) {
    throw new Error(`Unknown rate limit group ${name}`);
  }
  return { name, ...settings };
}

function groupKey(context: ExecutionContext): string {
  const { name, per } = groupSettings(context);
  const req = context.switchToHttp().getRequest<Request>();
  return per === 'user' && req.auth !== undefined ? `${name}:user:${req.auth.userId}` : `${name}:${req.ip ?? ''}`;
}

const isAuthenticated = (context: ExecutionContext): boolean =>
  context.switchToHttp().getRequest<Request>().auth !== undefined;

/**
 * NF-11.4: 600 requests per user per minute for authenticated requests, 60 per
 * IP per minute for the others. The authentication middleware sets `req.auth`
 * before any guard runs; the IP is `req.ip`, which honours `trust proxy`.
 *
 * Routes in a {@link RateLimitGroup} also count against the `group` throttler,
 * shared by every route of the group, with the limit of
 * {@link RATE_LIMIT_GROUPS} (AO-37, AR-55).
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: context => (isAuthenticated(context) ? 600 : 60) },
        {
          name: 'group',
          ttl: 60_000,
          limit: context => groupSettings(context).limit,
          skipIf: context => groupOf(context) === undefined,
          // One counter per group and client IP or user, whichever route of the group is called.
          generateKey: (context, _tracker, name) => `${name}:${groupKey(context)}`
        }
      ],
      setHeaders: false
    })
  ],
  providers: [ { provide: APP_GUARD, useClass: AppThrottlerGuard } ]
})
export class RateLimitModule {}
