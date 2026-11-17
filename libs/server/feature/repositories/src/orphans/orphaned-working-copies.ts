import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
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
 * is and logged. Nothing is deleted except a user folder left empty. A move
 * that fails is logged, and stops neither the other moves nor the start.
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
    this.moveAll();
  }

  /** Moves every orphan; gives the names of their new folders in `orphans/`. */
  moveAll(): string[] {
    const owned = new Set(this.instance.all().map(({ id, userId }) => `${userId}/${id}`));
    const time = stamp(new Date());
    const moved: string[] = [];
    for (const userName of entriesOf(this.layout.reposDir)) {
      const userId = idOf(userName);
      if (userId === undefined) {
        this.leftAlone('repos/');
        continue;
      }
      const userDir = join(this.layout.reposDir, userName);
      for (const repositoryName of entriesOf(userDir)) {
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
      this.removeIfEmpty(userDir);
    }
    return moved;
  }

  private move(userId: number, repositoryId: number, time: string): string | undefined {
    const base = `${userId}-${repositoryId}-${time}`;
    let name = base;
    // A rename onto an empty folder would replace it: never reuse a name.
    for (let n = 2; existsSync(join(this.layout.orphansDir, name)); n++) {
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
    this.logger.warn(
      `Working copy of repository ${repositoryId} (user ${userId}) has no repository; moved to orphans/${name}`
    );
    return name;
  }

  /** Never the entry's name, which may be a repository's (NF-10.5). */
  private leftAlone(folder: string): void {
    this.logger.warn(`${folder} holds an entry that the backend did not make; it is left where it is`);
  }

  /** Only an empty folder: `rmdir` refuses anything else. */
  private removeIfEmpty(userDir: string): void {
    try {
      if (readdirSync(userDir).length === 0) {
        rmdirSync(userDir);
      }
    } catch {
      // A file where a user folder should be, or a folder that can't be read: left as it is.
    }
  }
}
