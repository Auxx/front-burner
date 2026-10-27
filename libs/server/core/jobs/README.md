# server-core-jobs

The job runner (A-6): stores background jobs in the `jobs` table, runs them in
concurrency pools, resolves the jobs a stopped backend left running, and runs
the repeating housekeeping jobs.

## Running unit tests

Run `nx test server-core-jobs` to execute the unit tests via
[Vitest](https://vitest.dev/).
