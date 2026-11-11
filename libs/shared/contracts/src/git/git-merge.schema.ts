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

/** Query parameters for reading one side of a conflicting file (GC-17). */
export const GitMergeVersionQuerySchema = z
  .object({
    path: z.string().min(1).max(4096),
    side: z.enum([ 'ours', 'theirs' ])
  })
  .meta({ id: 'GitMergeVersionQuery' });

/**
 * How a conflicting file is resolved (GC-14 to GC-16): `mark-resolved` as saved,
 * for an editable file; `ours` or `theirs`, the whole version, for a file both
 * changed or added; `keep` or `delete`, for a file one side deleted.
 */
export const GitResolutionSchema = z
  .enum([ 'mark-resolved', 'ours', 'theirs', 'keep', 'delete' ])
  .meta({ id: 'GitResolution' });

/** Resolves one conflicting file; `force` marks it as resolved with markers left (GC-14). */
export const GitResolveRequestSchema = z
  .object({
    path: z.string().min(1).max(4096),
    resolution: GitResolutionSchema,
    force: z.boolean().optional()
  })
  .meta({ id: 'GitResolveRequest' });

export type GitConflictKind = z.infer<typeof GitConflictKindSchema>;
export type GitResolution = z.infer<typeof GitResolutionSchema>;
export type GitResolveRequest = z.infer<typeof GitResolveRequestSchema>;
export type GitConflictFile = z.infer<typeof GitConflictFileSchema>;
export type GitMergeState = z.infer<typeof GitMergeStateSchema>;
export type GitMergeVersion = z.infer<typeof GitMergeVersionSchema>;
export type GitMergeVersionQuery = z.infer<typeof GitMergeVersionQuerySchema>;
