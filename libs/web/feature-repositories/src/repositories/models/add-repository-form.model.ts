import type { Signal } from '@angular/core';
import { type SchemaFn, validate, validateStandardSchema } from '@angular/forms/signals';
import {
  type CloneMode,
  type GitLevel,
  RemoteUrlSchema,
  type RepositoryIndex,
  RepositoryNameSchema
} from '@front-burner/shared-contracts';

/** The Add repository form (AR-5), one Signal Forms model for the whole page. */
export interface AddRepositoryForm {
  remoteUrl: string;
  name: string;
  cloneMode: CloneMode;
  branch: string;
  understood: boolean;
  gitLevel: GitLevel;
}

/** What the form's checks need besides the form itself. */
export interface AddRepositoryContext {
  /** The user's repositories, for the early checks of AR-12 and AR-15; empty until loaded. */
  readonly index: Signal<RepositoryIndex['repositories']>;
}

export function emptyAddRepositoryForm(gitLevel: GitLevel): AddRepositoryForm {
  return { remoteUrl: '', name: '', cloneMode: 'full', branch: '', understood: false, gitLevel };
}

/** The checks of the whole form; the backend checks everything again (AR-3). */
export function addRepositorySchema(context: AddRepositoryContext): SchemaFn<AddRepositoryForm> {
  return path => {
    validateStandardSchema(path.remoteUrl, RemoteUrlSchema);
    validateStandardSchema(path.name, RepositoryNameSchema);
    validate(path.name, ({ value }) => {
      const name = value().trim().toLowerCase();
      const taken = name !== '' && context.index().some(entry => entry.name.toLowerCase() === name);
      return taken ? { kind: 'name-taken' } : undefined;
    });
  };
}
