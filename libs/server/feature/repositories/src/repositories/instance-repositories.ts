import { DATABASE, Database, repositories, Repository } from '@front-burner/server-core-database';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

/** What work on a working copy needs to know of its repository. */
export type InstanceRepository = Pick<Repository, 'id' | 'userId'>;

/**
 * Repositories across all users, for work the instance does on its own, such as
 * recovery on start. Never for a user's request: that is `RepositoryQueries`,
 * which is limited to the user (DS-3, A-7.3).
 */
@Injectable()
export class InstanceRepositories {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Every user's ready repositories. */
  ready(): InstanceRepository[] {
    return this.listed(eq(repositories.status, 'ready'));
  }

  /** Every user's repositories whose working copy is missing or damaged (RM-6). */
  damaged(): InstanceRepository[] {
    return this.listed(and(eq(repositories.status, 'error'), eq(repositories.errorCode, 'working-copy-missing')));
  }

  /** The status Error, "Working copy is missing or damaged" (RM-6); gives the row's user, or `undefined` without one. */
  markDamaged(id: number): number | undefined {
    return this.database.db.update(repositories)
      .set({ status: 'error', errorCode: 'working-copy-missing' })
      .where(eq(repositories.id, id))
      .returning({ userId: repositories.userId })
      .get()?.userId;
  }

  /** A damaged repository's working copy was put right; any other is left as it is. */
  markRepaired(id: number): void {
    this.database.db.update(repositories)
      .set({ status: 'ready', errorCode: null })
      .where(and(
        eq(repositories.id, id),
        eq(repositories.status, 'error'),
        eq(repositories.errorCode, 'working-copy-missing')
      ))
      .run();
  }

  private listed(where: ReturnType<typeof and>): InstanceRepository[] {
    return this.database.db.select({ id: repositories.id, userId: repositories.userId })
      .from(repositories)
      .where(where)
      .orderBy(asc(repositories.id))
      .all();
  }
}
