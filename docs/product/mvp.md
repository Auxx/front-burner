# Front Burner — MVP

> Status: **Draft**

## Purpose

This document defines the **minimum viable product (MVP)**: the smallest
release of Front Burner that delivers the core promise of the
[vision](vision.md) to one kind of user, end to end. It decides what is built
first. It does not change the vision: everything left out here is deferred,
not dropped.

The requirements stay the source of truth for behaviour. This document lists
which requirements the MVP needs, which already exist and which still have to
be written.

## Target user

The MVP serves **one person: the operator, who is also the instance's only
administrator and its only end user**. In persona terms this is the
self-hoster, or a tech lead or software developer trying Front Burner out
before inviting a team. It suits people who already know git.

Consequences:

- The only account is the first administrator, created by administrator
  onboarding (REQ-AUTH-001). Onboarding turns automatic registration off, and
  the MVP has no way to add users, so no other accounts can exist.
- Every repository uses the **Advanced** git control level. Since it is the
  only level allowed, the level dropdown on the Add repository page is
  hidden (AR-40).
- No outgoing mail is needed. Without SMTP the **Forgot password?** link is
  hidden (LG-48). If the operator loses their password, they recover the
  instance by hand (see [Risks](#risks)).
- The multi-user rules are still built in from day one: every repository,
  working copy, credential and preference belongs to one user, and the API
  enforces it. Adding users later must not need a data migration.

## Goal of the MVP

> An operator deploys Front Burner, signs in, adds an existing git
> repository, finds a Markdown file, edits it with a live preview on a laptop
> or a phone, and commits, pushes, pulls and resolves conflicts, all without
> a terminal.

### Exit criteria

The MVP is done when all of these hold on a fresh instance, in a desktop
browser and in a mobile browser:

1. Following the deployment guide, the operator starts the container and
   completes administrator onboarding, with either a password or OIDC.
2. The operator logs in and out. Sessions survive a backend restart.
3. The operator adds a private repository over HTTPS with a token, and
   another over SSH with a generated key, with each clone mode. They follow
   each clone on the dashboard.
4. The operator browses the repository, creates and renames Markdown files
   and folders, deletes files and folders, and opens any Markdown file in the
   editor.
5. Edits are saved to the working copy automatically after the user stops
   typing. Reloading the page or opening it on another device shows the saved
   content.
6. The live preview renders standard Markdown, front matter, code blocks,
   safe HTML and relative images. Unsafe HTML is stripped.
7. The operator sees the changed files and their diffs, discards a change,
   commits selected files with a message, and pushes. A new branch gets its
   upstream on the first push.
8. The operator creates a branch, switches between branches, and pulls.
9. When the remote changes, the operator is told. A pull that conflicts can
   be resolved in the browser by editing conflict markers, by keeping one
   whole version of a file, or by aborting. After an abort, the branch and
   working copy are exactly as they were before.
10. After a backend restart, a passphrase-protected key can be unlocked again
    from whichever page needs it, and the git operation carries on.
11. A repository whose clone failed, or whose credentials stopped working,
    can be fixed or removed from the repository management page.
12. The non-functional baseline holds: the security baseline, the
    rootless container, and the browser support and accessibility targets in
    [non-functional.md](../architecture/non-functional.md).

## In scope

### 1. Authentication and onboarding (written)

| Requirement                                               | Status   | MVP notes                                                         |
|-----------------------------------------------------------|----------|-------------------------------------------------------------------|
| [REQ-AUTH-001](../requirements/auth-onboarding.md)        | Accepted | As written.                                                       |
| [REQ-AUTH-002](../requirements/auth-password-policy.md)   | Accepted | As written.                                                       |
| [REQ-AUTH-003](../requirements/auth-login.md)             | Draft    | As written. Password reset stays hidden, because SMTP is missing. |

### 2. Dashboard and adding repositories (written)

| Requirement                                         | Status   | MVP notes                                                                                     |
|-----------------------------------------------------|----------|-----------------------------------------------------------------------------------------------|
| [REQ-DASH-001](../requirements/dashboard.md)        | Accepted | As written. The **Needs your confirmation** status never occurs.                              |
| [REQ-REPO-001](../requirements/repo-add.md)         | Draft    | As written. Only Advanced is allowed, so the level dropdown is hidden (AR-40).                |

### 3. Repository management (to write)

A minimal **repository management page**, which the dashboard already links
to:

- list every repository of the user, with its status and error;
- retry a failed clone;
- replace a repository's credentials, including adding credentials to a
  repository that was added without them, so that it can be pushed;
- remove a repository, which deletes its working copy after a confirmation
  that warns about commits that were not pushed and changes that were not
  committed. _(My call.)_

Left for later: renaming a repository, changing its clone mode, changing its
remote, and managing saved credentials and known hosts as lists of their own.

### 4. Push credentials and key unlock (to write)

- Pushing uses the repository credentials. A push that the remote refuses
  because of permissions shows a clear error, with a way to replace the
  credentials (section 3).
- When a git operation needs a passphrase-protected key that is not
  unlocked (for example after a restart or in a new session), the web client
  asks for the passphrase on the page where the operation was started, then
  carries on with the operation.

### 5. Commit author (to write)

- The author name and email of the user's commits. By default they come from
  the account (its display name and email). The user can change them in
  their user preferences. _(My call.)_

### 6. File browser (to write)

- A file tree of the current branch of the working copy, which loads
  folders lazily so that large code repositories stay fast.
- Markdown files (`.md`, `.markdown`, `.mdx`) and non-Markdown files are
  both shown, and files ignored by `.gitignore` are marked. Only Markdown
  files can be opened.
- Creating Markdown files and (empty) folders, renaming Markdown files and
  folders in place, and deleting files of any kind and folders.
- Opening a repository sets its last access time (DS-7, DS-8).
- Works with the tree on a phone (for example, as a drawer).

Written up as [REQ-FILE-001](../requirements/file-browser.md).

Left for later: moving files to another folder, uploading files, the "hide
non-Markdown files" preference, and search.

### 7. Markdown editor, saving and live preview (to write)

Builds on decisions D-1 and D-7:

- a CodeMirror 6 editor with Markdown and front matter highlighting;
- automatic saving to the working copy after the user stops typing (D-1.1 to
  D-1.3: no commit, last save wins), with a visible saved / saving / failed
  state and a warning when leaving with an unsaved change;
- plain Markdown editing, one file at a time (a formatting toolbar and tabs
  come later);
- a live preview beside the editor on wide screens, scrolling together with
  it, and Edit and Preview tabs on narrow screens;
- the rendering pipeline and what it shows (D-7.3 to D-7.6);
- **safe HTML**: the GitHub-compatible whitelist of HTML tags and
  attributes that the preview renders, with a notice when HTML was removed;
- **images**: images with a path relative to the Markdown file are shown,
  loaded through the API with the user's auth token. Site-absolute paths such
  as `/images/cover.png` and remote images are left for later.

The editor and preview are written up as
[REQ-EDIT-001](../requirements/editor.md), safe HTML as
[REQ-EDIT-002](../requirements/preview-html.md); images are still to write.

### 8. Git at the Advanced level (to write)

Builds on decisions D-4, D-5 and D-6. The backend exposes one set of git
operations for every level. The MVP builds only the Advanced level's UI for
them.

- **Status**: the current branch, how far it is ahead of and behind its
  upstream, and the list of changed files (added, modified, deleted, renamed).
- **Diff**: the diff of each changed file against the last commit.
- **Discard**: discarding the changes to selected files, with a confirmation.
- **Commit**: committing selected files, or all of them, with a message.
- **Push**: pushing the current branch, and setting its upstream on the first
  push.
- **Pull**: fetching and merging the upstream into the current branch. If
  there are uncommitted changes, the user is asked to commit or discard them
  first (D-4.3). The MVP only merges; rebase comes later (see D-5.2).
- **Branches**: listing local and remote branches, creating a branch from
  the current one, and switching branches. Switching is refused while there
  are uncommitted changes _(my call)_. In a single-branch clone, only the
  cloned branch and branches created locally from it are listed.
- **Fetch and remote-change notices** (D-4.2): fetching when a file is opened
  and periodically while the user is editing, telling the user when the
  upstream has new commits and whether the open file is among them.
- **Conflict resolution** (D-4.4 to D-4.6, D-6): a pull that conflicts locks
  the repository to the resolution screen, which offers:
  - **Edit conflict markers**, in the normal editor (D-6.4);
  - **Use my version** / **Use their version**, the only methods for
    non-Markdown files (D-6.2);
  - **Abort**, which puts the branch and working copy back exactly as they
    were (D-4.5).

  Finishing commits the merge. The user then pushes it like any other
  commit.

### 9. Deployment guide (to write)

The operator-facing deployment guide in `docs/wiki/deployment.md`, as listed
in `docs/wiki/todo.md`: the image, volumes, container UID, environment
variables, encryption key, backup and restore, upgrades, and a hardened
compose example.

## Out of scope (deferred)

These are deferred in favour of a smaller first release. They stay in the
vision, and the architecture must not rule them out.

| Area                    | Deferred                                                                                                                                      |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Users                   | Inviting password users, onboarding of invited users, user management (disable/enable, allowed levels), viewing the login audit log, OIDC allow-list and the automatic registration toggle. |
| System settings         | SMTP configuration, and everything that needs email: invitations, password reset, conflict reminder emails.                                   |
| Git control levels      | The Simple level and auto-sync (D-2, D-3), the Guided level, and changing a repository's level (D-4a).                                        |
| Pull requests           | "Submit for review", provider tokens, and the provider abstraction's pull request calls (D-8). Resolving on the provider.                     |
| Advanced git extras     | Rebase and the merge/rebase preference (D-5.2, D-5.3), the three-way merge editor, Choose per change, Keep both, commit history, deleting and renaming branches, tags, stash. |
| Repositories            | Adding a repository on a user's behalf and confirming it, renaming a repository, changing its clone mode or remote, submodules, Git LFS.     |
| Credentials             | Managing saved credentials and known hosts as lists: renaming, deleting, changing a passphrase, replacing a changed host key.                 |
| Files                   | Moving files to another folder, uploading files, the "hide non-Markdown files" preference, file search.                                     |
| Editor and preview      | A formatting toolbar, several open files (tabs), Mermaid and math, ticking task lists. Site-absolute image paths and remote images.            |
| Account                 | Changing the password while logged in.                                                                                                        |

## Order of work

A suggested order. Each step leaves a working product that can be shown to
someone:

1. Authentication and onboarding, then the dashboard and adding repositories
   (requirements already written).
2. The file browser, then the editor with saving and live preview, safe HTML
   and images. At this point the operator can edit files but not commit them.
3. Commit author, status, diff, discard, commit and push, with push
   credentials and key unlock.
4. Pull, fetch notices, branches and conflict resolution.
5. The repository management page.
6. The deployment guide, the security review and the release checks
   (NF-11.12, and the hand checks on real phones in
   [non-functional.md](../architecture/non-functional.md)).

## Risks

- **Locked out without SMTP.** With one administrator and no password reset,
  a forgotten password locks the operator out. REQ-AUTH-001 leaves
  recovering an instance where every administrator is lost to a separate
  requirement, as an operator task. The MVP needs at least a documented
  recovery procedure in the deployment guide.
- **Typing speed on phones.** Spike 3 measured typing in a 1 MB file at the
  limit of NF-2.4 in emulation (A-8.11). The check on a real mid-range phone
  is still to do, and must happen before the editor requirement is accepted.
- **Large repositories.** Spike 4 (git at 100,000 files, A-5.14) is still to
  do. The file browser's lazy loading and the status call are the parts most
  at risk.

## Open questions

None at the moment.
