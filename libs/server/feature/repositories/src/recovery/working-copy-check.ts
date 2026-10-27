import { DATABASE, Database, repositories } from '@front-burner/server-core-database';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * On start, a ready repository whose working copy is gone gets the status
 * Error, "Working copy missing" (RM-6). Only cloning it again brings it back
 * (REQ-REPO-003).
 */
@Injectable()
export class WorkingCopyCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkingCopyCheck.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  onApplicationBootstrap(): void {
    const ready = this.database.db.select({ id: repositories.id, userId: repositories.userId })
      .from(repositories).where(eq(repositories.status, 'ready')).all();
    for (const { id, userId } of ready) {
      if (!existsSync(join(this.layout.workingCopy(userId, id), '.git'))) {
        this.database.db.update(repositories)
          .set({ status: 'error', errorCode: 'working-copy-missing' })
          .where(eq(repositories.id, id))
          .run();
        this.logger.warn(`The working copy of repository ${id} is missing`);
      }
    }
  }
}
