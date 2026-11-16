import type { RemoteProblems } from '@front-burner/shared-contracts';
import { Injectable } from '@nestjs/common';

/** The warnings that the operations with the remote left (RM-8); each `null` when there is none. */
export type { RemoteProblems };

/** Reads the stored problems of many repositories at once; a repository without any may be left out. */
export type RemoteProblemsReader = (repositoryIds: readonly number[]) => ReadonlyMap<number, RemoteProblems>;

/**
 * Where this feature reads the problems that the sync feature records (RM-8).
 * The sync feature depends on this one, so it plugs its reader in here, as it
 * listens to `RepositoryCredentialsChanges` _(plan 108's call)_. Until then,
 * no repository has a stored problem.
 */
@Injectable()
export class RemoteProblemsSource {
  #reader: RemoteProblemsReader = () => new Map();

  provide(reader: RemoteProblemsReader): void {
    this.#reader = reader;
  }

  read(repositoryIds: readonly number[]): ReadonlyMap<number, RemoteProblems> {
    return repositoryIds.length === 0 ? new Map() : this.#reader(repositoryIds);
  }
}
