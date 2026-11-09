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

Deployment guide (`docs/wiki/deployment.md`), postponed until the MVP runs
locally in a development environment, so that it describes what was actually
built:

- Operator-facing parts of `docs/architecture/non-functional.md`: the data
  volume and optional repositories directory, the container UID, disk sizing,
  backup and restore, upgrades, the encryption key (including rotation and
  recovery from a lost key), `…_FILE` variables, log, metrics and low-space
  settings, and the hardened compose example.

Spikes (`docs/architecture/spikes.md`), each on its own `spike/<name>` branch,
never merged, time-boxed to 1–2 days; findings go back into the architecture
documents:

- Check typing in a 1 MB file on a real mid-range phone (NF-2.4): spike 3
  measured 40–56 ms per keystroke in emulation, at the limit (A-8.11).
- Spike 4 (A-5.14) is done on a stand-in machine. Release checks: repeat its
  timings on a real 2 vCPU, 4 GB host with the image's git, including whether a
  cold status or commit stays under NF-2.8's 2 seconds.
