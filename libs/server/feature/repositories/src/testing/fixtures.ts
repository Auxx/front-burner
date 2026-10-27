import { Database, NewRepository, repositories, users } from '@front-burner/server-core-database';

/** Inserts a user and returns its ID. */
export function insertUser(database: Database, email: string): number {
  return database.db.insert(users).values({
    email,
    displayName: email,
    role: 'user',
    loginMethod: 'password',
    passwordHash: '$argon2id$hash',
    createdAt: new Date(0)
  }).returning().get().id;
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
