import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataLayout } from './data-layout';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TRASH_NAME = new RegExp(`^delete-\\d+-${UUID}$`);

/**
 * The name in `tmp/` of a folder deleted from a repository's working copy
 * (FB-40): its repository's ID and a random UUID, never anything from the
 * user's path (A-6.3).
 */
export const newTrashName = (repositoryId: number): string => `delete-${repositoryId}-${randomUUID()}`;

/** Whether `name` is one that `newTrashName` makes, and so names nothing outside `tmp/`. */
export const isTrashName = (name: string): boolean => TRASH_NAME.test(name);

/**
 * Removes every trashed folder of a repository from `tmp/`. Removing a
 * repository calls it (RM-19): its queued Delete folder jobs are deleted with
 * it (A-4.5b), so nothing else would remove them before the next start.
 */
export async function emptyTrashOf(layout: DataLayout, repositoryId: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(layout.tmpDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const prefix = `delete-${repositoryId}-`;
  await Promise.all(
    names.filter(name => name.startsWith(prefix) && isTrashName(name))
      .map(name => rm(join(layout.tmpDir, name), { recursive: true, force: true }))
  );
}
