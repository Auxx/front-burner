# server-feature-sync

Git for a user's working copies (REQ-GIT-002). So far: the status.

- `SyncModule`: `GET /api/v1/repositories/:id/git/status`, the branch, its
  counts against the upstream and every changed file (GA-11). Relies on the
  global auth guard of `server-feature-auth` and the global `GitModule`, and
  takes no lock (A-5.3).

## Running unit tests

Run `nx test server-feature-sync` to execute the unit tests via
[Vitest](https://vitest.dev/).
