import { z } from 'zod';
import {
  COMMIT_AUTHOR_FIELD_CODES,
  COMMIT_AUTHOR_SOURCES,
  CommitAuthorPreferenceSchema,
  CommitAuthorSchema,
  RepositoryCommitAuthorSchema
} from './commit-author.schema';

const codeOf = (result: z.SafeParseReturnType<unknown, unknown>, path: string) => {
  if (result.success) {
    return null;
  }
  const issue = result.error.issues.find(i => i.path.join('.') === path);
  return (issue as { params?: { code?: string; }; } | undefined)?.params?.code ?? issue?.code;
};

describe('CommitAuthorSchema', () => {
  it('accepts noreply and dotless addresses', () => {
    expect(
      CommitAuthorSchema.parse({ name: 'Alice', email: '12345+user@users.noreply.github.com' })
    ).toEqual({ name: 'Alice', email: '12345+user@users.noreply.github.com' });
    expect(
      CommitAuthorSchema.parse({ name: 'Alice', email: 'me@nas' })
    ).toEqual({ name: 'Alice', email: 'me@nas' });
  });

  it('refuses a name with <, an email without @ and an email with a space', () => {
    const resName = CommitAuthorSchema.safeParse({ name: 'Alice <tag>', email: 'alice@example.com' });
    expect(resName.success).toBe(false);
    expect(codeOf(resName, 'name')).toBe('name-invalid');

    const resEmailNoAt = CommitAuthorSchema.safeParse({ name: 'Alice', email: 'aliceexample.com' });
    expect(resEmailNoAt.success).toBe(false);
    expect(codeOf(resEmailNoAt, 'email')).toBe('email-invalid');

    const resEmailSpace = CommitAuthorSchema.safeParse({ name: 'Alice', email: 'alice @example.com' });
    expect(resEmailSpace.success).toBe(false);
    expect(codeOf(resEmailSpace, 'email')).toBe('email-invalid');
  });

  it('refuses an email without one @ between two parts', () => {
    const resMultiAt = CommitAuthorSchema.safeParse({ name: 'Alice', email: 'a@b@c' });
    expect(resMultiAt.success).toBe(false);
    expect(codeOf(resMultiAt, 'email')).toBe('email-invalid');

    const resNoLocal = CommitAuthorSchema.safeParse({ name: 'Alice', email: '@nas' });
    expect(resNoLocal.success).toBe(false);
    expect(codeOf(resNoLocal, 'email')).toBe('email-invalid');

    const resNoDomain = CommitAuthorSchema.safeParse({ name: 'Alice', email: 'me@' });
    expect(resNoDomain.success).toBe(false);
    expect(codeOf(resNoDomain, 'email')).toBe('email-invalid');
  });

  it('refuses a name of only spaces and a line break in either field', () => {
    const resSpaces = CommitAuthorSchema.safeParse({ name: '   ', email: 'alice@example.com' });
    expect(resSpaces.success).toBe(false);
    expect(codeOf(resSpaces, 'name')).toBe('name-required');

    const resEmptyName = CommitAuthorSchema.safeParse({ name: '', email: 'alice@example.com' });
    expect(resEmptyName.success).toBe(false);
    expect(codeOf(resEmptyName, 'name')).toBe('name-required');

    const resEmptyEmail = CommitAuthorSchema.safeParse({ name: 'Alice', email: '' });
    expect(resEmptyEmail.success).toBe(false);
    expect(codeOf(resEmptyEmail, 'email')).toBe('email-required');

    const resNameBreak = CommitAuthorSchema.safeParse({ name: 'Alice\nBob', email: 'alice@example.com' });
    expect(resNameBreak.success).toBe(false);
    expect(codeOf(resNameBreak, 'name')).toBe('name-invalid');

    const resEmailBreak = CommitAuthorSchema.safeParse({ name: 'Alice', email: 'alice\n@example.com' });
    expect(resEmailBreak.success).toBe(false);
    expect(codeOf(resEmailBreak, 'email')).toBe('email-invalid');
  });

  it('limits a name to 255 and an email to 254 characters', () => {
    const maxName = 'a'.repeat(255);
    expect(CommitAuthorSchema.parse({ name: maxName, email: 'a@b.com' })).toEqual({
      name: maxName,
      email: 'a@b.com'
    });

    const tooLongName = 'a'.repeat(256);
    const resName = CommitAuthorSchema.safeParse({ name: tooLongName, email: 'a@b.com' });
    expect(resName.success).toBe(false);
    expect(codeOf(resName, 'name')).toBe('name-too-long');

    const maxEmail = `${'a'.repeat(248)}@b.com`; // 248 + 6 = 254
    expect(CommitAuthorSchema.parse({ name: 'Alice', email: maxEmail })).toEqual({
      name: 'Alice',
      email: maxEmail
    });

    const tooLongEmail = `${'a'.repeat(249)}@b.com`; // 249 + 6 = 255
    const resEmail = CommitAuthorSchema.safeParse({ name: 'Alice', email: tooLongEmail });
    expect(resEmail.success).toBe(false);
    expect(codeOf(resEmail, 'email')).toBe('email-too-long');
  });

  it('trims the name', () => {
    expect(CommitAuthorSchema.parse({ name: '  Alice  ', email: 'alice@example.com' })).toEqual({
      name: 'Alice',
      email: 'alice@example.com'
    });
  });
});

describe('CommitAuthorPreferenceSchema and RepositoryCommitAuthorSchema', () => {
  it('parses valid preferences and repository authors', () => {
    const pref = { author: { name: 'Alice', email: 'alice@example.com' }, confirmed: true };
    expect(CommitAuthorPreferenceSchema.parse(pref)).toEqual(pref);

    const repoAuthor = {
      author: { name: 'Alice', email: 'alice@example.com' },
      source: 'override' as const,
      confirmed: false
    };
    expect(RepositoryCommitAuthorSchema.parse(repoAuthor)).toEqual(repoAuthor);
  });
});

describe('registry and constants', () => {
  it.each(
    [
      [ CommitAuthorSchema, 'CommitAuthor' ],
      [ CommitAuthorPreferenceSchema, 'CommitAuthorPreference' ],
      [ RepositoryCommitAuthorSchema, 'RepositoryCommitAuthor' ]
    ] as const
  )('registers %p', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });

  it('exports field codes and sources', () => {
    expect(COMMIT_AUTHOR_SOURCES).toEqual([ 'default', 'override' ]);
    expect(COMMIT_AUTHOR_FIELD_CODES).toContain('name-required');
    expect(COMMIT_AUTHOR_FIELD_CODES).toContain('email-required');
  });
});
