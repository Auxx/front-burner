import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { lstatSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { InstanceRepositories } from '../repositories/instance-repositories';

/** An ID as the backend writes it in a path: a positive integer, without leading zeros. */
function idOf(name: string): number | undefined {
  const id = Number(name);
  return Number.isSafeInteger(id) && id > 0 && String(id) === name ? id : undefined;
}

/** The entries of a folder; none when it is gone. */
function entriesOf(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Whether anything has this path, a dangling symbolic link included, which a
 * rename can't replace. One that can't be checked is free: the rename then
 * fails and is logged, where a loop over taken names would never end.
 */
function taken(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `2026-11-16T10-00-00Z`: UTC to the second, without the colons that some file systems refuse. */
const stamp = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');

/**
 * On start, a working copy that no repository in the database owns moves to
 * `orphans/` and is logged, never deleted, as it may hold unpushed work
 * (NF-6.4): for example after a database was restored from a snapshot older
 * than some repositories. The pair of user and repository must match, since
 * `repos/<user-id>/<repo-id>` is where the backend puts it (NF-5.2).
 *
 * Only names the backend makes are looked at; anything else is left where it
 * is and logged. Nothing is deleted except a user folder that a move left
 * empty. Nothing here stops the start: a move or a folder that fails is
 * logged, and the other moves go on.
 *
 * Runs in `onModuleInit`, so before the sync feature's `WorkingCopyRecovery`,
 * whose module imports this one, and before `WorkingCopyCheck` (A-5.15).
 * Repositories being cloned have their copy in `tmp/`, which is emptied first.
 */
@Injectable()
export class OrphanedWorkingCopies implements OnModuleInit {
  private readonly logger = new Logger(OrphanedWorkingCopies.name);

  constructor(
    private readonly instance: InstanceRepositories,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  onModuleInit(): void {
    try {
      this.moveAll();
    } catch (error) {
      this.logger.error({ err: error }, 'Could not look for orphaned working copies in repos/; the start goes on');
    }
  }

  /** Moves every orphan; gives the names of their new folders in `orphans/`. Throws when `repos/` can't be read. */
  moveAll(): string[] {
    const owned = new Set(this.instance.all().map(({ id, userId }) => `${userId}/${id}`));
    const time = stamp(new Date());
    const moved: string[] = [];
    for (const userName of entriesOf(this.layout.reposDir)) {
      const userId = idOf(userName);
      if (userId === undefined) {
        this.leftAlone('repos/');
      } else {
        moved.push(...this.moveOrphansOf(userId, owned, time));
      }
    }
    return moved;
  }

  private moveOrphansOf(userId: number, owned: Set<string>, time: string): string[] {
    const userDir = join(this.layout.reposDir, String(userId));
    let entries: string[];
    try {
      entries = entriesOf(userDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        this.leftAlone('repos/');
      } else {
        this.logger.error({ err: error }, `Could not read the folder of user ${userId} in repos/`);
      }
      return [];
    }
    const moved: string[] = [];
    for (const repositoryName of entries) {
      const repositoryId = idOf(repositoryName);
      if (repositoryId === undefined) {
        this.leftAlone(`repos/${userId}/`);
      } else if (!owned.has(`${userId}/${repositoryId}`)) {
        const name = this.move(userId, repositoryId, time);
        if (name !== undefined) {
          moved.push(name);
        }
      }
    }
    if (moved.length > 0 && moved.length === entries.length) {
      this.removeEmpty(userDir);
    }
    return moved;
  }

  private move(userId: number, repositoryId: number, time: string): string | undefined {
    const base = `${userId}-${repositoryId}-${time}`;
    let name = base;
    // A rename onto an empty folder would replace it: never reuse a name.
    for (let n = 2; taken(join(this.layout.orphansDir, name)); n++) {
      name = `${base}-${n}`;
    }
    try {
      renameSync(this.layout.workingCopy(userId, repositoryId), join(this.layout.orphansDir, name));
    } catch (error) {
      this.logger.error(
        { err: error },
        `Could not move the working copy of repository ${repositoryId} (user ${userId}) to orphans/`
      );
      return undefined;
    }
    // Quoted in the deployment guide (docs/wiki/deployment.md): change both together.
    this.logger.warn(
      `Working copy of repository ${repositoryId} (user ${userId}) has no repository; moved to orphans/${name}`
    );
    return name;
  }

  /** Never the entry's name, which may be a repository's (NF-10.5). */
  private leftAlone(folder: string): void {
    this.logger.warn(`${folder} holds an entry that the backend did not make; it is left where it is`);
  }

  /** `rmdir` refuses a folder that is not empty, such as one that something wrote to meanwhile. */
  private removeEmpty(userDir: string): void {
    try {
      rmdirSync(userDir);
    } catch {
      // Left as it is: an empty folder costs nothing.
    }
  }
}
