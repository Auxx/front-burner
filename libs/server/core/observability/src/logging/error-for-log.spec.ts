import { readFile, rename } from 'node:fs/promises';
import { errorForLog, withoutPaths } from './error-for-log';

async function failure(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a failure');
}

describe('withoutPaths', () => {
  it('NF-10.5: removes the paths of a file system error from its message and stack, and keeps its code', async () => {
    const error = await failure(() => readFile('/data/repos/1/2/docs/private-plan.md'));

    const safe = withoutPaths(error);

    expect(safe.message).toBe('ENOENT: no such file or directory, open \'<path>\'');
    expect(safe.stack).not.toContain('private-plan.md');
    expect(safe).toMatchObject({ code: 'ENOENT', syscall: 'open' });
    expect(safe).not.toHaveProperty('path');
  });

  it('removes both paths of a rename', async () => {
    const error = await failure(() => rename('/data/repos/1/2/a-secret.md', '/data/repos/1/2/b-secret.md'));

    expect(String(withoutPaths(error))).not.toMatch(/secret/);
  });

  it('returns any other error as it is', () => {
    const error = new Error('git operation failed: merge-blocked');

    expect(withoutPaths(error)).toBe(error);
  });
});

describe('errorForLog', () => {
  it('describes an error without the paths in it', async () => {
    const error = await failure(() => readFile('/data/repos/1/2/docs/private-plan.md'));

    expect(errorForLog(error)).toBe('Error: ENOENT: no such file or directory, open \'<path>\'');
  });

  it('describes a value that is not an error', () => {
    expect(errorForLog('stopped')).toBe('stopped');
  });
});
