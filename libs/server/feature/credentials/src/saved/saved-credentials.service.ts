import { SECRET_BOX, SecretBinding, SecretBox } from '@front-burner/server-core-crypto';
import { DATABASE, Database, SavedCredential, savedCredentials, Tx } from '@front-burner/server-core-database';
import {
  generateEd25519Key,
  GitCredentials,
  inspectPrivateKey,
  SshKeyError,
  SshKeyInfo,
  unlockPrivateKey
} from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type {
  GeneratedSshKey,
  NewHttpsCredentials,
  NewSshKey,
  SavedCredentials,
  SavedSshKey,
  SshKeyType
} from '@front-burner/shared-contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { KeyUnlockStore } from '../unlocks/key-unlock-store';

const bindingOf = (row: Pick<SavedCredential, 'id' | 'userId'>): SecretBinding => ({
  table: 'saved_credentials',
  recordId: row.id,
  userId: row.userId
});

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown; }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/** Runs an SSH key check and reports its problem on the form field it belongs to (AR-27). */
function checkKey<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof SshKeyError) {
      throw ApiErrorException.forFields([ { path: error.field, code: error.problem, params: {} } ]);
    }
    throw error;
  }
}

/**
 * A user's saved HTTPS credentials and SSH keys (AR-17 to AR-31). Every lookup
 * is by ID and user: another user's credential is an unknown ID (AR-56,
 * A-7.3). Secrets are encrypted with their row's binding (NF-8.3) and never
 * leave this service except to git.
 */
@Injectable()
export class SavedCredentialsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
    private readonly unlocks: KeyUnlockStore
  ) {}

  /** The user's credentials without secrets, each kind sorted by name; `unlocked` in this session. */
  list(userId: number, sessionId: string): SavedCredentials {
    const rows = this.database.db.select().from(savedCredentials)
      .where(eq(savedCredentials.userId, userId))
      .orderBy(sql`lower(${savedCredentials.name})`, asc(savedCredentials.id))
      .all();
    return {
      https: rows.filter(row => row.kind === 'https').map(row => ({
        id: row.id,
        name: row.name,
        username: row.username ?? '',
        missing: row.secret === null
      })),
      sshKeys: rows.filter(row => row.kind === 'ssh-key').map(row => this.toSshKey(row, sessionId))
    };
  }

  /** @throws NotFoundException for an unknown ID or another user's (AR-56). */
  findOwned(userId: number, id: number): SavedCredential {
    const row = this.database.db.select().from(savedCredentials)
      .where(and(eq(savedCredentials.id, id), eq(savedCredentials.userId, userId)))
      .get();
    if (row === undefined) {
      throw new NotFoundException();
    }
    return row;
  }

  /**
   * Saves HTTPS credentials inside the caller's transaction (AR-20, AR-21).
   *
   * @throws ApiErrorException `name-taken` on `name` (AR-18).
   */
  createHttps(tx: Tx, userId: number, input: NewHttpsCredentials): number {
    return this.insert(tx, { userId, kind: 'https', name: input.name, username: input.username }, input.password);
  }

  /**
   * Saves a pasted key inside the caller's transaction, as pasted and with its
   * public parts (AR-26 to AR-28). The passphrase is only checked.
   *
   * @throws ApiErrorException on `privateKey` or `passphrase` (AR-27), or `name-taken` on `name`.
   */
  createPastedKey(tx: Tx, userId: number, input: NewSshKey): number {
    const info = checkKey(() => inspectPrivateKey(input.privateKey, input.passphrase));
    return this.insert(tx, { userId, kind: 'ssh-key', name: input.name, ...sshColumns(info, false) }, input.privateKey);
  }

  /**
   * Generates an Ed25519 key without a passphrase and saves it at once (AR-29,
   * AR-30).
   *
   * @throws ApiErrorException `name-taken` on `name`.
   */
  generateKey(userId: number, name: string, comment: string): GeneratedSshKey {
    const { privateKey, publicKey } = generateEd25519Key(comment);
    const info = inspectPrivateKey(privateKey);
    const id = this.database.db.transaction(tx =>
      this.insert(tx, { userId, kind: 'ssh-key', name, ...sshColumns(info, true) }, privateKey)
    );
    return { key: this.toSshKey(this.findOwned(userId, id), undefined), publicKey };
  }

  /**
   * The credentials for a git operation of this session. `touch: true` for a
   * git operation the user started, which keeps a key unlocked (AR-31, A-5.5).
   *
   * @throws NotFoundException for an unknown ID or another user's (AR-56).
   * @throws ApiErrorException 409 `key-locked` with `keyId` and `keyName` for a
   * protected key not unlocked in this session, or `credentials-missing` when
   * the secret was deleted by an encryption key reset (NF-8.6).
   */
  resolveForGit(userId: number, sessionId: string, id: number, options: { touch: boolean; }): GitCredentials {
    const row = this.findOwned(userId, id);
    if (row.kind === 'https') {
      return { kind: 'https', username: row.username ?? '', password: this.secretOf(row) };
    }
    if (!row.sshPassphraseProtected) {
      return { kind: 'ssh', key: unlockPrivateKey(this.secretOf(row)) };
    }
    const key = this.unlocks.get(sessionId, row.id, options);
    if (key === undefined) {
      // A missing secret is reported before asking for a passphrase that cannot help.
      this.secretOf(row);
      throw new ApiErrorException(409, 'key-locked', { keyId: row.id, keyName: row.name });
    }
    return { kind: 'ssh', key };
  }

  /**
   * Unlocks a saved key for this session (AR-25, AR-31).
   *
   * @throws NotFoundException for an unknown ID, another user's or one that is not an SSH key.
   * @throws ApiErrorException `wrong-passphrase` on `passphrase`, or `credentials-missing`.
   */
  unlock(userId: number, sessionId: string, id: number, passphrase: string): void {
    const row = this.findOwned(userId, id);
    if (row.kind !== 'ssh-key') {
      throw new NotFoundException();
    }
    const privateKey = this.secretOf(row);
    checkKey(() => this.unlocks.unlock(sessionId, row.id, privateKey, passphrase));
  }

  private insert(
    tx: Tx,
    values: Omit<typeof savedCredentials.$inferInsert, 'secret' | 'createdAt'>,
    secret: string
  ): number {
    let id: number;
    try {
      id =
        tx.insert(savedCredentials).values({ ...values, createdAt: new Date() }).returning({ id: savedCredentials.id })
          .get().id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiErrorException.forFields([ { path: 'name', code: 'name-taken', params: {} } ]);
      }
      throw error;
    }
    // The binding names the row, so the secret is written once its ID is known (NF-8.3).
    const encrypted = this.secretBox.encrypt(secret, bindingOf({ id, userId: values.userId }));
    tx.update(savedCredentials).set({ secret: encrypted }).where(eq(savedCredentials.id, id)).run();
    return id;
  }

  /** @throws ApiErrorException 409 `credentials-missing` after an encryption key reset (NF-8.6). */
  private secretOf(row: SavedCredential): string {
    if (row.secret === null) {
      throw new ApiErrorException(409, 'credentials-missing', { id: row.id });
    }
    return this.secretBox.decrypt(row.secret, bindingOf(row));
  }

  private toSshKey(row: SavedCredential, sessionId: string | undefined): SavedSshKey {
    return {
      id: row.id,
      name: row.name,
      keyType: row.sshKeyType as SshKeyType,
      fingerprint: row.sshFingerprint ?? '',
      passphraseProtected: row.sshPassphraseProtected ?? false,
      unlocked: sessionId !== undefined && this.unlocks.isUnlocked(sessionId, row.id),
      generated: row.sshGenerated ?? false,
      missing: row.secret === null
    };
  }
}

function sshColumns(info: SshKeyInfo, generated: boolean) {
  return {
    sshKeyType: info.type,
    sshPublicKey: info.publicKey,
    sshFingerprint: info.fingerprint,
    sshPassphraseProtected: info.encrypted,
    sshGenerated: generated
  };
}
