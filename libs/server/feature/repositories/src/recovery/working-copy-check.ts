import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { InstanceRepositories } from '../repositories/instance-repositories';

/**
 * On start, a ready repository whose working copy is gone gets the status
 * Error, "Working copy missing" (RM-6). Only cloning it again brings it back
 * (REQ-REPO-003).
 */
@Injectable()
export class WorkingCopyCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkingCopyCheck.name);

  constructor(
    private readonly instance: InstanceRepositories,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  onApplicationBootstrap(): void {
    for (const { id, userId } of this.instance.ready()) {
      if (!existsSync(join(this.layout.workingCopy(userId, id), '.git'))) {
        this.instance.markDamaged(id);
        this.logger.warn(`The working copy of repository ${id} is missing`);
      }
    }
  }
}
