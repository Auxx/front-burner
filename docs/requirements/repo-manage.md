# REQ-REPO-003: Repository management

> Status: **Accepted**

## Summary

The **repository management page** lists all of the user's repositories, and
each repository has a **repository settings page**, where the user can:

- follow a clone, see a clone error in full and **retry** the clone;
- see and fix **repository warnings**, such as refused credentials or a locked
  key;
- add or replace the repository's **credentials**
  ([REQ-REPO-002](repo-credentials.md));
- set the repository's **commit author** override
  ([REQ-GIT-001](commit-author.md));
- see how the repository was cloned;
- **remove** the repository, which deletes its working copy.

Renaming a repository, changing its clone mode, remote or git control level, and
managing saved credentials as a list come later ([mvp.md](../product/mvp.md)).

## Context

- The dashboard shows only the 10 most recent repositories and sends the user
  here for the rest, and for any repository that cannot be opened (DS-22,
  DS-24).
- A clone can fail or time out (AR-51, AR-53), or be interrupted by a restart
  (AR-54). The user needs to see why and try again, perhaps with other
  credentials.
- Problems with credentials do not stop the user from editing and committing:
  those work without the remote. Such a repository stays openable and shows a
  warning instead of an error.
- A working copy can go missing or be damaged outside Front Burner, for example
  when an operator restores a backup partly or a disk fails. The user must be
  able to recover without the operator.
- Removing a repository deletes its working copy, including any uncommitted
  changes and commits that were never pushed. They cannot be recovered, so
  removing must be deliberate in that case.
- Each user sees only their own repositories (vision goal 7).

## Terms

**Repository management page**
: The page that lists all of a user's repositories (see the
  [glossary](../product/glossary.md)). Route `/repositories`.

**Repository settings page**
: The page of one repository on the repository management page. Route
  `/repositories/<id>/settings`.

**Repository status**
: **Needs your confirmation**, **Cloning** or **Error**, as in
  [REQ-DASH-001](dashboard.md), for repositories that cannot be opened; this
  page also shows **Ready** for openable ones. **Error** is only for
  repositories that cannot be opened (RM-6).

**Repository warning**
: A problem with a repository that does not stop it from being opened, such as
  refused credentials (RM-8).

## Requirements

### General

- **RM-1** Both pages need a login (LG-4). A user sees and changes only their
  own repositories; a request for another user's repository is refused as if it
  did not exist (AR-56).
- **RM-2** The backend enforces every rule in this requirement, including which
  actions are allowed in which status (vision goal 12).
- **RM-3** Both pages are fully usable in desktop and mobile browsers, by touch
  alone and with the keyboard alone (NF-12, NF-13).

### Repository management page

- **RM-4** The page has the heading "Repositories", an **Add repository** button
  (to the Add repository page, AR-1), and a filter field that filters the list
  by repository name and remote as the user types. _(My call.)_
- **RM-5** It lists all of the user's repositories, in any status, sorted by
  name, ignoring case. Each entry shows the repository's name, its remote as on
  the dashboard (DS-18, DS-19), its last access time, labelled "Last accessed"
  (DS-18), and its status or warning (RM-6 to RM-8). Selecting an entry opens
  its settings page; an openable repository also has **Open**, which opens the
  repository screen. A user with no repositories sees the full guide of DS-11
  instead of the list. _(My call: the list is not paged, since a user has at
  most 50 repositories, NF-1.3.)_

### Statuses and warnings

- **RM-6** A repository is in the **Error** status, and cannot be opened, only
  when:
  - its clone failed, timed out or was interrupted ("Clone failed", "Clone timed
    out", AR-53, AR-54); or
  - its working copy is missing or damaged: "Working copy is missing or
    damaged". The backend finds this when it checks working copies on start
    (A-5.15) and whenever a git operation finds the working copy unusable. _(My
    call.)_
- **RM-7** While a repository is **Cloning**, its entry and settings page show
  the clone's progress, updated without a reload (DS-23, A-3.11), and "Waiting
  for other clones to finish" while it waits its turn (AR-52).
- **RM-8** A repository warning is shown next to an openable repository's
  status, on this page, on its settings page and on the dashboard (DS-18). The
  warnings are:

  | Warning                             | When                                                          | Fix offered                      |
  | ----------------------------------- | ------------------------------------------------------------- | -------------------------------- |
  | "Credentials refused"               | The last fetch, pull or push was refused (RC-4)               | **Fix credentials** (RC-12)      |
  | "Can't push with these credentials" | The last push was not allowed (RC-4)                          | **Use other credentials** (RC-7) |
  | "Server identity changed"           | The last connection met a changed host key (RC-4)             | **Review the new key** (RC-21)   |
  | "Key locked"                        | The repository's key is locked in the current session (RC-15) | **Unlock** (RC-16)               |

  The first three come from the backend's record of the operations with the
  remote, including background fetches. "Credentials refused" and "Server
  identity changed" go away when an operation of the same kind succeeds: a
  refused push only when a push succeeds, a refused fetch or pull when any
  operation with the remote succeeds. "Can't push with these credentials" goes
  away only when a push succeeds or the credentials are changed. "Key locked"
  depends on the session. _(My call.)_ A repository can be opened whatever its
  warnings.

### Repository settings page

- **RM-9** The settings page shows the repository's name, remote, status and
  warnings, with **Open** when the repository is openable, and these sections:
  - **Status**: for **Cloning** and **Error**, as in RM-10 to RM-13;
  - **Credentials** (RM-14);
  - **Commit author** (RM-15);
  - **Clone details** (RM-16);
  - **Remove repository** (RM-17).
- **RM-10** For a repository in the **Error** status, the **Status** section
  shows the error's label and a **Details** section, closed by default, with the
  git error as the backend recorded it, with secrets removed (AR-53), and the
  request ID (NF-10.6). _(My call: the message is shown as plain text, since it
  may contain text from the remote.)_
- **RM-11** **Retry clone** is offered for a failed, timed out or interrupted
  clone. It clones again with the same remote, clone mode and branch, and the
  repository's current credentials, unlocking the key first if needed (RC-16).
  The status becomes **Cloning** at once. The user can change the credentials
  (RM-14) before retrying.
- **RM-12** **Clone again** is offered for a repository whose working copy is
  missing or damaged. It warns: "Any changes and commits that were only in the
  old working copy are lost." It removes what is left of the working copy and
  clones as in RM-11. The repository keeps its name, settings, commit author
  override and last access time. _(My call.)_
- **RM-13** Retrying and cloning again count towards the limits on clones per
  user (NF-11.4) and access checks (AR-55).

### Credentials

- **RM-14** The **Credentials** section shows the credentials in use: their name
  and kind (HTTPS credentials with the username, or an SSH key with its type,
  SHA256 fingerprint and whether it is passphrase-protected), or "No credentials
  (public repository)". **Change credentials** opens the repository credentials
  dialog (RC-7, RC-11). The password, token or private key is never shown.

### Commit author

- **RM-15** The **Commit author** section shows the commit author that commits
  in this repository use, and whether it is the user's default or an override,
  with **Use a different author for this repository** or **Use my default**
  (CA-9).

### Clone details

- **RM-16** **Clone details** shows, read-only: the clone mode (**Full clone**,
  or **Single branch** with the branch), the git control level (Advanced in the
  MVP, with its description, AR-38), and when the repository was added.
  _(Changing them is out of scope.)_

### Removing a repository

- **RM-17** **Remove repository** is offered in every status. It opens a
  confirmation dialog: "Remove _&lt;name&gt;_? This deletes its working copy on
  Front Burner. The remote is not changed."
- **RM-18** When removing would lose work, the dialog lists what would be lost
  and the user must type the repository name to confirm. Work would be lost when
  the working copy has:
  - uncommitted changes (with how many files);
  - commits that are not on any remote branch (with how many);
  - a merge in progress.

  When none of these apply, one click on **Remove** confirms. _(My call: the
  check runs when the dialog opens and again when the user confirms.)_
- **RM-19** Removing:
  - cancels the clone, if the repository is **Cloning**;
  - stops its background jobs (fetches);
  - deletes its working copy and every record that belongs only to it (its
    status, warnings, commit author override, sync state and jobs);
  - keeps the user's saved credentials, SSH keys and known hosts, which other
    repositories may use (RC-10);
  - deletes the browser drafts of its files on the device that removes it
    (NF-3.3). _(Other devices delete theirs when they next find the repository
    gone.)_
- **RM-20** After removing, the web client shows the repository management page
  with "Repository _&lt;name&gt;_ removed." Other tabs and devices that show the
  repository go to the dashboard with the same message, without a reload. The
  name can be used again for a new repository at once.
- **RM-21** Deleting a large working copy may take longer than about 2 seconds;
  it then runs as a job (NF-2.8). The repository disappears from every list at
  once and cannot be opened while it is being deleted.

## Acceptance criteria

1. The repository management page lists all of a user's repositories sorted by
   name, with name, remote, last access time and status, and filters them as the
   user types. **Add repository** opens the Add repository page.
2. The dashboard's **All repositories** link opens this page; its link for a
   repository in error opens that repository's settings page.
3. A cloning repository shows its progress without a reload, and becomes
   **Ready** with **Open** when the clone ends.
4. A failed clone shows "Clone failed" and, under **Details**, the git error
   without secrets and with the request ID. **Retry clone** clones again with
   the same settings; changing the credentials first is possible.
5. Deleting a working copy's directory on disk while the backend is stopped
   shows "Working copy is missing or damaged" after the next start. **Clone
   again** warns about lost work, clones it, and keeps the repository's name and
   commit author override.
6. A repository whose last push was refused shows "Credentials refused" on the
   dashboard, this page and its settings page, and can still be opened. A
   successful background fetch does not remove the warning; the next successful
   push does.
7. After a backend restart, a repository with a passphrase-protected key shows
   "Key locked" with **Unlock**.
8. The **Credentials** section shows the credentials' name, kind and, for an SSH
   key, its fingerprint, never the secret. **Change credentials** opens the
   repository credentials dialog.
9. The **Commit author** section shows the author in use and switches between an
   override and the default.
10. **Clone details** shows "Single branch: main" for a single-branch clone, and
    the git control level.
11. Removing a repository with no uncommitted changes and nothing to push needs
    one click. With 2 uncommitted files and 3 commits not pushed, the dialog
    lists both and needs the repository name typed.
12. After removing, the repository is gone from every list, its working copy is
    deleted from disk, its saved credentials remain in the profile, and a second
    device that had it open goes to the dashboard.
13. Removing a repository that is cloning cancels the clone.
14. A request for another user's repository settings, or to remove another
    user's repository, gets the same response as for a repository that does not
    exist.

## Out of scope

- Renaming a repository, changing its remote, clone mode or git control level.
- Managing saved credentials, SSH keys and known hosts as lists.
- Disk usage per repository.
- Confirming repositories added on a user's behalf (administration
  requirements).
- Archiving a repository, or removing several at once.
- Removing a repository from the remote; Front Burner never changes remotes
  except by pushing.

## Open questions

None at the moment.
