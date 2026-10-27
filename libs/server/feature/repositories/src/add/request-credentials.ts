import { GitCredentials, SshKeyError, unlockPrivateKey } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { KeyUnlockStore, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { RepositoryCredentials } from '@front-burner/shared-contracts';
import { Injectable } from '@nestjs/common';

export interface ResolvedCredentials {
  git: GitCredentials;
  /** The saved credential used; undefined for none or new ones. */
  savedId: number | undefined;
  /** A key Front Burner generated (AR-29), for the hint of a refused access check (AR-42). */
  generated: boolean;
  /** A passphrase-protected key: a clone job must hold its own copy (AR-49, A-6.3). */
  protectedKey: boolean;
}

const fieldError = (path: string, code: string) => ApiErrorException.forFields([ { path, code, params: {} } ]);

/** Reports a key's problem on the request's `credentials.` field (AR-27). */
function underCredentials<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SshKeyError) {
      throw fieldError(`credentials.${error.field}`, error.problem);
    }
    if (error instanceof ApiErrorException && error.fields !== undefined) {
      throw ApiErrorException.forFields(error.fields.map(field => ({ ...field, path: `credentials.${field.path}` })));
    }
    throw error;
  }
}

/** Turns the credentials of an access check or a submit into what git needs (AR-16 to AR-31). */
@Injectable()
export class RequestCredentials {
  constructor(private readonly saved: SavedCredentialsService, private readonly unlocks: KeyUnlockStore) {}

  /**
   * Nothing is saved here; a passphrase given for a saved key unlocks it for
   * the session once checked, even if the submit then fails (AR-31).
   *
   * @throws NotFoundException for another user's credential (AR-56).
   * @throws ApiErrorException field errors under `credentials`, or 409 `credentials-missing`.
   */
  resolve(
    user: { id: number; sessionId: string; },
    protocol: 'https' | 'ssh',
    input: RepositoryCredentials
  ): ResolvedCredentials {
    switch (input.mode) {
      case 'none':
        return { git: { kind: 'none' }, savedId: undefined, generated: false, protectedKey: false };
      case 'new-https':
        return {
          git: { kind: 'https', username: input.username, password: input.password },
          savedId: undefined,
          generated: false,
          protectedKey: false
        };
      case 'new-ssh-key':
        return {
          git: { kind: 'ssh', key: underCredentials(() => unlockPrivateKey(input.privateKey, input.passphrase)) },
          savedId: undefined,
          generated: false,
          protectedKey: input.passphrase !== undefined
        };
      case 'saved':
        return this.resolveSaved(user, protocol, input);
    }
  }

  private resolveSaved(
    user: { id: number; sessionId: string; },
    protocol: 'https' | 'ssh',
    input: Extract<RepositoryCredentials, { mode: 'saved'; }>
  ): ResolvedCredentials {
    const row = this.saved.findOwned(user.id, input.credentialId);
    if ((row.kind === 'https' ? 'https' : 'ssh') !== protocol) {
      throw fieldError('credentials', 'kind-mismatch');
    }
    const protectedKey = row.kind === 'ssh-key' && row.sshPassphraseProtected === true;
    if (protectedKey && input.passphrase !== undefined) {
      underCredentials(() => this.saved.unlock(user.id, user.sessionId, row.id, input.passphrase ?? ''));
    } else if (protectedKey && !this.unlocks.isUnlocked(user.sessionId, row.id)) {
      throw fieldError('credentials.passphrase', 'passphrase-required');
    }
    return {
      git: this.saved.resolveForGit(user.id, user.sessionId, row.id, { touch: true }),
      savedId: row.id,
      generated: row.sshGenerated === true,
      protectedKey
    };
  }
}
