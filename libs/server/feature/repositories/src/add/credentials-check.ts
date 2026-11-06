import { DATABASE, Database, savedCredentials, Tx } from '@front-burner/server-core-database';
import { GitEngine, GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { KeyUnlockStore, KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { AccessCheckResult, RepositoryCredentials } from '@front-burner/shared-contracts';
import type { ParsedRemote } from '@front-burner/shared-util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { toAddRepositoryError } from './remote-errors';
import { ResolvedCredentials } from './request-credentials';
import { fieldError } from './request-fields';

/** Reports a credential's field error under `credentials.` (its name, AR-18). */
function underCredentials<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ApiErrorException && error.fields !== undefined) {
      throw ApiErrorException.forFields(error.fields.map(field => ({ ...field, path: `credentials.${field.path}` })));
    }
    throw error;
  }
}

/**
 * The access check with a request's credentials, and saving new ones, shared
 * by the Add repository page and the repository credentials dialog, so that
 * both report the same errors (AR-41, AR-42, RC-8).
 */
@Injectable()
export class CredentialsCheck {
  private readonly logger = new Logger(CredentialsCheck.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly saved: SavedCredentialsService,
    private readonly knownHosts: KnownHostsService,
    private readonly engine: GitEngine,
    private readonly unlocks: KeyUnlockStore
  ) {}

  /**
   * Runs `git ls-remote` with the credentials (AR-41, step 2).
   *
   * @throws ApiErrorException the codes of {@link toAddRepositoryError}.
   */
  async check(
    user: { id: number; },
    remoteUrl: string,
    remote: ParsedRemote,
    mode: RepositoryCredentials['mode'],
    credentials: ResolvedCredentials
  ): Promise<AccessCheckResult> {
    try {
      const result = await this.engine.accessCheck(remoteUrl, credentials.git, this.knownHosts.linesFor(user.id));
      return { branches: result.branches, defaultBranch: result.defaultBranch ?? null };
    } catch (error) {
      if (!(error instanceof GitOperationError)) {
        throw error;
      }
      // git's error, with credentials removed by the engine (AR-42, NF-10.5).
      this.logger.warn(`Access check of ${remote.host} failed with ${error.code}: ${error.detail.trim()}`);
      throw toAddRepositoryError(error, {
        host: remote.host,
        credentialsMode: mode,
        generatedKey: credentials.generated
      });
    }
  }

  /**
   * New credentials' names are checked with every other field, before the
   * remote is contacted (AR-41).
   *
   * @throws ApiErrorException `name-taken` on `credentials.name`.
   */
  assertNameFree(userId: number, credentials: RepositoryCredentials): void {
    if (credentials.mode !== 'new-https' && credentials.mode !== 'new-ssh-key') {
      return;
    }
    const kind = credentials.mode === 'new-https' ? 'https' : 'ssh-key';
    const taken = this.database.db.select({ id: savedCredentials.id }).from(savedCredentials)
      .where(and(
        eq(savedCredentials.userId, userId),
        eq(savedCredentials.kind, kind),
        eq(sql`lower(${savedCredentials.name})`, credentials.name.toLowerCase())
      ))
      .get();
    if (taken !== undefined) {
      throw fieldError('credentials.name', 'name-taken');
    }
  }

  /** Saves new credentials in the transaction (AR-21, AR-28); undefined for none or saved ones. */
  saveNew(tx: Tx, userId: number, credentials: RepositoryCredentials): number | undefined {
    switch (credentials.mode) {
      case 'new-https':
        return underCredentials(() => this.saved.createHttps(tx, userId, credentials));
      case 'new-ssh-key':
        return underCredentials(() => this.saved.createPastedKey(tx, userId, credentials));
      default:
        return undefined;
    }
  }

  /**
   * After the transaction that saved them: a pasted key's passphrase unlocks
   * it for the session once checked (AR-31). Does nothing for other
   * credentials.
   */
  unlockPasted(sessionId: string, credentialId: number | null, credentials: RepositoryCredentials): void {
    if (credentials.mode === 'new-ssh-key' && credentials.passphrase !== undefined && credentialId !== null) {
      this.unlocks.unlock(sessionId, credentialId, credentials.privateKey, credentials.passphrase);
    }
  }
}
