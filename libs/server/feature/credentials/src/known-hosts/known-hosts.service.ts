import { DATABASE, Database, knownHosts } from '@front-burner/server-core-database';
import {
  fingerprintOf,
  GIT_OPTIONS,
  GitOptions,
  hasHostEntry,
  knownHostsLine,
  trustedKeysFor
} from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { TrustHostRequest } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

/** The key type named at the start of an SSH public key blob (`string type, …`), if it has one. */
function blobType(key: string): string | undefined {
  const blob = Buffer.from(key, 'base64');
  const length = blob.length >= 4 ? blob.readUInt32BE(0) : -1;
  return length >= 0 && 4 + length <= blob.length ? blob.subarray(4, 4 + length).toString('latin1') : undefined;
}

/** The SSH host keys a user has trusted (AR-32, A-5.6). */
@Injectable()
export class KnownHostsService {
  private readonly logger = new Logger(KnownHostsService.name);

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
   * @throws ApiErrorException 409 `host-key-changed`, or `invalid-key` on `key`
   * when the key is not of the type named.
   */
  trust(userId: number, request: TrustHostRequest): void {
    const entry = checkedEntry(request);
    const line = knownHostsLine(entry);
    const known = [ ...this.gitOptions.knownHosts, ...this.linesFor(userId) ];
    if (known.includes(line)) {
      return;
    }
    if (hasHostEntry(known, entry)) {
      throw new ApiErrorException(409, 'host-key-changed', { host: entry.host });
    }
    this.database.db.insert(knownHosts).values(rowOf(userId, entry)).onConflictDoNothing().run();
  }

  /**
   * Replaces the key the user trusts for a host and port whose key changed
   * (RC-22): the user's own keys for it go, and this one is trusted instead,
   * for that user only. The instance-wide list never changes, so for a
   * built-in host the user's key is added next to the instance's (RC-23).
   * The change is logged (RC-24).
   *
   * @throws ApiErrorException 409 `host-key-unknown` for a host and port that
   * neither the user nor the instance has a key for, which {@link trust} is
   * for; `invalid-key` on `key` when the key is not of the type named.
   */
  replace(userId: number, request: TrustHostRequest): void {
    const entry = checkedEntry(request);
    const known = [ ...this.gitOptions.knownHosts, ...this.linesFor(userId) ];
    if (!hasHostEntry(known, entry)) {
      throw new ApiErrorException(409, 'host-key-unknown', { host: entry.host, port: entry.port });
    }
    const own = trustedKeysFor(this.linesFor(userId), entry);
    const before = own.length > 0 ? own : trustedKeysFor(this.gitOptions.knownHosts, entry);
    const row = rowOf(userId, entry);
    this.database.db.transaction(tx => {
      tx.delete(knownHosts)
        .where(and(eq(knownHosts.userId, userId), eq(knownHosts.host, entry.host), eq(knownHosts.port, entry.port)))
        .run();
      tx.insert(knownHosts).values(row).run();
    });
    this.logger.log(
      `User ${userId} replaced the trusted host key of ${entry.host} port ${entry.port}: `
        + `${before.map(({ fingerprint }) => fingerprint).join(', ')} → ${row.fingerprint}`
    );
  }
}

/**
 * The request with its host in lower case, once its key is of the type named.
 *
 * @throws ApiErrorException `invalid-key` on `key`.
 */
function checkedEntry(request: TrustHostRequest): TrustHostRequest {
  if (blobType(request.key) !== request.type) {
    throw ApiErrorException.forFields([ { path: 'key', code: 'invalid-key', params: {} } ]);
  }
  return { ...request, host: request.host.toLowerCase() };
}

/** The row of a trusted key; the backend works out the fingerprint itself. */
function rowOf(userId: number, entry: TrustHostRequest) {
  return {
    userId,
    host: entry.host,
    port: entry.port,
    keyType: entry.type,
    publicKey: entry.key,
    fingerprint: fingerprintOf(`${entry.type} ${entry.key}`),
    createdAt: new Date()
  };
}
