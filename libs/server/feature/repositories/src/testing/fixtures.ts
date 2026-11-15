import {
  Database,
  insertUserPreferences,
  NewRepository,
  repositories,
  Repository,
  users
} from '@front-burner/server-core-database';

/** Inserts a user and returns its ID. */
export function insertUser(database: Database, email: string): number {
  const user = database.db.insert(users).values({
    email,
    displayName: email,
    role: 'user',
    loginMethod: 'password',
    passwordHash: '$argon2id$hash',
    createdAt: new Date(0)
  }).returning().get();
  insertUserPreferences(database.db, user);
  return user.id;
}

/**
 * A ready, fully cloned repository row, as read from the database, for the
 * mapping functions; `values` override the defaults.
 */
export function repositoryRow(values: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    userId: 1,
    name: 'handbook',
    remoteUrl: 'https://github.com/acme/handbook.git',
    credentialId: null,
    cloneMode: 'full',
    branch: null,
    gitLevel: 'advanced',
    status: 'ready',
    errorCode: null,
    errorDetail: null,
    errorRequestId: null,
    commitAuthorName: null,
    commitAuthorEmail: null,
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
    ...values
  };
}

/** Inserts a ready, fully cloned repository; `values` override the defaults. */
export function insertRepository(
  database: Database,
  userId: number,
  values: Partial<NewRepository> & Pick<NewRepository, 'name'>
): number {
  return database.db.insert(repositories).values({
    userId,
    remoteUrl: 'https://github.com/acme/handbook.git',
    cloneMode: 'full',
    gitLevel: 'advanced',
    status: 'ready',
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
    ...values
  }).returning().get().id;
}
