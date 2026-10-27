# Front Burner — Job runner

> Status: **Draft**

How background work is stored, scheduled and run. Lives in `server/jobs` (A-2).
See [overview.md](overview.md) for the numbering conventions.

## A-6: Design

- **A-6.1** We write our own runner. Ready-made queues assume Redis or Postgres,
  and our needs are small (NF-4.3).
- **A-6.2** Jobs are rows in a `jobs` table: type, owner (user and repository,
  when there is one), JSON payload, status (`queued`, `running`, `done`,
  `failed`, `cancelled`), time to run, attempts, progress, result or error code,
  and an optional **dedupe key** that is unique among unfinished jobs.
- **A-6.3** Payloads never contain secrets. A clone that uses an unlocked key
  (AR-49) keeps its copy of the key in an in-memory map keyed by job ID, removed
  when the job ends. It is lost on restart, which is fine: an interrupted clone
  fails (AR-54).
- **A-6.4** A loop in the backend process claims due jobs atomically (`UPDATE …
  RETURNING`). Enqueuing wakes the loop at once; otherwise it checks for
  scheduled jobs every second.
- **A-6.5** Each job type belongs to a **concurrency pool**: clones
  (`FRONT_BURNER_CLONE_CONCURRENCY`, default 2, AR-52), fetches and sync cycles
  (4), email (1), housekeeping (1). The git engine's per-repository queue
  (A-5.3) still serialises work on each working copy. _(My call: the sizes of
  the last three pools.)_
- **A-6.6** Progress and results are published on the push channel (A-3.11).
  Metrics cover queue depth, durations and failures per type (NF-10.11).

## A-6: Job types

| Job                                             | Scheduling                                                                                                                                                                                                                                                    | On failure                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Clone** (AR-49)                               | Queued when a repository is added. At most 3 waiting or running per user (NF-11.4).                                                                                                                                                                           | Fails once; the user retries.                                                                                                      |
| **Simple-level sync cycle** (D-2.1, D-2.8)      | One job per repository with auto-sync on, dedupe key `sync:<repository>`. Every save moves its time to run to _now + 60 s_. Also scheduled _now_ after the user fixes a sync failure, or when a background fetch finds remote commits and no save is waiting. | A cause that may clear on its own schedules the next cycle in 15 minutes; a cause only the user can fix waits for the fix (D-2.8). |
| **Background fetch** (D-4.2)                    | Every **2 minutes** for each repository that a push channel stream is viewing (A-3.12); stops when no stream views it. Dedupe key `fetch:<repository>`.                                                                                                       | Not retried; the next run is the retry.                                                                                            |
| **Pull, push, merge, rebase** started by a user | Queued by the request when it may take longer than about 2 seconds (A-1.13).                                                                                                                                                                                  | Fails; the user retries (NF-9.5).                                                                                                  |
| **Conflict reminder email** (D-3.7)             | Scheduled for 2 days after the conflict episode starts; cancelled when it ends. Delivered at least once (NF-9.5).                                                                                                                                             | Retried 3 times with backoff.                                                                                                      |
| **Delete folder** (FB-40)                       | The request moves the folder into `tmp/` with one rename (same file system, NF-5.3), so it is gone from the working copy at once, then queues the job to delete it.                                                                                           | Retried at next startup, since `tmp/` is emptied on start (NF-5.1).                                                                |
| **Remove repository** (RM-19, RM-21)            | The request cancels the repository's clone and fetch jobs, deletes its rows (A-4.5b) and moves its working copy into `tmp/`, then queues the job to delete it.                                                                                                | Retried at next startup, as above.                                                                                                 |
| **Key rotation** (A-4.9)                        | Queued at startup when a previous encryption key is set.                                                                                                                                                                                                      | Retried at next startup.                                                                                                           |
| **Housekeeping**                                | Built-in repeating jobs: session cleanup (LG-38), login audit retention (LG-45), database snapshot (NF-6.2), disk space check (NF-9.7), deleting finished jobs older than 7 days.                                                                             | Runs again on schedule.                                                                                                            |

- **A-6.7** _(My call.)_ The 2-minute background fetch interval is a constant,
  not an operator setting, until a reason to change it appears.

## A-6: Restart

- **A-6.8** On startup, jobs left `running` are resolved by type as in NF-9.5
  before the loop starts. Overdue scheduled jobs of the types that ask for it,
  such as housekeeping, are spread over the first two minutes instead of all
  running at once. _(My call: which types, and two minutes.)_
