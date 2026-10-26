import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_GROUP = 'front-burner:rate-limit-group';

/**
 * Puts a route in a rate-limit group: all routes of a group share one counter
 * per IP address, with the stricter limit of the `group` throttler.
 */
export const RateLimitGroup = (name: string) => SetMetadata(RATE_LIMIT_GROUP, name);
