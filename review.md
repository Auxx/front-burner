# Code review: plan 89 (`merge-versions-api`)

**Verdict: not ready to merge yet.** The endpoint does what the plan asks in
normal use, including refusing a path that isn't a conflict, refusing oversized
versions before reading them, and reading resolved files. All eight planned
tests exist. There are three bugs in how versions are read, one missing path
limit and an unfinished plan step to fix first.

These findings were checked by reading the code; they were not reproduced by
running it. The review's test run passed for `server-core-git`,
`server-feature-sync` and `shared-contracts`, but Nx flagged
`server-core-git:test` as flaky, and whether this branch caused that was not
checked. Lint also passed, but from the Nx cache.

## Fix before merging

1. **Git failures look like unreadable files
   (`libs/server/core/git/src/engine/git-merge.ts:544`).** Any non-zero or
   missing exit code returns `null`, including a corrupt object, a failed spawn
   or git being killed at shutdown.
   - **Effect:** the client gets 409 `version-not-readable` and nothing is
     logged, so a temporary failure looks permanent and corruption stays hidden.
   - **Plan and tests:** the plan only allows `null` when the blob "does not
     decode". The test `returns null when the blob does not exist` locks in the
     wrong behaviour and needs changing.
   - **Fix:** throw on a non-zero exit, as `LocalGit.checked` does.

2. **Valid files containing U+FFFD are refused
   (`libs/server/core/git/src/engine/git-merge.ts:544`).** The check looks for
   U+FFFD after `GitRunner` has already decoded the output lossily, so it can't
   tell invalid bytes from a real U+FFFD character. The editor opens the same
   file because `decodeMarkdown` uses a fatal decoder, but **Show mine** would
   return 409.

3. **The text isn't normalised the way the editor's is
   (`libs/server/core/git/src/engine/git-merge.ts:547`).** A BOM and CRLF line
   endings reach the client unchanged, while `decodeMarkdown` strips the BOM and
   converts CRLF to `\n`.
   - **Effect:** plan 97 could show a stray BOM character, and every line of a
     CRLF file would differ from the editor's text, which undermines GC-17's
     comparison.

   **Shared fix for 2 and 3:** give the runner a way to return raw stdout bytes,
   then pass them through `decodeMarkdown`. It's exported from a file in
   `server-feature-files`, and `MergeStateService` already depends on that
   library, so the decoding fits there rather than in `readVersion`.

4. **`path` has no maximum length
   (`libs/shared/contracts/src/git/git-merge.schema.ts:50`).** The other git
   path queries cap it at 4096, but here a very long path passes validation and
   runs the git commands before getting a 409. Use `.max(GIT_PATH_MAX_LENGTH)`,
   then regenerate the OpenAPI file and client.

5. **Plan step 6 is unfinished
   (`docs/superpowers/plans/2026-11-08-00-roadmap-step-4.md:62`).** The row
   still says **Not started**, and the index says each plan's PR sets its own
   row to **Done**. The commit message also isn't the planned `feat(sync): read
   a version of a conflicting file`, so use that as the PR title or when
   squashing.

## Small fixes

6. **Wrong error if the merge ends mid-request
   (`libs/server/feature/sync/src/merge/merge-state.service.ts:70`).** If
   another device finishes the merge between the two reads, the client gets
   `not-conflicting` instead of `no-merge-in-progress`. The web client treats
   only the second as "the merge ended elsewhere". Re-checking `mergeInProgress`
   when the entry is missing fixes it.

7. **Unused import
   (`libs/shared/contracts/src/git/git-merge.schema.spec.ts:3`).**
   `GitMergeSideSchema` is imported but never used.

## Optional

8. **Each read lists every conflict
   (`libs/server/feature/sync/src/merge/merge-state.service.ts:70`).** This only
   matters for merges with thousands of conflicts, and the plan's design calls
   for reading through `conflicts`. Leave it unless that size is realistic.

9. **The query type scan can add an unused import
   (`libs/web/api-client/templates/api.ejs:42`).** It also matches words inside
   JSDoc comments, so a description that names a model adds an unused `import
   type`. Nothing triggers this today.

## Review findings dropped

- **Missing A-3.6 check on query types (`api.ejs`):** every query type is an
  inline object, and that check rejects any `{`, so applying it would fail every
  route with a query.
- **Repeated `side` ternaries (`merge-state.service.ts:74`):** these are only a
  style preference, not a bug.
