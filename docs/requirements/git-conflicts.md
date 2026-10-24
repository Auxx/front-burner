# REQ-GIT-003: Conflict resolution at the Advanced level

> Status: **Accepted**

## Summary

When a pull ([REQ-GIT-002](git-advanced.md)) cannot merge every file
automatically, the merge **stays in progress** and the repository screen
shows **conflict resolution** until the user finishes or aborts the merge
(D-4.4). The user can resolve it from any of their devices (D-4.4a).

For each conflicting file the user:

- **edits the conflict markers** in the normal editor, helped by **Accept
  mine**, **Accept theirs** and **Accept both** buttons on each conflict,
  then marks the file as resolved; or
- picks **Use my version** or **Use their version** for the whole file, the
  only choice for non-Markdown files (D-6.2).

When every file is resolved, **Commit merge** commits the merge. Until then,
**Abort merge** puts the branch and the files back exactly as they were
before the pull (D-4.5). After committing, **Undo merge** can still undo it
while it has not been pushed (D-4.6). Pushing the merge is a normal push.

## Context

- The vision promises that every conflict can be resolved inside Front
  Burner and that no work is lost (vision goal 5). The backend records the
  user's commit before every merge (D-4.6, A-5.12), so both aborting and
  undoing are always possible before a push.
- The Advanced level offers every resolution method, with the three-way
  merge editor and editing conflict markers first (vision goal 5). The MVP
  builds editing conflict markers and choosing a whole file; the other
  methods come later ([mvp.md](../product/mvp.md)).
- Editing conflict markers uses the normal editor, which meets WCAG 2.2 AA,
  so every Advanced user has an accessible way to resolve conflicts
  (NF-13.2).
- Selecting and deleting marker lines is slow on a phone. Buttons on each
  conflict make the common choices one tap, and remain plain text edits that
  can be undone.
- The plain merge marker style (`<<<<<<<`, `=======`, `>>>>>>>`) is the one
  most people know. The `zdiff3` style, which also shows the common ancestor,
  may come later as a user preference (see `docs/wiki/todo.md`).
- The merge in progress belongs to the repository, not to a device, and has
  no lease (D-4.4a). Git's own state in the working copy is the source of
  truth (A-4.5).

## Terms

**Merge in progress**
: The state of a repository after a pull whose merge conflicted, until the
user commits or aborts the merge.

**Conflicting file**
: A file that the merge could not combine on its own. Its **conflict kind**
is one of: **Both changed**, **Both added**, **Deleted by me**, **Deleted by
them**.

**Conflict marker**
: The lines that git writes into a conflicting text file around each
conflict: `<<<<<<< ` before my version, `=======` between the two versions,
and `>>>>>>> ` after their version.

**Conflict**
: One marked region of a conflicting file: my version and their version of
the same lines. A file can have several.

**Mine** / **Theirs**
: The user's version (git's _ours_: the current branch) and the incoming
version (git's _theirs_: the upstream being pulled). See the
[glossary](../product/glossary.md).

**Resolved file**
: A conflicting file that the user has marked as resolved, or resolved by
choosing a whole version (in git terms, added to the index).

## Requirements

### General

- **GC-1** The rules of the repository screen apply (FB-1 to FB-6), and the
  backend enforces every rule here (vision goal 12).
- **GC-2** While a merge is in progress, opening the repository, on any tab
  or device, shows conflict resolution. Other tabs that have the repository
  open switch to it without a reload. _(My call: through a push channel
  event, A-3.11.)_
- **GC-3** While a merge is in progress, only the actions of this
  requirement are allowed on the working copy: editing conflicting files
  (GC-12), resolving files, committing, aborting. Everything else that
  changes the working copy, the branch or the remote is refused (GA-4, A-5.3).
  Background fetches go on.
- **GC-4** The merge in progress has no lease and no expiry. Each resolution
  is written to the working copy at once, so the user can stop on one device
  and go on from another. It ends only when the user commits or aborts it
  (D-4.4a). It survives a backend restart (A-5.15).
- **GC-5** The backend writes conflict markers in the plain merge style,
  whatever the working copy's own configuration says. _(My call: for example
  `-c merge.conflictStyle=merge`.)_ The labels after `<<<<<<<` and `>>>>>>>`
  are the branch names, for example `<<<<<<< main` and `>>>>>>> origin/main`.

### Resolution screen

- **GC-6** The header says "Merging _origin/main_ into _main_" and how many
  files are resolved, for example "2 of 3 files resolved", with **Commit
  merge** (GC-20) and **Abort merge** (GC-23).
- **GC-7** The left pane (the drawer on narrow screens) lists the conflicting
  files, sorted by path. Each entry shows its name, folder, conflict kind in
  words, and whether it is **Unresolved** or **Resolved**, in words and with
  an icon. Below the list, "_n_ other files merged without conflicts" can be
  expanded to list them. _(My call.)_ The file tree and **Changes** are not
  shown during a merge.
- **GC-8** Selecting a conflicting file shows, in the editor area, the ways
  to resolve it that its kind allows (GC-9 to GC-17). After a file is
  resolved, the screen moves on to the next unresolved file. _(My call.)_

### Edit conflict markers

- **GC-9** A Markdown file whose conflict kind is **Both changed** or **Both
  added** and that can be edited (ED-2) opens in the normal editor
  (REQ-EDIT-001), with its conflict markers. This is the first method
  offered for such files (vision goal 5).
- **GC-10** Each conflict is shown with my version and their version told
  apart by background, by the label of the marker lines ("Mine (main)",
  "Theirs (origin/main)"), and not by colour alone (NF-13.7). A bar above
  the editor says "Conflict 2 of 5", with **Previous** and **Next**, which
  move the cursor to the start of a conflict.
- **GC-11** Above each conflict are three buttons:
  - **Accept mine** replaces the conflict, markers included, with my version;
  - **Accept theirs** replaces it with their version;
  - **Accept both** replaces it with my version followed by theirs.

  Each is an ordinary edit: it is saved like typing and can be undone with
  the editor's undo. The user can also edit the text freely, inside or
  outside conflicts. The buttons are reachable with the keyboard and meet
  the touch target size of NF-13.5.
- **GC-12** The file is saved as in ED-16 to ED-20, as the user edits it.
  Saves to conflicting files are allowed during the merge; saves to any
  other file are refused (ED-19, ED-25).
- **GC-13** While the file contains conflict markers, the live preview shows
  "The preview is shown again when no conflict markers are left." instead
  of rendering the file, since marker lines render as Markdown headings and
  rules. _(My call.)_
- **GC-14** **Mark as resolved** marks the file as resolved, with its content
  as saved. If the file still contains lines that look like conflict markers
  (a line starting with `<<<<<<< ` or `>>>>>>> `, or a line that is exactly
  `=======`), it first asks: "This file still has conflict markers. Mark it
  as resolved anyway?" A waiting save is sent first.

### Choosing a whole version

- **GC-15** **Use my version** and **Use their version** are offered for every
  conflicting file of kind **Both changed** or **Both added**: Markdown files
  (next to GC-9), non-Markdown files, and Markdown files that cannot be
  edited (ED-2). For non-Markdown files they are the only choice (D-6.2).
  Each resolves the file at once with that whole version.
- **GC-16** A file of kind **Deleted by me** or **Deleted by them** offers
  **Keep the file**, which keeps the version that still exists, and **Delete
  the file**. Each says which side deleted it, for example "You deleted this
  file; _origin/main_ changed it."
- **GC-17** For every file, the list shows the size of each version, and for
  a Markdown file **Show mine** and **Show theirs** open that version
  read-only in the editor area. _(My call: lets the user compare before
  choosing a whole version.)_

### Starting a file over

- **GC-18** A resolved file offers **Start over**, which puts it back as it
  was when the merge stopped, with its conflict markers, and marks it
  unresolved. It asks for confirmation when the user has edited it.
  _(My call.)_
- **GC-19** Resolving and starting over do not affect other files.

### Committing the merge

- **GC-20** **Commit merge** is enabled when every conflicting file is
  resolved. It shows the merge commit's message, filled in with git's default
  (for example "Merge remote-tracking branch 'origin/main'"), which the user
  can edit, and "Committing as _Name &lt;email&gt;_" (CA-9). The message must
  not be empty.
- **GC-21** The backend commits the merge with the resolved files and the
  files that merged without conflicts, with the user's commit author
  (REQ-GIT-001). The merge then ends: the repository screen returns to
  normal on every tab and device.
- **GC-22** After the commit, a notice says "Merge committed. Push to publish
  it." with **Push** and **Undo merge** (GC-25). The merge commit is pushed
  like any other commit (GA-29).

### Aborting the merge

- **GC-23** **Abort merge** asks: "Abort the merge? Your branch and files go
  back to how they were before the pull, and the resolutions you made are
  lost." It is available at any time during the merge.
- **GC-24** Aborting puts the branch, the working copy and the index back
  exactly as they were before the pull (D-4.5), using the commit recorded
  before the merge (D-4.6). The **to pull** count then shows the upstream's
  commits again.

### Undoing a committed merge

- **GC-25** **Undo merge** is offered, in the notice of GC-22 and in the
  branch list (GA-36), while:
  - the last commit of the branch is the merge commit made by Front Burner;
  - it has not been pushed (it is on no remote branch);
  - there are no uncommitted changes.
- **GC-26** **Undo merge** asks for confirmation, then puts the branch and
  the working copy back to the commit recorded before the merge (D-4.6,
  A-5.12). The merge commit is no longer on the branch; the **to pull** count
  shows the upstream's commits again. _(My call: the recorded commit is kept
  until the merge commit is pushed or undone.)_

### Errors and accessibility

- **GC-27** A failed resolution, commit, abort or undo shows the reason with
  an error code (A-3.8) and leaves the merge as it was.
- **GC-28** Conflict resolution meets NF-13: the conflict list and the
  editor's conflict bar and buttons work with the keyboard alone and by
  touch alone, and a screen reader announces each conflict as "Conflict
  _n_ of _m_" with its parts labelled as mine and theirs.

## Acceptance criteria

1. A pull that conflicts on `guide.md` switches the repository screen to
   conflict resolution, with "Merging origin/main into main" and "0 of 1
   files resolved". Another device that opens the repository sees the same
   screen.
2. `guide.md` opens in the editor with plain markers labelled
   `<<<<<<< main` and `>>>>>>> origin/main`, even if the working copy's
   configuration sets `merge.conflictStyle=zdiff3`.
3. "Conflict 1 of 3" with **Next** moves to the second conflict.
4. **Accept mine**, **Accept theirs** and **Accept both** each replace the
   conflict as described; the editor's undo brings the conflict back.
5. While markers remain, the preview says it will come back when no conflict
   markers are left; after the last one is removed, the preview renders
   again.
6. **Mark as resolved** with a marker left asks to confirm; without markers
   it marks the file resolved at once.
7. A conflicting PNG offers only **Use my version** and **Use their
   version**. A file deleted on the remote and changed locally offers **Keep
   the file** and **Delete the file**, saying which side deleted it.
8. **Start over** on a resolved file brings back its conflict markers and
   marks it unresolved.
9. During the merge, saving a file that is not conflicting, switching
   branches, pulling and pushing are refused by the API.
10. Resolving one file on a phone and the other on a desktop, then
    committing, works; no lease expires in between.
11. **Commit merge** is disabled until every file is resolved. It commits
    with git's default message, as edited, and the user's commit author. The
    screen then returns to normal on every device, and the notice offers
    **Push** and **Undo merge**.
12. **Abort merge** after resolving some files puts the branch and every
    file back exactly as before the pull; `git status` shows no merge in
    progress.
13. **Undo merge** after committing and before pushing puts the branch back
    to its commit before the pull. After pushing, **Undo merge** is no
    longer offered.
14. Restarting the backend during a merge keeps the merge in progress and
    every resolution made so far.
15. The conflict list, the conflict bar and the buttons work with the
    keyboard alone and by touch alone, and axe-core reports no violations.
16. **Show mine** and **Show theirs** on a conflicting Markdown file open
    that version read-only, and the list shows the size of each version.

## Out of scope

- The three-way merge editor, **Choose per change**, **Keep both** and
  **Resolve on the provider** (later; vision goal 5, D-6).
- The `zdiff3` marker style as a user preference (see `docs/wiki/todo.md`).
- Conflicts during a rebase (D-5.3), since the MVP never rebases.
- Conflicts at the Simple and Guided levels (D-3, D-4.7).
- Markdown-aware merging and AI-suggested resolutions (vision, future).

## Open questions

None at the moment.
