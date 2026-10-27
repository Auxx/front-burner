# server-feature-repositories

A user's repositories (A-2). So far: the dashboard's recent list (REQ-DASH-001).

- `RepositoriesModule`: `GET /api/v1/repositories/recent`, up to 10 of the
  logged-in user's repositories, most recently accessed first, ties by name
  ignoring case (DS-16, DS-17). Relies on the global auth guard of
  `server-feature-auth`.
- `RepositoryQueries`: reads repositories, always for one user (DS-3, A-7.3).
- `toSummary`: a row as clients see it, with the remote in its display form and
  never with credentials (DS-19).

## Running unit tests

Run `nx test server-feature-repositories` to execute the unit tests via
[Vitest](https://vitest.dev/).
