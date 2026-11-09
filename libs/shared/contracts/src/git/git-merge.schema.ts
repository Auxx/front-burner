import { z } from 'zod';

/** Which sides have the file: both changed or added it, or one side deleted it (GC-15, GC-16). */
export const GitConflictKindSchema = z
  .enum([ 'both-changed', 'both-added', 'deleted-by-us', 'deleted-by-them' ])
  .meta({ id: 'GitConflictKind' });

/** One file the merge could not combine, resolved or not (GC-7, GC-17). */
export const GitConflictFileSchema = z
  .object({
    path: z.string(),
    kind: GitConflictKindSchema,
    resolved: z.boolean(),
    /**
     * It can be opened with its conflict markers: Markdown, in both versions a
     * regular file that git can merge as text, and ED-2 holds (GC-9).
     */
    editable: z.boolean(),
    /** In bytes; `null` when this version does not exist or is a submodule. */
    oursSize: z.number().int().min(0).nullable(),
    theirsSize: z.number().int().min(0).nullable()
  })
  .meta({ id: 'GitConflictFile' });

/** The merge in progress, as git's own state has it (A-4.5, GC-6, GC-7, GC-20). */
export const GitMergeStateSchema = z
  .object({
    /** The current branch, such as `main`. */
    into: z.string(),
    /** The branch's upstream, such as `origin/main`, also after a fetch pruned it. */
    from: z.string(),
    /** Sorted by path, comparing code units, so that the order is the same on every device. */
    files: z.array(GitConflictFileSchema),
    /** What merged without conflicts, sorted the same way. */
    otherFiles: z.array(z.string()),
    /** The merge commit's message as git prepared it, for the user to edit. */
    message: z.string()
  })
  .meta({ id: 'GitMergeState' });

/** One version of a conflicting file for the user to compare (GC-17). */
export const GitMergeVersionSchema = z
  .object({
    content: z.string()
  })
  .meta({ id: 'GitMergeVersion' });

export type GitConflictKind = z.infer<typeof GitConflictKindSchema>;
export type GitConflictFile = z.infer<typeof GitConflictFileSchema>;
export type GitMergeState = z.infer<typeof GitMergeStateSchema>;
export type GitMergeVersion = z.infer<typeof GitMergeVersionSchema>;
