// A fixed locale, so that the backend and every browser sort the same way, as
// file names do (FB-17). `accent` ignores case only.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'accent' });

/** AR-15's clash rule: equal ignoring case, in every script, as the web client's early check. */
export function sameRepositoryName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * RM-5's order: by name ignoring case, accented letters next to their base
 * letter. Names that differ only in case compare equal, so that callers break
 * the tie, by ID for repositories.
 */
export function compareRepositoryNames(a: string, b: string): number {
  return collator.compare(a, b);
}
