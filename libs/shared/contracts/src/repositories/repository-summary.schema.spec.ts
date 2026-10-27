import { z } from 'zod';
import { RecentRepositoriesSchema, RepositorySummarySchema } from './repository-summary.schema';

const summary = {
  id: 1,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('RepositorySummarySchema', () => {
  it('parses a summary', () => {
    expect(RepositorySummarySchema.parse(summary)).toEqual(summary);
  });

  it('refuses an unknown status', () => {
    expect(RepositorySummarySchema.safeParse({ ...summary, status: 'archived' }).success).toBe(false);
  });

  it('refuses an unknown warning', () => {
    expect(RepositorySummarySchema.safeParse({ ...summary, warnings: [ 'slow' ] }).success).toBe(false);
  });
});

describe('RecentRepositoriesSchema', () => {
  it('refuses more than 10 repositories', () => {
    const repositories = Array.from({ length: 11 }, (_, id) => ({ ...summary, id }));
    expect(RecentRepositoriesSchema.safeParse({ repositories }).success).toBe(false);
  });
});

describe('registry', () => {
  it.each(
    [
      [ RepositorySummarySchema, 'RepositorySummary' ],
      [ RecentRepositoriesSchema, 'RecentRepositories' ]
    ] as const
  )('registers %#', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });
});
