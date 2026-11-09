# Code review 3: plan 89 (merge versions API)

Reviewed at `ce389f1`. Review files and commit messages are out of scope, as
requested.

**Not ready to merge, and one finding from the earlier reviews is not
resolved.** The BOM fix was later undone by a refactoring that removed
`utf8Fatal` but left one use of it. This is worse than the original bug: Front
Burner no longer writes its own conflict markers for any file, and the typecheck
fails, so CI fails too.

The fix is one line. With it applied in a throwaway worktree, every server check
passes and everything else from the two reviews holds up, apart from the minor
items below.

## Must fix

1. **`utf8Fatal` no longer exists
   (`libs/server/core/git/src/engine/git-merge.ts:480`):** commit `512c366`
   ("Refactoring") removed the declaration, but `textWithMarkers` still calls
   it. The typecheck reports `TS2304: Cannot find name 'utf8Fatal'`.

   At runtime the `ReferenceError` is thrown inside that method's `try`, and its
   bare `catch` turns it into `return null`, which normally means "not UTF-8".
   So for every conflicting Markdown file:

   - `writeMarkersFrom` returns early, leaving git's own markers: `<<<<<<< HEAD`
     rather than the branch name, and in whatever `merge.conflictStyle` the
     working copy has configured, although the glossary says Front Burner always
     uses plain style;
   - `canWriteMarkers` is always false, so a file the user took the markers out
     of stops being editable (GC-9).

   It fails 9 tests:

   | Project               | Failing tests                                                                                                                                                                                                                                                   |
   | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `server-core-git`     | `is true for text`; `is true for a file both added, which has no base`; `writes plain markers with branch names, whatever the config says`; `labels Both added too`; `preserves the BOM on a conflicting Markdown file`; `leaves other files as git wrote them` |
   | `server-feature-sync` | `leaves a merge in progress on a conflict, with the record kept`; `a file the user took the markers out of stays editable`; `reports a resolved file`                                                                                                           |

   **Fix:** put back the declaration as it was in `7c22b1d`. `ignoreBOM: true`
   must stay, or the second review's BOM bug returns:

   ```ts
   /** Throws on bytes that are not UTF-8. `ignoreBOM` keeps a BOM, as this text replaces the file. */
   const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
   ```

## Should fix

2. **Nothing tests the endpoint's content handling
   (`merge-state.service.spec.ts`, `git.controller.spec.ts`):** moving the
   decoding into `MergeStateService` was the right change, but the tests for it
   became raw-byte tests of `GitMerge`. No test now checks that the endpoint
   strips a BOM, converts CRLF or accepts a file containing U+FFFD, so the fixes
   for review 1's findings 4 and 5 could regress unnoticed. The temporary tests
   described below could be used as a starting point.

## Minor

3. **`readVersion` can silently truncate (`git-merge.ts:717`):** with the 64 MiB
   check gone, a blob over that limit returns its first 64 MiB as if complete.
   The service can't reach this: it refuses anything over 1 MiB, and a null size
   means the blob is missing, so `cat-file` fails. Removing the check is fine,
   but the doc comment should say the caller must check the size first.
4. **The plan's interface is out of date
   (`docs/superpowers/plans/2026-11-08-89-merge-versions-api.md:61`):** it still
   says `readVersion` returns `Promise<string | null>`, and `null` when it does
   not decode. It now returns a `Buffer` and throws.

## Findings from the earlier reviews

"Run" means the behaviour was exercised by the suite or a temporary test on the
one-line fix; "Read" means it was checked in the code only.

### Review 1

| #  | Finding                       | Status                             | How checked                                                                                                       |
| -- | ----------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1  | Client not regenerated        | Resolved                           | Run: the CI drift check is clean                                                                                  |
| 2  | Non-Markdown files served     | Resolved                           | Run: service and controller specs                                                                                 |
| 3  | Git failures look unreadable  | Resolved                           | Run: see review 2, finding 3                                                                                      |
| 4  | U+FFFD false refusal          | Resolved in the endpoint           | Run: temporary test. `textWithMarkers` has the same fix but is broken by finding 1. No permanent test (finding 2) |
| 5  | Content not normalised        | Resolved                           | Run: temporary test. No permanent test (finding 2)                                                                |
| 6  | Weak query validation         | Resolved                           | Run: schema and controller specs                                                                                  |
| 7  | Roadmap not updated           | Resolved                           | Read: row says **Done**                                                                                           |
| 8  | Test gaps                     | Resolved                           | Run: symbolic link, non-Markdown and "without reading" tests all pass                                             |
| 9  | Abort race, repeated scanning | Race resolved; scanning left alone | Run: race test. Scanning was left on the first review's advice                                                    |
| 10 | Repeated `side === 'ours'`    | Resolved                           | Read: one selection                                                                                               |
| 11 | Commit message                | Out of scope                       | The PR will be squashed                                                                                           |

### Review 2

| #  | Finding                   | Status                           | How checked                                                                                                                 |
| -- | ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1  | Client drift              | Resolved                         | Run: the CI drift check is clean                                                                                            |
| 2  | BOM lost from files       | **Not resolved** (finding 1)     | Fixed in `7c22b1d`, undone in `512c366`. Run: with the declaration restored, the file keeps its BOM and gets `<<<<<<< main` |
| 3  | Corrupt repositories      | Resolved                         | Run: temporary test on real corrupt and missing objects, which now throw. Read: the filter logs 5xx answers                 |
| 4  | Useless BOM code          | Resolved                         | Run: temporary test. A double BOM keeps one, like the editor                                                                |
| 5  | Repeated `decodeMarkdown` | Resolved                         | Read: the service uses the exported function                                                                                |
| 6  | `review.md` committed     | Out of scope                     | You will remove the reports                                                                                                 |
| 7  | Commit history            | Out of scope                     | The PR will be squashed                                                                                                     |
| 8  | Output copied twice       | Resolved                         | Read: `Buffer.concat` is memoised                                                                                           |
| 9  | Small tidying             | Resolved, except finding 3       | Read: controller comment, ED-2 citation and single condition                                                                |
| 10 | Confirm PR number         | **Can't be confirmed from here** | `mvp.md:298` now says `#135`. `master` stops at `#133`, so check it when the PR is opened                                   |

Review 2's finding 3 was resolved differently from what it suggested, and
better. It proposed refusing a null `size` with a 409, but the code lets it
through to `readVersion`. A missing object therefore gives a logged 500 instead
of a silent 409, which is the point of that finding.

## How this was checked

| Check                                                                  | At `ce389f1`                              | With the one-line fix                          |
| ---------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `typecheck` (server projects)                                          | **Fails** in `core-git`, `files`, `sync`  | Pass                                           |
| `test` (server projects)                                               | **10 fail** (9 real, 1 unrelated: below)  | Pass                                           |
| `lint`                                                                 | Pass; it doesn't catch the undefined name | Pass                                           |
| `nx affected -t typecheck test lint --base=master`, one task at a time | Not run                                   | 77 of 81 pass; the other 4 are explained below |
| CI's drift check                                                       | Clean                                     | Not repeated                                   |
| `npx dprint check`, `doc-ids.mjs criteria`                             | Pass; REQ-GIT-003 row matches             | Not repeated                                   |

The one-line fix and the temporary tests were made in a throwaway git worktree,
which has been removed. The temporary tests covered:

- a BOM and a double BOM;
- CRLF and U+FFFD;
- the 1 MiB boundary (exactly at the limit is read, one byte over is not);
- corrupt and missing objects.

Not run: the end-to-end tests and the rest of the CI pipeline.

## Failures unrelated to this branch

- **`web` and `web-feature-repository-screen` (typecheck and test) fail on this
  machine only because of its `node_modules`:** `diff` 4.0.4 is installed,
  whereas `package.json` and the lockfile require 9.0.0, and `diff-rows.ts`
  needs its types. The branch changes neither those files nor that library.
  After `npm ci`, these should be re-run, because they couldn't be confirmed
  here. The newer dependencies could also affect the other results slightly.
- **`keeps the password out of git's arguments, environment and files`
  (`git-engine.spec.ts:1746`) is flaky:** it scans all of `/tmp` for
  `fb-broker-*` and sees the folders of other test processes when projects run
  in parallel. It passed three times alone and in the one-at-a-time run. The
  branch doesn't change this test, but it may be worth fixing separately.

## Checked and fine

- **The new generated client method** matches the schema, including the `path`
  limits.
- **`GitRunner`:** the memoised buffer is safe, because `text()` and `raw()` are
  only called after the process closes.
- **A user's path still never reaches git:** it is only compared with the
  conflict list.
- **Exporting `markdown-codec` from the files library** causes no name clashes,
  and `server-feature-sync` already depended on that library.
