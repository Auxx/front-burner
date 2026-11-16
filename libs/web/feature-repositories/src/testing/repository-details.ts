import type { RepositoryDetails } from '@front-burner/shared-contracts';

/** The details of a ready, fully cloned "handbook" (ID 7), with `summary` and the rest changed by `extra`. */
export function repositoryDetails(
  summary: Partial<RepositoryDetails['summary']> = {},
  extra: Partial<Omit<RepositoryDetails, 'summary'>> = {}
): RepositoryDetails {
  return {
    summary: {
      id: 7,
      name: 'handbook',
      remote: 'github.com/acme/handbook',
      status: 'ready',
      error: null,
      warnings: [],
      clone: null,
      lastAccessedAt: '2026-10-26T10:00:00.000Z',
      ...summary
    },
    cloneMode: 'full',
    branch: null,
    gitLevel: 'advanced',
    addedAt: '2026-10-25T09:30:00.000Z',
    errorDetail: null,
    errorRequestId: null,
    remoteProblems: { fetch: null, push: null },
    ...extra
  };
}
