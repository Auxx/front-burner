import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import '../auth/request-auth';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Authenticated requests count per user, others per client IP (NF-11.4). */
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { auth, ip } = req as unknown as Request;
    return Promise.resolve(auth ? `user:${auth.userId}` : ip ?? '');
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail
  ): Promise<void> {
    // Whole seconds, at least 1: a window about to end must not answer 0 (A-3.9a).
    const seconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    context.switchToHttp().getResponse().setHeader('Retry-After', String(seconds));
    await super.throwThrottlingException(context, detail);
  }
}
