/** `Retry-After` of a `429` that names no time of its own: the rate limits' one-minute window (NF-11.4, A-3.9a). */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * A wait in seconds as `Retry-After` sends it: whole seconds, rounded up, at
 * least 1, so that a client never retries at once into another `429`; a wait
 * that is not a finite number falls back to {@link DEFAULT_RETRY_AFTER_SECONDS}
 * (NF-11.4, A-3.9a).
 */
export function retryAfterSeconds(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : DEFAULT_RETRY_AFTER_SECONDS;
}
