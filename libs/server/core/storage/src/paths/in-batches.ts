/** How many paths are worked on at once: enough to hide the file system's latency, few enough for its handles. */
export const PATHS_AT_ONCE = 32;

/** Runs `task` for every item, a batch at a time; a failure stops it after the batch it failed in. */
export async function inBatches<T>(
  items: readonly T[],
  task: (item: T) => Promise<unknown>,
  size = PATHS_AT_ONCE
): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(task));
  }
}
