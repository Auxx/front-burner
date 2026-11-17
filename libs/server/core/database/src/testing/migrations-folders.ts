import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The real migrations, which the built server applies. */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Copies the real migrations to `<dir>/<name>` and changes the copy's journal with `edit`. */
function migrationsCopy(dir: string, name: string, edit: (entries: JournalEntry[]) => JournalEntry[]): string {
  const folder = join(dir, name);
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const file = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: JournalEntry[]; };
  writeFileSync(file, JSON.stringify({ ...journal, entries: edit(journal.entries) }));
  return folder;
}

/**
 * The previous version's migrations: every real migration but the last, in
 * `<dir>/previous`.
 */
export function previousMigrations(dir: string): string {
  return migrationsCopy(dir, 'previous', entries => entries.slice(0, -1));
}

/**
 * A newer version's migrations: the real ones and one more, which creates the
 * table `future`, in `<dir>/newer`.
 */
export function newerMigrations(dir: string): string {
  const folder = migrationsCopy(dir, 'newer', entries => {
    const last = entries[entries.length - 1];
    return [ ...entries, { ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_future' } ];
  });
  writeFileSync(join(folder, '9999_future.sql'), 'CREATE TABLE `future` (`id` integer PRIMARY KEY NOT NULL);');
  return folder;
}
