import { z } from 'zod';
import { RemovalCheckResultSchema, wouldLoseWork } from './removal-check.schema';

const nothing = { uncommittedFiles: 0, unpushedCommits: 0, stashes: 0, mergeInProgress: false, unreadable: false };

describe('RemovalCheckResultSchema', () => {
  it('accepts counts and flags', () => {
    const check = { ...nothing, uncommittedFiles: 2, unpushedCommits: 3 };
    expect(RemovalCheckResultSchema.parse(check)).toEqual(check);
  });

  it('refuses a negative count', () => {
    expect(RemovalCheckResultSchema.safeParse({ ...nothing, uncommittedFiles: -1 }).success).toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(RemovalCheckResultSchema)?.id).toBe('RemovalCheckResult');
  });
});

describe('wouldLoseWork', () => {
  it('is false when there is nothing to lose', () => {
    expect(wouldLoseWork(nothing)).toBe(false);
  });

  it.each([
    [ 'uncommitted files', { uncommittedFiles: 1 } ],
    [ 'commits not pushed', { unpushedCommits: 1 } ],
    [ 'stashed changes', { stashes: 1 } ],
    [ 'a merge in progress', { mergeInProgress: true } ],
    [ 'an unreadable working copy', { unreadable: true } ]
  ])('is true with %s', (_name, change) => {
    expect(wouldLoseWork({ ...nothing, ...change })).toBe(true);
  });
});
