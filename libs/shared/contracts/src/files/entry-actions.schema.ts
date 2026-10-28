import { entryNameProblem } from '@front-burner/shared-util';
import { z } from 'zod';

/** A path of a working copy, as `FolderQuery`'s. */
const PathSchema = z.string().max(4096);

/**
 * A name for a new or renamed entry (FB-27); the issue's code is its problem.
 * Not trimmed: names are stored as typed (FB-28). The sibling clash needs the
 * disk and is checked by the backend (`name-taken`).
 */
export const EntryNameSchema = z.string().superRefine((name, ctx) => {
  const problem = entryNameProblem(name);
  if (problem !== null) {
    ctx.addIssue({ code: 'custom', message: 'This name can\'t be used', params: { code: problem } });
  }
});

export const NEW_ENTRY_KINDS = [ 'file', 'folder' ] as const;

/** **New file** or **New folder** in `folder` (FB-29 to FB-34). A file's name gets `.md` if it has no Markdown extension. */
export const CreateEntryRequestSchema = z
  .object({ folder: PathSchema, name: EntryNameSchema, kind: z.enum(NEW_ENTRY_KINDS) })
  .meta({ id: 'CreateEntryRequest' });

/** **Rename** in place (FB-35). */
export const RenameEntryRequestSchema = z
  .object({ path: PathSchema, name: EntryNameSchema })
  .meta({ id: 'RenameEntryRequest' });

/** The path of a created or renamed entry. */
export const EntryPathSchema = z.object({ path: z.string() }).meta({ id: 'EntryPath' });

/** The entry to summarise. */
export const EntryQuerySchema = z.object({ path: PathSchema }).meta({ id: 'EntryQuery' });

/**
 * What an entry holds, for the delete and rename confirmations (FB-35, FB-38).
 * For a file: 1 file, 1 non-Markdown if it is one, 1 uncommitted if it is untracked or ignored.
 */
export const EntrySummarySchema = z
  .object({
    files: z.number().int().nonnegative(),
    nonMarkdown: z.number().int().nonnegative(),
    uncommitted: z.number().int().nonnegative()
  })
  .meta({ id: 'EntrySummary' });

/** Whether a new entry at `path` would be ignored (FB-31, FB-34); it need not exist, its parent must. */
export const IgnoreQuerySchema = z
  .object({ path: PathSchema, kind: z.enum(NEW_ENTRY_KINDS) })
  .meta({ id: 'IgnoreQuery' });

export const IgnoreResultSchema = z.object({ ignored: z.boolean() }).meta({ id: 'IgnoreResult' });

export type NewEntryKind = (typeof NEW_ENTRY_KINDS)[number];
export type CreateEntryRequest = z.infer<typeof CreateEntryRequestSchema>;
export type RenameEntryRequest = z.infer<typeof RenameEntryRequestSchema>;
export type EntryPath = z.infer<typeof EntryPathSchema>;
export type EntryQuery = z.infer<typeof EntryQuerySchema>;
export type EntrySummary = z.infer<typeof EntrySummarySchema>;
export type IgnoreQuery = z.infer<typeof IgnoreQuerySchema>;
export type IgnoreResult = z.infer<typeof IgnoreResultSchema>;
