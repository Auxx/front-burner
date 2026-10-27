import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

/** A nullable column that holds values encrypted with the instance key (A-4.8). */
export interface EncryptedColumn {
  table: SQLiteTable;
  column: SQLiteColumn;
}

/**
 * Every encrypted column. A table with an encrypted column adds its entry here;
 * the column is nullable, and `null` means "deleted by a key reset" (NF-8.6).
 */
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [];
