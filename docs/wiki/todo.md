Requirements files for the MVP (`docs/product/mvp.md`): all written and
accepted.

Requirements files deferred until after the MVP:

- Admin-assisted adding, plus the user's confirmation flow.
- Saved credentials and known-hosts management.
- Changing a repository's remote.
- Live preview: mapping site-absolute image paths such as `/images/cover.png` to
  the folder a blog engine uses (for example Hexo's `source/`), per repository.
  Until then they resolve from the repository root (IM-2).
- User management, invitations and onboarding of invited users, and SMTP in
  system settings.
- The Simple and Guided levels, and pull requests.
- Conflict markers in the `zdiff3` style (with the common ancestor) as a user
  preference. The MVP always uses the plain merge style (GC-5).
- Pull: a merge refused for incoming paths that are not valid UTF-8 uses
  `merge-blocked`, whose message speaks of ignored files. It needs its own error
  code and message, since there is nothing to move.
- Pull: the waiting saves it sends first include other repositories' open files
  (`OpenFilesService.flushAll`), so a slow one elsewhere keeps "Pulling…"
  showing. It needs a flush per repository; a commit waits in the same way.
- Remote-change notice: a force-push that leaves the same number of commits to
  pull goes unnoticed. "This file changed too." is not read again, and a notice
  dismissed at that count stays away (GA-34). It needs the upstream's commit in
  the git status, to tell these commits from the last ones.
- Editor: basic code formatting from the repository's `.editorconfig` (for
  example indent style and size, line endings, final newline and trimming
  trailing spaces), applied while typing and on save. Until then the editor
  changes nothing on its own (ED-9, ED-12).
- Editor: two user preferences for highlighting large files on narrow screens
  (ED-9a):
  - **Highlight large files**: `false` by default. When it is on, every file is
    highlighted whatever its size.
  - **Size limit for highlighting**: 100 KB by default, the limit chosen with
    the typing check (spike 3). Users with faster phones can raise it to keep
    highlighting in larger files without highlighting every file.

  Until then the limit is fixed at 100 KB, and **Turn on highlighting** lasts
  only until the file is closed.

Known gaps, left until someone meets them:

- Database snapshots (A-4.12): `VACUUM INTO` runs on the backend's main thread,
  so every request, the job runner and the health probes wait while it copies
  the database. The MVP's database is small enough that this takes well under a
  second. If plan 152's run on the reference host, or an instance with a large
  login audit log, shows a long pause, run it in a worker thread with its own
  connection, or use the online backup API, which copies a few pages at a time.

- Recovery on start (A-5.15): when a merge is cut short after writing a file
  that the restored `.gitignore` ignores, as when the incoming commit un-ignores
  `dist/` and adds `dist/app.js`, the file stays, and every later pull fails
  with `merge-blocked` until someone removes it on the instance. A fix needs the
  merge target in `sync_state`, to know which files were the merge's.
- Merge state (`GET …/git/merge`), for a merge that a pull did not start, which
  the product itself never leaves:
  - `from` is the branch's configured upstream, not what is merging: after a
    `git merge feature` on `main` it says `origin/main`, next to the message
    "Merge branch 'feature'". Without an upstream or on a detached `HEAD`,
    `from` and `into` are git's words `MERGE_HEAD` and `HEAD`, which a client
    can't tell from branch names. Nullable fields would let it word these cases
    itself.
  - A file left with only a base version, as after a rename on both sides, is
    left out of `files` but listed in `otherFiles` as merged without conflicts.
    With every listed file resolved, **Commit merge** would be enabled, git
    would refuse, and nothing would say why. In a pull, `prepareConflicts`
    removes these files.
- Merge state, when a merge ends during a read: `read` checks for a merge once
  and then reads without a lock (A-5.3), so another device's commit or abort in
  between gives a `200` with every file resolved or no files, rather than `409
  no-merge-in-progress`. Checking again after the reads closes it, once plans 80
  and 93 can end a merge.
- Aborting a merge, when the record can't be put back: the reset comes first, so
  if the process dies or `update-ref` fails right after it, the merge is over
  but `sync_state` still has the aborted merge's record, and a retry answers
  `409 no-merge-in-progress`. Recovery only restores a record while
  `merge_applying` is set, so the next pull overwrites the `earlier_` columns,
  and **Undo merge** of the earlier merge (GC-25) is lost. Recovery could
  restore the earlier record when there is no merge, no merge commit, and the
  record is `HEAD`; plan 93's end of a merge needs the same thought.

Operations, after the MVP:

- An `arm64` image next to the `linux/amd64` one, as one multi-platform image.
  The release workflow (`.github/workflows/release.yml`) builds `amd64` only: an
  `arm64` build needs a native ARM runner or a long emulated build, and the deps
  stage must build `better-sqlite3` for ARM. The scan, the version check, the
  signature and the attestations then cover both platforms.
- Encryption key rotation (NF-8.4). When it is built, the deployment guide's
  "Changing a secret" and "A lost encryption key", which say the key cannot be
  changed in place, describe it.
- Changing the OIDC client secret after onboarding, and entering it again after
  an encryption key reset, in system settings. When they exist, the deployment
  guide sends the operator there rather than to the OIDC environment variables.

Spikes (`docs/architecture/spikes.md`), each on its own `spike/<name>` branch,
never merged, time-boxed to 1–2 days; findings go back into the architecture
documents:

- Check typing in a 1 MB file on a real mid-range phone (NF-2.4): spike 3
  measured 40–56 ms per keystroke in emulation, at the limit (A-8.11).
