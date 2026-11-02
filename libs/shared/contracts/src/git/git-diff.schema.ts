import { z } from 'zod';

export const DIFF_LINE_TYPES = [ 'context', 'added', 'removed' ] as const;

export const DiffLineSchema = z
  .object({
    type: z.enum(DIFF_LINE_TYPES),
    /** In the last commit's version; `null` for an added line. */
    oldLine: z.number().int().positive().nullable(),
    /** In the working tree's version; `null` for a removed line. */
    newLine: z.number().int().positive().nullable(),
    /** Without the line break; a trailing `\r` is kept, so that a line ending change can be shown (GA-16). */
    text: z.string()
  })
  .meta({ id: 'DiffLine' });

const SizeSchema = z.number().int().min(0).nullable();

/** One changed file's difference from the last commit (GA-14 to GA-16). */
export const GitDiffSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('text'),
      /** Empty when the file is not changed (any more). */
      lines: z.array(DiffLineSchema),
      /** Every unchanged line is included, so every fold can be opened; false for a file over 1 MB. */
      complete: z.boolean(),
      /** Only the line endings changed (GA-16). */
      lineEndingsOnly: z.boolean()
    }),
    z.object({
      kind: z.literal('binary'),
      /** In bytes; `null` when that side does not exist. */
      oldSize: SizeSchema,
      newSize: SizeSchema
    }),
    /** The diff is larger than 1 MB (GA-16). */
    z.object({ kind: z.literal('too-large') })
  ])
  .meta({ id: 'GitDiff' });

/** One file of a working copy, as in the files API. */
export const GitDiffQuerySchema = z.object({ path: z.string().min(1).max(4096) }).meta({ id: 'GitDiffQuery' });

export type DiffLine = z.infer<typeof DiffLineSchema>;
export type GitDiff = z.infer<typeof GitDiffSchema>;
export type GitDiffQuery = z.infer<typeof GitDiffQuerySchema>;
