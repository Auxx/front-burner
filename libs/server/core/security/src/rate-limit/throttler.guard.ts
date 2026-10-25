import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail
  ): Promise<void> {
    context.switchToHttp().getResponse().setHeader('Retry-After', String(Math.ceil(detail.timeToBlockExpire)));
    await super.throwThrottlingException(context, detail);
  }
}
