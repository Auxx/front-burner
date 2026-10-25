import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database } from '@front-burner/server-core-database';
import type { HealthStatus } from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { accessSync, constants } from 'node:fs';

/** Injection token: whether the migrations were applied at startup. */
export const MIGRATIONS_APPLIED = 'FRONT_BURNER_MIGRATIONS_APPLIED';

/** Decides what `GET /api/health/ready` answers (NF-10.7). */
@Injectable()
export class ReadinessService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(MIGRATIONS_APPLIED) private readonly migrationsApplied: boolean
  ) {}

  check(): HealthStatus['status'] {
    if (!this.migrationsApplied) {
      return 'fail';
    }
    try {
      this.database.sqlite.prepare('select 1').get();
      accessSync(this.config.dataDir, constants.W_OK);
    } catch {
      return 'fail';
    }
    return 'ok';
  }
}
