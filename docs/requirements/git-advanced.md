# REQ-GIT-002: Git at the Advanced level

> Status: **Accepted**

## Summary

At the Advanced git control level, the user works with git explicitly, in
standard git vocabulary, without leaving the repository screen
([REQ-FILE-001](file-browser.md)):

- the screen's **header** shows the current **branch**, how many commits are
  **to push** and **to pull**, and **Fetch**, **Pull** and **Push**;
- the left pane has two tabs, **Files** and **Changes**. **Changes** lists every
  changed file, with a checkbox, and selecting one shows its **diff**;
- the user **commits** the ticked files with a message, or **amends** the last
  commit while it has not been pushed. There is no staging area;
- the user **discards** changes to a file, **pulls** (fetch and merge),
  **pushes** the current branch, and **creates** and **switches** branches;
- the backend **fetches** in the background while the user views the repository,
  and the user is told when the remote has new commits.

Nothing is committed, pulled or pushed unless the user asks (D-4.1). A pull that
conflicts goes to conflict resolution ([REQ-GIT-003](git-conflicts.md)).
Credentials that are missing or refused, and keys that need unlocking, are
handled by [REQ-REPO-002](repo-credentials.md).

## Context

- The MVP has one user, who knows git, and every repository is at the Advanced
  level ([mvp.md](../product/mvp.md)). The backend offers the same operations at
  every level (vision goal 4); this requirement describes the Advanced level's
  UI for them.
- Edits are saved to the working copy as the user types (D-1). Committing is a
  separate, deliberate step, so the working copy usually has changes that are
  not committed.
- A staging area is hard to use on a phone and is state the user must keep in
  mind between sessions. Ticking files at commit time covers most needs;
  committing parts of a file comes later.
- Without rebase and force push in the MVP, the only way to rewrite history is
  amending a commit that has not been pushed, which never needs a force push.
- "Nothing is stashed silently" (D-4.3): a pull or a branch switch never hides
  the user's uncommitted changes. The user commits or discards them first.
- Fetching often warns early about remote changes and so prevents conflicts
  (vision goal 5). Fetching never changes the user's files or branch (D-4.2).
- Repositories can be large (NF-1.4). Listing changes uses git status, whose
  cost at 100,000 files is checked by spike 4 (A-5.14).

## Terms

**Changes**
: The files in the working copy that differ from the last commit of the current
  branch: modified, added (untracked) or deleted. Ignored entries are not
  changes. Also the name of the tab that lists them.

**Diff**
: The line-by-line difference between a changed file and its version in the last
  commit.

**Upstream**
: The remote branch that the current branch pulls from and pushes to, in git
  terms its _upstream_ or _tracking_ branch, for example `origin/main`.

**To push** / **To pull**
: The number of commits on the current branch that are not on its upstream
  (git's _ahead_), and on the upstream that are not on the current branch (git's
  _behind_), as of the last fetch.

**Unpublished branch**
: A local branch that has no upstream yet.

**Remote-change notice**
: The notice that the upstream has new commits (D-4.2).

## Requirements

### General

- **GA-1** The rules of the repository screen apply: login, ownership and
  backend enforcement (FB-1 to FB-6). The backend enforces every rule in this
  requirement, including when an action is allowed (vision goal 12).
- **GA-2** Every operation acts on the user's own working copy, and git
  operations on one working copy run one at a time (A-5.3). An operation that
  waits shows that it is waiting.
- **GA-3** An operation that may take longer than about 2 seconds — fetch, pull
  and push, and any other that turns out slow — runs as a job, with its progress
  shown at once and its result pushed to the client (NF-2.6, NF-2.8, A-6).
- **GA-4** While a merge is in progress, the repository screen shows conflict
  resolution instead (REQ-GIT-003). The actions of this requirement that change
  the working copy, the branch or the remote are not offered, and the backend
  refuses them with an error code.
- **GA-5** The UI uses standard git vocabulary: branch, commit, amend, fetch,
  pull, push, merge, upstream, discard.
- **GA-6** Everything in this requirement is usable on a phone, by touch alone,
  and with the keyboard alone (NF-12.5, NF-13).

### Header

- **GA-7** The repository screen's header (FB-10) shows:
  - the **current branch**, as a button that opens the branch list (GA-36);
  - **to push** and **to pull** counts in words, for example "2 to push, 3 to
    pull", not only as arrows; "Not published" for an unpublished branch;
    nothing when both are zero;
  - **Fetch**, **Pull** and **Push** buttons.

  On narrow screens the counts stay visible and the three buttons move into a
  menu. _(My call.)_
- **GA-8** **Pull** is offered when the branch has an upstream. **Push** is
  offered when there is something to push or the branch is unpublished.
  Otherwise they are shown disabled, with the reason available on hover, focus
  or tap.
- **GA-9** While a fetch, pull or push runs, its button shows progress and the
  others that would conflict with it are disabled.

### Changes tab

- **GA-10** The left pane of the repository screen (the drawer on narrow
  screens, FB-9) has two tabs: **Files** (the file tree) and **Changes**. The
  **Changes** tab's label shows the number of changes, for example "Changes
  (3)".
- **GA-11** **Changes** lists every change in the working copy, of any file kind
  (Markdown or not), sorted by path. Each entry shows:
  - a checkbox (GA-17);
  - the file name, and its folder in a quieter style;
  - its state in words and with a letter: **Modified** (M), **Added** (A) or
    **Deleted** (D). Colour is never the only signal (NF-13.7).

  A renamed file is shown as one deleted and one added file. _(My call: no
  rename detection without a staging area.)_
- **GA-12** The list updates without a reload after saves, after actions in the
  file tree, after git operations, and after changes from another tab or device
  (FB-41), within a few seconds. _(My call: how often status runs after saves is
  left to the builder, within the limits that spike 4 sets.)_
- **GA-13** When there are no changes, the tab says "No changes since the last
  commit."

### Diffs

- **GA-14** Selecting an entry in **Changes** shows its diff in the editor area,
  replacing the open file until the user opens a file again. The diff is
  **unified**: removed and added lines one above the other, with the changed
  words within a line highlighted, and line numbers of both versions. Unchanged
  parts are folded, with a few lines of context that the user can expand. _(My
  call: unified only, since it works on any screen; side by side may come
  later.)_
- **GA-15** An added file shows all its lines as added, a deleted file all as
  removed. A Markdown file's diff offers **Open in editor** (not for a deleted
  file).
- **GA-16** A file that git considers binary shows "Binary file changed", with
  its old and new size. A text file whose diff is larger than 1 MB shows "This
  diff is too large to show". Line ending changes are shown, and a file whose
  only change is its line endings says so. _(My call.)_

### Committing

- **GA-17** Each entry in **Changes** has a checkbox, ticked by default,
  including for files that become changed later. A checkbox at the top ticks or
  clears all of them. Which files are ticked is kept per device and per
  repository until the files are committed. _(My call.)_
- **GA-18** Below the list is the commit form:
  - a **message** field, several lines long. The first line is the subject; a
    hint appears when it is longer than 72 characters, but nothing is refused.
    _(My call.)_
  - "Committing as _Name &lt;email&gt;_" with **Change** (CA-9);
  - **Amend last commit** (GA-22);
  - a **Commit** button that says how many files it commits, for example "Commit
    2 files".
- **GA-19** **Commit** needs a message that is not empty after trimming, and at
  least one ticked file (unless amending, GA-22). The backend commits exactly
  the ticked files, as they are on disk, including their additions and
  deletions, and nothing else: changes to files that are not ticked stay
  uncommitted. The commit author is set as in REQ-GIT-001, including the
  confirmation before the first commit (CA-12).
- **GA-20** A waiting save of a ticked file is sent before the commit, so the
  commit contains what the user sees. _(My call.)_
- **GA-21** The message is kept as the user wrote it, except that trailing
  spaces and trailing blank lines are removed. Lines that start with `#` are
  kept, since Markdown users write them. _(My call: git's `whitespace` cleanup
  mode.)_ After a successful commit, the message field is cleared and the
  committed files leave the list.
- **GA-22** **Amend last commit** is offered only when the current branch's last
  commit has not been pushed, that is, it is not on any remote branch, and is
  not a merge commit. Ticking it fills in the last commit's message for editing.
  **Amend** replaces the last commit with one that has the new message, the last
  commit's files and the ticked files. It works with no ticked files, to change
  only the message. _(My call.)_

### Discarding

- **GA-23** Each entry in **Changes** offers **Discard**, and the list offers
  **Discard all**. Both ask for confirmation, saying how many files and that the
  changes cannot be recovered. Discarding:
  - a modified file restores it from the last commit;
  - an added file deletes it;
  - a deleted file restores it.
- **GA-24** Before a file is discarded, its waiting save is dropped and its
  browser draft deleted (ED-20), so that a late save cannot bring the change
  back. An open file that is discarded is reloaded in the editor at once,
  without the question of ED-24, since the user asked for the discard; an added
  file that is discarded is closed (FB-39). _(My call.)_

### Pulling

- **GA-25** **Pull** fetches the upstream and merges it into the current branch:
  a fast-forward when the branch has no commits of its own, otherwise a merge
  commit with git's default message. The MVP never rebases (D-5.2 comes later).
- **GA-26** When the working copy has uncommitted changes, **Pull** does not
  start. It says "Commit or discard your changes before pulling." with a link to
  **Changes** (D-4.3). Nothing is stashed.
- **GA-27** Before the merge, the backend records the current commit (D-4.6,
  A-5.12). When the merge needs a merge commit and the user has not confirmed
  their commit author, the pull asks first (CA-14).
- **GA-28** The result is shown in a short notice: "Already up to date", "Pulled
  3 commits", or, when the merge conflicts, the screen switches to conflict
  resolution (REQ-GIT-003). An open file that the pull changed is reloaded as in
  ED-24.

### Pushing

- **GA-29** **Push** pushes the current branch, and only it, to its upstream. An
  unpublished branch is pushed to a remote branch of the same name, which
  becomes its upstream. No tags are pushed.
- **GA-30** A push is never forced. When the remote rejects it because the
  upstream has commits that the branch does not have, the push says "The remote
  has new commits. Pull first." with **Pull**.
- **GA-31** When the remote rejects a push for another reason — for example a
  protected branch, a server hook, or unsigned commits (CA-15) — the push says
  so in plain words where it can, and shows the remote's own messages (the
  `remote:` lines) as plain text. Credentials and key problems follow
  REQ-REPO-002 (RC-4).
- **GA-32** After a successful push, the counts update and a short notice says
  "Pushed 2 commits to origin/main".

### Fetching and remote changes

- **GA-33** The backend fetches:
  - every 2 minutes while a tab views the repository (A-3.12, A-6.7);
  - when a file is opened, at most once every 30 seconds per repository; _(My
    call.)_
  - when the user selects **Fetch**.

  A fetch updates remote branches only, never the user's files or branch
  (D-4.2), and removes remote branches that were deleted on the remote.
- **GA-34** When a fetch finds that the upstream has commits the branch does not
  have, the header's **to pull** count updates and a remote-change notice
  appears: "3 new commits on origin/main", followed by "This file changed too."
  when the open file is among the files those commits change, with **Pull**. The
  notice can be dismissed; it comes back when more commits arrive. _(My call.)_
- **GA-35** A failed background fetch does not interrupt the user: the header
  shows a quiet "Couldn't check for remote changes" with the reason and **Try
  again**. A fetch that needs a locked key to be unlocked says so there, without
  opening a dialog by itself.

### Branches

- **GA-36** The branch list opens from the header. It shows the local branches,
  with the current one marked, and then the remote branches that have no local
  branch, with a filter field at the top for repositories with many branches.
- **GA-37** Selecting a local branch switches to it. Selecting a remote branch
  creates a local branch of the same name, with the remote branch as its
  upstream, and switches to it.
- **GA-38** **New branch** asks for a name and creates the branch from the
  current commit, then switches to it. The new branch is unpublished until it is
  pushed. Names follow git's rules for branch names (`git check-ref-format`),
  and a name already used by a local branch is refused, with the reason next to
  the field.
- **GA-39** Switching branches is refused while there are uncommitted changes:
  "Commit or discard your changes before switching branches.", with the list of
  changed files and a link to **Changes**. Nothing is stashed. _(My call.)_
- **GA-40** After a switch, the file tree, the open file and the changes update
  as in FB-41 and ED-24. An open file that does not exist on the new branch is
  closed (FB-42); since switching needs a clean working copy (GA-39), it has no
  unsaved edits other than a waiting save, which is sent before the switch. _(My
  call.)_
- **GA-41** In a single-branch clone, the remote branches are only the cloned
  branch and branches pushed from Front Burner. The branch list says "This is a
  single-branch clone, so other remote branches aren't available." _(My call:
  the engine adds pushed branches to what is fetched.)_
- **GA-42** In a repository cloned from an empty remote (AR-37), the header
  shows "main · no commits yet"; the first commit creates the branch `main`, and
  pushing publishes it. _(My call.)_

### Errors

- **GA-43** Every failed operation shows what failed and why, using error codes
  (A-3.8), and leaves the working copy as it was before the operation. Network
  and server errors offer **Try again**.

## Acceptance criteria

- **AC-GIT-002.1** The header shows the current branch, "2 to push, 3 to pull"
  after a fetch, and **Fetch**, **Pull** and **Push**. On a phone the counts
  stay visible and the buttons are in a menu.
- **AC-GIT-002.2** Editing two Markdown files and deleting an image lists three
  entries in **Changes** — two **Modified** (M) and one **Deleted** (D) — and
  the tab says "Changes (3)". An ignored file is not listed.
- **AC-GIT-002.3** Selecting a changed Markdown file shows a unified diff with
  changed words highlighted, and **Open in editor** opens it. A changed PNG
  shows "Binary file changed" with both sizes.
- **AC-GIT-002.4** Unticking one of three files and committing with a message
  commits the two ticked files only; the third stays in **Changes**. The
  commit's author and committer are the user's commit author.
- **AC-GIT-002.5** Typing in a file and committing at once includes the last
  edit in the commit.
- **AC-GIT-002.6** A message whose first line is longer than 72 characters shows
  a hint and still commits. A message with a line starting with `#` keeps it.
- **AC-GIT-002.7** **Amend last commit** is offered after a local commit and not
  after it is pushed. Amending with no ticked files changes only the message.
- **AC-GIT-002.8** **Discard** on a modified file restores it; on an added file
  deletes it; on a deleted file restores it. Each asks for confirmation.
  Discarding the open file while a save is waiting does not bring the change
  back.
- **AC-GIT-002.9** **Pull** with uncommitted changes says "Commit or discard
  your changes before pulling." With a clean working copy, it fast-forwards or
  makes a merge commit, and says how many commits it pulled.
- **AC-GIT-002.10** **Push** on an unpublished branch publishes it under the
  same name and sets its upstream; the header then shows no counts.
- **AC-GIT-002.11** A push rejected because the remote has new commits says "The
  remote has new commits. Pull first." and offers **Pull**. No push is ever
  forced.
- **AC-GIT-002.12** A push rejected by a server hook shows the remote's
  `remote:` lines as plain text.
- **AC-GIT-002.13** While the repository is viewed, a commit pushed to the
  upstream from elsewhere shows "1 new commit on origin/main" within about 2
  minutes, with "This file changed too." when it changes the open file. The
  user's files do not change until they pull.
- **AC-GIT-002.14** A failed background fetch shows "Couldn't check for remote
  changes" in the header and opens no dialog.
- **AC-GIT-002.15** The branch list shows local and remote branches and filters
  them by name. Selecting `origin/feature` creates and switches to a local
  `feature` that tracks it.
- **AC-GIT-002.16** **New branch** creates a branch from the current commit and
  switches to it. The names `bad..name` and the name of an existing local branch
  are refused.
- **AC-GIT-002.17** Switching branches with uncommitted changes is refused with
  the list of changed files. Without changes, the switch updates the tree and
  the open file.
- **AC-GIT-002.18** In a single-branch clone, the branch list shows the
  single-branch note.
- **AC-GIT-002.19** In a repository cloned from an empty remote, the first
  commit creates `main`, and **Push** publishes it.
- **AC-GIT-002.20** While a merge is in progress, commit, discard, pull, push
  and branch switching are not offered, and the API refuses them.
- **AC-GIT-002.21** Every action can be done by touch alone and with the
  keyboard alone, and axe-core reports no violations in the header, **Changes**
  and the diff.
- **AC-GIT-002.22** A text file whose diff is larger than 1 MB shows "This diff
  is too large to show"; a file whose only change is its line endings says so.
- **AC-GIT-002.23** Unticking a file, reloading the page and coming back keeps
  it unticked on that device; a file that becomes changed later appears ticked.

## Out of scope

- Rebase, and the merge or rebase preference (D-5.2, D-5.3).
- A staging area, and committing parts of a file.
- Force push, pushing tags, and pushing to a branch with another name.
- Deleting and renaming branches; merging one local branch into another.
- Commit history, viewing past commits, blame, tags, stash, cherry-pick, revert
  and reset.
- Side-by-side diffs, and diffs of rendered Markdown.
- Rename detection in **Changes**.
- Several remotes; remotes other than the one the repository was cloned from.
- The Simple and Guided levels, and pull requests.
- Credentials and key unlock (REQ-REPO-002), and changing the remote.

## Open questions

None at the moment.
