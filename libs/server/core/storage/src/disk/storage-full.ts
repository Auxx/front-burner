/**
 * The file-system errors that mean there is no room left to write: the disk is
 * full (`ENOSPC`), or a quota on it is used up (`EDQUOT`, _plan 133's call_:
 * the same condition to the user). See NF-9.8.
 */
const STORAGE_FULL_CODES: ReadonlySet<string> = new Set([ 'ENOSPC', 'EDQUOT' ]);

/** Whether `error` is a file-system error saying that there is no room left to write (NF-9.8). */
export function isStorageFull(error: unknown): boolean {
  const code = (error as { code?: unknown; } | null)?.code;
  return typeof code === 'string' && STORAGE_FULL_CODES.has(code);
}
