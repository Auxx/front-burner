import { z } from 'zod';

export const CommitAuthorNameSchema = z
  .string()
  .trim()
  .superRefine((name, ctx) => {
    if (name.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter a name', params: { code: 'name-required' } });
      return;
    }
    if (name.length > 255) {
      ctx.addIssue({ code: 'custom', message: 'Name is too long', params: { code: 'name-too-long' } });
      return;
    }
    if (/[<>\r\n]/.test(name)) {
      ctx.addIssue({ code: 'custom', message: 'Name is invalid', params: { code: 'name-invalid' } });
      return;
    }
  });

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
    if (/[<>\s]/.test(email)) {
      ctx.addIssue({ code: 'custom', message: 'Email is invalid', params: { code: 'email-invalid' } });
      return;
    }
    const atIndex = email.indexOf('@');
    if (atIndex === -1 || atIndex === 0 || atIndex === email.length - 1 || email.indexOf('@', atIndex + 1) !== -1) {
      ctx.addIssue({ code: 'custom', message: 'Email is invalid', params: { code: 'email-invalid' } });
      return;
    }
  });

/** Rules of CA-10; name is trimmed. */
export const CommitAuthorSchema = z
  .object({
    name: CommitAuthorNameSchema,
    email: CommitAuthorEmailSchema
  })
  .meta({ id: 'CommitAuthor' });

export const CommitAuthorPreferenceSchema = z
  .object({
    author: CommitAuthorSchema,
    confirmed: z.boolean()
  })
  .meta({ id: 'CommitAuthorPreference' });

export const COMMIT_AUTHOR_SOURCES = [ 'default', 'override' ] as const;
export type CommitAuthorSource = (typeof COMMIT_AUTHOR_SOURCES)[number];

export const RepositoryCommitAuthorSchema = z
  .object({
    author: CommitAuthorSchema,
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
