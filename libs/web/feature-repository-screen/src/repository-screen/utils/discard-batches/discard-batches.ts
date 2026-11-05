import { GIT_PATHS_MAX, GIT_PATHS_MAX_BYTES } from '@front-burner/shared-contracts';

import { ancestors } from '../file-name/file-name';

/** The bytes of `{"paths":[]}`. */
const EMPTY_BODY_BYTES = 12;

const encoder = new TextEncoder();

/** The bytes `path` adds to a request's body, with the comma before it. */
function bytesOf(path: string): number {
  return encoder.encode(JSON.stringify(path)).length + 1;
}

/**
 * Splits the paths of a discard into requests of at most `maxPaths` paths and
 * under `maxBytes` of body. A path goes in the same request as any listed entry
 * on the way to it, since the backend refuses a deleted file whose place is taken
 * by something it is not discarding (`discard-blocked`). Sorted paths do not keep
 * them together: `a-b` comes between `a` and `a/b`.
 *
 * A group too long for one request is still sent in order, with the entry on the
 * way first. Once an added entry on the way is gone, nothing blocks the rest. A
 * deleted one, whose place is taken by more added files than fit in a request, is
 * refused with `discard-blocked`, and nothing is discarded; those files can be
 * discarded on their own first.
 */
export function discardBatches(
  paths: readonly string[],
  limits: { maxPaths?: number; maxBytes?: number; } = {}
): string[][] {
  const maxPaths = limits.maxPaths ?? GIT_PATHS_MAX;
  const maxBytes = limits.maxBytes ?? GIT_PATHS_MAX_BYTES;

  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = EMPTY_BODY_BYTES;
  const startBatch = () => {
    if (batch.length > 0) {
      batches.push(batch);
    }
    batch = [];
    bytes = EMPTY_BODY_BYTES;
  };
  const add = (path: string, size: number) => {
    if (batch.length >= maxPaths || bytes + size > maxBytes) {
      startBatch();
    }
    batch.push(path);
    bytes += size;
  };

  for (const group of groupsOf(paths)) {
    const sizes = group.map(bytesOf);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (batch.length + group.length > maxPaths || bytes + total > maxBytes) {
      startBatch();
    }
    group.forEach((path, index) => add(path, sizes[index]));
  }
  startBatch();
  return batches;
}

/** Each path with the listed paths under it, the one on the way first, in the order of the list. */
function groupsOf(paths: readonly string[]): string[][] {
  const listed = new Set(paths);
  const groups = new Map<string, string[]>();
  for (const path of listed) {
    // `ancestors` starts with the root folder, `''`, which is never a listed path.
    const root = ancestors(path).find(folder => listed.has(folder)) ?? path;
    const group = groups.get(root) ?? [];
    groups.set(root, group);
    if (root === path) {
      group.unshift(path);
    } else {
      group.push(path);
    }
  }
  return [ ...groups.values() ];
}
