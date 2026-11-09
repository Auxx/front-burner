# Code review 2: plan 89 (merge versions API)

**Not ready to merge:** the fixes for the first review introduced a regression
that removes the BOM from users' conflicting files, and CI's API client drift
step still fails. Both are small fixes. The endpoint itself now behaves as the
plan describes, and most of the first review's findings are fixed.

## How this was checked

| Check                                                                                              | Result                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------- |
| `test` and `typecheck` for `server-core-git`, `server-feature-sync`, `shared-contracts` (no cache) | Pass                             |
| `lint` for those projects and `server-core-observability` (from the Nx cache)                      | Pass                             |
| `npx dprint check`                                                                                 | Pass                             |
| `doc-ids.mjs criteria`                                                                             | REQ-GIT-003 row matches `mvp.md` |
| CI's drift check: `npx nx run web-api-client:generate`, then `git status`                          | **Fails** (finding 1)            |

The generated file was restored afterwards. The full CI pipeline and the
end-to-end tests were not run.

## Must fix

1. **The API client still drifts
   (`libs/web/api-client/src/generated/Git.ts:71`):** the client was generated
   before `path` gained `.min(1).max(4096)`. Running the generator adds this, so
   the "API client drift" step in `.github/workflows/ci.yml` exits 1:

   ```diff
    query: {
   +  /**
   +   * @minLength 1
   +   * @maxLength 4096
   +   */
      path: string;
   ```

   **Fix:** run `npx nx run web-api-client:generate` and commit the result.

2. **Regression: conflicting files lose their BOM (`git-merge.ts:12`, used at
   `git-merge.ts:483`):** `utf8Fatal` leaves out `ignoreBOM: true`, so
   `TextDecoder` silently removes a leading BOM. `textWithMarkers` now uses this
   decoder, and `writeMarkersFrom` writes its result over the user's file
   (`git-merge.ts:437`).

   A Markdown file with a BOM that conflicts below its first line therefore
   loses the BOM on disk, and the merge commit carries a byte change nobody
   asked for. ED-12 keeps the BOM (`decodeMarkdown` tracks it so that it can be
   written back). `master` kept it, because `Buffer.toString` doesn't remove it.

   Evidence, from running `git merge-file` and each decoder on its output:

   | Code                         | First bytes written |
   | ---------------------------- | ------------------- |
   | `git merge-file -p` output   | `ef bb bf 23`       |
   | `master` (`Buffer.toString`) | `ef bb bf 23`       |
   | This branch (`utf8Fatal`)    | `23 20 54 69`       |

   This ran the git command and the decoders directly, not `GitMerge` itself.
   The step from the decoded text to the file was read from the code. No spec
   covers this path, which is why the tests pass.

   **Fix:** `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, plus a
   test that a conflicting file with a BOM keeps it after the markers are
   written. This also fixes finding 4.

## Should fix

3. **Corrupt repositories still look like unreadable files
   (`git-merge.ts:728`):** this is the first review's finding 3, only partly
   fixed. `readVersion` treats exit 128 as "object not found", but 128 is git's
   generic fatal exit. Tested on a real repository, `git cat-file blob` exits
   128 for all three of these:

   - a corrupt loose object;
   - a loose object that can't be read (permissions);
   - a missing object.

   Each returns `null`, so the user gets 409 `version-not-readable` with nothing
   logged. The method's `@throws` comment says a corrupt store throws, which is
   wrong. The test `throws when git itself fails` only covers `exitCode: null`.

   The object ID has just come from the index, so a failure here is abnormal.

   **Fix:** throw on every non-zero exit, so that it gives a logged 500. Keep
   refusing a missing version in the service, by treating a null `size` as not
   readable. Update the tests `returns null for an oid that is not a blob` and
   `returns null for a non-existent oid`.

## Minor

4. **The BOM code in `readVersion` does nothing useful (`git-merge.ts:740`):**
   the decoder has already removed the BOM, so this branch only runs for a
   second one. A blob starting with two BOMs loses both here but only one in the
   editor. The test `strips the BOM` would pass without the branch. Finding 2's
   fix makes this code correct.
5. **`readVersion` repeats `decodeMarkdown` (`git-merge.ts:738`):** the two
   copies have already diverged (finding 4). `MergeStateService` already depends
   on `server-feature-files`, so `GitMerge` could return bytes and the service
   could decode them with `decodeMarkdown`, if the files library exports it.
   Finding 2's fix is enough for now.
6. **`review.md` is committed (commit `0ccefd4`):** merging puts a stale "Not
   ready to merge" note at the repository root. Remove it before merging, along
   with this file if it gets committed.
7. **Commit history:** `13ff8dc` (`Plan 89, Junie + Junie Lite implementation`)
   and `0ccefd4` (`Code review`) don't follow the plan's message. Squashing into
   `feat(sync): read a version of a conflicting file` fixes both this and the
   first review's finding 11.
8. **Every git command copies its output twice (`git-runner.ts:75`, `:149`):**
   `Buffer.concat` runs for both `text()` and `raw()`, so each result holds two
   copies of stdout, up to 64 MiB each for `LocalGit`, although only two callers
   read `stdoutRaw`. Concatenating once and deriving the text from that buffer
   is a small change.
9. **Small tidying:**
   - The controller comment (`git.controller.ts:278`) leaves "not Markdown" out
     of the `version-not-readable` reasons, which anyone building Show mine or
     Show theirs will read.
   - The comment `(plan review focus)` (`merge-state.service.ts:55`) cites a
     working document; ED-2 is the stable reference.
   - Four consecutive `if` blocks throw the same exception
     (`merge-state.service.ts:46` onwards); one predicate would be shorter.
   - `readVersion`'s 64 MiB check (`git-merge.ts:734`) can't trigger through its
     only caller, which has already refused anything over 1 MiB.
10. **Confirm the PR number (`docs/product/mvp.md:298`):** the row lists `#134`.
    Check that it matches once the PR is opened.

## Left as it is

- **Rescanning every conflict on each click (`merge-state.service.ts:34`):**
  this is still true. The first review said to leave it unless large merges feel
  slow, and that still holds. If it matters, the `:(literal)` pathspec form at
  `git-merge.ts:378` would allow a lookup of one path.

## First review's findings

| #  | Finding                           | Status                                                   |
| -- | --------------------------------- | -------------------------------------------------------- |
| 1  | Client not regenerated            | **Partly fixed:** endpoint added, but drifts (finding 1) |
| 2  | Non-Markdown files served         | Fixed and tested                                         |
| 3  | Git failures look like unreadable | **Partly fixed:** only non-128 exits throw (finding 3)   |
| 4  | U+FFFD false refusal              | Fixed and tested, but the fix caused finding 2           |
| 5  | Content not normalised            | Fixed for normal files (see finding 4)                   |
| 6  | Weak query validation             | Fixed and tested; the schema is in `shared-contracts`    |
| 7  | Roadmap not updated               | Fixed                                                    |
| 8  | Test gaps                         | Fixed: symbolic links, non-Markdown, "without reading"   |
| 9  | Abort race, repeated scanning     | Race fixed and tested; scanning left, as advised         |
| 10 | Repeated `side === 'ours'`        | Fixed                                                    |
| 11 | Commit message                    | **Partly fixed:** latest commit only (finding 7)         |

## Checked and fine

- **A user's path never reaches git:** `path` is only compared with the conflict
  list, so `.git/config` gets `not-conflicting`, and `cat-file` receives only an
  object ID from the index.
- **Another user's repository:** answers 404, and a test covers it.
- **Size limit:** checked before reading, and the service spec now proves the
  blob is not read.
- **U+FFFD in `textWithMarkers`:** a file really containing that character now
  gets markers rather than being skipped, which is an improvement beyond the
  first review's finding. Only the BOM side effect is wrong.
- **Line endings:** `readVersion` converts `\r\n` the same way as
  `decodeMarkdown` and also keeps a lone `\r`.
