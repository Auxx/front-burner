import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database, loginAudit, sessions } from '@front-burner/server-core-database';
import { JobRunner } from '@front-burner/server-core-jobs';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { lt, or } from 'drizzle-orm';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Housekeeping of authentication: expired sessions (LG-38) and old login audit entries (LG-45). */
@Injectable()
export class AuthHousekeeping implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Pick<Config, 'loginAuditRetentionMs'>,
    private readonly runner: JobRunner
  ) {}

  onModuleInit(): void {
    const housekeeping = { pool: 'housekeeping', onInterrupted: 'requeue', spreadOnStart: true } as const;
    this.runner.register({
      ...housekeeping,
      type: 'auth.session-cleanup',
      repeatEveryMs: HOUR_MS,
      handler: () => Promise.resolve({ deleted: this.deleteEndedSessions() })
    });
    this.runner.register({
      ...housekeeping,
      type: 'auth.login-audit-retention',
      repeatEveryMs: DAY_MS,
      handler: () => Promise.resolve({ deleted: this.deleteOldAuditEntries() })
    });
  }

  /** Deletes expired and revoked sessions (LG-38); returns how many. */
  deleteEndedSessions(): number {
    const now = new Date();
    return this.database.db.delete(sessions).where(or(lt(sessions.expiresAt, now), lt(sessions.revokedAt, now))).run()
      .changes;
  }

  /** Deletes login audit entries older than the retention (LG-45); returns how many. */
  deleteOldAuditEntries(): number {
    const cutoff = new Date(Date.now() - this.config.loginAuditRetentionMs);
    return this.database.db.delete(loginAudit).where(lt(loginAudit.at, cutoff)).run().changes;
  }
}
