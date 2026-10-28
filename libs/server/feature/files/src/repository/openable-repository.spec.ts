import { Repository } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DataLayout } from '@front-burner/server-core-storage';
import type { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { OpenableRepository } from './openable-repository';

describe('OpenableRepository', () => {
  const row = (status: Repository['status']) => ({ id: 7, userId: 3, status }) as Repository;
  const openable = (found: Repository | undefined) => {
    const queries = { find: vi.fn().mockReturnValue(found) } as unknown as RepositoryQueries;
    return { openable: new OpenableRepository(queries, new DataLayout('/data')), queries };
  };
  const failure = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiErrorException);
      const { code, params } = error as ApiErrorException;
      return { status: (error as ApiErrorException).getStatus(), code, params };
    }
    throw new Error('did not throw');
  };

  it('gives the working copy of a ready repository', () => {
    const { openable: subject, queries } = openable(row('ready'));
    expect(subject.root(3, 7)).toBe('/data/repos/3/7');
    expect(queries.find).toHaveBeenCalledWith(3, 7);
  });

  it('refuses a cloning repository with its status', () => {
    const { openable: subject } = openable(row('cloning'));
    expect(failure(() => subject.root(3, 7)))
      .toEqual({ status: 409, code: 'repository-not-openable', params: { status: 'cloning' } });
  });

  it('answers a missing or another user\'s repository with not-found', () => {
    const { openable: subject } = openable(undefined);
    expect(failure(() => subject.root(3, 7))).toEqual({ status: 404, code: 'not-found', params: {} });
  });
});
