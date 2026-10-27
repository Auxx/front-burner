import { DATABASE, Database, knownHosts } from '@front-burner/server-core-database';
import { fingerprintOf, GIT_OPTIONS, GitOptions, hasHostEntry, knownHostsLine } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { TrustHostRequest } from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

/** The SSH host keys a user has trusted (AR-32, A-5.6). */
@Injectable()
export class KnownHostsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(GIT_OPTIONS) private readonly gitOptions: GitOptions
  ) {}

  /** The user's `known_hosts` lines, for git commands next to the instance's. */
  linesFor(userId: number): string[] {
    return this.database.db.select().from(knownHosts)
      .where(eq(knownHosts.userId, userId))
      .orderBy(asc(knownHosts.id))
      .all()
      .map(row => knownHostsLine({ host: row.host, port: row.port, type: row.keyType, key: row.publicKey }));
  }

  /**
   * Trusts a host key for the user (AR-32). A key that is already trusted is
   * accepted again. Any other key for a host the user or the instance already
   * has a key for is what `ssh` reports as changed, and this cannot replace it.
   *
   * @throws ApiErrorException 409 `host-key-changed`.
   */
  trust(userId: number, request: TrustHostRequest): void {
    const entry = { ...request, host: request.host.toLowerCase() };
    const line = knownHostsLine(entry);
    const known = [ ...this.gitOptions.knownHosts, ...this.linesFor(userId) ];
    if (known.includes(line)) {
      return;
    }
    if (hasHostEntry(known, entry)) {
      throw new ApiErrorException(409, 'host-key-changed', { host: entry.host });
    }
    this.database.db.insert(knownHosts).values({
      userId,
      host: entry.host,
      port: entry.port,
      keyType: entry.type,
      publicKey: entry.key,
      fingerprint: fingerprintOf(`${entry.type} ${entry.key}`),
      createdAt: new Date()
    }).onConflictDoNothing().run();
  }
}
