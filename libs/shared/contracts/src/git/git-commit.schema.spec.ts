import { COMMIT_MAX_PATHS, COMMIT_MESSAGE_MAX_LENGTH, CommitRequestSchema } from './git-commit.schema';

describe('CommitRequestSchema', () => {
  const valid = { message: 'Update the handbook', paths: [ 'a.md' ] };
  const accepts = (value: unknown) => CommitRequestSchema.safeParse(value).success;

  it('keeps the message as written', () => {
    const message = '  Subject longer than seventy-two characters, which is only a hint, not a rule  \n\n# Why\n';
    expect(CommitRequestSchema.parse({ ...valid, message })).toEqual({ ...valid, message });
  });

  it('refuses a message that is empty after trimming', () => {
    expect(accepts({ ...valid, message: '' })).toBe(false);
    expect(accepts({ ...valid, message: ' \n\t\n' })).toBe(false);
  });

  it('refuses a message over the limit', () => {
    expect(accepts({ ...valid, message: 'x'.repeat(COMMIT_MESSAGE_MAX_LENGTH) })).toBe(true);
    expect(accepts({ ...valid, message: 'x'.repeat(COMMIT_MESSAGE_MAX_LENGTH + 1) })).toBe(false);
  });

  it('needs 1 to 10,000 paths', () => {
    expect(accepts({ ...valid, paths: [] })).toBe(false);
    expect(accepts({ ...valid, paths: Array.from({ length: COMMIT_MAX_PATHS }, (_, i) => `${i}.md`) })).toBe(true);
    expect(accepts({ ...valid, paths: Array.from({ length: COMMIT_MAX_PATHS + 1 }, (_, i) => `${i}.md`) })).toBe(
      false
    );
  });

  it('amending needs no paths (GA-19)', () => {
    expect(accepts({ ...valid, paths: [], amend: true })).toBe(true);
    expect(accepts({ ...valid, paths: [], amend: false })).toBe(false);
  });

  it('amending still needs a message and keeps the limit on paths', () => {
    expect(accepts({ ...valid, message: ' ', paths: [], amend: true })).toBe(false);
    expect(
      accepts({ ...valid, amend: true, paths: Array.from({ length: COMMIT_MAX_PATHS + 1 }, (_, i) => `${i}.md`) })
    ).toBe(false);
  });
});
