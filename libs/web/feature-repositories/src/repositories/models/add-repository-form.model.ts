import type { Signal } from '@angular/core';
import { applyWhen, type SchemaFn, validate, validateStandardSchema } from '@angular/forms/signals';
import {
  type CloneMode,
  credentialName,
  type GitLevel,
  NewHttpsCredentialsSchema,
  RemoteUrlSchema,
  type RepositoryCredentials,
  type RepositoryIndex,
  RepositoryNameSchema,
  type SavedCredentials
} from '@front-burner/shared-contracts';

/**
 * How the user gives the remote's credentials (AR-19, AR-23): HTTPS offers
 * `saved`, `new-https` and `none`; SSH offers `saved`, `new-ssh-key` (paste)
 * and `generate`.
 */
export type CredentialsChoice = 'saved' | 'new-https' | 'none' | 'new-ssh-key' | 'generate';

/**
 * The credentials section as flat fields, so that each can be bound and
 * checked on its own; {@link toRepositoryCredentials} makes the API's value.
 */
export interface CredentialsModel {
  choice: CredentialsChoice;
  /** The chosen saved credentials or key; 0 for none. */
  savedId: number;
  /** The name of new HTTPS credentials or of a pasted key. */
  name: string;
  username: string;
  password: string;
  privateKey: string;
  /** The passphrase of a locked saved key or of a pasted key; never kept after a submit (AR-46). */
  passphrase: string;
  /** The name of a key to generate. */
  generateName: string;
  /** "I have added this key to my git server" (AR-29). */
  keyAdded: boolean;
}

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
export interface AddRepositoryContext {
  /** The user's repositories, for the early checks of AR-12 and AR-15; empty until loaded. */
  readonly index: Signal<RepositoryIndex['repositories']>;
  /** The user's saved credentials; empty until loaded. */
  readonly saved: Signal<SavedCredentials>;
}

/** The credentials of a protocol as they start (AR-16, AR-19, AR-23): saved ones first, when there are any. */
export function defaultCredentials(protocol: 'https' | 'ssh' | undefined, saved: SavedCredentials): CredentialsModel {
  const list = protocol === 'ssh' ? saved.sshKeys : protocol === 'https' ? saved.https : [];
  const first = list[0];
  const choice: CredentialsChoice = first ? 'saved' : protocol === 'ssh' ? 'new-ssh-key' : 'new-https';
  return {
    choice,
    savedId: first?.id ?? 0,
    name: '',
    username: '',
    password: '',
    privateKey: '',
    passphrase: '',
    generateName: '',
    keyAdded: false
  };
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

/** The API's value for the section, or `undefined` while it cannot have one. */
export function toRepositoryCredentials(credentials: CredentialsModel): RepositoryCredentials | undefined {
  switch (credentials.choice) {
    case 'none':
      return { mode: 'none' };
    case 'saved':
      return credentials.savedId === 0 ? undefined : {
        mode: 'saved',
        credentialId: credentials.savedId,
        ...(credentials.passphrase === '' ? {} : { passphrase: credentials.passphrase })
      };
    case 'new-https':
      return {
        mode: 'new-https',
        name: credentials.name.trim(),
        username: credentials.username,
        password: credentials.password
      };
    default:
      return undefined;
  }
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

    const credentials = path.credentials;
    applyWhen(credentials, ({ valueOf }) => valueOf(credentials.choice) === 'saved', saved => {
      validate(saved.savedId, ({ value }) => value() === 0 ? { kind: 'required' } : undefined);
    });
    applyWhen(credentials, ({ valueOf }) => valueOf(credentials.choice) === 'new-https', https => {
      validateStandardSchema(https.name, credentialName);
      validateStandardSchema(https.username, NewHttpsCredentialsSchema.shape.username);
      validateStandardSchema(https.password, NewHttpsCredentialsSchema.shape.password);
    });
  };
}
