import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './throttler.guard';

/**
 * NF-11.4: 60 requests per IP per minute. Every endpoint is unauthenticated so
 * far. The key is `req.ip`, which honours `trust proxy`.
 */
@Module({
  imports: [ ThrottlerModule.forRoot({ throttlers: [ { ttl: 60_000, limit: 60 } ], setHeaders: false }) ],
  providers: [ { provide: APP_GUARD, useClass: AppThrottlerGuard } ]
})
export class RateLimitModule {}
