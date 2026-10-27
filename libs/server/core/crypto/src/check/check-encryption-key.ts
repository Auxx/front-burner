import { Database, ENCRYPTED_COLUMNS, EncryptedColumn, instanceState } from '@front-burner/server-core-database';
import { eq, sql } from 'drizzle-orm';
import { SecretBinding, SecretBox, SecretDecryptionError } from '../secret-box/secret-box';

const ROW = 1;
const CHECK_PLAINTEXT = 'front-burner-check';
const CHECK_BINDING: SecretBinding = { table: 'instance_state', recordId: ROW };

/** The encryption key cannot decrypt the check value, so it is not the key the secrets were stored with (NF-8.5). */
export class EncryptionKeyMismatchError extends Error {
  constructor() {
    super(
      'FRONT_BURNER_ENCRYPTION_KEY does not match the key this instance\'s secrets were encrypted with. Use the right key, or start once with FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm to delete every stored secret (NF-8.6).'
    );
    this.name = 'EncryptionKeyMismatchError';
  }
}

/**
 * Startup step 5 (A-1.11, A-4.10): checks the encryption key against the
 * stored check value, storing one on the first start.
 *
 * A requested reset acts only when the key does not match: it sets every
 * encrypted column to `null` and stores a new check value, in one transaction
 * (NF-8.6). With a matching key it is ignored and the result is `verified`.
 *
 * @param columns Replaces {@link ENCRYPTED_COLUMNS}; meant for tests.
 * @throws EncryptionKeyMismatchError when the key does not match and no reset is requested.
 */
export function checkEncryptionKey(
  database: Database,
  box: SecretBox,
  options: { reset: boolean; },
  columns: readonly EncryptedColumn[] = ENCRYPTED_COLUMNS
): 'stored' | 'verified' | 'reset' {
  return database.db.transaction(tx => {
    const stored = tx.select({ check: instanceState.encryptionCheck }).from(instanceState)
      .where(eq(instanceState.id, ROW)).get()?.check;
    // The onboarding state is worked out later (OnboardingStateService); `required` only fills a new row.
    const store = () => {
      const encryptionCheck = box.encrypt(CHECK_PLAINTEXT, CHECK_BINDING);
      tx.insert(instanceState)
        .values({ id: ROW, onboardingState: 'required', encryptionCheck })
        .onConflictDoUpdate({ target: instanceState.id, set: { encryptionCheck } })
        .run();
    };

    if (stored === undefined || stored === null) {
      store();
      return 'stored';
    }
    try {
      if (box.decrypt(stored, CHECK_BINDING) === CHECK_PLAINTEXT) {
        return 'verified';
      }
    } catch (error) {
      if (!(error instanceof SecretDecryptionError)) {
        throw error;
      }
    }
    if (!options.reset) {
      throw new EncryptionKeyMismatchError();
    }
    for (const { table, column } of columns) {
      tx.run(sql`UPDATE ${table} SET ${sql.identifier(column.name)} = NULL`);
    }
    store();
    return 'reset';
  });
}
