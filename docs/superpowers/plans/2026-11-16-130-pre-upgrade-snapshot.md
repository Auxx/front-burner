# Pre-upgrade Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 130 of [the step 6 index](2026-11-16-00-roadmap-step-6.md):
before the first pending migration, Front Burner writes a pre-upgrade snapshot
named after the old version, and a version that finds a newer database refuses
to start with "Database is from version X; restore the pre-upgrade snapshot to
go back" (NF-7.1, NF-7.3, NF-6.6).

**Architecture:** `instance_state` gets `last_version` (data.md already lists
"last version"), set to `Config.version` at every start after the migrations.
The `migrations` startup step becomes: refuse a newer schema, naming
`last_version` (or "a newer version" when it is empty); when migrations are
pending and the database is not new,
`DatabaseSnapshots.write('pre-upgrade-v<last version>')` (plan 129); then
migrate. Pre-upgrade snapshots are never pruned (A-4.12). Drizzle's migrator
already runs the pending migrations in one transaction; a test pins that.

**Tech Stack:** as before. A Drizzle migration for the column.

**Spec:** `docs/architecture/non-functional.md` NF-7.1, NF-7.3, NF-6.6;
`docs/architecture/data.md` A-4.7, A-4.12.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- A new, empty database gets no snapshot. A database from before this plan has
  no `last_version`: its snapshot is named `pre-upgrade-vunknown-…`.
- A snapshot that fails stops the start before any migration: an upgrade never
  runs without its way back.
- The log at `info` names both versions: `Upgrading the database from 0.1.0 to
  0.2.0; snapshot backups/pre-upgrade-v0.1.0-….sqlite`.

## Review Focus

- **A migration that fails halfway** leaves the database as it was, and the old
  image still starts → test `a failed migration changes nothing`.
- **A full disk at the snapshot** stops the start with the reason, before
  migrating → test `a failed snapshot stops the start before migrating`.
- **Starting the old image after an upgrade** names the version to restore →
  test `refuses a newer database naming its version`.

---

### Task 1: Last version and the refusal

**Files:**

- Modify: `libs/server/core/database/src/schema/instance-state.ts`, a new
  migration in `libs/server/core/database/migrations/`,
  `libs/server/core/database/src/database/migrations.ts` (+ spec),
  `apps/server/src/startup/start-server.ts` (+ spec)

**Interfaces:**

- Produces: `NewerSchemaError` with `lastVersion: string | null` and NF-7.3's
  message; `recordVersion(database: Database, version: string): void`.

- [ ] **Step 1: Write the failing tests**: `records the version after
      migrating`; `refuses a newer database naming its version`; `refuses a
      newer database without a recorded version`; `a failed migration changes
      nothing`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-database`, `npx nx test server`.
- [ ] **Step 3: Implement.** Generate the migration with `drizzle-kit generate`
      and review it (A-4.6).
- [ ] **Step 4: Run them and see them pass** — same commands.
- [ ] **Step 5: Commit** — `feat(database): record the last version`

---

### Task 2: The snapshot before migrating

**Files:**

- Modify: `apps/server/src/startup/start-server.ts` (+ spec),
  `apps/server-e2e/src/startup.e2e.spec.ts`, `docs/architecture/data.md`
  (A-4.7), `docs/architecture/overview.md` (A-1.11's steps)

**Interfaces:**

- Consumes: `DatabaseSnapshots.write(prefix)` (plan 129).

- [ ] **Step 1: Write the failing tests**: `writes a pre-upgrade snapshot named
      after the old version before migrating`; `a new database gets no
      snapshot`; `no pending migration, no snapshot`; `a failed snapshot stops
      the start before migrating`; `the daily pruning leaves pre-upgrade
      snapshots`.
- [ ] **Step 2: Run them, implement, run them again** — `npx nx test server`.
- [ ] **Step 3: Test end to end**: `an upgrade from the previous migrations
      writes a snapshot that opens with the previous schema` (start on a
      database migrated by every migration but the last). Run `npx nx e2e
      server-e2e`.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(server): pre-upgrade snapshot`.
