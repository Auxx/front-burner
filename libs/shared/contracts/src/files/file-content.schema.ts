import { z } from 'zod';

/** A path of a working copy, as `FolderQuery`'s. */
const PathSchema = z.string().max(4096);

/** The line ending a Markdown file is saved with (ED-12). */
export const LINE_ENDINGS = [ 'lf', 'crlf' ] as const;

export type LineEnding = (typeof LINE_ENDINGS)[number];

/** SHA-256 of the file's bytes on disk, lower-case hex (ED-6, ED-24). */
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The Markdown file to read. */
export const FileQuerySchema = z.object({ path: PathSchema }).meta({ id: 'FileQuery' });

/**
 * A Markdown file opened for editing (ED-2, ED-6): its text with `\n` line
 * breaks and without a byte order mark, and what is needed to save it back
 * unchanged (ED-12).
 */
export const FileContentSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    lineEnding: z.enum(LINE_ENDINGS),
    /** The file starts with a UTF-8 byte order mark. */
    bom: z.boolean(),
    hash: HashSchema,
    /** In bytes, as stored. */
    size: z.number().int().nonnegative()
  })
  .meta({ id: 'FileContent' });

/** A save of an existing file (ED-12, ED-19), or **Recreate it** of a missing one (ED-21). */
export const SaveFileRequestSchema = z
  .object({
    path: PathSchema,
    /** With `\n` line breaks; each is written as `lineEnding`. */
    content: z.string(),
    lineEnding: z.enum(LINE_ENDINGS),
    bom: z.boolean()
  })
  .meta({ id: 'SaveFileRequest' });

/** A file's content as it is on disk now, without the content itself. */
export const FileStateSchema = z
  .object({ hash: HashSchema, size: z.number().int().nonnegative() })
  .meta({ id: 'FileState' });

export type FileQuery = z.infer<typeof FileQuerySchema>;
export type FileContent = z.infer<typeof FileContentSchema>;
export type SaveFileRequest = z.infer<typeof SaveFileRequestSchema>;
export type FileState = z.infer<typeof FileStateSchema>;
