import { ApiErrorException } from './api-error.exception';
import { DEFAULT_RETRY_AFTER_SECONDS, retryAfterSeconds } from './retry-after';

describe('retryAfterSeconds', () => {
  it('NF-11.4: rounds up to whole seconds, at least 1', () => {
    expect(retryAfterSeconds(12.2)).toBe(13);
    expect(retryAfterSeconds(30)).toBe(30);
    expect(retryAfterSeconds(0.2)).toBe(1);
    expect(retryAfterSeconds(0)).toBe(1);
    expect(retryAfterSeconds(-5)).toBe(1);
  });

  it('NF-11.4: falls back to the one-minute window for a wait that is not a number', () => {
    expect(DEFAULT_RETRY_AFTER_SECONDS).toBe(60);
    expect(retryAfterSeconds(Number.NaN)).toBe(60);
    expect(retryAfterSeconds(Number.POSITIVE_INFINITY)).toBe(60);
  });

  it('is what ApiErrorException.tooMany sends', () => {
    expect(ApiErrorException.tooMany('too-many-jobs', Number.NaN).retryAfterSeconds).toBe(60);
    expect(ApiErrorException.tooMany('too-many-jobs', 0.5)).toMatchObject({
      code: 'too-many-jobs',
      retryAfterSeconds: 1
    });
    expect(ApiErrorException.tooMany('too-many-jobs', 0.5).getStatus()).toBe(429);
  });
});
