# Code review: plan 89 (merge versions API)

**Not ready to merge:** CI should fail on the API client drift check, and the
endpoint serves non-Markdown files, which the plan says it must refuse. The
endpoint's core logic is sound, and a path outside the conflict list never
reaches git.

The findings were checked against the code, but the tests and the generator were
not run.

## Must fix

1. **Generated API client not regenerated (`apps/server/openapi.json`,
   `libs/web/api-client/src/generated/Git.ts`):** neither file mentions the new
   endpoint, although plan step 3 is ticked. The "API client drift" step in
   `.github/workflows/ci.yml` should therefore fail, and plan 97 has no client
   method to call.
2. **Non-Markdown files aren't refused (`merge-state.service.ts:43`):** a
   conflict on `config.env` or `app.ts` returns 200 with the content instead of
   409 `version-not-readable`. The plan and the `version-not-readable` comment
   in `error-codes.ts` both require the refusal. `isEditable` in the same file
   already checks `isMarkdownName`, but this path doesn't, and no test covers
   it.

## Should fix

3. **Real git failures look like unreadable files (`git-merge.ts:717`):** any
   non-zero or null exit returns `null`. A failed spawn, a killed process or a
   corrupt object store therefore gives a 409 with nothing logged, rather than a
   500. The test `returns null for a non-existent oid` locks this in, whereas
   `local.checked` throws on these failures.
4. **Valid files can be refused (`git-merge.ts:720`):** the UTF-8 check looks
   for U+FFFD in the decoded text, so a valid file that really contains that
   character gets a 409. The same file opens normally in the editor, which uses
   a fatal `TextDecoder`. Decoding the raw bytes fixes it, but `LocalGit` only
   returns strings, so this needs a small runner change.
5. **Content isn't normalised like the editor's (`git-merge.ts:723`):** the
   editor's `decodeMarkdown` strips the BOM and converts `\r\n` to `\n`, but
   this endpoint returns the raw text. Show mine and Show theirs can therefore
   differ from the editor view of the same bytes, including in any comparison.
6. **Query validation is weaker than its siblings (`git.dto.ts:78`):** `path`
   has no `.min(1).max(4096)`, so an empty path returns 409 `not-conflicting`
   instead of 400. The schema is also inline rather than in `shared-contracts`,
   so web code can't share the `ours`/`theirs` type.

## Minor

7. **Roadmap not updated:** plan 89's row in
   `docs/superpowers/plans/2026-11-08-00-roadmap-step-4.md:62` still says "Not
   started", although step 6 is ticked. Plan 97 depends on this row.
8. **Test gaps:**
   - Nothing tests the symbolic-link or non-Markdown refusals.
   - `refuses a large version without reading it` can't prove the "without
     reading" part, because a refusal after reading also returns 409.
   - The plan lists `merge-state.service.spec.ts` and
     `git-merge.schema.spec.ts`, but neither changed; the service is only tested
     through the controller spec.
9. **Abort race and repeated scanning (`merge-state.service.ts:34`):**
   - A merge aborted on another device between the two checks gives
     `not-conflicting` instead of `no-merge-in-progress`.
   - Each click also rescans every conflict to use one entry. The plan's
     architecture implies this, so leave it unless large merges feel slow.
10. **Repeated code (`merge-state.service.ts:39`):** `side === 'ours' ?` appears
    three times; selecting one `{ oid, mode, size }` object would be simpler.
11. **Commit message:** it doesn't match the plan's `feat(sync): read a version
    of a conflicting file`, which can be fixed when squashing.

## Dropped or checked

- **Dropped: size limit bypass when `size` is null
  (`merge-state.service.ts:49`):** a regular file only has a null size if its
  blob is missing, and then `cat-file` fails and returns 409 anyway. Treating
  null as unreadable would still be tidier, but it isn't a real way past the
  limit.
- **Checked: large files aren't falsely refused:** the runner joins its buffers
  before decoding, so a multi-byte character split across chunks can't produce a
  false U+FFFD.
