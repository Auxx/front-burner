/**
 * Whether a URL segment is an ID the backend can have given a repository: a
 * positive safe integer, written without leading zeros, so that each
 * repository has one URL. Anything else is Page not found, like a repository
 * that does not exist (FB-2, RM-1).
 */
export function isRepositoryId(segment: string): boolean {
  return /^[1-9]\d*$/.test(segment) && Number.isSafeInteger(Number(segment));
}
