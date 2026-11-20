import { loadConfig } from '@front-burner/server-core-config';
import { assertNoNewerMigrations, Database, openDatabase, sessions, users } from '@front-burner/server-core-database';
import { createBootstrapLogger } from '@front-burner/server-core-observability';
import { PasswordHasher } from '@front-burner/server-feature-auth';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyIssues,
  type PasswordRule
} from '@front-burner/shared-contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import type { DestinationStream } from 'pino';

export interface ResetPasswordOptions {
  env: Record<string, string | undefined>;
  email: string;
  /** Where the password is read from: a terminal (without echo) or a pipe (two lines). */
  input: Readable;
  /** Where the prompts and the one-line refusal go; `process.stderr` in `main.ts`. */
  output: Writable;
  migrationsFolder: string;
  cwd?: string;
  version?: string;
  /** Replaces stdout as the log destination; meant for tests. */
  logDestination?: DestinationStream;
}

/** A reason to stop, printed as one line; the exit code is 1. */
class Refusal extends Error {}

/** What each rule of the password policy asks for (REQ-AUTH-002). */
const RULE_TEXT: Record<PasswordRule, string> = {
  'too-short': `be at least ${PASSWORD_MIN_LENGTH} characters long`,
  'too-long': `be at most ${PASSWORD_MAX_LENGTH} characters long`,
  'too-few-classes':
    'mix at least two of lowercase letters, uppercase letters, other letters, digits and other characters',
  'control-character': 'not contain control characters',
  'equals-email': 'not be the user\'s email'
};

/**
 * `node main.js reset-password <email>`: the operator's way back in after a
 * lost password (MVP "Risks"; A-7.2a). Runs the startup steps that it needs,
 * configuration and the database with its newer-schema check, but never
 * migrates and touches nothing but the database. Reads the new password twice,
 * checks it against the password policy, stores its hash and revokes every
 * session of the user in one transaction. The login audit log is not written:
 * a reset is not a login attempt.
 *
 * The instance must be stopped: the command does not detect a running one,
 * whose session cache would still accept the revoked sessions (NF-4.2).
 *
 * @returns the exit code: 0 when the password was reset, 1 after a one-line refusal on `output`.
 */
export async function resetPassword(options: ResetPasswordOptions): Promise<number> {
  let database: Database | undefined;
  try {
    const { config } = loadConfig(options.env, { cwd: options.cwd, version: options.version });
    const databaseFile = join(config.dataDir, 'db', 'front-burner.sqlite');
    if (!existsSync(databaseFile)) {
      throw new Refusal(`No database in ${config.dataDir}; start the instance once first`);
    }
    database = openDatabase(databaseFile);
    if (assertNoNewerMigrations(database, options.migrationsFolder).pending > 0) {
      throw new Refusal('Start the instance once to upgrade the database, then stop it and run this again');
    }

    const email = options.email.trim();
    const user = database.db.select({
      id: users.id,
      email: users.email,
      loginMethod: users.loginMethod,
      disabled: users.disabled
    })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .get();
    if (user === undefined) {
      throw new Refusal('No password user with this email');
    }
    if (user.loginMethod !== 'password') {
      throw new Refusal('This user signs in with OIDC');
    }
    // A disabled user cannot log in or reset their password (LG-13).
    if (user.disabled) {
      throw new Refusal('This user is disabled');
    }

    const entries = await readPasswordTwice(options.input, options.output);
    if (entries === undefined) {
      throw new Refusal('Expected the new password twice on standard input');
    }
    const [ password, repeated ] = entries;
    if (password !== repeated) {
      throw new Refusal('The two entries differ; nothing was changed');
    }
    const issues = passwordPolicyIssues(password, user.email);
    if (issues.length > 0) {
      throw new Refusal(
        `The password does not meet the password policy: it must ${issues.map(rule => RULE_TEXT[rule]).join('; ')}`
      );
    }

    // Hashing is slow and asynchronous, so it happens before the transaction.
    const passwordHash = await new PasswordHasher().hash(password);
    const userId = user.id;
    database.db.transaction(tx => {
      tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
      tx.update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .run();
    });
    // Quoted in the deployment guide (docs/wiki/deployment.md): change both together.
    createBootstrapLogger(config, options.logDestination).warn(
      { userId },
      `Password of user ${userId} reset from the command line; every session revoked`
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.output.write(`${message.replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  } finally {
    database?.sqlite.close();
  }
}

/** Swallows what readline echoes, so that a password typed on a terminal is not shown. */
function muted(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
}

/**
 * Two lines of `input`, never trimmed (PP-2). On a terminal each is prompted
 * for and not echoed; Ctrl+C gives up.
 *
 * @returns undefined when the input ends first.
 */
async function readPasswordTwice(input: Readable, output: Writable): Promise<[ string, string ] | undefined> {
  const terminal = (input as Readable & { isTTY?: boolean; }).isTTY === true;
  const reader = createInterface({ input, output: terminal ? muted() : undefined, terminal, crlfDelay: Infinity });
  reader.on('SIGINT', () => reader.close());
  const lines = reader[Symbol.asyncIterator]();
  try {
    const entries: string[] = [];
    for (const prompt of [ 'New password: ', 'Repeat the new password: ' ]) {
      if (terminal) {
        output.write(prompt);
      }
      const line = await lines.next();
      if (terminal) {
        output.write('\n');
      }
      if (line.done === true) {
        return undefined;
      }
      entries.push(line.value);
    }
    return [ entries[0], entries[1] ];
  } finally {
    reader.close();
  }
}
