import { z } from 'zod';
import { RepositoryDetailsSchema } from './repository-details.schema';

const details = {
  summary: {
    id: 1,
    name: 'handbook',
    remote: 'github.com/acme/handbook',
    status: 'error',
    error: 'clone-failed',
    warnings: [],
    clone: null,
    lastAccessedAt: '2026-10-26T10:00:00.000Z'
  },
  cloneMode: 'single-branch',
  branch: 'main',
  gitLevel: 'advanced',
  addedAt: '2026-10-26T10:00:00.000Z',
  errorDetail: 'fatal: repository not found',
  errorRequestId: 'request-1'
};

describe('RepositoryDetailsSchema', () => {
  it('accepts the details of a failed single-branch clone', () => {
    expect(RepositoryDetailsSchema.parse(details)).toEqual(details);
  });

  it('accepts a full clone without an error record', () => {
    const ready = { ...details, cloneMode: 'full', branch: null, errorDetail: null, errorRequestId: null };
    expect(RepositoryDetailsSchema.safeParse(ready).success).toBe(true);
  });

  it('refuses an unknown clone mode', () => {
    expect(RepositoryDetailsSchema.safeParse({ ...details, cloneMode: 'shallow' }).success).toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(RepositoryDetailsSchema)?.id).toBe('RepositoryDetails');
  });
});
