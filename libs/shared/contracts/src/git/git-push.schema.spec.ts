import { GitJobParamsSchema, GitJobStartedSchema, GitJobStateSchema, GitNetworkJobSchema } from './git-push.schema';

describe('GitJobStartedSchema', () => {
  it('parses a job ID', () => {
    expect(GitJobStartedSchema.parse({ jobId: 4 })).toEqual({ jobId: 4 });
    expect(GitJobStartedSchema.safeParse({ jobId: 'x' }).success).toBe(false);
  });
});

describe('GitJobStateSchema', () => {
  it('parses an unfinished job without an outcome', () => {
    expect(GitJobStateSchema.parse({ status: 'running', outcome: null })).toEqual({ status: 'running', outcome: null });
  });

  it('parses a push and a refused push', () => {
    const pushed = { status: 'done', outcome: { kind: 'pushed', commits: 2, upstream: 'origin/main' } };
    expect(GitJobStateSchema.parse(pushed)).toEqual(pushed);
    const refused = {
      status: 'done',
      outcome: { kind: 'failed', code: 'push-rejected', params: { remoteMessages: 'No.', branch: 'main' } }
    };
    expect(GitJobStateSchema.parse(refused)).toEqual(refused);
  });

  it('parses each result of a pull, and refuses another', () => {
    for (const result of [ 'up-to-date', 'fast-forward', 'merged', 'conflicted' ]) {
      const pulled = { status: 'done', outcome: { kind: 'pulled', result, commits: 2, upstream: 'origin/main' } };
      expect(GitJobStateSchema.parse(pulled)).toEqual(pulled);
    }
    const rebased = {
      status: 'done',
      outcome: { kind: 'pulled', result: 'rebased', commits: 2, upstream: 'origin/main' }
    };
    expect(GitJobStateSchema.safeParse(rebased).success).toBe(false);
  });

  it('refuses an unknown status and an outcome of an unknown kind', () => {
    expect(GitJobStateSchema.safeParse({ status: 'paused', outcome: null }).success).toBe(false);
    expect(GitJobStateSchema.safeParse({ status: 'done', outcome: { kind: 'pulled' } }).success).toBe(false);
  });
});

describe('GitNetworkJobSchema', () => {
  it('parses a push', () => {
    expect(GitNetworkJobSchema.parse({ id: 4, type: 'push' })).toEqual({ id: 4, type: 'push' });
    expect(GitNetworkJobSchema.parse({ id: 5, type: 'pull' })).toEqual({ id: 5, type: 'pull' });
    expect(GitNetworkJobSchema.safeParse({ id: 4, type: 'clone' }).success).toBe(false);
  });
});

describe('GitJobParamsSchema', () => {
  it('reads both IDs from the path', () => {
    expect(GitJobParamsSchema.parse({ id: '3', jobId: '12' })).toEqual({ id: 3, jobId: 12 });
    expect(GitJobParamsSchema.safeParse({ id: '3', jobId: 'x' }).success).toBe(false);
  });
});
