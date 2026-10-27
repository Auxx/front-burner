import { Database, users } from '@front-burner/server-core-database';

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
