import type { Signal } from '@angular/core';
import {
  apply,
  applyWhen,
  type SchemaFn,
  validate,
  validateStandardSchema,
  type ValidationError
} from '@angular/forms/signals';
import {
  type CloneMode,
  type GitLevel,
  RemoteUrlSchema,
  type RepositoryIndex,
  RepositoryNameSchema
} from '@front-burner/shared-contracts';
import {
  type CredentialsContext,
  type CredentialsModel,
  credentialsSchema,
  defaultCredentials
} from '@front-burner/web-repository-dialogs';

/** The Add repository form (AR-5), one Signal Forms model for the whole page. */
export interface AddRepositoryForm {
  remoteUrl: string;
  name: string;
  credentials: CredentialsModel;
  cloneMode: CloneMode;
  branch: string;
  understood: boolean;
  gitLevel: GitLevel;
}

/** What the form's checks need besides the form itself. */
export interface AddRepositoryContext extends CredentialsContext {
  /** The user's repositories, for the early checks of AR-12 and AR-15; empty until loaded. */
  readonly index: Signal<RepositoryIndex['repositories']>;
}

export function emptyAddRepositoryForm(gitLevel: GitLevel): AddRepositoryForm {
  return {
    remoteUrl: '',
    name: '',
    credentials: defaultCredentials(undefined, { https: [], sshKeys: [] }),
    cloneMode: 'full',
    branch: '',
    understood: false,
    gitLevel
  };
}

/** The checks of the whole form; the backend checks everything again (AR-3). */
export function addRepositorySchema(context: AddRepositoryContext): SchemaFn<AddRepositoryForm> {
  return path => {
    validateStandardSchema(path.remoteUrl, RemoteUrlSchema);
    validateStandardSchema(path.name, RepositoryNameSchema);
    validate(path.name, ({ value }) => {
      const name = value().trim().toLowerCase();
      const taken = name !== '' && context.index().some(entry => entry.name.toLowerCase() === name);
      return taken ? { kind: 'name-taken', params: { name: value().trim() } } as ValidationError : undefined;
    });

    apply(path.credentials, credentialsSchema(context));

    // AR-34: a branch, and the warning acknowledged.
    applyWhen(path, ({ valueOf }) => valueOf(path.cloneMode) === 'single-branch', single => {
      validate(single.branch, ({ value }) => value() === '' ? { kind: 'required' } : undefined);
      validate(single.understood, ({ value }) => value() ? undefined : { kind: 'required' });
    });
  };
}
