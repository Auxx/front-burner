import { GitFetchedSchema, GitIncomingQuerySchema, GitIncomingSchema } from './git-fetch.schema';
import { GitJobStateSchema, GitNetworkJobSchema } from './git-push.schema';

describe('GitFetchedSchema', () => {
  it('parses a fetch, which is a git job\'s outcome', () => {
    const moved = { kind: 'fetched', moved: true, upstreamMoved: false };
    expect(GitFetchedSchema.parse(moved)).toEqual(moved);
    expect(GitFetchedSchema.safeParse({ kind: 'fetched' }).success).toBe(false);
    expect(GitFetchedSchema.safeParse({ kind: 'fetched', moved: true }).success).toBe(false);
    const fetched = { status: 'done', outcome: { kind: 'fetched', moved: false, upstreamMoved: false } };
    expect(GitJobStateSchema.parse(fetched)).toEqual(fetched);
  });

  it('is a network job', () => {
    expect(GitNetworkJobSchema.parse({ id: 4, type: 'fetch' })).toEqual({ id: 4, type: 'fetch' });
  });
});

describe('GitIncomingSchema', () => {
  it('parses what is incoming, and nothing to compare with', () => {
    const incoming = { incoming: { upstream: 'origin/main', commits: 3, touchesPath: true } };
    expect(GitIncomingSchema.parse(incoming)).toEqual(incoming);
    expect(GitIncomingSchema.parse({ incoming: null })).toEqual({ incoming: null });
    expect(
      GitIncomingSchema.safeParse({ incoming: { upstream: 'origin/main', commits: -1, touchesPath: false } })
        .success
    ).toBe(false);
  });
});

describe('GitIncomingQuerySchema', () => {
  it('takes an optional path, never an empty one', () => {
    expect(GitIncomingQuerySchema.parse({})).toEqual({});
    expect(GitIncomingQuerySchema.parse({ path: 'docs/a.md' })).toEqual({ path: 'docs/a.md' });
    expect(GitIncomingQuerySchema.safeParse({ path: '' }).success).toBe(false);
  });
});
