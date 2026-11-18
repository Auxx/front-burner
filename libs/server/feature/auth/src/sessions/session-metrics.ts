import { DATABASE, Database, sessions } from '@front-burner/server-core-database';
import { METRICS_PREFIX, METRICS_REGISTRY } from '@front-burner/server-core-observability';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, count, gt, isNull } from 'drizzle-orm';
import { Gauge, Registry } from 'prom-client';

export const ACTIVE_SESSIONS = `${METRICS_PREFIX}active_sessions`;

/**
 * `front_burner_active_sessions`: the unrevoked, unexpired sessions of every
 * user together, counted in the database on each scrape (NF-10.11). No label,
 * so no user can be told apart.
 */
@Injectable()
export class SessionMetrics implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(METRICS_REGISTRY) private readonly registry: Registry
  ) {}

  onModuleInit(): void {
    const countActive = () => this.countActive();
    new Gauge({
      name: ACTIVE_SESSIONS,
      help: 'Sessions that are neither revoked nor expired.',
      registers: [ this.registry ],
      collect() {
        this.set(countActive());
      }
    });
  }

  private countActive(): number {
    return this.database.db.select({ value: count() }).from(sessions)
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .get()?.value ?? 0;
  }
}
