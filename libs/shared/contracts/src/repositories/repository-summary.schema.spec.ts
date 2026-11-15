import { z } from 'zod';
import {
  CloneProgressSchema,
  RecentQuerySchema,
  RecentRepositoriesSchema,
  RepositoryParamsSchema,
  RepositorySummarySchema
} from './repository-summary.schema';

const summary = {
  id: 1,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  clone: null,
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};

describe('RepositorySummarySchema', () => {
  it('parses a summary', () => {
    expect(RepositorySummarySchema.parse(summary)).toEqual(summary);
  });

  it('parses a clone that waits and one that runs', () => {
    const waiting = { ...summary, status: 'cloning', clone: { jobId: 3, state: 'waiting', percent: null } };
    const running = { ...summary, status: 'cloning', clone: { jobId: 3, state: 'running', percent: 42 } };
    expect(RepositorySummarySchema.parse(waiting)).toEqual(waiting);
    expect(RepositorySummarySchema.parse(running)).toEqual(running);
  });

  it('refuses a percentage above 100', () => {
    const clone = { jobId: 3, state: 'running', percent: 101 };
    expect(RepositorySummarySchema.safeParse({ ...summary, clone }).success).toBe(false);
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
      [ CloneProgressSchema, 'CloneProgress' ],
      [ RecentRepositoriesSchema, 'RecentRepositories' ],
      [ RecentQuerySchema, 'RecentQuery' ]
    ] as const
  )('registers %#', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });
});

describe('RepositoryParamsSchema', () => {
  it('coerces the id', () => {
    expect(RepositoryParamsSchema.parse({ id: '7' })).toEqual({ id: 7 });
  });

  it('refuses an id that is not a positive integer', () => {
    expect(RepositoryParamsSchema.safeParse({ id: '0' }).success).toBe(false);
    expect(RepositoryParamsSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(RepositoryParamsSchema)?.id).toBe('RepositoryParams');
  });
});

describe('RecentQuerySchema', () => {
  it('has no exclude by default', () => {
    expect(RecentQuerySchema.parse({})).toEqual({});
  });

  it('coerces exclude', () => {
    expect(RecentQuerySchema.parse({ exclude: '7' })).toEqual({ exclude: 7 });
  });

  it('refuses an exclude that is not a positive integer', () => {
    expect(RecentQuerySchema.safeParse({ exclude: '0' }).success).toBe(false);
    expect(RecentQuerySchema.safeParse({ exclude: 'abc' }).success).toBe(false);
  });
});
