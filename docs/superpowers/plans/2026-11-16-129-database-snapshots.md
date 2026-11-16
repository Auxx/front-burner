# Database Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 129 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): Front
Burner writes a consistent database snapshot to `/data/backups/` every day and
keeps the last 7, both changeable, so that a file-level backup of a running
instance always includes a good copy of the database (NF-6.2).

**Architecture:** `DatabaseSnapshots` in `server/core/database` writes with
`VACUUM INTO` to a `.partial` file and renames it into place, so that a
half-written snapshot never looks like a good one. Names sort by time:
`front-burner-<UTC time>-v<version>.sqlite` _(plan's call)_, with `:` written as
`-`. Pruning keeps the newest `FRONT_BURNER_DB_SNAPSHOT_KEEP` of these and never
touches files with another prefix (plan 130's `pre-upgrade-…`). A housekeeping
job, `database.snapshot`, runs every hour and from the start, without
`spreadOnStart`, and writes a snapshot only when the newest one of its own
prefix is older than `FRONT_BURNER_DB_SNAPSHOT_INTERVAL`, or there is none
_(plan's call: the age of the newest file decides, not a timer. A fresh instance
has its first snapshot a moment after it starts, which plans 142 and 153 rely
on. A crash loop writes at most one, and a restart never restarts the
interval.)_ The runner needs no change. Plan 130 calls the same writer with
another prefix.

**Tech Stack:** as before (`better-sqlite3`). No new packages.

**Spec:** `docs/architecture/non-functional.md` NF-6.2, NF-6.5;
`docs/architecture/data.md` A-4.12; `docs/architecture/overview.md` A-1.15
(`FRONT_BURNER_DB_SNAPSHOT_INTERVAL` `1d`, `FRONT_BURNER_DB_SNAPSHOT_KEEP` `7`);
`docs/architecture/jobs.md` (Housekeeping).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- `FRONT_BURNER_DB_SNAPSHOT_KEEP` is a whole number of at least 1; the interval
  is at least `1h` _(plan's call: more often than that only wears the disk)_.
- `backups/` is created by `prepareDataDir` with the other folders, in the data
  directory (never the repositories directory).
- A snapshot that fails (for example a full disk) is logged at `error`, leaves
  no `.partial` behind and does not change the existing snapshots.

## Review Focus

- **A snapshot while saves and commits write** is still a consistent database →
  test `a snapshot during writes opens and passes integrity_check`.
- **A failure mid-write** leaves the previous 7 → test `a failed snapshot
  removes its partial file and prunes nothing`.
- **Other files in `backups/`**, such as the operator's own copies, are never
  pruned → test `prunes only its own snapshots`.

---

### Task 1: Writing and pruning

**Files:**

- Create: `libs/server/core/database/src/snapshots/database-snapshots.ts` (+
  spec)
- Modify: `libs/server/core/database/src/index.ts`,
  `libs/server/core/config/src/config/` (two variables, + spec),
  `apps/server/src/startup/prepare-data-dir.ts` (`backups/`, + spec)

**Interfaces:**

- Produces: `Config.dbSnapshotIntervalMs: number`, `Config.dbSnapshotKeep:
  number`; `DatabaseSnapshots.write(prefix: string): string` (the file's path),
  `DatabaseSnapshots.prune(prefix: string, keep: number): string[]` (removed
  files); `DatabaseSnapshots.newest(prefix: string): Date | undefined` (from the
  file names, not the file times, which a restore changes); `SNAPSHOT_PREFIX =
  'front-burner'`.

- [ ] **Step 1: Write the failing tests**: `writes a snapshot named with the
      time and version`; `a snapshot during writes opens and passes
      integrity_check`; `a failed snapshot removes its partial file and prunes
      nothing`; `keeps the newest seven`; `prunes only its own snapshots`;
      `finds the newest snapshot by its name`; config: `reads the snapshot
      interval and count`, `refuses a count of 0`, `refuses an interval under an
      hour`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-database`, `npx nx test server-core-config`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same commands.
- [ ] **Step 5: Commit** — `feat(database): database snapshots`

---

### Task 2: The housekeeping job

**Files:**

- Create: `libs/server/core/jobs/src/housekeeping/database-snapshot.job.ts` (+
  spec), or next to `DatabaseSnapshots` if the jobs library may not import the
  database library's new class (check the project tags)
- Modify: the module that registers it, `docs/architecture/jobs.md`,
  `docs/architecture/data.md` (A-4.12: the file names)

- [ ] **Step 1: Write the failing tests**: `registers database.snapshot every
      hour`; `writes a snapshot at the first run when there is none`; `skips a
      run while the newest snapshot is younger than the interval`; `writes once
      the newest is older than the interval, and prunes`; `restarts in a loop
      write one snapshot` (a crash loop must not fill the disk).
- [ ] **Step 2: Run them, implement, run them again.**
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(jobs): daily database snapshot`.
