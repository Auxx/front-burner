import { z } from 'zod';

/** What an entry of the file tree is (FB-16, FB-20). */
export const ENTRY_KINDS = [ 'folder', 'file', 'symlink', 'submodule' ] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

/** One entry of a folder listing (FB-16 to FB-20b). */
export const EntrySchema = z
  .object({
    name: z.string(),
    kind: z.enum(ENTRY_KINDS),
    /** In bytes, files only. */
    size: z.number().int().nonnegative().nullable(),
    /** Files only (FB-21). */
    markdown: z.boolean(),
    /** Ignored by `.gitignore` and not tracked, or inside an ignored folder (FB-20b). */
    ignored: z.boolean(),
    /** Folders only: the folder has no entries. */
    empty: z.boolean()
  })
  .meta({ id: 'Entry' });

/** One folder of a working copy: at most 5,000 entries, `more` counts the rest (FB-18). */
export const FolderListingSchema = z
  .object({
    /** The folder's path; `''` is the root. */
    path: z.string(),
    /** The folder itself is ignored. */
    ignored: z.boolean(),
    entries: z.array(EntrySchema),
    more: z.number().int().nonnegative()
  })
  .meta({ id: 'FolderListing' });

/** Which folder to list; the root by default. */
export const FolderQuerySchema = z
  .object({ path: z.string().max(4096).default('') })
  .meta({ id: 'FolderQuery' });

export type Entry = z.infer<typeof EntrySchema>;
export type FolderListing = z.infer<typeof FolderListingSchema>;
export type FolderQuery = z.infer<typeof FolderQuerySchema>;
