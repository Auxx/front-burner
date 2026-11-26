# Release checks

> Status: **In progress**. Plans 149 to 157 fill the rows marked **To check**;
> plan 157 closes this document.

This is the record of the release checks of MVP step 6 (`docs/product/mvp.md`,
"Order of work"): every rule of
[non-functional.md](../architecture/non-functional.md) that is in the MVP or
limited in it (`mvp.md`, section 11 of "In scope"), what proves it, and the
result. Rules that are not in the MVP (NF-1.6, NF-8.4, NF-13.4) are left out.
For a rule limited in the MVP, only the MVP's part is checked; its row says
which part.

## How to read and fill it

**How it is checked** is one or more of:

- **Test**: an automated test, named by its file and title, that CI runs. It was
  read, not only found by its name: it checks what the rule says, not only that
  something exists.
- **Hand**: a check by a person, with the plan that writes its script.
- **Measured**: a number measured with a tool, with the plan that runs it and
  the tool.
- **Document**: a rule an operator follows, or a decision visible only in the
  design, with the section of the guide or the architecture that says it.

A row that a test proves only in part names the rest and the plan that checks
it, as for acceptance criteria: a partial test does not count as the whole.

**Result** is **Pass**, **Fail** (with a link to the fix or its plan), **Not
applicable** (with the reason), or **To check** with the plan that will check
it. **Date** and **Commit** say when and on what the result was taken. A hand
check also records the device and the browser versions, in its plan's section
below the tables.

Every check of Part E (plans 149 to 157) writes its result here, as the step 6
index's shared constraints say. A plan that finds a rule nobody can check yet
adds a row here first. Each rule links to its text; the first cell of a row is a
link, not a bare ID, so that `doc-ids.mjs` reads the row as a reference and not
as a second definition.

The **Pass** results of 2026-11-20 come from a run on a developer machine at
commit `7e82076`: `npx nx run-many -t test`, `npx nx e2e server-e2e`, `npx nx
e2e web-e2e` in Chromium (desktop and phone) and `npx nx run web:size-check`.
Plan 154 repeats the end-to-end suites in every browser.

- In that web-e2e run, five tests that no row cites failed. Three passed when
  run again (load on the machine). `login.spec.ts`'s "AC-AUTH-003.14: sends the
  user to the login page when the refresh fails" fails every time, in both
  projects: after the reload, the administrators' `GET /api/v1/instance/storage`
  (plan 132) answers `401`, and the test does not drain it.
- The container suite (`npx nx run server-e2e:e2e-container`) could not run on
  that machine: its Docker daemon saw neither the suite's files in `/tmp` nor
  its published port. Rows that need the container suite therefore take its
  result from CI's `image` job, which plan 153 records with its own tests (see
  [Plan 153](#plan-153-resilience-checks)).

## NF-1: Scale

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Result                           | Date       | Commit    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------- | --------- |
| [NF-1.1][nf-1] | **Measured**: plan 150's `perf-api.mjs scale` seeds 50 users with 50 small repositories each; `perf-api.mjs ready` times a restart among them (recovery visits every working copy, NF-9.4) and `run --users 10` the API measures; plan 152 runs them on the reference host. Indicative: [Plan 150](#plan-150-indicative-api-timings). [Reference host](#reference-host): the 50 users fit and the instance starts among them, ready after 46 s, but only just inside the image's health check. [Plan 161](#plan-161-health-check-start-period): with a 5-minute start period, a cold start among them is `starting` for 81 s and `healthy` 2 s after ready. | Pass                             | 2026-11-25 | `aade0f2` |
| [NF-1.2][nf-1] | **Measured**: plan 150's `perf-api.mjs run --users 10` runs its measures from 10 users at once, each pausing 5 s on average before each operation (plan 160, recorded at NF-1.2); plan 152 runs it on the reference host. Indicative: [Plan 150](#plan-150-indicative-api-timings). [Reference host](#reference-host), with no pauses: NF-2.1 and NF-2.6 missed. [Plan 160](#plan-160-ten-users-measured-again), with the pauses: every target holds, the pull closest (p95 944 ms added).                                                                                                                                                                  | Pass                             | 2026-11-24 | `f052735` |
| [NF-1.3][nf-1] | **Measured**: as NF-1.1, `perf-api.mjs scale` (2,500 working copies). The disk they need: **Document**, [Sizing the disk](deployment.md#sizing-the-disk). [Reference host](#reference-host): 2,500 working copies, recovered on start in 42 s.                                                                                                                                                                                                                                                                                                                                                                                                              | Pass                             | 2026-11-23 | `f9c295c` |
| [NF-1.4][nf-1] | **Test**: `libs/server/feature/files/src/listing/folder-lister.spec.ts` › "AC-FILE-001.7: lists 1,000 entries within 300 ms in a repository of 100,000 files". The rest, a repository of that size cloned, opened, committed and pushed: **Measured** by plan 150's `gen-large-repo.mjs` and `perf-api.mjs run --large` (clone, status, commit, push), on the reference host by plan 152. Indicative: [Plan 150](#plan-150-indicative-api-timings). [Reference host](#reference-host): cloned in 35 s; the folder 94 ms, warm status 521 ms and commit 1.4 s at p95; 10 pushes, worst 1.4 s.                                                                | Pass                             | 2026-11-23 | `f9c295c` |
| [NF-1.5][nf-1] | **Test**: `apps/server-e2e/src/files.e2e.spec.ts` › "AC-EDIT-001.10: refuses a save over 1 MB and accepts it once smaller"; `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.10: shows the 1 MB refusal and saves again once smaller". Editing a 1 MB file on a phone: **Hand**, plan 155 (NF-2.4).                                                                                                                                                                                                                                                                                                                                                         | Not measured: see the NF-2.4 row | 2026-11-26 | `e0e4a48` |
| [NF-1.7][nf-1] | **Document**: [Sizing the disk](deployment.md#sizing-the-disk) gives the formula, per user and working copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass                             | 2026-11-20 | `7e82076` |

[nf-1]: ../architecture/non-functional.md#nf-1-scale

## NF-2: Performance

The targets are p95 on the reference host. The tests below run on whatever
machine runs CI, so they prove the code path, not the number; the number is plan
152's.

| Rule            | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Result                                                                                                                                      | Date       | Commit    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| [NF-2.1][nf-2]  | **Test** (API, median of 5, not on the reference host): `libs/server/feature/files/src/listing/folder-lister.spec.ts` › "AC-FILE-001.7: lists 1,000 entries within 300 ms in a repository of 100,000 files". **Measured**: API by plan 150 (`perf-api.mjs`), screen on slow 4G by plan 151 (`perf-screen.mjs`), both on the reference host by plan 152. Indicative API: [Plan 150](#plan-150-indicative-api-timings). Indicative screen: [Plan 151](#plan-151-indicative-screen-timings), 1.1 s on slow 4G; [after compression](#plan-159-after-compression), 0.61 s. [Reference host](#reference-host), before compression: API 94 ms for one user, 633 ms for 10 at once with no pauses; screen 1.1 s on slow 4G, a row set by the network, not the host. [Plan 160](#plan-160-ten-users-measured-again): API 82 ms for one user, 128 ms for 10 at once.                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass                                                                                                                                        | 2026-11-24 | `f052735` |
| [NF-2.2][nf-2]  | **Test** (screen, one run): `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.2: is ready to edit a 100 KB file within NF-2.2". **Measured**: API by plan 150, screen on broadband and slow 4G by plan 151, on the reference host by plan 152. Indicative API: [Plan 150](#plan-150-indicative-api-timings). Indicative screen: [Plan 151](#plan-151-indicative-screen-timings), broadband passes, 8.3 s on slow 4G; [after compression](#plan-159-after-compression), 3.4 s on slow 4G; [plan 162](#plan-162-round-trips), the editor's chunks in one wave with the file, 2.3 s. [Reference host](#reference-host), before compression: API 48 ms for one user, 174 to 208 ms for 10 at once with no pauses; screen 182 ms on broadband, 8.3 s on slow 4G. [Plan 160](#plan-160-ten-users-measured-again): API 20 ms for one user, 25 ms for 10 at once. [Plan 162 on the reference host](#on-the-reference-host): 2.3 s (desktop) and 2.5 s (phone) on slow 4G, the editor's 293 KB of chunks. [Plan 163](#plan-163-editor-bytes), the preview pipeline and the HTML grammars out of the editor's chunks (143 KB of Brotli left), with a budget the build checks: 1.5 s (desktop) and 1.6 s (phone) on slow 4G; [on the reference host](#on-the-reference-host-1), 1.47 s (desktop) and 1.59 s (phone). | Pass                                                                                                                                        | 2026-11-25 | `cb5f662` |
| [NF-2.3][nf-2]  | **Test** (the indicator, not the time): `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.3: saves after typing stops without committing". **Measured**: the API's 200 ms by plan 150, on the reference host by plan 152. Indicative: [Plan 150](#plan-150-indicative-api-timings). [Reference host](#reference-host): 19 ms for one user, 81 to 135 ms for 10 at once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pass                                                                                                                                        | 2026-11-23 | `f9c295c` |
| [NF-2.4][nf-2]  | **Hand**: plan 155, `typing-test.mjs` on a real mid-range phone at 200 KB and 1 MB, with and without the conflict view (`docs/wiki/typing-test.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Not measured: no lag noticed in a week of use on an Android phone ([Plan 155](#plan-155-phones)); the measurement is in `docs/wiki/todo.md` | 2026-11-26 | `e0e4a48` |
| [NF-2.5][nf-2]  | **Test** (CPU-throttled Chromium, not a phone): `apps/web-e2e/src/preview.spec.ts` › "AC-EDIT-001.16: updates a 200 KB file's preview within 300 ms after typing stops". **Measured**: plan 151 (`perf-screen.mjs`), on the reference host by plan 152. Indicative: [Plan 151](#plan-151-indicative-screen-timings), 126 ms on a desktop; 1.1 s on the phone profile, from the tap on **Preview**. [Reference host](#reference-host): the same, 128 ms and 1.2 s (no server part).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fail on the phone profile (to decide with plan 155)                                                                                         | 2026-11-23 | `f9c295c` |
| [NF-2.6][nf-2]  | **Measured**: plan 150 (`perf-api.mjs`, the job against plain `git`), on the reference host by plan 152. Indicative: [Plan 150](#plan-150-indicative-api-timings). [Reference host](#reference-host): one user adds 547 ms to a pull and 273 ms to a push; 10 users at once with no pauses add 3.3 to 3.7 s and 1.5 to 1.9 s. [Plan 160](#plan-160-ten-users-measured-again): one user adds 273 ms and 115 ms; 10 users at once, 944 ms and 349 ms, the pull within 56 ms of the target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass                                                                                                                                        | 2026-11-24 | `f052735` |
| [NF-2.7][nf-2]  | **Measured**: plan 151 (`perf-screen.mjs`, slow 4G), on the reference host by plan 152. Indicative: [Plan 151](#plan-151-indicative-screen-timings), 11.0 s cold; [after compression](#plan-159-after-compression), 5.4 s cold (desktop) and 5.6 s (phone); [plan 162](#plan-162-round-trips), the first route's chunks preloaded, 3.7 s and 3.8 s. [Reference host](#reference-host), before compression: 11.0 s cold, the same. [Plan 162 on the reference host](#on-the-reference-host): 3.7 s cold (desktop) and 3.8 s (phone), from 8 waves of round trips to 5. **Test** that the preloads break no CSP rule and the translations are fetched once: `apps/web-e2e/src/baseline.spec.ts` › "NF-2.7: a first load asks for i18n/en.json once and breaks no CSP rule".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass                                                                                                                                        | 2026-11-25 | `c1ad1ed` |
| [NF-2.8][nf-2]  | **Document**: clones, pulls, pushes, fetches, merges and large deletes are jobs (A-6 in [jobs.md](../architecture/jobs.md)). **Measured**: whether a cold status or commit at 100,000 files stays under about 2 seconds, plan 150 (`perf-api.mjs run --large --cold`), on the reference host by plan 152, which answers spike 4's question in `spikes.md`. Indicative, warm only: [Plan 150](#plan-150-indicative-api-timings). [Reference host](#reference-host): cold status 2.6 s and cold commit 3.5 s at p95, warm 0.5 s and 1.4 s; status and commit stay requests, by the operator's decision recorded at NF-2.8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass (by decision)                                                                                                                          | 2026-11-23 | `f9c295c` |
| [NF-2.9][nf-2]  | **Test**: `apps/web/scripts/size-check.mjs` (the `web:size-check` target, which CI runs after every build) fails above 300 KB gzipped. Lazy loading of the editor, preview, Shiki and conflict screens: **Document**, A-8.1 in [web-client.md](../architecture/web-client.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass                                                                                                                                        | 2026-11-20 | `7e82076` |
| [NF-2.10][nf-2] | **Test**: `libs/server/feature/files/src/listing/folder-lister.spec.ts` › "AC-FILE-001.7: lists 1,000 entries within 300 ms in a repository of 100,000 files"; `apps/web-e2e/src/repository-screen.spec.ts` › "AC-FILE-001.22: shows Try again for a folder that fails" (one folder at a time).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass                                                                                                                                        | 2026-11-20 | `7e82076` |

[nf-2]: ../architecture/non-functional.md#nf-2-performance

## NF-3: Unsaved edits

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                      | Result | Date       | Commit    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| [NF-3.1][nf-3] | **Test**: `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.3: saves after typing stops without committing" ("Saving…", "Saved") and "AC-EDIT-001.5: saves after the network comes back" ("Not saved — offline, retrying").                                                                                                             | Pass   | 2026-11-20 | `7e82076` |
| [NF-3.2][nf-3] | **Test**: `libs/web/core/src/core/saving/file-saver.spec.ts` › "AC-EDIT-001.5: retries until the backend answers" and "backs off after a failed save during which the delay ended, then saves edits 1.5 s after them"; `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.5: saves after the network comes back" (typing while offline). | Pass   | 2026-11-20 | `7e82076` |
| [NF-3.3][nf-3] | **Test**: `libs/web/core/src/core/saving/draft-store.spec.ts` › "keeps drafts of users, repositories and paths apart"; `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.6: offers an offline edit after a reload and restores it" (deleted once saved).                                                                                | Pass   | 2026-11-20 | `7e82076` |
| [NF-3.4][nf-3] | **Test**: `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.6: offers an offline edit after a reload and restores it"; `libs/web/feature-repository-screen/src/repository-screen/pages/repository-screen/repository-screen.page.spec.ts` › "offers a draft when a file is opened, with the editor read-only until the user chooses".    | Pass   | 2026-11-20 | `7e82076` |
| [NF-3.5][nf-3] | **Test**: `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.7: deletes drafts on logout", "AC-APP-001.3: deletes browser drafts when logging out, in every tab" and "AC-EDIT-001.8: asks before closing a tab with unsaved edits"; `libs/web/core/src/core/saving/draft-store.spec.ts` › "deletes drafts when the session expires".     | Pass   | 2026-11-20 | `7e82076` |
| [NF-3.6][nf-3] | **Document**: a rule that something does not exist. The web client keeps only its own files and browser drafts (NF-3.3), never a file that was not opened ([web-client.md](../architecture/web-client.md)).                                                                                                                            | Pass   | 2026-11-20 | `7e82076` |

[nf-3]: ../architecture/non-functional.md#nf-3-unsaved-edits-on-unreliable-connections

## NF-4: Database

| Rule           | How it is checked                                                                                                                                                                                                                                                                         | Result | Date       | Commit    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| [NF-4.1][nf-4] | **Test**: `libs/server/core/database/src/database/open-database.spec.ts` › "sets the pragmas" (`journal_mode` is `wal`); the file is `db/front-burner.sqlite` under the data directory, `apps/server/src/startup/prepare-data-dir.spec.ts` › "creates db/ and returns the database file". | Pass   | 2026-11-20 | `7e82076` |
| [NF-4.2][nf-4] | **Document**: A-1.1 in [overview.md](../architecture/overview.md): one container runs one Node.js process, and nothing coordinates several.                                                                                                                                               | Pass   | 2026-11-20 | `7e82076` |
| [NF-4.3][nf-4] | **Test**: `libs/server/core/jobs/src/runner/job-runner.spec.ts` (the runner on the `jobs` table). **Document**: A-6 in [jobs.md](../architecture/jobs.md); no queue library is a dependency.                                                                                              | Pass   | 2026-11-20 | `7e82076` |

[nf-4]: ../architecture/non-functional.md#nf-4-database

## NF-5: Data layout

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Result | Date       | Commit    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | --------- |
| [NF-5.1][nf-5] | **Test**: `apps/server/src/startup/prepare-data-dir.spec.ts` › "creates db/ and returns the database file", "creates backups, repos, tmp and orphans" and "empties tmp on start".                                                                                                                                                                                                                                                                                                                                                                                              | Pass   | 2026-11-20 | `7e82076` |
| [NF-5.2][nf-5] | **Test**: `libs/server/core/storage/src/layout/data-layout.spec.ts` › "places a working copy under the user's and repository's IDs".                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass   | 2026-11-20 | `7e82076` |
| [NF-5.3][nf-5] | **Test**: `libs/server/core/storage/src/layout/data-layout.spec.ts` › "puts repos, tmp and orphans under the repositories root" (one root, so one file system).                                                                                                                                                                                                                                                                                                                                                                                                                | Pass   | 2026-11-20 | `7e82076` |
| [NF-5.4][nf-5] | **Test**: `apps/server/src/startup/prepare-data-dir.spec.ts` › "puts repos, tmp and orphans under the repositories directory", "throws when the repositories directory does not exist", "throws when the repositories directory holds anything else, and empties nothing", "accepts the lost+found of a fresh volume" and "warns when the data directory still holds working copies"; `libs/server/core/config/src/config/load-config.spec.ts` (the `FRONT_BURNER_REPOS_DIR` cases); `apps/server-e2e/src/startup.e2e.spec.ts` › "a clone lands under FRONT_BURNER_REPOS_DIR". | Pass   | 2026-11-20 | `7e82076` |
| [NF-5.5][nf-5] | **Test**: `libs/server/core/config/src/config/load-config.spec.ts` › "requires the encryption key" and "requires FRONT_BURNER_JWT_SECRET" (from the environment or a `…_FILE`). **Document**: [Secrets](deployment.md#secrets); the security review's [NF-8 and A-4.8 to A-4.11](security-review.md#nf-8-and-a-48-to-a-411-secrets-at-rest).                                                                                                                                                                                                                                   | Pass   | 2026-11-20 | `7e82076` |
| [NF-5.6][nf-5] | **Test**: `apps/server-e2e/src/container.e2e.spec.ts` › "an unwritable /data stops the start and names the UID"; `apps/server-e2e/src/startup.e2e.spec.ts` › "refuses to start with an unwritable data directory". **Document**: [Volumes and the UID](deployment.md#volumes-and-the-uid).                                                                                                                                                                                                                                                                                     | Pass   | 2026-11-20 | `7e82076` |

[nf-5]: ../architecture/non-functional.md#nf-5-data-layout

## NF-6: Backup and restore

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Result | Date       | Commit    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | --------- |
| [NF-6.1][nf-6] | **Document**: [Backing up](deployment.md#backing-up) and [Keeping the encryption key](deployment.md#keeping-the-encryption-key).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass   | 2026-11-20 | `7e82076` |
| [NF-6.2][nf-6] | **Test**: `libs/server/core/database/src/snapshots/database-snapshots.spec.ts` › "a snapshot during writes opens and passes integrity_check" and "keeps the newest seven"; `libs/server/core/jobs/src/housekeeping/database-snapshot.job.spec.ts` › "writes once the newest is older than the interval, and prunes"; `apps/server-e2e/src/startup.e2e.spec.ts` › "a fresh instance has a database snapshot a moment after it starts". A copy of a running container restored as the guide says: `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-6.2: a copy of a running instance restores from its snapshot".                                                                                                                                                          | Pass   | 2026-11-26 | `59bf61f` |
| [NF-6.3][nf-6] | **Document**: [What a backup protects](deployment.md#what-a-backup-protects).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass   | 2026-11-20 | `7e82076` |
| [NF-6.4][nf-6] | **Test**: `libs/server/feature/repositories/src/orphans/orphaned-working-copies.spec.ts` (every case of the rule, including "runs before working copy recovery"); `apps/server-e2e/src/startup.e2e.spec.ts` › "a working copy left by a removed row is in orphans after a restart"; `apps/web-e2e/src/repository-management.spec.ts` › "AC-REPO-003.5: deleting a working copy's directory while the backend is stopped shows "Working copy is missing or damaged" after the next start…". After a restore in the container: `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-6.4: a restore moves newer working copies to orphans"; after going back from an upgrade: › "NF-7.3: the old image refuses the upgraded database and starts from the pre-upgrade snapshot". | Pass   | 2026-11-26 | `59bf61f` |
| [NF-6.5][nf-6] | **Document**: [Restoring](deployment.md#restoring). **Test**: the procedure followed in the container, `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-6.5: a stopped copy restores as it was".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   | 2026-11-26 | `59bf61f` |
| [NF-6.6][nf-6] | **Test**: `libs/server/core/database/src/database/migrations.spec.ts` › "refuses a newer database naming its version"; `apps/server-e2e/src/startup.e2e.spec.ts` › "refuses to start with a newer database".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   | 2026-11-20 | `7e82076` |

[nf-6]: ../architecture/non-functional.md#nf-6-backup-and-restore

## NF-7: Upgrades

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Result | Date       | Commit    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| [NF-7.1][nf-7] | **Test**: `apps/server/src/startup/upgrade-database.spec.ts` › "writes a pre-upgrade snapshot named after the old version before migrating" and "a failed snapshot stops the start before migrating"; `libs/server/core/database/src/database/migrations.spec.ts` › "a failed migration changes nothing"; `apps/server-e2e/src/startup.e2e.spec.ts` › "an upgrade from the previous migrations writes a snapshot that opens with the previous schema". Two real images, the second with a throwaway migration (CI on pushes to master, and the release workflow): `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-7.1: an upgrade writes a pre-upgrade snapshot and migrates". | Pass   | 2026-11-26 | `59bf61f` |
| [NF-7.2][nf-7] | **Document**: [Upgrading](deployment.md#upgrading); the release workflow takes only `v<major>.<minor>.<patch>` tags (NF-11.12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass   | 2026-11-20 | `7e82076` |
| [NF-7.3][nf-7] | **Test**: `apps/server/src/startup/upgrade-database.spec.ts` › "refuses a newer database naming its version, before any snapshot"; `apps/server-e2e/src/startup.e2e.spec.ts` › "refuses to start with a newer database". **Document**: [Going back after an upgrade](deployment.md#going-back-after-an-upgrade). Two real images, as NF-7.1: `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-7.3: the old image refuses the upgraded database and starts from the pre-upgrade snapshot".                                                                                                                                                                                       | Pass   | 2026-11-26 | `59bf61f` |
| [NF-7.4][nf-7] | **Document**: working copies are plain clones made by the `git` program ([git-engine.md](../architecture/git-engine.md)); nothing of Front Burner is stored in them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass   | 2026-11-20 | `7e82076` |
| [NF-7.5][nf-7] | **Test**: `libs/server/core/crypto/src/secret-box/secret-box.spec.ts` › "starts with the format and the key ID".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass   | 2026-11-20 | `7e82076` |
| [NF-7.6][nf-7] | **Test**: `apps/server-e2e/src/api.e2e.spec.ts` › "sets the version on every API response, errors included"; `apps/web-e2e/src/app-header.spec.ts` › "AC-APP-001.11: after a new version is deployed, every page shows "A new version of Front Burner is available." with Reload…".                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   | 2026-11-20 | `7e82076` |
| [NF-7.7][nf-7] | **Document**: [Upgrading](deployment.md#upgrading) says the instance is unavailable while it restarts; interrupted jobs as NF-9.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass   | 2026-11-20 | `7e82076` |

[nf-7]: ../architecture/non-functional.md#nf-7-upgrades

## NF-8: Secrets

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Result | Date       | Commit    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| [NF-8.1][nf-8] | **Test**: `libs/server/core/config/src/config/load-config.spec.ts` › "requires the encryption key", "refuses a key shorter than 32 characters" and "refuses a key equal to the JWT secret".                                                                                                                                                                                                                                                                                                                                                                                                                    | Pass   | 2026-11-20 | `7e82076` |
| [NF-8.2][nf-8] | **Test**: `libs/server/core/config/src/config/load-config.spec.ts` › "reads the key from a file", "reads the JWT secret from a file", "reads the client secret from a file", "reads the setup token from a _FILE variable" and "reads FRONT_BURNER_METRICS_TOKEN and its _FILE".                                                                                                                                                                                                                                                                                                                               | Pass   | 2026-11-20 | `7e82076` |
| [NF-8.3][nf-8] | **Test**: `libs/server/core/crypto/src/secret-box/secret-box.spec.ts` › "uses a fresh nonce every time", "refuses a value bound to another record" and "refuses a tampered value"; `libs/server/feature/credentials/src/saved/saved-credentials.service.spec.ts` › "stores HTTPS credentials encrypted"; `libs/server/core/database/src/schema/schema.spec.ts` › "registers the client secret as encrypted". AES-256-GCM itself: **Document**, the security review's [NF-8 and A-4.8 to A-4.11](security-review.md#nf-8-and-a-48-to-a-411-secrets-at-rest). SMTP is not in the MVP.                            | Pass   | 2026-11-20 | `7e82076` |
| [NF-8.5][nf-8] | **Test**: `libs/server/core/crypto/src/check/check-encryption-key.spec.ts` › "refuses the wrong key and leaves the values alone"; `apps/server/src/startup/start-server.spec.ts` › "stops at encryption-key with another key".                                                                                                                                                                                                                                                                                                                                                                                 | Pass   | 2026-11-20 | `7e82076` |
| [NF-8.6][nf-8] | **Test**: `libs/server/core/crypto/src/check/check-encryption-key.spec.ts` › "resets with the wrong key and confirm" and "ignores a reset when the key matches"; `apps/server/src/startup/start-server.spec.ts` › "warns about a reset that the matching key made unnecessary"; `libs/server/feature/repositories/src/credentials/repository-credentials.service.spec.ts` › "reports credentials whose secret an encryption key reset deleted as missing". **Document**: [A lost encryption key](deployment.md#a-lost-encryption-key), [Keeping the encryption key](deployment.md#keeping-the-encryption-key). | Pass   | 2026-11-20 | `7e82076` |

[nf-8]: ../architecture/non-functional.md#nf-8-secrets

## NF-9: Availability and resilience

| Rule           | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Result | Date       | Commit    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | --------- |
| [NF-9.1][nf-9] | **Document**: the [compose example](deployment.md#compose-example) sets `restart: unless-stopped` and `stop_grace_period: 30s`. **Test**: `apps/server-e2e/src/container.e2e.spec.ts` › "the guide's compose example becomes healthy" (CI only, see above; plan 153 records it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass   | 2026-11-26 | `59bf61f` |
| [NF-9.2][nf-9] | **Test**: `libs/server/core/jobs/src/runner/job-runner.spec.ts` › "shutdown aborts running jobs" and "shutdown waits at most 25 seconds"; `libs/server/core/git/src/runner/git-runner.spec.ts` › "kills every running git on killAll"; `apps/server-e2e/src/container.e2e.spec.ts` › "stops within the grace period during a clone" (CI only, see above; plan 153 records it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   | 2026-11-26 | `59bf61f` |
| [NF-9.3][nf-9] | **Test**: `libs/server/core/observability/src/health/health.controller.spec.ts` › "answers ready with 503 fail when migrations were not applied"; `apps/server-e2e/src/container.e2e.spec.ts` › "the hardened container becomes healthy". **Document**: the startup order ([non-functional.md](../architecture/non-functional.md), "Startup sequence").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass   | 2026-11-20 | `7e82076` |
| [NF-9.4][nf-9] | **Test**: `libs/server/feature/sync/src/recovery/working-copy-recovery.spec.ts` › "removes a stale lock without ending a merge", "removes HEAD.lock and a ref's lock" and "refreshes each index". In the container after a kill: `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-9.4: a stale index.lock is removed on start".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass   | 2026-11-26 | `59bf61f` |
| [NF-9.5][nf-9] | Limited in the MVP: clones, pulls, pushes, merges waiting for resolution and fetches. **Test**: `apps/server-e2e/src/add-repository.e2e.spec.ts` › "AC-REPO-001.19 after a restart: an interrupted clone fails cleanly"; `apps/server-e2e/src/git.e2e.spec.ts` › "an interrupted pull ends failed", "a restart during a merge leaves the branch as it was, and the job failed" and "a restart keeps a merge waiting for the user"; `libs/server/feature/sync/src/jobs/git-jobs.service.spec.ts` › "reports an interrupted push"; `libs/server/core/jobs/src/runner/job-runner.spec.ts` › "requeues an interrupted job whose type says so", with `libs/server/feature/sync/src/fetch/fetch.job.spec.ts` › "skips a requeued job whose key is gone"; `apps/server-e2e/src/container.e2e.spec.ts` › "the clone interrupted by a stop is failed after the next start". Killed, not stopped, in the container: `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-9.5: a clone killed mid-way is failed and removed on start", "NF-9.5: a pull killed mid-merge is undone on start" and "NF-9.5: a merge waiting for resolution survives a kill". | Pass   | 2026-11-26 | `59bf61f` |
| [NF-9.6][nf-9] | Limited in the MVP: key unlocks are lost on restart. **Test**: `apps/web-e2e/src/repository-management.spec.ts` › "AC-REPO-003.7: after a backend restart, a repository with a passphrase-protected key shows "Key locked" with Unlock".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass   | 2026-11-20 | `7e82076` |
| [NF-9.7][nf-9] | Limited in the MVP: clones are refused. **Test**: `apps/server-e2e/src/add-repository.e2e.spec.ts` › "NF-9.7: a clone on low space gets 507 low-storage, and low space refuses only clones"; `apps/server-e2e/src/api.e2e.spec.ts` › "NF-9.7: tells an administrator that storage is low"; `apps/web-e2e/src/app-header.spec.ts` › "NF-9.7: an administrator sees the low-space banner, below the app header, and it cannot be dismissed"; `apps/web-e2e/src/add-repository.spec.ts` › "NF-9.7: adding a repository on low space shows the message and the banner"; `libs/server/core/observability/src/health/readiness.service.spec.ts` › "is degraded while low on storage".                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass   | 2026-11-20 | `7e82076` |
| [NF-9.8][nf-9] | **Test**: `libs/server/feature/files/src/content/file-contents.spec.ts` › "a save on a full disk answers storage-full" and "a save on a full disk leaves the file as it was"; `libs/web/feature-repository-screen/src/repository-screen/components/save-status/save-status.component.spec.ts` › "shows "Server storage is full — not saved" on storage-full"; `libs/web/feature-repository-screen/src/repository-screen/services/open-files/open-files.service.spec.ts` › "keeps the draft on storage-full"; `libs/server/core/git/src/runner/git-runner.spec.ts` › "git's "No space left on device" is storage-full"; `libs/server/core/database/src/database/open-database.spec.ts` › "a failed transaction for ENOSPC changes nothing". A really full volume in the container (a 64 MB `tmpfs` as the repositories volume): `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-9.8: a full repositories volume refuses a save with storage-full and the file is unchanged" and "NF-9.8: space freed, the save goes through".                                                                                                              | Pass   | 2026-11-26 | `59bf61f` |
| [NF-9.9][nf-9] | **Document**: a rule that something does not exist; no code sets a per-user quota.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass   | 2026-11-20 | `7e82076` |

[nf-9]: ../architecture/non-functional.md#nf-9-availability-and-resilience

## NF-10: Observability

| Rule              | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result | Date       | Commit    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| [NF-10.1][nf-10]  | **Test** (in part): `apps/server-e2e/src/container.e2e.spec.ts` runs the image with a read-only root file system, so nothing is written outside `/data` and `/tmp`. That `/data` holds no log file after a run: `apps/server-e2e/src/container-resilience.e2e.spec.ts` › "NF-10.1: the data volume holds no log file after the runs". **Document**: [The log](deployment.md#the-log).                                                                                                                                                                                                                                                                             | Pass   | 2026-11-26 | `59bf61f` |
| [NF-10.2][nf-10]  | **Test**: `libs/server/core/observability/src/logging/logger-options.spec.ts` › "writes ISO time, level label, message and module" (JSON) and "uses the pino-pretty transport for the pretty format".                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.3][nf-10]  | **Test**: `libs/server/core/observability/src/logging/logger-options.spec.ts` › "honours the level"; `apps/server/src/startup/start-server.spec.ts` › "honours the configured log level".                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.4][nf-10]  | **Test**: `libs/server/core/observability/src/logging/logger-options.spec.ts` › "writes ISO time, level label, message and module"; `libs/server/core/observability/src/logging/logging.module.spec.ts` › "logs requestId on the request line and module on Nest logger lines". `jobId`, `userId` and `repoId` as IDs: **Document**, the security review's [NF-10.5 and A-3.5](security-review.md#nf-105-and-a-35-secrets-in-transit-and-in-the-log).                                                                                                                                                                                                             | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.5][nf-10]  | **Test**: `libs/server/core/observability/src/logging/logging.module.spec.ts` › "logs the request without its query, which may name a file (NF-10.5)" and "logs the whole URL at debug"; `libs/server/core/observability/src/errors/api-exception.filter.spec.ts` › "NF-10.5: logs an unhandled file system error without the file's path"; `libs/server/feature/repositories/src/clone/clone.job.spec.ts` › "NF-10.5: keeps a token that git's error echoes out of the error record and the log"; `apps/server-e2e/src/git.e2e.spec.ts` › "AC-REPO-002.14: no API response contains a password, token, private key or passphrase, and none appears in the logs". | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.6][nf-10]  | **Test**: `libs/server/core/observability/src/errors/api-exception.filter.spec.ts` › "answers an unknown route with 404 not-found and the request ID"; `libs/server/core/observability/src/logging/logging.module.spec.ts` › "logs requestId on the request line and module on Nest logger lines"; `libs/web/core/src/core/services/api-error-text/api-error-text.service.spec.ts` › "shows the first 8 characters of the request id as reference".                                                                                                                                                                                                               | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.7][nf-10]  | **Test**: `apps/server-e2e/src/api.e2e.spec.ts` › "live and ready answer ok"; `libs/server/core/observability/src/health/health.controller.spec.ts` › "answers live with 200 ok".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.8][nf-10]  | **Test**: `libs/server/core/observability/src/health/readiness.service.spec.ts` (ok, a closed database, migrations, the writable directory, `degraded`, and `fail` over `degraded`); `libs/server/core/observability/src/health/health.controller.spec.ts` › "answers ready with 200 degraded while low on storage, so that the container stays healthy".                                                                                                                                                                                                                                                                                                         | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.9][nf-10]  | **Test**: `apps/server-e2e/src/api.e2e.spec.ts` › "the health endpoints have no version, in any case the router accepts" and "live and ready answer ok" (without a token); `apps/server-e2e/src/container.e2e.spec.ts` › "the health endpoints answer without a version" and "the hardened container becomes healthy" (the image's `HEALTHCHECK`; its start period: [Plan 161](#plan-161-health-check-start-period)).                                                                                                                                                                                                                                             | Pass   | 2026-11-25 | `aade0f2` |
| [NF-10.10][nf-10] | **Test**: `libs/server/core/observability/src/metrics/metrics.controller.spec.ts` › "the endpoint does not exist without a token", "serves metrics with the right bearer token" and "refuses a wrong token like a missing one"; `apps/server-e2e/src/api.e2e.spec.ts` › "NF-10.10: refuses a scrape without the token".                                                                                                                                                                                                                                                                                                                                           | Pass   | 2026-11-20 | `7e82076` |
| [NF-10.11][nf-10] | **Test**: `apps/server-e2e/src/api.e2e.spec.ts` › "NF-10.11: metrics show a request after it is made", "NF-10.11: no metric label holds a user, repository or path", "NF-10.11: its job, its git operation and free space are in the metrics" and "NF-10.11: every label value of the job, git and disk metrics comes from a fixed set"; `libs/server/core/jobs/src/runner/job-runner.spec.ts` › "reports clones running and waiting"; `libs/server/feature/auth/src/sessions/session-metrics.spec.ts` › "counts active sessions on scrape".                                                                                                                      | Pass   | 2026-11-20 | `7e82076` |

[nf-10]: ../architecture/non-functional.md#nf-10-observability

## NF-11: Security baseline

| Rule              | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result         | Date       | Commit    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------- | --------- |
| [NF-11.1][nf-11]  | **Test**: `libs/server/core/security/src/csp/csp.spec.ts` › "NF-11.1: builds the policy" (the whole value); `libs/server/core/security/src/web-client/serve-web-client.spec.ts` › "NF-11.1: templates %s like any route" (`index.html` gets exactly that policy with its own nonce) and "NF-11.1: uses a new nonce per request"; end to end, `apps/web-e2e/src/login.spec.ts` › "NF-11.1: index.html, a deep link and an error page carry the exact CSP" (the whole header compared with NF-11.1's text on `/`, a deep link into a repository and the "page not found" route, the nonce equal to the HTML's and new on every response); every web-e2e test fails on a CSP or Trusted Types violation (`apps/web-e2e/src/support/fixtures.ts`).                                                                                                                                                                                                                                                                                                                                                                            | Pass           | 2026-11-20 | `bd78526` |
| [NF-11.2][nf-11]  | **Test**: `libs/server/core/security/src/headers/security-headers.spec.ts` › "NF-11.2: sets the headers", "NF-11.2: sends HSTS only over HTTPS" and "NF-11.2: allows clipboard-write for the page itself only"; `apps/server-e2e/src/api.e2e.spec.ts` › "NF-11.2: API responses carry the security headers, no HSTS over HTTP, no X-RateLimit headers".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pass           | 2026-11-20 | `bd78526` |
| [NF-11.3][nf-11]  | **Test**: `apps/server-e2e/src/files.e2e.spec.ts` › "AC-EDIT-003.13: serves an SVG with a script sandboxed" (`default-src 'none'; sandbox` and `nosniff`, also on a `304`). `Content-Disposition: attachment` for non-image files is **not applicable** in the MVP, which serves no non-image file as it is: the images endpoint answers `415 image-format-unsupported`, and there are no uploads or downloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass           | 2026-11-20 | `7e82076` |
| [NF-11.4][nf-11]  | **Test**: `libs/server/core/security/src/rate-limit/throttler.guard.spec.ts` › "NF-11.4: allows 60 requests per minute", "NF-11.4: allows an authenticated user 600 requests per minute", "NF-11.4: sets Retry-After on 429" and "NF-11.4: routes of a group share 10 requests per minute"; `apps/server-e2e/src/onboarding.e2e.spec.ts` › "NF-11.4: the setup-token group is limited to 10 per minute" and "NF-11.4: the limit stays on after onboarding is completed"; `apps/server-e2e/src/files.e2e.spec.ts` › "NF-11.4: counts image requests in the per-user rate limit" (with `Retry-After`); `libs/server/feature/repositories/src/clone/clone-again.service.spec.ts` › "NF-11.4: counts towards the clone limit"; `libs/server/feature/repositories/src/repositories/repositories.controller.spec.ts` › "NF-11.4: refuses a fourth clone with 429 too-many-jobs and Retry-After"; `libs/server/core/observability/src/errors/api-exception.filter.spec.ts` › "NF-11.4: sends Retry-After on every 429…". The clone limit's `429` had no `Retry-After`, nor had a key's unlock limit: fixed by plan 149 (A-3.9a). | Pass           | 2026-11-20 | `bd78526` |
| [NF-11.5][nf-11]  | **Test**: `apps/server-e2e/src/api.e2e.spec.ts` › "NF-11.5: refuses a JSON body over 2 MB with 413 payload-too-large". Uploads are not in the MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass           | 2026-11-20 | `bd78526` |
| [NF-11.6][nf-11]  | **Test**: `libs/server/core/git/src/runner/git-runner.spec.ts` › "runs git with the hardening" (`protocol.allow=never`, `https` and `ssh` only) and "lets git itself refuse file://, ext:: and plain http, behind the URL checks (NF-11.6)".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pass           | 2026-11-20 | `7e82076` |
| [NF-11.7][nf-11]  | **Test**: `libs/server/core/git/src/runner/git-runner.spec.ts` › "runs git with the hardening" (`core.hooksPath=/dev/null`, no system or global file) and "starts with an empty environment".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass           | 2026-11-20 | `7e82076` |
| [NF-11.8][nf-11]  | **Test**: `libs/server/core/git/src/runner/git-runner.spec.ts` › "kills the whole process group at the timeout"; `libs/server/core/git/src/engine/git-engine.spec.ts` › "stops a clone at the timeout"; `apps/server-e2e/src/add-repository.e2e.spec.ts` › "AC-REPO-001.19: a clone over the timeout leaves Error and no working copy"; `libs/server/core/config/src/config/load-config.spec.ts` › "parses the durations". **Document**: the security review's [Credentials, known hosts and timeouts](security-review.md#credentials-known-hosts-and-timeouts) (every run has a timeout).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass           | 2026-11-20 | `7e82076` |
| [NF-11.9][nf-11]  | **Document**: `package-lock.json` is committed; `.github/actions/setup/action.yml` runs `npm ci`; `.github/dependabot.yml` proposes updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pass           | 2026-11-20 | `7e82076` |
| [NF-11.10][nf-11] | **Document**: `.github/workflows/ci.yml`'s `trivy` job (the lockfile) and `image` job (the built image), and `.github/workflows/release.yml` before the push, each with `severity: HIGH,CRITICAL`, `ignore-unfixed: true` and `exit-code: 1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass           | 2026-11-20 | `7e82076` |
| [NF-11.11][nf-11] | **Document**: `tools/docker/Dockerfile` (a slim Node.js base, `git` and `openssh-client`, `tini` as PID 1, UID 1000); [The image](deployment.md#the-image). **Test**: `apps/server-e2e/src/container.e2e.spec.ts` › "an unwritable /data stops the start and names the UID"; › "reaps processes left by their parent, such as git's detached maintenance" (plan 160).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass           | 2026-11-24 | `f052735` |
| [NF-11.12][nf-11] | **Document**: `.github/workflows/release.yml`. A real release (a tag pushed, the image signed and attested, the draft release with its SBOM, and the signature verified as [Verifying the image](deployment.md#verifying-the-image) says): plan 157, with a release candidate tag the operator pushes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | To check (157) |            |           |
| [NF-11.13][nf-11] | **Test**: `apps/server-e2e/src/container.e2e.spec.ts` › "the hardened container becomes healthy", "onboarding, login, a clone and a save work", "a session survives a restart", "stops within the grace period during a clone" and "the guide's compose example becomes healthy"; `apps/server-e2e/src/compose-example.e2e.spec.ts` › "quotes the compose example as it is". The container suite's result is CI's, see above; plan 153 records it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass           | 2026-11-26 | `59bf61f` |

[nf-11]: ../architecture/non-functional.md#nf-11-security-baseline

## NF-12: Browser and device support

| Rule             | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result                                                           | Date       | Commit    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | --------- |
| [NF-12.1][nf-12] | **Document**: the web client has no `browserslist` of its own, so Angular's default applies. **Test**: every browser test in Chromium, Firefox and WebKit, desktop and phone, passes ([Plan 154](#plan-154-full-browser-run)), with the browser differences of [A-8.19 and A-8.20](../architecture/web-client.md#a-8-browser-differences). **Hand**: plan 155, Safari on iOS and Chrome on Android.                                                                                                                                                                                                                                                                                                                                                                                                              | Pass on Android ([Plan 155](#plan-155-phones)); iPhone: To check | 2026-11-26 | `e0e4a48` |
| [NF-12.2][nf-12] | **Document**: `apps/web-e2e/playwright.config.mts` and `.github/workflows/ci.yml` (Chromium, desktop and phone, on every pull request); `.github/workflows/nightly.yml` (Firefox on desktop, WebKit on desktop and phone, started by hand). **Test**: both pass on the same commit ([Plan 154](#plan-154-full-browser-run)). Real phones: plan 155.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pass on Android ([Plan 155](#plan-155-phones)); iPhone: To check | 2026-11-26 | `e0e4a48` |
| [NF-12.3][nf-12] | **Document**: a rule about what is not supported; there is nothing to test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pass                                                             | 2026-11-20 | `7e82076` |
| [NF-12.4][nf-12] | **Test**: `apps/web-e2e/src/baseline.spec.ts` › "NF-12.4: no page or dialog scrolls sideways at 320 px" (every page in its list: onboarding, login, dashboard with the account menu, repository management, Add repository, a repository's settings with the Remove dialog, a failed clone's settings, Preferences, the repository screen with a file open and the branch list, the repository screen during a merge, and Page not found); the page specs' own tests, for example `apps/web-e2e/src/login.spec.ts` › "NF-12.4: does not scroll sideways at 320 px", `apps/web-e2e/src/add-repository.spec.ts` › "AC-REPO-001.26: usable at 320 px, with no axe violations" and `apps/web-e2e/src/repository-screen.spec.ts` › "NF-12.4: opens a fold in place, and keeps a long line inside the diff at 320 px". | Pass                                                             | 2026-11-20 | `bd78526` |
| [NF-12.5][nf-12] | **Test**: the "by touch alone" tests, for example `apps/web-e2e/src/commit-and-push.spec.ts` › "exit criterion 7, on a phone by touch alone", `apps/web-e2e/src/pull-and-conflicts.spec.ts` › "exit criterion 8, on a phone by touch alone" and `apps/web-e2e/src/repository-screen.spec.ts` › "AC-FILE-001.23: browses by touch alone"; `apps/web-e2e/src/preview.spec.ts` › "AC-EDIT-001.21: switches Edit and Preview tabs on a phone, keeping the place, with the cursor above the on-screen keyboard". A real on-screen keyboard: **Hand**, plan 155.                                                                                                                                                                                                                                                       | Pass on Android ([Plan 155](#plan-155-phones)); iPhone: To check | 2026-11-26 | `e0e4a48` |
| [NF-12.6][nf-12] | **Test**: `apps/web-e2e/src/baseline.spec.ts` › "NF-12.6: every page works in landscape on a phone" (the phone projects, turned to landscape: every page of the NF-12.4 row's list does not scroll sideways and shows its heading, and every dialog and menu fits the screen); passed in `mobile-chromium` on 2026-11-20. Real phones, rotated: **Hand**, plan 155.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pass on Android ([Plan 155](#plan-155-phones)); iPhone: To check | 2026-11-26 | `e0e4a48` |

[nf-12]: ../architecture/non-functional.md#nf-12-browser-and-device-support

## NF-13: Accessibility

| Rule             | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result                                                                                     | Date       | Commit    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------- | --------- |
| [NF-13.1][nf-13] | **Test** (what axe finds): the NF-13.8 row. The rest of WCAG 2.2 AA: **Hand**, plan 156.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass with the keyboard and NVDA ([Plan 156](#plan-156-accessibility)); VoiceOver: To check | 2026-11-26 | `e0e4a48` |
| [NF-13.2][nf-13] | Limited in the MVP: **Edit conflict markers** is offered. **Test**: `apps/web-e2e/src/pull-and-conflicts.spec.ts` › "AC-GIT-003.15: the conflict list, the conflict bar and the buttons work with the keyboard alone and by touch alone, and axe-core reports no violations". With screen readers: **Hand**, plan 156.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pass with the keyboard and NVDA ([Plan 156](#plan-156-accessibility)); VoiceOver: To check | 2026-11-26 | `e0e4a48` |
| [NF-13.3][nf-13] | **Test**: the "with the keyboard alone" tests, for example `apps/web-e2e/src/commit-and-push.spec.ts` › "exit criterion 7, on desktop with the keyboard alone" and `apps/web-e2e/src/repository-management-walkthrough.spec.ts` › "exit criterion 11, on desktop with the keyboard alone"; `apps/web-e2e/src/editor.spec.ts` › "AC-EDIT-001.22: opens find and replace from the button and Ctrl+F, and Esc then Tab leaves the editor" and "A-10.30: the focused editor has no focus ring; the find panel's controls have one"; `apps/web-e2e/src/app-header.spec.ts` › "AC-APP-001.12: Skip to content is the first element reached with Tab…". A visible focus everywhere and no trap: **Hand**, plan 156, in Chrome and Firefox ([Plan 156](#plan-156-accessibility)). | Pass                                                                                       | 2026-11-26 | `e0e4a48` |
| [NF-13.5][nf-13] | **Test**: `apps/web-e2e/src/baseline.spec.ts` › "NF-13.5: every control is at least 44 px on a phone" (every page of the NF-12.4 row's list with its dialog or menu, and the **Changes** tab, in the phone projects; added by plan 164); the `TouchTargets` stories of `libs/ui` (segmented control, tab strip, button, page, link); `apps/web-e2e/src/repository-screen.spec.ts` › "the branch and counts stay in the one bar". On real phones: **Hand**, plan 155; failed on Android, fixed by [plan 164](../superpowers/plans/2026-11-26-164-touch-targets.md) and measured again on the same phone ([Plan 155](#plan-155-phones)).                                                                                                                                    | Pass: test (emulated phones) and Android after plan 164; iPhone: To check                  | 2026-11-26 | `269f6c6` |
| [NF-13.6][nf-13] | **Test**: `apps/web-e2e/src/editor.spec.ts` › "NF-13.6: resizes the editor and the preview with the arrow keys on the line between them" (renamed from NF-13.5 by plan 149); `apps/web-e2e/src/repository-screen.spec.ts` › "AC-FILE-001.4: collapses, expands and resizes the tree with the keyboard". Moving files is not in the MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pass                                                                                       | 2026-11-20 | `bd78526` |
| [NF-13.7][nf-13] | **Test**: reduced motion, `apps/web-e2e/src/baseline.spec.ts` › "NF-13.7: reduced motion turns animations off" (on every page of the NF-12.4 row's list and in its dialogs and menus, nothing moves but a fade, and the same check finds a transition once motion is welcome); colour, in part, `libs/web/shell/src/shell/components/repository-status/repository-status.component.spec.ts` › "gives each warning the warning icon (NF-13.7)". Colour never the only signal, everywhere: **Hand**, plan 156.                                                                                                                                                                                                                                                              | Pass with the keyboard and NVDA ([Plan 156](#plan-156-accessibility)); VoiceOver: To check | 2026-11-26 | `e0e4a48` |
| [NF-13.8][nf-13] | **Test**: axe-core in the specs of every page: login, onboarding, dashboard, Add repository, Preferences, repository management, the app header and its menus, and the repository screen with the editor, preview, changes, commit and push, and conflicts; each test that runs it names NF-13.8 or an acceptance criterion, for example `apps/web-e2e/src/dashboard.spec.ts` › "NF-13.8: has no accessibility violations, empty or with repositories" and `apps/web-e2e/src/login.spec.ts` › "NF-13.8: has no accessibility violations". The manual pass: **Hand**, plan 156.                                                                                                                                                                                            | Pass with the keyboard and NVDA ([Plan 156](#plan-156-accessibility)); VoiceOver: To check | 2026-11-26 | `e0e4a48` |

[nf-13]: ../architecture/non-functional.md#nf-13-accessibility

## NF-14: Localisation

| Rule             | How it is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result | Date       | Commit    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| [NF-14.1][nf-14] | **Document**: the web client has one language file, `apps/web/public/i18n/en.json`. Emails and automatic commits are not in the MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass   | 2026-11-20 | `7e82076` |
| [NF-14.2][nf-14] | **Test**: `libs/web/core/src/core/providers/provide-core.spec.ts` › "registers the ICU transpiler: TranslocoService formats a plural"; `libs/web/core/src/core/i18n/icu-transpiler.spec.ts` › "formats plurals", "returns a malformed message as it is and logs the key once" and "never compiles code at run time (CSP, Trusted Types)"; `libs/web/core/src/core/i18n/transloco-http.loader.spec.ts` › "GETs i18n/<lang>.json"; `libs/web/core/src/core/utils/relative-time/relative-time.spec.ts` › "uses the locale". No text outside Transloco: the lint rule `front-burner/no-raw-text` on every template (`tools/lint-rules/src/rules/no-raw-text.spec.mjs`; `tools/lint-rules/src/angular-templates.config.spec.mjs` › "NF-14.2: reports text outside Transloco, except in index.html and the design token overview"), which every project's lint passes. | Pass   | 2026-11-20 | `bd78526` |
| [NF-14.3][nf-14] | **Test**: `libs/shared/contracts/src/errors/api-error.schema.spec.ts` › "parses a minimal error body" (code, parameters, request ID, message); `apps/web/src/app/translations.spec.ts` › "has the text errors.%s" (every error code); `libs/web/core/src/core/services/api-error-text/api-error-text.service.spec.ts` › "translates the error code" and "treats a translation that equals its own key as missing and uses the message".                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass   | 2026-11-20 | `7e82076` |
| [NF-14.4][nf-14] | **Test**: `apps/web-e2e/src/preview.spec.ts` › "AC-EDIT-001.19: shows an Arabic paragraph right to left in the editor and the preview"; `libs/server/feature/files/src/actions/entry-actions.spec.ts` › "AC-FILE-001.25: stores names in NFC".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pass   | 2026-11-20 | `7e82076` |

[nf-14]: ../architecture/non-functional.md#nf-14-localisation

## Plan 150: indicative API timings

**Indicative only**: a developer machine much faster than the reference host,
with the instance, the tool and its git server on the same machine. Plan 152's
run on the reference host is the one that counts. Taken on 2026-11-21 with plan
150's `perf-api.mjs` after its review, against the server of commit `90fd68b`
built (`node dist/apps/server/main.js`, `FRONT_BURNER_SERVER_TIMING=true`,
`FRONT_BURNER_LOG_LEVEL=warn`) on a fresh data directory. `--cold` was not run
(it needs root).

The large repository, from `gen-large-repo.mjs generate` with the defaults:
100,000 files, 4,504 folders, depth 5, 1200.0 MB, median 4.0 KB, mean 12.0 KB,
largest 2062.5 KB, commit `135e3c3a`.

`perf-api.mjs run --email admin@example.com --large`, one user:

```text
Host: 20 CPUs (12th Gen Intel(R) Core(TM) i7-12700K), 31.1 GB memory, linux, git version 2.56.1
Instance: http://127.0.0.1:3555; 1 user(s) at once; 50 runs after 5 warm-up runs
Large repository: tmp/ai-tools/large-repo, 100,000 files, 4,504 folders, 1.20 GB; cloned in 42 s

Rule    Operation                       Runs  p50     p95     Max     Target                                          Pass
NF-2.1  Open a folder of 1,000 entries  50    10 ms   11 ms   12 ms   300 ms                                          yes
NF-2.2  Open a 100 KB Markdown file     50    3.2 ms  3.9 ms  4.1 ms  200 ms                                          yes
NF-2.3  Save a 100 KB file              50    18 ms   37 ms   42 ms   200 ms                                          yes
NF-2.6  Pull (job) over git pull        50    42 ms   51 ms   93 ms   ≤ 1000 ms added (job p95 78 ms, git p50 28 ms)  yes
NF-2.6  Push (job) over git push        50    19 ms   26 ms   32 ms   ≤ 1000 ms added (job p95 58 ms, git p50 32 ms)  yes
NF-2.8  Status, warm, 100,000 files     50    356 ms  363 ms  378 ms  ≈ 2000 ms                                       yes
NF-2.8  Commit, warm, 100,000 files     50    174 ms  179 ms  181 ms  ≈ 2000 ms                                       yes
NF-1.4  Push (job), 100,000 files       10    148 ms  195 ms  195 ms  —                                               —
```

The NF-1.4 row's slowest push (195 ms) is the first, which sends every commit of
the status and commit runs.

`perf-api.mjs scale` on the stopped instance (50 users, 2,500 working copies);
`perf-api.mjs ready` while it started: **ready after 10.5 s**. Then
`perf-api.mjs run --users 10`, among the 2,500 working copies:

```text
Instance: http://127.0.0.1:3555; 10 user(s) at once; 50 runs after 5 warm-up runs

Rule    Operation                       Runs  p50     p95     Max     Target                                           Pass
NF-2.1  Open a folder of 1,000 entries  500   99 ms   107 ms  114 ms  300 ms                                           yes
NF-2.2  Open a 100 KB Markdown file     500   27 ms   33 ms   38 ms   200 ms                                           yes
NF-2.3  Save a 100 KB file              500   87 ms   151 ms  235 ms  200 ms                                           yes
NF-2.6  Pull (job) over git pull        500   235 ms  355 ms  412 ms  ≤ 1000 ms added (job p95 418 ms, git p50 63 ms)  yes
NF-2.6  Push (job) over git push        500   133 ms  166 ms  204 ms  ≤ 1000 ms added (job p95 226 ms, git p50 60 ms)  yes
```

No sample was dropped in either run: every job ended on its `job.finished`
event. With 10 users at once, the save's p95 (151 ms, 171 ms on an earlier run)
is the closest to its target, 200 ms, on this machine; it is the first number to
watch on the reference host.

## Plan 151: indicative screen timings

**Indicative only**: a developer machine, with the instance, the browser and the
tool's git server on the same machine. Plan 152's run on the reference host is
the one that counts. Taken on 2026-11-21 with plan 151's `perf-screen.mjs`,
against the server and web client of commit `09d035f` built for production
(`node dist/apps/server/main.js`, `FRONT_BURNER_LOG_LEVEL=warn`) on a fresh data
directory. Slow 4G is Chrome DevTools' preset: 562.5 ms per request, 180 KB/s
down, 84 KB/s up.

`perf-screen.mjs run --email admin@example.com` (desktop):

```text
Host: 20 CPUs (12th Gen Intel(R) Core(TM) i7-12700K), 31.1 GB memory, linux
Instance: http://127.0.0.1:3556; profile desktop (Desktop Chrome, CPU 1× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                         Runs  p50       p95       Max       Target   Pass
NF-2.7  First load, cold cache            20    11038 ms  11040 ms  11047 ms  5000 ms  NO
NF-2.7  First load, warm cache            20    3560 ms   3569 ms   3576 ms   —        —
NF-2.1  Show a folder of 1,000 entries    20    1123 ms   1126 ms   1127 ms   1000 ms  NO
NF-2.2  Editor usable, 100 KB, broadband  20    95 ms     97 ms     97 ms     1000 ms  yes
NF-2.2  Editor usable, 100 KB, slow 4G    20    8247 ms   8267 ms   8269 ms   2000 ms  NO
NF-2.5  Preview updated, 200 KB           20    119 ms    126 ms    127 ms    300 ms   yes
```

`perf-screen.mjs run --email admin@example.com --profile phone`:

```text
Instance: http://127.0.0.1:3556; profile phone (Pixel 7, CPU 4× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                       Runs  p50       p95       Max       Target   Pass
NF-2.7  First load, cold cache          20    11226 ms  11235 ms  11238 ms  5000 ms  NO
NF-2.7  First load, warm cache          20    3737 ms   3772 ms   3780 ms   —        —
NF-2.1  Show a folder of 1,000 entries  20    1166 ms   1167 ms   1170 ms   1000 ms  NO
NF-2.2  Editor usable, 100 KB, slow 4G  20    8410 ms   8426 ms   8431 ms   2000 ms  NO
NF-2.5  Preview updated, 200 KB         20    1022 ms   1111 ms   1122 ms   300 ms   NO
```

The slow 4G rows barely vary, since the network, not the machine, sets them; a
faster host will not change them much. What sets them:

- **No response is compressed.** The instance sends no `Content-Encoding`, for
  the web client's files or the API. The first page's files are 714 KB as sent
  and 198 KB gzipped (`main` 491 KB and 128 KB); at 180 KB/s that is about 4 s
  against 1.1 s. The listing of the 1,000-entry folder is 94 KB as sent and 3 KB
  gzipped, which alone is the half second NF-2.1 misses by.
- **The web client's files are sent with `Cache-Control: public, max-age=0`**,
  so even a warm load asks again for every file, each costing a round trip of
  562.5 ms: the warm row's 3.6 s. The hashed files could be cached for good.
- The editor's slow 4G time also includes its lazy chunks, loaded one after
  another as each import is found, and the 100 KB file.

Plan 159 (Part F of the step 6 index) adds compression and long caching of the
hashed files; this plan's rows are measured again after it, then on the
reference host by plan 152. The phone's NF-2.5 row, 1.1 s from the tap on
**Preview** to a render of the 200 KB file with a CPU 4 times slower, has no
network part: whether a phone's first render after switching tab counts against
NF-2.5's "after typing stops" is to be decided, with plan 155's real phones.

## Plan 153: resilience checks

Both container suites of server-e2e (`npx nx run server-e2e:e2e-container`),
`container.e2e.spec.ts` and `container-resilience.e2e.spec.ts`, on the image
each run built, on GitHub's `ubuntu-latest`. The release workflow's dry run also
ran the upgrade check (`E2E_UPGRADE_TEST=true`), from that image to a build with
one throwaway migration and back.

| Run                                                                                          | Commit     | Result                                                                                                    |
| -------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| [CI 45729729416](https://github.com/Auxx/front-burner/actions/runs/45729729416)              | `e1401870` | Failed: the suite's own set-up (a remote copied onto itself); the smoke test's 9 passed                   |
| [CI 45730556006](https://github.com/Auxx/front-burner/actions/runs/45730556006)              | `eb3798d1` | Failed: two faults of the tests (a save of a new file; a restart expected to write a snapshot); 15 passed |
| [CI 45731205666](https://github.com/Auxx/front-burner/actions/runs/45731205666)              | `59bf61f8` | Passed: 19 tests, the upgrade's 2 skipped on a pull request                                               |
| [Release dry run 45731860648](https://github.com/Auxx/front-burner/actions/runs/45731860648) | `59bf61f8` | Passed: 21 tests, the upgrade's included; build, then the container suite in its own job; publish skipped |

The restart did not write a snapshot because the job runner keeps the snapshot
check's next run across a restart: a restarted instance checks within the hour
of its last check, as [Database snapshots](deployment.md#database-snapshots)
says ("It checks every hour"). The test now makes that check due, as if the hour
had passed. No step of the guide's backup, restore, upgrade or going back needed
a change.

## Plan 154: full browser run

Every browser test, in every project of `apps/web-e2e/playwright.config.mts`:
Chromium on desktop and phone in CI, Firefox on desktop and WebKit on desktop
and phone in the nightly workflow, on the same commit. Playwright 1.65: Chromium
158.0.8127.18, Firefox 159.0 (build 1572), WebKit 27.2 (build 2388), on GitHub's
`ubuntu-latest`.

| Run                                                                                  | Commit     | Result                                                                              |
| ------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| [Nightly 45634938916](https://github.com/Auxx/front-burner/actions/runs/45634938916) | `988f1841` | Failed: unit tests (TestBed on 4 cores), 63 Firefox and WebKit tests; fixed in #241 |
| [Nightly 45693954122](https://github.com/Auxx/front-burner/actions/runs/45693954122) | `e9b7603b` | Failed: AC-REPO-003.12 in WebKit, one flaky test; fixed in #242                     |
| [Nightly 45709070034](https://github.com/Auxx/front-burner/actions/runs/45709070034) | `fd015017` | Passed, with three tests flaky (passed on a retry); fixed in this plan's change     |
| [Nightly 45723718115](https://github.com/Auxx/front-burner/actions/runs/45723718115) | `95e1a4df` | Passed: 905 tests, none flaky; Chromium in the pull request's CI on the same commit |

What the runs found was fixed, test first where it was the product's:

- **The product.** In Firefox, a branch-list row reached with Shift+Tab stayed
  under the filter; in WebKit, the file tree and **Changes** lost their scroll
  position when switching between them.
- **The tests.** Waits on what the screen shows rather than on time (a fade-in
  before axe-core, an available git action, a held save, a restored offset),
  seeded working copies made in one transaction with their repository, and the
  test browsers' own differences (A-8.20).

Two differences of Safari are accepted and recorded as A-8.19 in
[web-client.md](../architecture/web-client.md#a-8-browser-differences): no
`Secure` cookie on `http://localhost`, and a second download of the translations
on a first load.

## Plan 155: phones

The web client by hand on a real Android phone and a real iPhone: every MVP page
by touch alone, the editor with the on-screen keyboard open (NF-12.5), portrait
and landscape (NF-12.6), touch targets (NF-13.5), and typing speed in large
files, with and without the conflict view (NF-2.4). The browser tests of plan
154 already do the same in emulated phones; this check finds what only a real
phone, keyboard and finger show.

The operator follows the script once on each phone and fills in the
[report](#report) for each. A failure becomes a plan in Part F of the step 6
index, unless it is a one-line fix.

### Before you start

**The phones.** A mid-range Android phone with the current Chrome (NF-2.4 names
a mid-range phone; a Galaxy A5x or a Pixel "a" model), and an iPhone with
Safari. Charged above 50 %, battery saver off, other apps closed, the usual
on-screen keyboard with autocorrect as normally used.

**The instance.** A fresh instance of the release image, set up by
[the deployment guide](deployment.md): the compose example with
[Caddy next to it](deployment.md#caddy-next-to-the-compose-example), on a host
with a domain, so that the phones reach it over HTTPS with a real certificate.
Plain HTTP is not enough: the refresh cookie is `Secure`
([HTTPS is required](deployment.md#https-is-required)). The reference host of
plan 152 will do, with a domain pointed at it.

**The remotes**, on GitHub (or Bitbucket), each with a few Markdown files in
folders, a `README.md`, an image the README embeds, and a second branch:

- `phone-https`: private, with a fine-grained token that can read and write its
  contents. Make a second token for the same repository too: exit criterion 11
  revokes the first.
- `phone-ssh`: private, for a key that Front Burner generates (exit criterion
  3).
- `phone-locked`: private, with a deploy key with write access whose private key
  has a passphrase, made beforehand with `ssh-keygen -t ed25519 -N <passphrase>`
  (exit criterion 10).
- A public repository larger than about 200 MB, such as
  `https://github.com/git/git.git`, whose clone takes long enough to be
  interrupted (exit criterion 11).

Somewhere to push from other than the phone: a clone of `phone-https` on a
computer, or GitHub's web editor.

**The remote inspector**, for the typing runs and for measuring a control: on
Android, `chrome://inspect` in Chrome on the computer with USB debugging on; on
an iPhone, Safari's Web Inspector on a Mac (Settings › Apps › Safari › Advanced
› Web Inspector on the phone).

**Measuring touch targets.** Where a line says _measure_, run this in the remote
inspector's console. It lists the visible controls smaller than 44 × 44 px, the
size NF-13.5 asks for on touch screens. A link inside a sentence is allowed to
be smaller (WCAG 2.5.8's inline exception), and a radio button or checkbox
counts by its label when the label is tappable.

```js
console.table(
  [
    ...document.querySelectorAll(
      'a[href], button, input, select, textarea, label, [role=button], [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=treeitem]'
    )
  ]
    .map(e => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
    .map(({ e, r }) => ({
      control: (e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 40),
      tag: e.tagName.toLowerCase(),
      width: Math.round(r.width),
      height: Math.round(r.height)
    }))
);
```

### How to follow the script

Each line is one thing to do and what should happen. Do every line by touch
alone: no Bluetooth keyboard, no mouse. Start each part in portrait. Where a
line says _rotate_, turn the phone to landscape, repeat what the line names, and
turn it back.

Three things are checked on every page and in every dialog, without a line of
their own; note any page where one fails:

- **No sideways scroll** (NF-12.4): the page never moves sideways, except a wide
  table or code block in the preview, which scrolls inside itself.
- **No zoom on focus** (iOS): tapping a field does not zoom the page in. Safari
  zooms into a field whose text is smaller than 16 px.
- **Nothing under the keyboard** (NF-12.5): with the on-screen keyboard open,
  the field typed in, its error message and the button that submits it can be
  seen, or scrolled to without closing the keyboard.

A line passes when what happens matches it. Anything else, however small, is a
note in the report: what was done, what happened, and a screenshot or screen
recording if it helps.

### Script

**1 and 2: onboarding, login and logout.**

1. Open the instance's address. The Administrator onboarding page opens.
2. Fill in the setup token, the name, the email and the password, and finish
   onboarding. Typing in each field: no zoom, the field above the keyboard.
   _Rotate_ with the keyboard open in the password field.
3. The dashboard opens, empty, with **Add repository**.
4. Open the user menu in the app header, then **Log out**. The login page opens.
5. Log in again with a wrong password: a generic error, under the field or above
   the keyboard. Then with the right one: the dashboard.
6. On the second phone, log in too. Both stay logged in through the rest of the
   script (exit criterion 5's other device).

**3: adding repositories.**

7. **Add repository**. Paste `phone-https`'s HTTPS URL into **Remote URL**: the
   repository name is filled in from it. Long-press to paste works.
8. Under the credentials, **Add new credentials**: a name, the username and the
   first token. The branches load.
9. **Full clone**, then **Add repository**. The dashboard shows "Cloning
   phone-https…" and the clone's progress until it is ready.
10. **Add repository** again with `phone-ssh`'s SSH URL. **Generate a key**,
    give it a name, **Generate**.
11. **Copy** the public key: it is on the clipboard (paste it into a note to
    see). Add it on GitHub as a deploy key with write access, from the same
    phone if you can, switching apps and back: the form is as you left it.
12. Tick **I have added this key to my git server**. Accept the host key if
    asked. The branches load.
13. **Single branch**, choose `main`, tick **I understand**, then **Add
    repository**. The clone is followed on the dashboard until ready.
14. _Rotate_ the Add repository page with the form filled in and the keyboard
    closed: every section and **Add repository** can be reached.
15. _Measure_ on the Add repository page with **Generate a key** chosen.

**4: browsing and files.**

16. Open `phone-https` from the dashboard. The repository screen opens with
    `README.md`.
17. Open **Files**: the file tree. Tap a folder: it expands. Tap it again: it
    collapses. Tap a Markdown file: it opens, and the tree closes.
18. In the tree, **Actions for** a folder (the button at the end of its row),
    then **New file**. Type a name without `.md`: "Will be created as …md".
    **Create**: the new file opens in the editor.
19. **New folder** the same way, then rename the folder and the new file from
    their **Actions for** menus. A name already taken shows an error in the
    dialog, above the keyboard.
20. Delete the new file, then the folder, each after its confirmation dialog.
21. _Rotate_ with the tree open and with a dialog open: the dialog fits the
    screen, and its buttons can be tapped.
22. _Measure_ with the tree open and a folder expanded, and with an **Actions
    for** menu open.

**5: saving, and the editor with the keyboard.**

23. Open `README.md` and tap in the middle of a paragraph. The keyboard opens;
    the cursor is above it, and the editor's toolbar (**Edit**, **Preview**,
    **Wrap**, find) is visible or comes back when you scroll up a little.
24. Type a sentence. The save status shows "Saving…", then "Saved", shortly
    after you stop.
25. Type at the end of the file, then press Enter until the cursor reaches the
    keyboard: the editor scrolls, and the cursor stays above the keyboard.
26. _Rotate_ with the keyboard open while typing: the cursor stays visible above
    the keyboard, and typing goes on in the same place.
27. Select a word by long-press, drag its handles, and replace it. Use the
    keyboard's word suggestions and autocorrect on a few words: the text is as
    the keyboard shows it, with no doubled or lost letters.
28. Open find (the toolbar's search button). Search for a word and replace it.
    The find panel's fields: no zoom, above the keyboard.
29. Reload the page: the saved text is there. On the second phone, open the same
    file: the same text.
30. Turn on airplane mode, type a few words: "Not saved — offline, retrying".
    Turn it off: "Saved" within a few seconds.

**6: the preview.**

31. Tap **Preview**: the rendered file, at the place you were editing. Tap
    **Edit**: back at the same place, with the cursor where it was.
32. In a file with front matter, a fenced code block, a table, a `<details>`
    block and a `<script>` tag (add them if the repository has none): the front
    matter is not body text, the code is highlighted, a wide table or code block
    scrolls inside itself, and the preview notes that something was removed.
33. A repository image shows. A remote image (`https:` on another host) shows
    only after **Show remote images**.
34. _Rotate_ in the preview.

**7: changes, commit and push.**

35. Edit two files and delete a third. The **Changes** tab shows "Changes (3)".
36. Open each change: its diff, readable at phone width, a long line wrapped or
    scrolled inside the diff.
37. **Discard** one change, and confirm: "Changes (2)".
38. Untick one file, type a commit message (no zoom; the message and the commit
    button above the keyboard), and commit 1 file. Confirm the commit author
    when asked.
39. The branch shows "1 to push". From the **Git actions** menu, **Push**: a
    toast "Pushed 1 commit to origin/main".
40. Tap an unavailable git action, such as **Push** with nothing to push: it
    says why.
41. _Measure_ on the **Changes** tab with two changes, and with the **Git
    actions** menu open.

**8: branches and pull.**

42. Tap the branch name in the bar: the branch list. **New branch**, name it,
    **Create branch**: "Not published".
43. Switch to `main` and back from the branch list. Switch to the remote's
    second branch: it gets its upstream.
44. Make a change, commit and push on the new branch: it gets its upstream on
    the first push.
45. Push a commit to `main` from the computer. On the phone, switch to `main`,
    then **Git actions** › **Pull**: "Pulled 1 commit".
46. _Rotate_ with the branch list open. _Measure_ with it open.

**9: remote changes and conflicts.**

47. Edit `README.md` on the computer and push. On the phone, edit the same line
    of `README.md` and commit. Open the file: within a few seconds a notice says
    that origin/main has 1 new commit and that this file changed too.
48. **Pull** from the notice. The merge shows "0 of 1 file resolved" and
    `README.md` with its conflict markers, "Mine (main)" and "Theirs
    (origin/main)", and an **Accept** button above the conflict.
49. Tap **Accept theirs** above the conflict: the markers are gone, and the
    conflict bar says no conflict markers are left.
50. Type in the resolved file with the keyboard open: the conflict bar and the
    cursor stay visible. _Rotate_ while typing.
51. **Mark as resolved**, then commit the merge and **Push**.
52. Make another conflict as in line 47. **Pull**, then **Use their version**
    for the file, then **Git actions** › **Abort merge** and confirm: the branch
    and the file are as they were before the pull.
53. _Measure_ with a conflict open: the conflict bar, and the **Accept** buttons
    in the editor.

**10: a locked key after a restart.**

54. **Add repository** with `phone-locked`'s SSH URL, **Paste a key**, paste its
    private key, enter the passphrase. Add it with **Full clone**: the clone
    finishes.
55. On the host: `docker compose restart front-burner`. On the phone, reload the
    dashboard: `phone-locked` shows "Key locked" with **Unlock**.
56. Open `phone-locked` and **Pull** from **Git actions**. The **Unlock** dialog
    opens: enter a wrong passphrase ("Wrong passphrase", above the keyboard),
    then the right one. The pull carries on and finishes.

**11: repository management and settings.**

57. In the app header, **Repositories**: the repository management page lists
    all three, with their status.
58. Type in **Filter by name or remote**: the list narrows; no zoom.
59. **Add repository** with the large public repository, **No credentials
    (public repository)**, **Full clone**. As soon as the dashboard shows it
    cloning, on the host: `docker compose restart front-burner`.
60. After the restart, on the repository management page: the large repository
    shows that its clone failed. Open its settings: **Details** shows git's
    message and a request ID, and **Copy** copies the ID.
61. **Retry clone**: the clone starts again. Remove the repository while it
    clones, or once it is done, from its settings, confirming the dialog. It
    leaves the list.
62. Revoke `phone-https`'s first token on GitHub. On the phone, open
    `phone-https` and **Git actions** › **Fetch**: a warning that the
    credentials were refused.
63. On the repository management page, `phone-https` shows the warning and its
    fix. Open its settings, **Change credentials**, **Add new credentials** with
    the second token: the warning goes; **Fetch** works.
64. On the settings page, change the commit author for this repository and back
    to **Use my default**. Change the git control level and back.
65. _Measure_ on the settings page, with every section loaded and with
    **Details** open. Tap each control of its rows with a fingertip: none is
    missed and none hits its neighbour.
66. _Rotate_ the repository management page and the settings page, with **Change
    credentials** open.

**Preferences and the app header.**

67. User menu › **Preferences**. **Edit** the default commit author, **Save**:
    "Saved". Its fields: no zoom, above the keyboard.
68. _Measure_ the app header with the user menu open, and the Preferences page.
69. Open an address that does not exist, such as `/nothing`: Page not found,
    with a way back to the dashboard.

**Low and full storage.** These change the instance, so they come last.

70. On the host, set `FRONT_BURNER_LOW_DISK_THRESHOLD` to more than the free
    space (for example `100000GB`) in the instance's `compose.yaml` and run
    `docker compose up -d`. Within a minute the banner "The server is running
    low on storage. New repositories can't be added until space is freed." shows
    on every page. _Rotate_ with it shown: it does not cover the page's
    controls.
71. Try **Add repository** with any remote: the form says "The server is running
    low on storage. Contact your administrator.". Typing and saving in
    `phone-https` still work.
72. Remove the variable again and `docker compose up -d`: the banner goes within
    a minute.
73. For a full disk, stop the instance (`docker compose down`) and start a
    throwaway one from a copy of its folder with an empty `data/` (owned by UID
    1000), with this `compose.override.yaml` next to the copy's `compose.yaml`
    (as the container suite's `container-tmpfs-repos.yaml` does):

    ```yaml
    services:
      front-burner:
        environment:
          FRONT_BURNER_REPOS_DIR: /repositories
          FRONT_BURNER_LOW_DISK_THRESHOLD: '0'
        tmpfs:
          - /repositories:size=64m,uid=1000,gid=1000,mode=0700
    ```

    Complete onboarding, add a small public repository, and open a Markdown file
    on the phone.

74. Fill the volume: `docker compose exec front-burner sh -c 'head -c 128M
    /dev/zero > /repositories/filler'`. Type a few lines on the phone: "Server
    storage is full — not saved". Reload: the browser draft is offered ("You
    have unsaved changes from …").
75. Remove the filler (`docker compose exec front-burner rm
    /repositories/filler`), restore the draft and type: "Saved". Then remove the
    throwaway instance and start the main one again.

### Typing speed

NF-2.4: a keystroke is shown within 50 ms on a mid-range phone, in files up to 1
MB. Measured with `typing-test.mjs`'s page, as [typing-test.md](typing-test.md)
describes (its steps 1 to 3: start the page, prepare the phone, measure), on
both phones. On narrow screens, a file over 100 KB opens without Markdown
highlighting (ED-9a), so the large files are measured with the setup **Without
Markdown highlighting, front matter included**, which is what a phone gets; the
conflict view is the **Conflicts** box.

Type every run at the same steady, normal pace: tap the place named, type 50
letters, then press Enter 10 times. If a run's typing speed is more than 1 key/s
away from the others, do it again.

| Run | File       | Setup                                          | Where                 |
| --- | ---------- | ---------------------------------------------- | --------------------- |
| 1   | `2kb.md`   | Everything on                                  | **Middle** (baseline) |
| 2   | `200kb.md` | Without Markdown highlighting                  | **Middle**            |
| 3   | `200kb.md` | Without Markdown highlighting, **Conflicts**   | **Middle**            |
| 4   | `1mb.md`   | Without Markdown highlighting                  | **End**               |
| 5   | `1mb.md`   | Without Markdown highlighting, **Conflicts**   | **End**               |
| 6   | `1mb.md`   | Without Markdown highlighting                  | **Middle**            |
| 7   | `1mb.md`   | Without Markdown highlighting, **Conflicts**   | **Middle**            |
| 8   | `200kb.md` | Everything on (after **Turn on highlighting**) | **Middle**            |

A run passes as typing-test.md's "What happens next" says: the page's own meter
has no keystroke over 50 ms, and in the browser timing the share of keystrokes
over 50 ms is at most 5 percentage points above the baseline's. One slow first
keystroke after a file loads is noted but does not fail a run. On an iPhone,
only the page's own meter applies. Run 8 is a note, not a pass or fail: it shows
what **Turn on highlighting** costs on that phone.

Then, in the product: open a file of about 1 MB in `phone-https` (`1mb.md` from
`tmp/typing-test/`, committed and pushed from the computer, then pulled), type a
sentence in the middle and at the end, and note how it felt.

### Report

One per phone, pasted into the pull request:

```text
Phone check — plan 155
Date:
Commit or image tag:
Phone: <make, model, year>
OS and browser: <e.g. Android 16, Chrome 158 / iOS 26.1, Safari 26.1>
Keyboard: <e.g. Gboard, the iOS keyboard>

Script: every line passed except:
- <line number>: <what was done, what happened>

Measured (lines 15, 22, 41, 46, 53, 65, 68), controls under 44 px:
- <line number>: <the console table, or "none">

Pages where a check of every page failed (sideways scroll, zoom on focus,
hidden under the keyboard):

Typing (paste each "Copy results" output):
Run 1 (2 KB, middle, baseline):
Run 2 (200 KB, middle):
Run 3 (200 KB, middle, conflicts):
Run 4 (1 MB, end):
Run 5 (1 MB, end, conflicts):
Run 6 (1 MB, middle):
Run 7 (1 MB, middle, conflicts):
Run 8 (200 KB, middle, highlighting on):
Typing in the product, 1 MB file, how it felt:
```

### Results

Run by the operator on 2026-11-26, against a fresh instance of the release image
built from `e0e4a48` at `https://fbtest.hexmode.org`, set up by the deployment
guide (the compose example behind Caddy) on the reference host. The report is in
[pull request #245](https://github.com/Auxx/front-burner/pull/245).

| Phone               | OS and browser                                   | Keyboard | Script                       | Typing       |
| ------------------- | ------------------------------------------------ | -------- | ---------------------------- | ------------ |
| Google Pixel 10 Pro | Android 17, Vivaldi 8.3.4192.96 (Chromium-based) | Gboard   | Passed; touch targets failed | Not measured |
| iPhone              | —                                                | —        | Not run: no iOS device       | Not run      |

**The script** passed on the Android phone: every line by touch alone, the
editor with the keyboard open and rotated, and no page scrolling sideways. The
browser was Vivaldi, which runs Chrome's engine; NF-12.1 names Chrome on Android
itself, which was not used.

**Touch targets** (NF-13.5) failed: the measuring lines found controls under 44
px, all in shared components of `libs/ui`, fixed by
[plan 164](../superpowers/plans/2026-11-26-164-touch-targets.md):

| Control                                                                                          | Measured                          | Lines      |
| ------------------------------------------------------------------------------------------------ | --------------------------------- | ---------- |
| The segmented control's segments (credentials, clone mode, the view mode's Split, Edit, Preview) | 40 px high                        | 15, 22     |
| The **Changes** tab's checkboxes                                                                 | 24 × 24 px, in a 36 × 48 px label | 41         |
| The breadcrumb links (settings page, Preferences)                                                | 18 px high                        | 15, 65, 68 |
| **Edit**, the editor's tab on a phone, on the conflict screen                                    | 43 × 44 px                        | 53         |

Not findings: the visually hidden **Skip to content** link and radio inputs (1 ×
1 px; the label is the target), the labels of text fields (the field is the
target), and links inside the previewed Markdown (WCAG 2.5.8's inline
exception). Line 46 reported nothing.

Plan 164 fixed them and added an end-to-end check that measures every page the
same way in the phone projects; it also found standalone text links, 21 px high,
that the hand run had not reached (on the dashboard, the repository management
page and Page not found), and fixed those too.

The operator measured plan 164's build (`ee4e782`, on the test instance) on the
same phone on 2026-11-26, lines 15, 22, 41, 46, 53, 65 and 68
([pull request #247](https://github.com/Auxx/front-burner/pull/247)): every
control above was 44 px or more. Line 53 found one more: the editor's **Accept
mine**, **Accept theirs** and **Accept both** buttons above a conflict, 24 px
high. They are hidden from assistive technology (the conflict bar offers the
same), which the end-to-end check had skipped; it now counts them, and plan 164
gives them the small control height, 44 px on touch screens. Measured again on
the phone with that build (`269f6c6`), line 53 found nothing under 44 px but the
visually hidden **Skip to content** link.

**Typing speed** (NF-2.4) was not measured with `typing-test.mjs`. The operator
used the test instance on the Android phone for over a week and noticed no lag.
That is a note, not the measurement NF-2.4 asks for; the measurement is in
`docs/wiki/todo.md`.

**The iPhone** checks were not run, for want of an iOS device; they are in
`docs/wiki/todo.md`.

## Plan 156: accessibility

The manual accessibility pass before the release (NF-13.8): the whole MVP
against WCAG 2.2 AA (NF-13.1), in three passes:

- **K**, with the **keyboard alone** in a desktop browser (NF-13.3);
- **V**, with **VoiceOver on iOS**, in Safari on an iPhone;
- **N**, with **NVDA on Windows**, in Chrome or Firefox.

axe-core already runs in the browser tests of every page (the NF-13.8 row); this
pass finds what axe cannot: focus order and visibility, traps, what a screen
reader says and how often, and whether a page makes sense without seeing it. The
**Edit conflict markers** method and keeping a whole version are the MVP's
conflict methods (NF-13.2 as limited in the MVP).

The operator follows the script once per pass and fills in the
[report](#accessibility-report). A finding names the WCAG success criterion it
breaks. A small finding is fixed in this plan's pull request, after a test that
fails without the fix (a Storybook interaction test, or an end-to-end test with
axe or ARIA assertions); a larger one becomes a plan in Part F of the step 6
index.

### Before you start

**The instance.** A fresh instance of the release image, set up by
[the deployment guide](deployment.md), over HTTPS with a real certificate. Plan
155's phone check needs the same instance and remotes, so one set-up serves
both; remove the repositories between passes, or add them again under other
names.

**The remotes**, on GitHub (or Bitbucket), each with a few Markdown files in
folders, a `README.md` that embeds an image, and a second branch:

- `phone-https`: private, with two fine-grained tokens that can read and write
  its contents (line 45 revokes the first);
- `phone-ssh`: private, for a key that Front Burner generates;
- `phone-locked`: private, with a deploy key with write access whose private key
  has a passphrase (`ssh-keygen -t ed25519 -N <passphrase>`);
- a public repository larger than about 200 MB, such as
  `https://github.com/git/git.git`, whose clone takes long enough to be
  interrupted.

Somewhere to push from other than the browser being tested: a clone on a
computer, or GitHub's web editor.

**The passes.**

- **K**: Chrome or Firefox on a desktop, the mouse put away. The current
  versions. The operating system's "reduce motion" setting on for part of the
  pass (line 46).
- **V**: an iPhone with the current iOS and Safari, VoiceOver on (Settings ›
  Accessibility › VoiceOver), used with its gestures only: swipe right and left
  to move, double-tap to activate, the rotor for headings, landmarks and form
  controls. The on-screen keyboard for typing.
- **N**: Windows with the current NVDA and Chrome or Firefox, the keyboard only,
  in NVDA's browse mode and focus mode as a user would switch between them. NVDA
  › Tools › **Speech viewer** on, so that what NVDA says can be copied into the
  report.

### How to follow the script

Each numbered line is one thing to do and what should happen. Do it in every
pass, unless the line names its passes, such as **(K)** or **(V, N)**. In the
screen reader passes, "press" means activating the control the screen reader's
way, and "hear" is what the screen reader says.

These are checked on every page and in every dialog, without a line of their
own; note any page or dialog where one fails:

- **(K)** The focus can always be seen, and it moves in reading order (WCAG
  2.4.7, 2.4.11, 2.4.3). Nothing traps it (2.1.2): `Tab` and `Shift+Tab` leave
  everything but a dialog, and `Esc` closes a dialog or menu and returns the
  focus to what opened it.
- **(K)** Nothing that a mouse could do is missing from the keyboard (2.1.1).
- **(V, N)** Every control has a name that says what it does, and its role and
  state (expanded, checked, current, unavailable) are said (4.1.2). Every field
  says its label, and its error when it has one (3.3.1, 3.3.2).
- **(V, N)** Moving to another page says the new page's title, and the focus is
  on its main heading, or on the editor area on the repository screen (NV-18).
  Headings and landmarks (banner, navigation, main, the repository screen's
  labelled regions) let you jump around (1.3.1, 2.4.1, NV-17).
- **(V, N)** A change that is not where the focus is (a toast, a banner, a
  status) is said once, without moving the focus, and is not said again and
  again while it stays (4.1.3).
- **(All)** Colour is never the only signal (1.4.1, NF-13.7): changes, diffs,
  conflict regions, warnings, statuses and ignored files each have an icon or a
  word too.

A line passes when what happens matches it. Anything else is a finding in the
report: the line, the pass, what was done, what happened (for N, a copy from the
speech viewer), and the WCAG success criterion.

### Script

**1 and 2: onboarding, login and logout.**

1. Open the instance's address. **(K, N)** The first `Tab` reaches **Skip to
   content**; pressing it moves the focus to the page's content.
2. Complete administrator onboarding. Leave a required field empty and submit:
   the error is said or shown with the field, and the focus goes to the first
   field in error.
3. On the dashboard, open the user menu, move through it with the arrow keys
   **(K, N)**, close it with `Esc`: the focus is back on its button. Then **Log
   out**.
4. Log in with a wrong password: the error is said once. Log in with the right
   one: the dashboard's title is said.

**3: adding repositories.**

5. **Add repository** with `phone-https`'s HTTPS URL and **Add new
   credentials**. The radio groups (credentials, clone mode, git control level)
   say their group's label and each choice; **(K)** the arrow keys move between
   choices.
6. While the branches load, "Loading branches…" or its spinner is said or shown
   once; when they are loaded, the branch field can be reached.
7. **Full clone**, **Add repository**. On the dashboard, "Cloning phone-https.
   It will be ready to open soon." is said once. **(V, N)** The clone's progress
   bar can be reached and says its value, but is **not** said by itself as it
   moves.
8. **Add repository** with `phone-ssh`'s SSH URL, **Generate a key**. The public
   key can be reached and read; **Copy** says that it copied. Accepting the host
   key, if asked, is a dialog whose fingerprint can be read.
9. **Single branch**: the warning and **I understand** are reached in order;
   submitting without ticking it says "Tick this box to continue".
10. **(K)** Leave the form with changes made: "Discard your changes?" focuses
    **Keep editing**, the safe choice.

**4: browsing and files.**

11. Open `phone-https`. The file tree is a tree: **(K, N)** the arrow keys move
    between entries, right and left expand and collapse folders, `Enter` opens a
    file (FB-46). **(V, N)** Each entry says its name, that it is a folder or
    file, whether it is expanded, and its flags (Markdown, ignored, empty).
12. Open an entry's actions menu from the keyboard **(K, N)** or with VoiceOver
    **(V)**. **New file**: the dialog focuses its name field; "Will be created
    as …md" is read with it. **Create**: the focus goes to the new file's
    editor.
13. **New folder**, rename, and delete, each by its dialog. A taken name's error
    is said. After a delete, the focus lands on a sensible entry, not on the
    page's top.
14. **(K)** Collapse, expand and resize the tree with the keyboard (NF-13.6).

**5: the editor and saving.**

15. **(V, N)** The editor says the open file's name (ED-37).
16. Type a sentence. "Saving…" and then "Saved" are said once each, without
    moving the focus (ED-38), and not on every keystroke.
17. **(K)** `Tab` inserts a tab; `Esc` then `Tab` leaves the editor (NF-13.3).
    The caret and the active line's number show where the focus is (A-10.30).
18. **(K)** `Ctrl+F` (`Cmd+F`) opens find. The count of matches is said once per
    search **(N)**; the find panel's controls show their focus; `Esc` returns to
    the editor.
19. **(V, N)** Typing in the editor reads back what was typed, and moving with
    the arrow keys **(N)** or the rotor **(V)** reads the line.
20. **(K)** Resize the editor and the preview with the arrow keys on the line
    between them (NF-13.6).
21. Turn off the network: the offline banner is said once, and "Not saved —
    offline, retrying" once. Turn it back on: "Saved".

**6: the preview.**

22. **Preview**, then **Edit**: the view mode controls say which is selected.
23. **(V, N)** The preview is a labelled region; its headings keep the file's
    levels, and the rotor or NVDA's `H` moves between them (ED-37). A table is
    read as a table; an image says its alt text; a code block is read as text.
24. In a file with removed HTML, the notice is **not** said while typing in the
    editor (SH-20), and can be reached in the preview. **Show remote images**
    can be reached and pressed.

**7: changes, commit and push.**

25. Edit two files and delete a third. The **Changes** tab says its count.
26. Open each change's diff. **(V, N)** Added and removed lines are said as
    added and removed, not only shown in colour (1.4.1, 1.3.1).
27. **Discard** a change: the confirmation focuses **Cancel**; after it, the
    focus is on the list, and the new count is said or shown.
28. Untick a file (its checkbox says its file's name), type a message, commit,
    confirm the commit author. The result is said as a toast, once.
29. **Push**, from the bar's buttons **(K, N)** or the **Git actions** menu on
    the phone **(V)**: "Pushing…" then the toast "Pushed 1 commit to
    origin/main", each once.
30. An unavailable action, such as **Push** with nothing to push, keeps the
    focus and says why when pressed (A-10.46).

**8: branches and pull.**

31. The branch button says "Branch main: open the branch list". The list's
    filter and rows can be reached in order; **(K)** the arrow keys move through
    the rows.
32. **New branch**, **Create branch**: the new branch and "Not published" are
    said or shown. "Switching branch…" is said once per switch.
33. Push a commit from elsewhere, then **Pull**: "Pulling…" and the result, once
    each.

**9: remote changes and conflicts.**

34. Make a remote change to an open file: the notice that origin/main has new
    commits is said once, without moving the focus.
35. Make a conflict and **Pull** from the notice. The merge's summary ("0 of 1
    file resolved") and the conflict list can be reached; the list says each
    file and whether it is resolved.
36. **(K, N)** The conflict bar outside the editor is the way to the conflicts:
    **Next** and **Previous** say "Conflict 1 of 1: mine and theirs" (GC-28),
    and the editor's own **Accept** buttons are not reached with `Tab`.
37. **(N)** Resolve the conflict with NVDA alone: move to it with the conflict
    bar, read its mine and theirs parts in the editor (labelled "Mine (main)"
    and "Theirs (origin/main)"), **Accept theirs** from the bar, then edit a
    line. "No conflict markers left." is said once.
38. **(V)** The same with VoiceOver: the **Accept** buttons are reached through
    the conflict bar, and the marker lines are labelled.
39. **Mark as resolved**, commit the merge and push; each result said once.
40. Make another conflict, **Use their version**, then **Abort merge**: the
    dialog focuses **Cancel**; after the abort, the focus is on the repository
    screen, not lost on the page's top.

**10: a locked key after a restart.**

41. Add `phone-locked` with its pasted key and passphrase. Restart the instance
    (`docker compose restart front-burner`). On the dashboard, the "Key locked"
    warning is read with its repository, and **Unlock** can be reached.
42. Open `phone-locked` and **Pull**. The **Unlock** dialog moves the focus to
    its passphrase field (RC-25); a wrong passphrase says "Wrong passphrase";
    the right one closes the dialog, returns the focus, and the pull's result is
    said once.

**11: repository management and settings.**

43. **Repositories**: the list's headings or rows say each repository and its
    status. Typing in **Filter by name or remote** says how many are shown, once
    the typing stops, not on every key.
44. **Add repository** with the large public repository, **No credentials
    (public repository)**, **Full clone**, and restart the instance while it
    clones (`docker compose restart front-burner`): the clone fails. Its
    settings: the status, **Details** (says expanded or collapsed), the request
    ID and **Copy** ("Request ID copied."). **Retry clone** and **Clone again**
    say what they do; **Clone again**'s confirmation focuses **Cancel**.
45. Revoke `phone-https`'s first token and **Fetch**: the warning is read with
    its fix. **Change credentials**: the dialog focuses its first field; adding
    the second token clears the warning, and the focus returns to **Change
    credentials**. The settings page's key-value lists read each value with its
    label (A-10.50).

**The rest of the product.**

46. **(K)** With the system's "reduce motion" on, dialogs, menus, toasts and the
    tree only fade; nothing slides or spins (NF-13.7).
47. **(K)** At 200 % browser zoom, on the dashboard, the Add repository page,
    the repository screen and the settings page: nothing is cut off and nothing
    overlaps (1.4.4, 1.4.10).
48. **Preferences**: **Edit** the default commit author, **Save**: "Saved" is
    said once.
49. `/nothing`: the page title "This page doesn't exist." is said, and the link
    to the dashboard can be reached.
50. **(V)** Rotate the iPhone on a page and in a dialog: VoiceOver keeps its
    place.
51. Set `FRONT_BURNER_LOW_DISK_THRESHOLD` to more than the free space (for
    example `100000GB`) and run `docker compose up -d`. Within a minute, the
    low-space banner is said once when it appears, and not again on every page
    change. Remove the variable again afterwards.

### Accessibility report

One per pass, pasted into the pull request:

```text
Accessibility pass — plan 156
Pass: <K / V / N>
Date:
Commit or image tag:
OS: <e.g. Fedora 45, iOS 26.1, Windows 11 24H2>
Browser: <e.g. Chrome 158, Safari 26.1, Firefox 159>
Screen reader: <none, VoiceOver, NVDA 2026.x>

Every line passed except:
- <line>: <what was done, what happened or was said> — WCAG <x.y.z>

Pages or dialogs where a check of every page failed:
- <page>: <which check, what happened> — WCAG <x.y.z>

Anything else that was hard or confusing, even if no rule is broken:
```

### Results

Run by the operator on 2026-11-26, against a fresh instance of the release image
built from `e0e4a48` at `https://fbtest.hexmode.org`, set up by the deployment
guide (the compose example behind Caddy) on the reference host. The reports are
in [pull request #246](https://github.com/Auxx/front-burner/pull/246).

| Pass | OS         | Browser              | Screen reader | Result                                         |
| ---- | ---------- | -------------------- | ------------- | ---------------------------------------------- |
| K    | Fedora 45  | Chrome 157.0.8103.50 | —             | Pass: no findings                              |
| K    | Fedora 45  | Firefox 161.0        | —             | Pass: no findings                              |
| N    | Windows 11 | Chrome 157.0         | NVDA 2026.3.1 | Pass: no findings                              |
| V    | —          | Safari on iOS        | VoiceOver     | Not run: no iOS device; in `docs/wiki/todo.md` |

No finding needed a fix or a plan. The VoiceOver pass is still to be run, on any
iPhone with the current iOS, before NF-13.8's manual pass is complete.

## Plan 159: after compression

**Indicative only**, on the same machine as plan 151, which this section repeats
after plan 159: the web client's files are precompressed at build and the hashed
ones cached for good (A-7.9), and API answers are compressed as they are sent
(A-7.15). Taken on 2026-11-23 against the server and web client of commit
`b72a3f8` built for production, with `web:precompress`, on a fresh data
directory (`FRONT_BURNER_LOG_LEVEL=warn`, `FRONT_BURNER_SERVER_TIMING=true`).

The first page's files, from `web:precompress`:

| File               | As built | Brotli | gzip   |
| ------------------ | -------- | ------ | ------ |
| `main-*.js`        | 491 KB   | 106 KB | 129 KB |
| `chunk-*.js` (2)   | 198 KB   | 58 KB  | 65 KB  |
| `styles-*.css`     | 25 KB    | 3 KB   | 4 KB   |
| `polyfills-*.js`   | 76 B     | —      | —      |
| **The first page** | 714 KB   | 167 KB | 198 KB |

`perf-screen.mjs run --email admin@example.com` (desktop):

```text
Host: 20 CPUs (12th Gen Intel(R) Core(TM) i7-12700K), 31.1 GB memory, linux
Instance: http://127.0.0.1:3556; profile desktop (Desktop Chrome, CPU 1× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                         Runs  p50      p95      Max      Target   Pass
NF-2.7  First load, cold cache            20    5388 ms  5397 ms  5405 ms  5000 ms  NO
NF-2.7  First load, warm cache            20    1245 ms  1246 ms  1247 ms  —        —
NF-2.1  Show a folder of 1,000 entries    20    607 ms   611 ms   611 ms   1000 ms  yes
NF-2.2  Editor usable, 100 KB, broadband  20    97 ms    100 ms   101 ms   1000 ms  yes
NF-2.2  Editor usable, 100 KB, slow 4G    20    3438 ms  3443 ms  3443 ms  2000 ms  NO
NF-2.5  Preview updated, 200 KB           20    120 ms   127 ms   127 ms   300 ms   yes
```

`perf-screen.mjs run --email admin@example.com --profile phone`:

```text
Instance: http://127.0.0.1:3556; profile phone (Pixel 7, CPU 4× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                       Runs  p50      p95      Max      Target   Pass
NF-2.7  First load, cold cache          20    5578 ms  5600 ms  5641 ms  5000 ms  NO
NF-2.7  First load, warm cache          20    1487 ms  1505 ms  1527 ms  —        —
NF-2.1  Show a folder of 1,000 entries  20    653 ms   656 ms   657 ms   1000 ms  yes
NF-2.2  Editor usable, 100 KB, slow 4G  20    3607 ms  3620 ms  3620 ms  2000 ms  NO
NF-2.5  Preview updated, 200 KB         20    1143 ms  1177 ms  1184 ms  300 ms   NO
```

`perf-api.mjs run --email admin@example.com`, to check that compression did not
move the server's own times, with and without the compression middleware (the
same build, its one line in `start-server.ts` taken out), each on a fresh data
directory on the same disk:

```text
Rule    Operation                       With compression        Without
                                        p50     p95             p50     p95
NF-2.1  Open a folder of 1,000 entries  12 ms   16 ms           11 ms   13 ms
NF-2.2  Open a 100 KB Markdown file     4.2 ms  5.4 ms          3.9 ms  6.8 ms
NF-2.3  Save a 100 KB file              58 ms   59 ms           57 ms   60 ms
NF-2.6  Pull (job) over git pull        54 ms   60 ms           49 ms   56 ms
NF-2.6  Push (job) over git push        25 ms   29 ms           24 ms   28 ms
```

The save is slower than plan 150's 18 ms with or without compression: the data
directory was on another disk then. A first run with the data directory on
`tmpfs` gave 1.0 ms, so the save's time here is the disk's.

What changed and what is left:

- **The folder of 1,000 entries passes**: 1.1 s to 0.61 s, the listing now 3 KB
  gzipped instead of 94 KB. NF-2.1 still fails for 10 users at once on the
  reference host (plan 160).
- **The warm load** asks for no hashed file again: 3.6 s to 1.2 s.
- **The first load, cold, still misses by 0.4 s (desktop) and 0.6 s (phone)**:
  11.0 s to 5.4 s. Its 167 KB now take about 1 s at 180 KB/s; the rest is most
  likely round trips of 562.5 ms each, one after another (not traced request by
  request): `index.html`, then `main-*.js` and the files it imports, then the
  lazy route's chunks, the translations and the first API requests, each found
  only when the one before it has run.
- **The editor on slow 4G still misses by 1.4 s**: 8.2 s to 3.4 s. The editor's
  lazy chunks are loaded one after another as each import is found, each a round
  trip, before the 100 KB file.

Both are round trips rather than bytes, so plan 162 (Part F of the step 6 index)
takes them: `modulepreload` for the lazy route's and the editor's chunks, and
fewer requests one after another on the first page. The phone's NF-2.5 row has
no network part and stays as plan 151 left it.

## Plan 162: round trips

**Indicative only**, on the same machine as plans 151 and 159. Plan 162's
`perf-screen.mjs waterfall` lists every request of a cold first load and of
opening the 100 KB `big.md`, on slow 4G, and groups them into **waves**: a
request is in wave _n_ + 1 when it starts at or after the first end in wave _n_.
The number of waves is the number of round trips made one after another, each
562.5 ms on slow 4G.

### Before

Taken on 2026-11-25 against the server and web client of commit `12f164d` (this
plan's base) built for production, with `web:precompress`, on a fresh data
directory on disk (`FRONT_BURNER_LOG_LEVEL=warn`,
`FRONT_BURNER_SERVER_TIMING=true`).

| Measure                        | Desktop: waves | Mark    | Phone: waves | Mark    |
| ------------------------------ | -------------- | ------- | ------------ | ------- |
| First load, cold cache         | 8              | 5396 ms | 8            | 5597 ms |
| Editor usable, 100 KB, slow 4G | 3              | 3439 ms | 3            | 3604 ms |

`perf-screen.mjs waterfall --email admin@example.com` (desktop), the first load:

```text
Wave  Start    End      Request
1     0 ms     583 ms   /
2     592 ms   1269 ms  /styles-POZISHPY.css
2     592 ms   1868 ms  /chunk-BNfx-oCf.js
2     592 ms   1227 ms  /chunk-B9dn0NrW.js
2     592 ms   1194 ms  /polyfills-7Q6ROF5C.js
2     592 ms   2419 ms  /main-ZCKRL2BP.js
3     1268 ms  2391 ms  /media/inter-latin-wght-normal-NRMW37G5.woff2
4     2448 ms  3058 ms  /chunk-BvLe0wMs.js
4     2449 ms  3049 ms  /chunk-64USeiKr.js
4     2449 ms  3033 ms  /chunk-DywkOlpa.js
5     3052 ms  3816 ms  /i18n/en.json
5     3058 ms  3732 ms  /chunk-BYRY_D2E.js
5     3058 ms  4224 ms  /chunk-CyM9pZN3.js
6     4241 ms  4808 ms  /api/v1/onboarding
7     4811 ms  5383 ms  /chunk-C_z1MSRN.js
8     5386 ms  5957 ms  /api/v1/me
8     5390 ms  5966 ms  /api/v1/repositories/recent

Mark at 5396 ms; 17 requests in 8 waves.
```

Opening `big.md`:

```text
Wave  Start    End      Request
1     17 ms    584 ms   /api/v1/repositories/1/git/fetch/file-opened
1     17 ms    601 ms   /api/v1/repositories/1/file?path=big.md
2     617 ms   1876 ms  /chunk-CGCanc0T.js
3     1881 ms  3393 ms  /chunk-BasEaq0f.js

Mark at 3439 ms; 4 requests in 3 waves.
```

The phone's waterfalls have the same requests in the same waves, each a few ms
later. The font (wave 3) is not waited for. What the first load waits for, wave
by wave: `index.html`; `main` and the files `index.html` names; the route's lazy
chunks, found once `main` has run; their own static imports and the
translations; the onboarding status, asked for only by the guard; the shell's
lazy component, loaded only once the guard has let the route through; and the
dashboard's API requests, whose answers the mark does not wait for. The editor
waits for the file, then its first chunk, then that chunk's static import: 124
KB and 169 KB of Brotli, 1.6 s at 180 KB/s however they are ordered.

### After

Taken on 2026-11-25 as above, against commit `c1ad1ed` (this plan's last code
change): the server preloads the first route's chunks and the translations
(A-7.9), the web client asks for the onboarding status at start and for the
editor's chunks as soon as a Markdown file is chosen (A-8.18). The groups of the
chunk map, from `web:chunk-map`, each counted whole although groups share chunks
(`/` preloads the union of `shell` and `dashboard`, 118 KB of Brotli):

| Group               | Files | gzip     | Brotli   |
| ------------------- | ----- | -------- | -------- |
| `auth`              | 3     | 126.0 KB | 104.5 KB |
| `shell`             | 3     | 108.7 KB | 89.1 KB  |
| `dashboard`         | 3     | 111.3 KB | 91.3 KB  |
| `repositories`      | 5     | 153.1 KB | 128.2 KB |
| `preferences`       | 4     | 133.3 KB | 110.7 KB |
| `repository-screen` | 6     | 196.0 KB | 163.9 KB |
| `editor`            | 8     | 538.6 KB | 450.3 KB |

| Measure                        | Waves before | After | Desktop: mark before | After   | Phone: mark before | After   |
| ------------------------------ | ------------ | ----- | -------------------- | ------- | ------------------ | ------- |
| First load, cold cache         | 8            | 5     | 5396 ms              | 3657 ms | 5597 ms            | 3780 ms |
| Editor usable, 100 KB, slow 4G | 3            | 1     | 3439 ms              | 2297 ms | 3604 ms            | 2436 ms |

The phone has the same waves as the desktop, before and after.

`perf-screen.mjs waterfall --email admin@example.com` (desktop), the first load:

```text
Wave  Start    End      Request
1     0 ms     584 ms   /
2     591 ms   1294 ms  /styles-POZISHPY.css
2     591 ms   1169 ms  /chunk-BP_c6noG.js
2     591 ms   1327 ms  /chunk-CFSmKejw.js
2     591 ms   1961 ms  /chunk-DZ53YNge.js
2     591 ms   1278 ms  /chunk-CwN1F0Zo.js
2     591 ms   1428 ms  /i18n/en.json
2     591 ms   2644 ms  /chunk-BLd-aSjC.js
2     592 ms   1894 ms  /chunk-B9dn0NrW.js
2     592 ms   1886 ms  /polyfills-7Q6ROF5C.js
2     592 ms   3053 ms  /main-5RP3FM7F.js
3     1293 ms  2684 ms  /media/inter-latin-wght-normal-NRMW37G5.woff2
4     3080 ms  3650 ms  /api/v1/onboarding
4     3100 ms  3683 ms  /chunk-Bnm064l4.js
4     3100 ms  3675 ms  /chunk-Cr_n4ZYl.js
5     3657 ms  4225 ms  /api/v1/me

Mark at 3657 ms; 16 requests in 5 waves.
```

Opening `big.md`:

```text
Wave  Start  End      Request
1     16 ms  589 ms   /api/v1/repositories/1/git/fetch/file-opened
1     17 ms  623 ms   /api/v1/repositories/1/file?path=big.md
1     20 ms  2256 ms  /chunk-Bc7qgy-3.js
1     20 ms  2006 ms  /chunk-DvbM9cmz.js

Mark at 2297 ms; 4 requests in 1 waves.
```

`i18n/en.json` is asked for once, by the preload. `perf-screen.mjs run --email
admin@example.com` (desktop):

```text
Host: 20 CPUs (12th Gen Intel(R) Core(TM) i7-12700K), 31.1 GB memory, linux
Instance: http://127.0.0.1:3556; profile desktop (Desktop Chrome, CPU 1× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                         Runs  p50      p95      Max      Target   Pass
NF-2.7  First load, cold cache            20    3657 ms  3665 ms  3666 ms  5000 ms  yes
NF-2.7  First load, warm cache            20    1231 ms  1239 ms  1240 ms  —        —
NF-2.1  Show a folder of 1,000 entries    20    608 ms   610 ms   611 ms   1000 ms  yes
NF-2.2  Editor usable, 100 KB, broadband  20    75 ms    77 ms    77 ms    1000 ms  yes
NF-2.2  Editor usable, 100 KB, slow 4G    20    2297 ms  2302 ms  2302 ms  2000 ms  NO
NF-2.5  Preview updated, 200 KB           20    126 ms   128 ms   128 ms   300 ms   yes
```

`perf-screen.mjs run --email admin@example.com --profile phone`:

```text
Instance: http://127.0.0.1:3556; profile phone (Pixel 7, CPU 4× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                       Runs  p50      p95      Max      Target   Pass
NF-2.7  First load, cold cache          20    3779 ms  3781 ms  3783 ms  5000 ms  yes
NF-2.7  First load, warm cache          20    1446 ms  1470 ms  1525 ms  —        —
NF-2.1  Show a folder of 1,000 entries  20    650 ms   654 ms   655 ms   1000 ms  yes
NF-2.2  Editor usable, 100 KB, slow 4G  20    2445 ms  2451 ms  2453 ms  2000 ms  NO
NF-2.5  Preview updated, 200 KB         20    1085 ms  1101 ms  1103 ms  300 ms   NO
```

What changed and what is left:

- **The first load, cold, passes**: 5.4 s to 3.7 s (desktop), 5.6 s to 3.8 s
  (phone), from 8 waves to 5. The route's chunks and the translations now arrive
  with `main` (wave 2), and the onboarding status and the shell's lazy component
  no longer wait for each other. The waves left: `index.html`; every file it
  names; the onboarding status and the two chunks `main` imports dynamically at
  start, all asked for only once `main` has run; the dashboard's API requests,
  which the mark does not wait for. `main` itself now ends later (3.1 s against
  2.4 s), as the preloaded chunks share the 180 KB/s with it. Inlining the
  onboarding status into `index.html` (the plan's "Left out") would save at most
  wave 4's onboarding request, which runs beside two chunks that take as long:
  not worth it while the row passes.
- **The editor on slow 4G still misses by 0.3 s (desktop) and 0.45 s (phone)**:
  3.4 s to 2.3 s, from 3 waves to 1. Its time is now bytes, not round trips: the
  file and the editor's two chunks start together, and the chunks, 169 KB and
  124 KB of Brotli, take 1.6 s at 180 KB/s on top of the round trip.
  CodeMirror's chunk carries `@lezer/javascript` (93 KB before compression), and
  the editor pane's own chunk carries the preview's Markdown pipeline
  (`hast-util-raw` alone 203 KB before compression, with micromark), which
  A-8.13 runs in a worker; why the main thread's chunk holds it too was not
  traced here. Plan 163 (Part F of the step 6 index) takes them.
- The warm load, the folder and the preview are unchanged, as expected.

### On the reference host

Taken on 2026-11-25 on plan 152's droplet (2 vCPU, 4 GB, Ubuntu 24.04.5, kernel
6.8.0-149-generic, Docker 29.1.3), with steps 3 and 6 of the run sheet: a second
instance beside plan 152's, on a fresh data directory and port 8090, with the
run sheet's override but no metrics token, and the screens from the developer
machine through the SSH tunnel. Before: the image of plan 161
(`sha256:36f7001d6182`, commit `aade0f2`, whose server and web client are this
plan's base). After: the image built from commit `c1ad1ed` with the run sheet's
`docker build` (`sha256:c35262bc7edf`). The second instance was removed
afterwards.

| Rule   | Operation (p95)                  | Desktop: before | After   | Phone: before | After   | Target |
| ------ | -------------------------------- | --------------- | ------- | ------------- | ------- | ------ |
| NF-2.7 | First load, cold cache           | 5389 ms         | 3666 ms | 5595 ms       | 3819 ms | 5 s    |
| NF-2.7 | First load, warm cache           | 1247 ms         | 1242 ms | 1503 ms       | 1501 ms | —      |
| NF-2.1 | Show a folder of 1,000 entries   | 610 ms          | 610 ms  | 651 ms        | 667 ms  | 1 s    |
| NF-2.2 | Editor usable, 100 KB, broadband | 183 ms          | 146 ms  | —             | —       | 1 s    |
| NF-2.2 | Editor usable, 100 KB, slow 4G   | 3450 ms         | 2330 ms | 3603 ms       | 2487 ms | 2 s    |
| NF-2.5 | Preview updated, 200 KB          | 128 ms          | 130 ms  | 1157 ms       | 1381 ms | 300 ms |

The waterfalls have the same waves as on the developer machine: 8 and 3 before,
5 and 1 after, with the marks within 40 ms of its own. The slow 4G rows are set
by the throttled network, not by the host or the distance to London. The phone's
preview row has no network part, and runs on the developer machine's CPU slowed
4 times: its 1.2 s to 1.4 s is the browser's, not the host's.

## Plan 163: editor bytes

**Indicative only**, on the same machine as plans 151, 159 and 162. After plan
162 the editor's chunks loaded in one wave beside the file, but their 293 KB of
Brotli kept NF-2.2 at 2.3 s on slow 4G. Plan 163 takes two things out of them
that are not needed to type (A-8.11, A-8.18):

- **The preview's Markdown pipeline** (`render-safe-html.ts`, `hast-util-raw`,
  micromark), which runs in the preview worker, was also in the editor pane's
  chunk, because `libs/web/markdown`'s entry point exported `renderSafeHtml`.
- **The HTML, CSS and JavaScript grammars** of `@codemirror/lang-html` now come
  in a chunk of their own after `fb:editor-ready`. The editor starts with the
  basic language, Markdown and front matter, and swaps in the full one, with
  HTML tags highlighted, once it has loaded. The basic language is built from
  `@lezer/markdown`'s parser, now declared in `package.json` at the version the
  lockfile already had: importing `@codemirror/lang-markdown` outside the lazy
  chunk would keep `lang-html` in the editor's, as the bundler splits by module.

`web:chunk-map` now fails the build when the `editor` group holds either again,
or when the editor's own files (the group less the repository screen's) are over
230 KB gzipped.

### The editor's chunks

The production build of commit `bd1d9be`, sizes as `web:precompress` serves
them:

| Chunk                       | Holds                                     | Before (Brotli) | After: raw | gzip     | Brotli   |
| --------------------------- | ----------------------------------------- | --------------- | ---------- | -------- | -------- |
| Editor pane                 | `rs-editor-pane` and what only it imports | 124 KB          | 92 KB      | 28.9 KB  | 25.9 KB  |
| CodeMirror                  | CodeMirror, Markdown, YAML                | 169 KB          | 418 KB     | 136.2 KB | 116.9 KB |
| HTML language (lazy, after) | `markdown-html.ts`, `lang-html`, grammars | —               | 155 KB     | 62.0 KB  | 51.1 KB  |

`web:chunk-map` prints 165.1 KB gzipped for the editor's own files, against the
230 KB budget. The `editor` group's other six files are the repository screen's,
which are loaded before any file can be chosen.

### Measured

Taken on 2026-11-25 against the server and web client of commit `bd1d9be` built
for production, with `web:precompress`, on a fresh data directory on disk
(`FRONT_BURNER_LOG_LEVEL=warn`, `FRONT_BURNER_SERVER_TIMING=true`). "Before" is
plan 162's "After", on the same machine, against commit `c1ad1ed`, whose server
and web client are this plan's base.

| Operation (p95)                  | Rule   | Desktop: before | After   | Phone: before | After   | Target |
| -------------------------------- | ------ | --------------- | ------- | ------------- | ------- | ------ |
| First load, cold cache           | NF-2.7 | 3665 ms         | 3666 ms | 3781 ms       | 3792 ms | 5 s    |
| First load, warm cache           | NF-2.7 | 1239 ms         | 1232 ms | 1470 ms       | 1471 ms | —      |
| Show a folder of 1,000 entries   | NF-2.1 | 610 ms          | 611 ms  | 654 ms        | 659 ms  | 1 s    |
| Editor usable, 100 KB, broadband | NF-2.2 | 77 ms           | 66 ms   | —             | —       | 1 s    |
| Editor usable, 100 KB, slow 4G   | NF-2.2 | 2302 ms         | 1476 ms | 2451 ms       | 1608 ms | 2 s    |
| Preview updated, 200 KB          | NF-2.5 | 128 ms          | 121 ms  | 1101 ms       | 1273 ms | 300 ms |

`perf-screen.mjs waterfall --measures editor-slow-4g` (desktop), opening
`big.md`:

```text
Wave  Start  End      Request
1     16 ms  586 ms   /api/v1/repositories/1/git/fetch/file-opened
1     17 ms  619 ms   /api/v1/repositories/1/file?path=big.md
1     20 ms  910 ms   /chunk-CQrA0QN6.js
1     20 ms  1436 ms  /chunk-CkrmW3B4.js

Mark at 1470 ms; 4 requests in 1 waves.
```

The phone's has the same requests in the same wave, with the mark at 1608 ms.
The HTML language's chunk (`chunk-BYUzVqoj.js`) is not in it, as it is asked for
after the mark. Checked by hand in Chromium, broadband: the chunk is asked for 6
ms after `fb:editor-ready`, and an `<abbr title="x">` typed into the file then
has its tag name and attribute coloured, as before.

- **NF-2.2 passes on slow 4G** on the developer machine: 2.3 s to 1.5 s
  (desktop), 2.5 s to 1.6 s (phone). The 0.8 s saved is about the 150 KB of
  Brotli taken out, at 180 KB/s. The reference host agrees (below).
- The other rows are unchanged, as expected. The phone's preview row (1.1 s to
  1.3 s) has no network part and runs on this machine's CPU slowed 4 times; it
  is NF-2.5's, outside this plan.
- **One full desktop run did not finish**: the fourth measure, `editor-slow-4g`,
  timed out waiting for the repository screen, three times out of three, 3.5
  minutes in, also with a 1-hour auth token. It passed whenever the measures ran
  in two parts with a minute between them, which is how the desktop row above
  was taken. The likely cause is the refresh limit of 60 a minute per address
  (`RATE_LIMIT_GROUPS.refresh`): every run is a fresh context that refreshes,
  and the broadband runs are about a second each. Not confirmed; nothing in this
  plan touches refresh. The phone, which has no broadband runs, finished in one
  go.

### On the reference host

Taken on 2026-11-25 on plan 152's droplet (2 vCPU "DO-Regular", 4 GB, 80 GB SSD,
Ubuntu 24.04.5, kernel 6.8.0-149-generic, Docker 29.1.3, Compose 2.40.3), with
steps 3 and 6 of the run sheet: a second instance beside plan 152's, on port
8090, with the run sheet's override but no metrics token, and the screens from
the developer machine through the SSH tunnel (the tool's git server on port
9419). Before: plan 162's image (`sha256:c35262bc7edf`, commit `c1ad1ed`, whose
server and web client are this plan's base). After: the image built from commit
`cb5f662` with the run sheet's `docker build` (`sha256:dbbdbe6b9178`), which
also includes the review's fixes. Each on a fresh data directory; the second
instance was removed afterwards. As on the developer machine, the desktop rows
were taken in two parts a minute apart.

| Operation (p95)                  | Rule   | Desktop: before | After   | Phone: before | After   | Target |
| -------------------------------- | ------ | --------------- | ------- | ------------- | ------- | ------ |
| First load, cold cache           | NF-2.7 | 3658 ms         | 3658 ms | 3789 ms       | 3787 ms | 5 s    |
| First load, warm cache           | NF-2.7 | 1229 ms         | 1225 ms | 1468 ms       | 1445 ms | —      |
| Show a folder of 1,000 entries   | NF-2.1 | 611 ms          | 610 ms  | 653 ms        | 652 ms  | 1 s    |
| Editor usable, 100 KB, broadband | NF-2.2 | 97 ms           | 84 ms   | —             | —       | 1 s    |
| Editor usable, 100 KB, slow 4G   | NF-2.2 | 2301 ms         | 1474 ms | 2449 ms       | 1593 ms | 2 s    |
| Preview updated, 200 KB          | NF-2.5 | 129 ms          | 127 ms  | 1126 ms       | 1102 ms | 300 ms |

`perf-screen.mjs waterfall --measures editor-slow-4g` (desktop), after:

```text
Wave  Start  End      Request
1     16 ms  586 ms   /api/v1/repositories/1/git/fetch/file-opened
1     16 ms  636 ms   /api/v1/repositories/1/file?path=big.md
1     19 ms  920 ms   /chunk-8fsP1tLQ.js
1     19 ms  1436 ms  /chunk-BZRSmnBu.js

Mark at 1468 ms; 4 requests in 1 waves.
```

Before, the same wave ended with the two chunks at 2004 ms and 2255 ms, and the
mark at 2295 ms; the phone's marks were at 2437 ms before and 1587 ms after.

- **NF-2.2 passes on slow 4G on the reference host**: 2.3 s to 1.47 s (desktop),
  2.45 s to 1.59 s (phone), within 20 ms of the developer machine's. The other
  rows are unchanged; the phone's preview row is NF-2.5's, as above.

## Reference host

Plan 152 measures NF-1 and NF-2 on the reference host of
[non-functional.md](../architecture/non-functional.md#reference-host) (2 vCPU, 4
GB RAM, an SSD), running the release image, and repeats spike 4's status and
commit timings there with the image's git. The run sheet below is how it was
done, so that a later release can repeat it; the results follow it.

### Run sheet

A throwaway cloud VM of the reference size is enough, with a fresh Linux and SSH
as root. Nothing on it is kept: delete it after the run. `<host>` is its
address, `<commit>` the commit measured.

1. **The host.** Install Docker with Compose and Node 24 (the version in
   `.nvmrc`), and let only SSH in, since the instance listens on the host's
   network:

   ```sh
   apt-get install -y docker.io docker-compose-v2 rsync build-essential python3
   # Node 24 from nodejs.org into /opt, linked into /usr/local/bin
   ufw allow OpenSSH && ufw --force enable
   ```

2. **The workspace and the image**, from a developer machine at `<commit>`. The
   tools need the workspace's files but, of the dependencies, only
   `better-sqlite3` (for `scale`). The image is built as CI builds it, or pulled
   from `ghcr.io` once a release exists:

   ```sh
   git ls-files -z | rsync -a --from0 --files-from=- ./ root@<host>:/srv/fb/
   ssh root@<host> 'mkdir /srv/deps && cd /srv/deps && echo {} > package.json \
     && npm install better-sqlite3@<package.json version> \
     && ln -s /srv/deps/node_modules /srv/fb/node_modules'
   docker build -f tools/docker/Dockerfile -t front-burner:ref-<commit> .
   docker save front-burner:ref-<commit> | gzip -1 | ssh root@<host> 'gunzip | docker load'
   ```

3. **The instance**, on the host in `/srv/fb/tmp/ref`: the guide's compose
   example (`docs/wiki/compose.example.yaml`) unchanged, its three secret files
   and a metrics token made with `openssl rand -hex 32` (owner 1000, mode 600),
   an empty `data/` owned by 1000, and this `compose.override.yaml`. The data
   directory is a bind mount under the workspace, because `scale` writes into
   it; the instance is on the host's network, because the tools serve their
   remotes on `127.0.0.1` with the test certificate.

   ```yaml
   services:
     front-burner:
       image: front-burner:ref-<commit>
       network_mode: host
       ports: !reset []
       environment:
         FRONT_BURNER_SERVER_TIMING: "true"
         FRONT_BURNER_METRICS_TOKEN_FILE: /run/secrets/front-burner-metrics-token
         GIT_SSL_CAINFO: /perf/test.crt
       secrets:
         - front-burner-metrics-token
       volumes: !override
         - ./data:/data
         - /srv/fb/libs/server/core/security/src/testing/fixtures/test.crt:/perf/test.crt:ro
   secrets:
     front-burner-metrics-token:
       file: ./secrets/metrics-token
   ```

   Then `docker compose up -d`, and onboard `admin@example.com` with `POST
   /api/v1/onboarding/password-setup` and the setup token. The password goes
   into `PERF_PASSWORD` for every command below.

4. **The large repository and the API, one user** (NF-1.4, NF-2.1 to NF-2.3,
   NF-2.6, NF-2.8), on the host as root, since `--cold` drops the page cache:

   ```sh
   cd /srv/fb
   node tools/ai-tools/src/bin/gen-large-repo.mjs generate
   node tools/ai-tools/src/bin/perf-api.mjs run --url http://127.0.0.1:8080 \
     --email admin@example.com --large --cold
   ```

5. **Scale and the restart** (NF-1.1 to NF-1.3, NF-9.4's recovery): stop the
   instance, fill it as the container's UID, and time the start, which also
   refreshes the index of each working copy after the cold runs:

   ```sh
   (cd tmp/ref && docker compose stop)
   setpriv --reuid=1000 --regid=1000 --clear-groups \
     node tools/ai-tools/src/bin/perf-api.mjs scale --data-dir tmp/ref/data
   node tools/ai-tools/src/bin/perf-api.mjs ready --url http://127.0.0.1:8080 &
   (cd tmp/ref && docker compose start); wait
   node tools/ai-tools/src/bin/perf-api.mjs run --url http://127.0.0.1:8080 --users 10 \
     --metrics-token-file tmp/ref/secrets/metrics-token \
     --instance-pid "$(docker inspect -f '{{.State.Pid}}' ref-front-burner-1)"
   ```

   Each of the 10 users pauses 5 seconds on average before each operation, as
   NF-1.2 measures "active" (plan 160), so the run takes about 40 minutes. The
   load printed after the table (CPU by process, the event loop's delay, each
   job's run time against its wait) says where the time went when a row misses.

6. **The screens** (NF-2.1, NF-2.2, NF-2.5, NF-2.7), from a machine outside the
   host, so that the browser does not share the host's CPU and the requests
   cross the real network as well as the slow 4G throttling. An SSH tunnel
   carries the instance to the machine and the tool's git server back to the
   host's `127.0.0.1`, where the instance clones from:

   ```sh
   ssh -N -L 8080:127.0.0.1:8080 -R 9418:127.0.0.1:9418 root@<host> &
   node tools/ai-tools/src/bin/perf-screen.mjs run --url http://127.0.0.1:8080 \
     --email admin@example.com --git-port 9418 --profile desktop
   node tools/ai-tools/src/bin/perf-screen.mjs run --url http://127.0.0.1:8080 \
     --email admin@example.com --git-port 9418 --profile phone --name screen-phone
   ```

   When a `--users 10` row of step 5 misses its target and the load shows the
   tool's own share of the CPU ("everything else") as large, run it again the
   same way, from outside (`--name perfx --git-port 9418`), to tell the
   instance's own load from the tool's.

7. **The host's record**: `lscpu`, `free -m`, `lsblk -d -o NAME,ROTA,SIZE`,
   `uname -r`, `docker --version`, `git --version` on the host and in the
   container, and the image's ID.

8. **Afterwards**: `FRONT_BURNER_SERVER_TIMING` is for measuring only; the VM is
   deleted with the instance, which removes it too.

### Results

Taken on 2026-11-23 with the run sheet above, against the release image built
from commit `f9c295c` (image `sha256:5fad7d53f216`).

- **Host:** a DigitalOcean droplet in London, "Regular" 2 vCPU, 4 GB (3.8 GB
  usable, no swap), 80 GB SSD (`vda`, ext4, virtio), Ubuntu 24.04.5, kernel
  6.8.0-149-generic, KVM; the CPU is reported as "DO-Regular" at 2.0 GHz, with
  AVX2. Docker 29.1.3, Compose 2.40.3. Git 2.47.3 in the image, 2.43.0 on the
  host (the tool's plain `git` for NF-2.6).
- **Screens:** from the developer machine of plan 151 (i7-12700K, Chromium of
  Playwright) through the SSH tunnel, over the internet to London.
- **The large repository**, from `gen-large-repo.mjs generate` on the host:
  100,000 files, 4,504 folders, depth 5, 1200.0 MB, median 4.0 KB, mean 12.0 KB,
  largest 2062.5 KB, commit `135e3c3a`, as in plan 150.

`perf-api.mjs run --email admin@example.com --large --cold`, one user:

```text
Host: 2 CPUs (DO-Regular), 3.8 GB memory, linux, git version 2.43.0
Instance: http://127.0.0.1:8080; 1 user(s) at once; 50 runs after 5 warm-up runs
Large repository: tmp/ai-tools/large-repo, 100,000 files, 4,504 folders, 1.20 GB; cloned in 35 s

Rule    Operation                       Runs  p50      p95      Max      Target                                            Pass
NF-2.1  Open a folder of 1,000 entries  50    76 ms    94 ms    104 ms   300 ms                                            yes
NF-2.2  Open a 100 KB Markdown file     50    17 ms    48 ms    156 ms   200 ms                                            yes
NF-2.3  Save a 100 KB file              50    12 ms    19 ms    133 ms   200 ms                                            yes
NF-2.6  Pull (job) over git pull        50    370 ms   547 ms   661 ms   ≤ 1000 ms added (job p95 689 ms, git p50 142 ms)  yes
NF-2.6  Push (job) over git push        50    208 ms   273 ms   322 ms   ≤ 1000 ms added (job p95 410 ms, git p50 137 ms)  yes
NF-2.8  Status, cold, 100,000 files     5     2016 ms  2614 ms  2614 ms  ≈ 2000 ms                                         over
NF-2.8  Status, warm, 100,000 files     50    438 ms   521 ms   542 ms   ≈ 2000 ms                                         yes
NF-2.8  Commit, cold, 100,000 files     5     1738 ms  3458 ms  3458 ms  ≈ 2000 ms                                         over
NF-2.8  Commit, warm, 100,000 files     50    1240 ms  1440 ms  1655 ms  ≈ 2000 ms                                         yes
NF-1.4  Push (job), 100,000 files       10    850 ms   1358 ms  1358 ms  —                                                 —
```

The cold rows are over NF-2.8's "about 2 seconds". By the operator's decision of
2026-11-23, status and commit stay API requests (NF-2.8 in
[non-functional.md](../architecture/non-functional.md#nf-2-performance), and
spike 4 in [spikes.md](../architecture/spikes.md)).

`perf-api.mjs scale` on the stopped instance (50 users, 2,500 working copies,
written in 10 s), then `perf-api.mjs ready` while it started: **ready after 46.0
s**, of which 42 s were recovery (NF-9.4), between "Administrator onboarding
state" and "Nest application successfully started" in the log. The image's
health check allows 20 s and then three failures 10 s apart: two had failed, and
the instance answered ready 7 s before the third. A slightly slower disk or a
restore (spike 4's stale index) shows the container as `unhealthy`, which the
guide's "First start" tells the operator to treat as a problem: fixed by
[plan 161](#plan-161-health-check-start-period).

`perf-api.mjs run --users 10` among the 2,500 working copies, on the host:

```text
Host: 2 CPUs (DO-Regular), 3.8 GB memory, linux, git version 2.43.0
Instance: http://127.0.0.1:8080; 10 user(s) at once; 50 runs after 5 warm-up runs

Rule    Operation                       Runs  p50      p95      Max      Target                                             Pass
NF-2.1  Open a folder of 1,000 entries  500   519 ms   641 ms   987 ms   300 ms                                             NO
NF-2.2  Open a 100 KB Markdown file     500   131 ms   208 ms   282 ms   200 ms                                             NO
NF-2.3  Save a 100 KB file              500   56 ms    81 ms    249 ms   200 ms                                             yes
NF-2.6  Pull (job) over git pull        500   2973 ms  3691 ms  4740 ms  ≤ 1000 ms added (job p95 4487 ms, git p50 795 ms)  NO
NF-2.6  Push (job) over git push        500   1227 ms  1506 ms  2346 ms  ≤ 1000 ms added (job p95 2228 ms, git p50 723 ms)  NO
```

The tool and its git server shared the 2 vCPU with the instance (load average
7.5), so the same run was repeated from the developer machine through the
tunnel, with only the instance and its git on the host (load average 2.7):

```text
Host: 20 CPUs (12th Gen Intel(R) Core(TM) i7-12700K), 31.1 GB memory, linux, git version 2.56.1
Instance: http://127.0.0.1:8080; 10 user(s) at once; 50 runs after 5 warm-up runs

Rule    Operation                       Runs  p50      p95      Max      Target                                            Pass
NF-2.1  Open a folder of 1,000 entries  500   517 ms   633 ms   659 ms   300 ms                                            NO
NF-2.2  Open a 100 KB Markdown file     500   99 ms    174 ms   257 ms   200 ms                                            yes
NF-2.3  Save a 100 KB file              500   50 ms    135 ms   197 ms   200 ms                                            yes
NF-2.6  Pull (job) over git pull        500   2760 ms  3314 ms  3712 ms  ≤ 1000 ms added (job p95 3359 ms, git p50 45 ms)  NO
NF-2.6  Push (job) over git push        500   1615 ms  1933 ms  2163 ms  ≤ 1000 ms added (job p95 2014 ms, git p50 81 ms)  NO
```

In that repeat the instance's git reaches the remote across the tunnel and the
plain `git` does not, which adds to NF-2.6's difference; the host's own run has
no such gap and misses too. So the misses are the instance's: a folder of 1,000
entries takes about seven times as long with 10 users at once as with one, and
the pull and push jobs, which share the `fetch` pool's 4 places (A-6.5), wait
for each other. Plan 160 finds the cause and fixes it.

`perf-screen.mjs run --email admin@example.com` (desktop):

```text
Host: 20 CPUs (12th Gen Intel(R) Core(TM) i7-12700K), 31.1 GB memory, linux
Instance: http://127.0.0.1:8080; profile desktop (Desktop Chrome, CPU 1× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                         Runs  p50       p95       Max       Target   Pass
NF-2.7  First load, cold cache            20    11030 ms  11039 ms  11046 ms  5000 ms  NO
NF-2.7  First load, warm cache            20    3560 ms   3568 ms   3569 ms   —        —
NF-2.1  Show a folder of 1,000 entries    20    1124 ms   1127 ms   1128 ms   1000 ms  NO
NF-2.2  Editor usable, 100 KB, broadband  20    150 ms    182 ms    254 ms    1000 ms  yes
NF-2.2  Editor usable, 100 KB, slow 4G    20    8265 ms   8269 ms   8269 ms   2000 ms  NO
NF-2.5  Preview updated, 200 KB           20    125 ms    128 ms    129 ms    300 ms   yes
```

`perf-screen.mjs run --email admin@example.com --profile phone`:

```text
Instance: http://127.0.0.1:8080; profile phone (Pixel 7, CPU 4× slower); 20 runs after 1 warm-up runs, each in a fresh context

Rule    Operation                       Runs  p50       p95       Max       Target   Pass
NF-2.7  First load, cold cache          20    11231 ms  11239 ms  11246 ms  5000 ms  NO
NF-2.7  First load, warm cache          20    3766 ms   3788 ms   3790 ms   —        —
NF-2.1  Show a folder of 1,000 entries  20    1164 ms   1170 ms   1171 ms   1000 ms  NO
NF-2.2  Editor usable, 100 KB, slow 4G  20    8436 ms   8439 ms   8442 ms   2000 ms  NO
NF-2.5  Preview updated, 200 KB         20    1120 ms   1153 ms   1158 ms   300 ms   NO
```

The screen rows are plan 151's within a few milliseconds: the slow 4G rows are
set by the uncompressed responses (plan 159), not by the host, and the phone's
NF-2.5 row waits for its decision with plan 155. The screens were run before
plan 159, so they are taken again after it; slow 4G rows do not depend on the
host, so that run can be anywhere.

### Plan 160: ten users, measured again

Taken on 2026-11-24 on the same droplet, with steps 4 and 5 of the run sheet,
against the release image built from commit `f052735` (image
`sha256:06caf212d02c`; git 2.47.3 in the image, 2.43.0 on the host). The data
directory was plan 152's, so `scale` was not run again: its 2,500 working
copies, with the repositories that plan 152 and plan 160's own runs had added.
Plan 160 found the cause of the misses above (its "The cause"), and changed
three things: NF-1.2 is measured with think time, each user pausing 5 seconds on
average before each operation (the operator's decision, recorded at NF-1.2); git
reads the certificate bundle rather than `/etc/ssl/certs` file by file on every
connection (A-5.1), with fewer gits per listing and per network command; and
`tini` is the image's PID 1, which reaps the processes git's detached
maintenance leaves (NF-11.11). Ready after 48.0 s.

`perf-api.mjs run --email admin@example.com --large --cold`, one user:

```text
Host: 2 CPUs (DO-Regular), 3.8 GB memory, linux, git version 2.43.0
Instance: http://127.0.0.1:8080; 1 user(s) at once; 50 runs after 5 warm-up runs
Large repository: tmp/ai-tools/large-repo, 100,000 files, 4,504 folders, 1.20 GB; cloned in 37 s

Rule    Operation                       Runs  p50      p95      Max      Target                                            Pass
NF-2.1  Open a folder of 1,000 entries  50    63 ms    82 ms    90 ms    300 ms                                            yes
NF-2.2  Open a 100 KB Markdown file     50    17 ms    20 ms    55 ms    200 ms                                            yes
NF-2.3  Save a 100 KB file              50    19 ms    27 ms    40 ms    200 ms                                            yes
NF-2.6  Pull (job) over git pull        50    224 ms   273 ms   483 ms   ≤ 1000 ms added (job p95 426 ms, git p50 153 ms)  yes
NF-2.6  Push (job) over git push        50    86 ms    115 ms   150 ms   ≤ 1000 ms added (job p95 252 ms, git p50 136 ms)  yes
NF-2.8  Status, cold, 100,000 files     5     956 ms   1017 ms  1017 ms  ≈ 2000 ms                                         yes
NF-2.8  Status, warm, 100,000 files     50    471 ms   570 ms   711 ms   ≈ 2000 ms                                         yes
NF-2.8  Commit, cold, 100,000 files     5     1850 ms  1993 ms  1993 ms  ≈ 2000 ms                                         yes
NF-2.8  Commit, warm, 100,000 files     50    1326 ms  1464 ms  1734 ms  ≈ 2000 ms                                         yes
NF-1.4  Push (job), 100,000 files       10    753 ms   1064 ms  1064 ms  —                                                 —
```

What the instance adds to a pull and a push halved against plan 152 (547 to 273
ms, 273 to 115 ms at p95): most of it was curl reading the certificate folder on
each of a fetch's connections. The cold rows vary from run to run: an earlier
run of plan 160 on an image without the certificate change gave 5.9 s and 6.4 s,
this one 1.0 s and 2.0 s, and plan 152 2.6 s and 3.5 s; NF-2.8's decision stands
either way.

`perf-api.mjs run --users 10` among the working copies, on the host, with the
load (`--metrics-token-file`, `--instance-pid`):

```text
Host: 2 CPUs (DO-Regular), 3.8 GB memory, linux, git version 2.43.0
Instance: http://127.0.0.1:8080; 10 user(s) at once; 50 runs after 5 warm-up runs; each user pauses 5 s on average before each

Rule    Operation                       Runs  p50     p95     Max      Target                                             Pass
NF-2.1  Open a folder of 1,000 entries  500   61 ms   128 ms  223 ms   300 ms                                             yes
NF-2.2  Open a 100 KB Markdown file     500   15 ms   25 ms   127 ms   200 ms                                             yes
NF-2.3  Save a 100 KB file              500   15 ms   32 ms   77 ms    200 ms                                             yes
NF-2.6  Pull (job) over git pull        500   348 ms  944 ms  1209 ms  ≤ 1000 ms added (job p95 1110 ms, git p50 165 ms)  yes
NF-2.6  Push (job) over git push        500   117 ms  349 ms  579 ms   ≤ 1000 ms added (job p95 489 ms, git p50 140 ms)   yes

Load while the measures ran:
CPU over 2087 s, in cores: host 0.59; instance node 0.10, instance git and the rest of its container 0.15, everything else 0.34
Load average (1 min), highest: 6.9
Event loop delay: p50 10.2 ms (mean of the windows), p99 34.0 ms, max 109.5 ms (highest window)
Job storage.disk-check: 34 run, mean run time 2 ms; at most 1 queued
Job sync.pull: 550 run, mean run time 550 ms; mean from request to job.finished 598 ms, so 48 ms waiting or on the way; at most 2 queued
Job sync.push: 550 run, mean run time 255 ms; mean from request to job.finished 290 ms, so 36 ms waiting or on the way
```

Every target holds with 10 users at work. The pull's p95 is the closest, 944 ms
against 1,000: the users' pulls come in bursts, each after a push from
elsewhere, and a pull still runs about 20 gits one after another. Without the
certificate change, on otherwise the same image, the same run gave 1,529 ms. No
zombie was left in the container after the run (3,344 after plan 152's).

The same tool with no pauses (`--think 0`) is a load test, no longer NF-1.2's
check: on the old image it kept the main thread at its limit, with a folder at
p95 692 ms and pulls waiting as long for the `fetch` pool as they ran. Plan
160's "The cause" has those numbers.

### Plan 161: health check start period

Taken on 2026-11-25 on the same droplet, against the release image built from
commit `aade0f2` with the run sheet's `docker build` (image
`sha256:36f7001d6182`), which allows a 300 s start period and checks every 2 s
within it. The data directory was plan 160's, with its 2,500 working copies. The
instance was stopped, the host's page cache dropped (`echo 3 >
/proc/sys/vm/drop_caches`) and the instance started, with `docker inspect`
polled every second:

```text
2 s: starting
83 s: healthy
```

Recovery took 75 s, between "Administrator onboarding state" (10:42:29) and
"Nest application successfully started" (10:43:44) in the log, against 42 s warm
for plan 152. Every check until then failed, inside the start period (the last
four are in `docker inspect`'s health log, which keeps five), and the next one,
at 10:43:46, passed. With the old 20 s and three failures 10 s apart, this start
would have shown `unhealthy` from about 50 s.

The container suite (`npx nx run server-e2e:e2e-container`, `E2E_IMAGE` set to
this image) passed on the droplet: 9 tests, among them "the hardened container
becomes healthy" and "the guide's compose example becomes healthy".
