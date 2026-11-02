import { z } from 'zod';

const MAX_NAME_LENGTH = 255;
/** CA-10: `<`, `>`, control characters (line breaks included) and Unicode line separators. */
const NAME_DISALLOWED = /[<>\p{Cc}\u2028\u2029]/u;
/** CA-10: git drops these from the ends of a name, and fails if nothing else is left. */
const GIT_USABLE = /[^\s,:;"'\\<>\p{Cc}]/u;

/**
 * A missing field counts as an empty one, so that it gets the `-required` code.
 * Both fields stay required in the API's description: see `CommitAuthorDto`.
 */
export const CommitAuthorNameSchema = z
  .string()
  .trim()
  .superRefine((name, ctx) => {
    if (name.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter a name', params: { code: 'name-required' } });
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'Name is too long', params: { code: 'name-too-long' } });
      return;
    }
    if (NAME_DISALLOWED.test(name) || !GIT_USABLE.test(name)) {
      ctx.addIssue({ code: 'custom', message: 'Name is invalid', params: { code: 'name-invalid' } });
    }
  })
  .prefault('');

export const CommitAuthorEmailSchema = z
  .string()
  .superRefine((email, ctx) => {
    if (email.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter an email', params: { code: 'email-required' } });
      return;
    }
    if (email.length > 254) {
      ctx.addIssue({ code: 'custom', message: 'Email is too long', params: { code: 'email-too-long' } });
      return;
    }
    const parts = email.split('@');
    if (/[<>\s\p{Cc}]/u.test(email) || parts.length !== 2 || parts.some(part => part.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'Email is invalid', params: { code: 'email-invalid' } });
    }
  })
  .prefault('');

/** Rules of CA-10, for what a client sends; name is trimmed. */
export const CommitAuthorSchema = z
  .object({
    name: CommitAuthorNameSchema,
    email: CommitAuthorEmailSchema
  })
  .meta({ id: 'CommitAuthor' });

/**
 * A commit author as stored. A default copied from an account may break CA-10
 * (CA-7), and must still be readable so that the user can change it.
 */
export const StoredCommitAuthorSchema = z
  .object({
    name: z.string(),
    email: z.string()
  })
  .meta({ id: 'StoredCommitAuthor' });

/**
 * The name of a default commit author (CA-7): the display name without what
 * CA-10 refuses, otherwise the email's local part likewise, otherwise the email.
 */
export function defaultCommitAuthorName(displayName: string, email: string): string {
  for (const candidate of [ displayName, email.split('@')[0] ?? '' ]) {
    const name = candidate
      .replace(/[<>]/g, '')
      .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH)
      .trim();
    if (GIT_USABLE.test(name)) {
      return name;
    }
  }
  return email;
}

export const CommitAuthorPreferenceSchema = z
  .object({
    author: StoredCommitAuthorSchema,
    confirmed: z.boolean()
  })
  .meta({ id: 'CommitAuthorPreference' });

export const COMMIT_AUTHOR_SOURCES = [ 'default', 'override' ] as const;
export type CommitAuthorSource = (typeof COMMIT_AUTHOR_SOURCES)[number];

export const RepositoryCommitAuthorSchema = z
  .object({
    author: StoredCommitAuthorSchema,
    source: z.enum(COMMIT_AUTHOR_SOURCES),
    confirmed: z.boolean()
  })
  .meta({ id: 'RepositoryCommitAuthor' });

export const COMMIT_AUTHOR_FIELD_CODES = [
  'name-required',
  'name-too-long',
  'name-invalid',
  'email-required',
  'email-too-long',
  'email-invalid'
] as const;

export type CommitAuthorFieldCode = (typeof COMMIT_AUTHOR_FIELD_CODES)[number];
export type CommitAuthor = z.infer<typeof CommitAuthorSchema>;
export type CommitAuthorPreference = z.infer<typeof CommitAuthorPreferenceSchema>;
export type RepositoryCommitAuthor = z.infer<typeof RepositoryCommitAuthorSchema>;
