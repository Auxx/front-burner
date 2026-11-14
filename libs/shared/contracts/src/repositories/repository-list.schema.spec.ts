import { z } from 'zod';
import { RepositoryListSchema } from './repository-list.schema';

const summary = {
  id: 1,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('RepositoryListSchema', () => {
  it('accepts more than 10 repositories, as the list is not limited like the recent one', () => {
    const repositories = Array.from({ length: 50 }, (_, id) => ({ ...summary, id }));
    expect(RepositoryListSchema.parse({ repositories }).repositories).toHaveLength(50);
  });

  it('refuses an entry that is not a summary', () => {
    expect(RepositoryListSchema.safeParse({ repositories: [ { ...summary, status: 'archived' } ] }).success)
      .toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(RepositoryListSchema)?.id).toBe('RepositoryList');
  });
});
