import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** Compares two secrets in constant time; hashing first hides a difference in length too. */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}
