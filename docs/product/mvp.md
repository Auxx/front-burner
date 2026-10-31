# Front Burner — MVP

> Status: **Accepted**

## Purpose

This document defines the **minimum viable product (MVP)**: the smallest release
of Front Burner that delivers the core promise of the [vision](vision.md) to one
kind of user, end to end. It decides what is built first. It does not change the
vision: everything left out here is deferred, not dropped.

The requirements stay the source of truth for behaviour. This document lists
which requirements the MVP needs, which already exist and which still have to be
written.

## Target user

The MVP serves **one person: the operator, who is also the instance's only
administrator and its only end user**. In persona terms this is the self-hoster,
or a tech lead or software developer trying Front Burner out before inviting a
team. It suits people who already know git.

Consequences:

- The only account is the first administrator, created by administrator
  onboarding (REQ-AUTH-001). Onboarding turns automatic registration off, and
  the MVP has no way to add users, so no other accounts can exist.
- Every repository uses the **Advanced** git control level. Since it is the only
  level allowed, the level dropdown on the Add repository page is hidden
  (AR-40).
- No outgoing mail is needed. Without SMTP the **Forgot password?** link is
  hidden (LG-48). If the operator loses their password, they recover the
  instance by hand (see [Risks](#risks)).
- The multi-user rules are still built in from day one: every repository,
  working copy, credential and preference belongs to one user, and the API
  enforces it. Adding users later must not need a data migration.

## Goal of the MVP

> An operator deploys Front Burner, signs in, adds an existing git repository,
> finds a Markdown file, edits it with a live preview on a laptop or a phone,
> and commits, pushes, pulls and resolves conflicts, all without a terminal.

### Exit criteria

The MVP is done when all of these hold on a fresh instance, in a desktop browser
and in a mobile browser:

1. Following the deployment guide, the operator starts the container and
   completes administrator onboarding, with either a password or OIDC.
2. The operator logs in and out. Sessions survive a backend restart.
3. The operator adds a private repository over HTTPS with a token, and another
   over SSH with a generated key, with each clone mode. They follow each clone
   on the dashboard.
4. The operator browses the repository, creates and renames Markdown files and
   folders, deletes files and folders, and opens any Markdown file in the
   editor.
5. Edits are saved to the working copy automatically after the user stops
   typing. Reloading the page or opening it on another device shows the saved
   content.
6. The live preview renders standard Markdown, front matter, code blocks, safe
   HTML and repository images, and remote images on request. Unsafe HTML is
   stripped.
7. The operator sees the changed files and their diffs, discards a change,
   commits selected files with a message, and pushes. A new branch gets its
   upstream on the first push.
8. The operator creates a branch, switches between branches, and pulls.
9. When the remote changes, the operator is told. A pull that conflicts can be
   resolved in the browser by editing conflict markers, by keeping one whole
   version of a file, or by aborting. After an abort, the branch and working
   copy are exactly as they were before.
10. After a backend restart, a passphrase-protected key can be unlocked again
    from whichever page needs it, and the git operation carries on.
11. A repository whose clone failed, or whose credentials stopped working, can
    be fixed or removed from the repository management page.
12. The non-functional baseline holds: the security baseline, the rootless
    container, and the browser support and accessibility targets in
    [non-functional.md](../architecture/non-functional.md).

## In scope

Each section has a table with one row per requirement (per area for the
non-functional requirements). **Status** is the status of the requirement
document. Every point and acceptance criterion of the requirement is in exactly
one of three columns:

- **In MVP**: part of the MVP as written.
- **Limited in MVP**: only part of it is in the MVP, or it is in the MVP but
  nothing in the MVP can trigger it. The list under the table says how.
- **Not in MVP**: deferred.

### 1. Authentication and onboarding

| Requirement                                             | Status   | In MVP                                                                                                                                                               | Limited in MVP                                               | Not in MVP                                                                     | MVP notes                                                                 |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [REQ-AUTH-001](../requirements/auth-onboarding.md)      | Accepted | AO-1 to AO-39; AC-AUTH-001.1 to AC-AUTH-001.14                                                                                                                       | —                                                            | —                                                                              | As written.                                                               |
| [REQ-AUTH-002](../requirements/auth-password-policy.md) | Accepted | PP-1 to PP-15; AC-AUTH-002.1 to AC-AUTH-002.14                                                                                                                       | —                                                            | —                                                                              | As written. The onboarding form is the only form that sets a password.    |
| [REQ-AUTH-003](../requirements/auth-login.md)           | Accepted | LG-2, LG-4 to LG-23, LG-27 to LG-36, LG-38 to LG-47, LG-61 to LG-64, LG-66, LG-68; AC-AUTH-003.2 to AC-AUTH-003.15, AC-AUTH-003.17, AC-AUTH-003.23 to AC-AUTH-003.26 | LG-1, LG-3, LG-24, LG-37, LG-48, LG-65, LG-67; AC-AUTH-003.1 | LG-25, LG-26, LG-49 to LG-60; AC-AUTH-003.16, AC-AUTH-003.18 to AC-AUTH-003.22 | No password reset, because SMTP is missing, and no way to disable a user. |

Limited in MVP:

- **LG-1**, **LG-3**, **AC-AUTH-003.1**: only the login page. The Forgot
  password and Confirm password reset pages are not built.
- **LG-24**: the check is built, but nothing in the MVP disables a user.
- **LG-37**: a session is revoked on logout and on refresh token reuse.
  Disabling a user and resetting a password do not exist.
- **LG-48**: the **Forgot password?** link is hidden. The Forgot password page
  that says reset is not available is not built.
- **LG-65**: rate limits on login, refresh and the OIDC callback. The forgot
  password and confirm password reset endpoints do not exist.
- **LG-67**: every event except the three password reset events.

### 2. Dashboard and adding repositories

| Requirement                                  | Status   | In MVP                                                                                                         | Limited in MVP | Not in MVP            | MVP notes                                                                              |
| -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | -------------- | --------------------- | -------------------------------------------------------------------------------------- |
| [REQ-DASH-001](../requirements/dashboard.md) | Accepted | DS-1 to DS-6, DS-8 to DS-20, DS-22 to DS-26; AC-DASH-001.1 to AC-DASH-001.11, AC-DASH-001.13 to AC-DASH-001.16 | DS-7           | DS-21; AC-DASH-001.12 | No repositories added on a user's behalf, so **Needs your confirmation** never occurs. |
| [REQ-REPO-001](../requirements/repo-add.md)  | Accepted | AR-1 to AR-37, AR-39 to AR-57; AC-REPO-001.1 to AC-REPO-001.26                                                 | AR-38          | —                     | Only Advanced is allowed, so the level dropdown is hidden (AR-40).                     |

Limited in MVP:

- **DS-7**: set when the user adds or opens a repository. Administrators do not
  add repositories on a user's behalf.
- **AR-38**: the dropdown is built, but it is never shown, because the only
  allowed level is Advanced (AR-40).

### 3. Repository management

| Requirement                                    | Status   | In MVP                                         | Limited in MVP | Not in MVP | MVP notes                                                                                                                                   |
| ---------------------------------------------- | -------- | ---------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [REQ-REPO-003](../requirements/repo-manage.md) | Accepted | RM-1 to RM-21; AC-REPO-003.1 to AC-REPO-003.14 | —              | —          | As written. Renaming a repository, changing its clone mode or remote, and managing saved credentials and known hosts as lists are deferred. |

### 4. Push credentials and key unlock

| Requirement                                         | Status   | In MVP                                         | Limited in MVP | Not in MVP | MVP notes   |
| --------------------------------------------------- | -------- | ---------------------------------------------- | -------------- | ---------- | ----------- |
| [REQ-REPO-002](../requirements/repo-credentials.md) | Accepted | RC-1 to RC-25; AC-REPO-002.1 to AC-REPO-002.15 | —              | —          | As written. |

### 5. Commit author

| Requirement                                     | Status   | In MVP                                       | Limited in MVP | Not in MVP | MVP notes                                                                                                                   |
| ----------------------------------------------- | -------- | -------------------------------------------- | -------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| [REQ-GIT-001](../requirements/commit-author.md) | Accepted | CA-1 to CA-15; AC-GIT-001.1 to AC-GIT-001.12 | —              | —          | As written. Includes a minimal **Preferences** page (`/preferences`) for the default commit author. Commits are not signed. |

### 6. File browser

| Requirement                                     | Status   | In MVP                                                         | Limited in MVP | Not in MVP | MVP notes                                                                                                                      |
| ----------------------------------------------- | -------- | -------------------------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [REQ-FILE-001](../requirements/file-browser.md) | Accepted | FB-1 to FB-46, FB-20a, FB-20b; AC-FILE-001.1 to AC-FILE-001.26 | —              | —          | As written. Moving files to another folder, uploading files, the "hide non-Markdown files" preference and search are deferred. |

### 7. Markdown editor, saving and live preview

| Requirement                                       | Status   | In MVP                                                | Limited in MVP | Not in MVP | MVP notes                                                                      |
| ------------------------------------------------- | -------- | ----------------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------ |
| [REQ-EDIT-001](../requirements/editor.md)         | Accepted | ED-1 to ED-39, ED-9a; AC-EDIT-001.1 to AC-EDIT-001.25 | —              | —          | As written. Builds on D-1 and D-7. A formatting toolbar and tabs are deferred. |
| [REQ-EDIT-002](../requirements/preview-html.md)   | Accepted | SH-1 to SH-23; AC-EDIT-002.1 to AC-EDIT-002.17        | —              | —          | As written.                                                                    |
| [REQ-EDIT-003](../requirements/preview-images.md) | Accepted | IM-1 to IM-26; AC-EDIT-003.1 to AC-EDIT-003.16        | —              | —          | As written. Blog-engine image folders are deferred.                            |

### 8. Git at the Advanced level

| Requirement                                     | Status   | In MVP                                       | Limited in MVP | Not in MVP | MVP notes                                                                                                                                                                     |
| ----------------------------------------------- | -------- | -------------------------------------------- | -------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [REQ-GIT-002](../requirements/git-advanced.md)  | Accepted | GA-1 to GA-43; AC-GIT-002.1 to AC-GIT-002.23 | —              | —          | As written. Builds on D-4, D-5 and D-6. The backend exposes one set of git operations for every level; the MVP builds only the Advanced level's UI. Pull only merges (D-5.2). |
| [REQ-GIT-003](../requirements/git-conflicts.md) | Accepted | GC-1 to GC-28; AC-GIT-003.1 to AC-GIT-003.16 | —              | —          | As written. The other resolution methods are deferred.                                                                                                                        |

### 9. Navigation

| Requirement                                  | Status   | In MVP                                       | Limited in MVP | Not in MVP | MVP notes   |
| -------------------------------------------- | -------- | -------------------------------------------- | -------------- | ---------- | ----------- |
| [REQ-APP-001](../requirements/navigation.md) | Accepted | NV-2 to NV-19; AC-APP-001.1 to AC-APP-001.13 | NV-1           | —          | As written. |

Limited in MVP:

- **NV-1**: every route except the password reset pages, which are not built
  (LG-1).

### 10. Deployment guide

| Document                                  | Status | In MVP | Limited in MVP | Not in MVP | MVP notes                                                                                                                                                              |
| ----------------------------------------- | ------ | ------ | -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Deployment guide](../wiki/deployment.md) | Draft  | —      | —              | —          | Has no numbered points. Completed once the MVP runs locally, before the release (order of work, step 6), with the operator-facing parts listed in `docs/wiki/todo.md`. |

### 11. Non-functional requirements

All in [non-functional.md](../architecture/non-functional.md), whose status is
**Draft**.

| Area                              | In MVP                               | Limited in MVP   | Not in MVP | MVP notes                                   |
| --------------------------------- | ------------------------------------ | ---------------- | ---------- | ------------------------------------------- |
| NF-1: Scale                       | NF-1.1 to NF-1.5, NF-1.7             | —                | NF-1.6     | No uploads.                                 |
| NF-2: Performance                 | NF-2.1 to NF-2.10                    | —                | —          |                                             |
| NF-3: Unsaved edits               | NF-3.1 to NF-3.6                     | —                | —          |                                             |
| NF-4: Database                    | NF-4.1 to NF-4.3                     | —                | —          |                                             |
| NF-5: Data layout                 | NF-5.1 to NF-5.6                     | —                | —          |                                             |
| NF-6: Backup and restore          | NF-6.1 to NF-6.6                     | —                | —          |                                             |
| NF-7: Upgrades                    | NF-7.1 to NF-7.7                     | —                | —          |                                             |
| NF-8: Secrets                     | NF-8.1 to NF-8.3, NF-8.5, NF-8.6     | —                | NF-8.4     | Key rotation comes after the first release. |
| NF-9: Availability and resilience | NF-9.1 to NF-9.4, NF-9.8, NF-9.9     | NF-9.5 to NF-9.7 | —          |                                             |
| NF-10: Observability              | NF-10.1 to NF-10.11                  | —                | —          |                                             |
| NF-11: Security baseline          | NF-11.1 to NF-11.13                  | —                | —          |                                             |
| NF-12: Browser and device support | NF-12.1 to NF-12.6                   | —                | —          |                                             |
| NF-13: Accessibility              | NF-13.1, NF-13.3, NF-13.5 to NF-13.8 | NF-13.2          | NF-13.4    | Only the MVP's resolution methods.          |
| NF-14: Localisation               | NF-14.1 to NF-14.4                   | —                | —          |                                             |

Limited in MVP:

- **NF-9.5**: interrupted clones, pulls, pushes, merges waiting for resolution
  and fetches. The Simple level and conflict reminder emails do not exist.
- **NF-9.6**: key unlocks are lost on restart. The Simple level does not exist.
- **NF-9.7**: new clones are refused on low space. Uploads do not exist.
- **NF-13.2**: **Edit conflict markers** is offered. The three-way merge editor
  does not exist.

## Out of scope (deferred)

These are deferred in favour of a smaller first release. They stay in the
vision, and the architecture must not rule them out.

| Area                | Deferred                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users               | Inviting password users, onboarding of invited users, user management (disable/enable, allowed levels), viewing the login audit log, OIDC allow-list and the automatic registration toggle. |
| System settings     | SMTP configuration, and everything that needs email: invitations, password reset, conflict reminder emails.                                                                                 |
| Git control levels  | The Simple level and auto-sync (D-2, D-3), the Guided level, and changing a repository's level (D-4a).                                                                                      |
| Pull requests       | "Submit for review", provider tokens, and the provider abstraction's pull request calls (D-8). Resolving on the provider.                                                                   |
| Advanced git extras | Rebase and the merge/rebase preference (D-5.2, D-5.3), the three-way merge editor, Choose per change, Keep both, commit history, deleting and renaming branches, tags, stash.               |
| Repositories        | Adding a repository on a user's behalf and confirming it, renaming a repository, changing its clone mode or remote, submodules, Git LFS.                                                    |
| Credentials         | Managing saved credentials and known hosts as lists: renaming, deleting, changing a passphrase, reviewing known hosts.                                                                      |
| Files               | Moving files to another folder, uploading files, the "hide non-Markdown files" preference, file search.                                                                                     |
| Editor and preview  | A formatting toolbar, several open files (tabs), Mermaid and math, ticking task lists. Blog-engine image folders, a remote image proxy.                                                     |
| Account             | Changing the password while logged in.                                                                                                                                                      |

## Order of work

A suggested order. Each step leaves a working product that can be shown to
someone:

1. Authentication and onboarding, the app header and navigation, then the
   dashboard and adding repositories.
2. The file browser, then the editor with saving and live preview, safe HTML and
   images. At this point the operator can edit files but not commit them.
3. Commit author, status, diff, discard, commit and push, with push credentials
   and key unlock.
4. Pull, fetch notices, branches and conflict resolution.
5. The repository management page.
6. The deployment guide, the security review and the release checks: every
   non-functional requirement in the MVP (section 11 of
   [In scope](#11-non-functional-requirements)), including NF-11.12 and the hand
   checks on real phones in
   [non-functional.md](../architecture/non-functional.md).

## Implementation status

How far the code is. [In scope](#in-scope) says which points and acceptance
criteria the MVP needs; this table says which of those are built and tested.
Points and criteria that are not in the MVP are left out. The pull request that
builds a part updates its row.

- **Not started**: none of its MVP points are built.
- **In progress**: some of its MVP points are built.
- **Built**: every MVP point is built, but some MVP criteria have no test yet.
- **Done**: every MVP point is built, and every MVP criterion has a test.

A criterion has a test when a test title starts with its ID, for example
`it('AC-REPO-001.2: two quick submits create one repository', …)`. `node
tools/ai-tools/src/bin/doc-ids.mjs criteria` lists the MVP criteria that no test
names, in the form of the last column.

The non-functional requirements are not tracked here. They are checked with the
release checks (order of work, step 6).

**Keeping it up to date.** An agent that implements any part of the MVP updates
this section in the same change, without being asked:

- it starts the title of every test that covers an MVP criterion with the
  criterion's ID;
- for every requirement its change touches, it updates **State**, **Built in**
  (the pull request number, or the branch name until the pull request has a
  number) and **MVP points not built**;
- it runs `doc-ids.mjs criteria` and copies the result into **MVP criteria
  without a test**;
- it checks that every **State** still matches its definition above.

| Requirement                                             | Step | State       | Built in                                                                                                                                                                       | MVP points not built                                                                                                                                                         | MVP criteria without a test                                                                |
| ------------------------------------------------------- | ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [REQ-AUTH-001](../requirements/auth-onboarding.md)      | 1    | Done        | #18, #28, #29                                                                                                                                                                  | —                                                                                                                                                                            | —                                                                                          |
| [REQ-AUTH-002](../requirements/auth-password-policy.md) | 1    | Done        | #18                                                                                                                                                                            | —                                                                                                                                                                            | —                                                                                          |
| [REQ-AUTH-003](../requirements/auth-login.md)           | 1    | Done        | #25, #26, #28, #33, `centred-island`                                                                                                                                           | —                                                                                                                                                                            | —                                                                                          |
| [REQ-APP-001](../requirements/navigation.md)            | 1    | In progress | #26, #30, #36, #42, `file-tree`, `repository-switcher`, `editing-saving`, `browser-drafts`                                                                                     | NV-1 (the routes of pages not built yet), NV-7 (Preferences and the version line), NV-9 (the branch and the git status), NV-11 (the branch and the git counts), NV-15, NV-16 | AC-APP-001.1 to AC-APP-001.2, AC-APP-001.4 to AC-APP-001.5, AC-APP-001.10 to AC-APP-001.13 |
| [REQ-DASH-001](../requirements/dashboard.md)            | 1    | In progress | #30, #35, #36, #42                                                                                                                                                             | DS-20                                                                                                                                                                        | AC-DASH-001.6, AC-DASH-001.11                                                              |
| [REQ-REPO-001](../requirements/repo-add.md)             | 1    | Done        | #27, #31 to #36                                                                                                                                                                | —                                                                                                                                                                            | —                                                                                          |
| [REQ-FILE-001](../requirements/file-browser.md)         | 2    | In progress | #41, #42, `file-tree`, `create-rename-api`, `delete-api`, `create-rename-ui`, `delete-ui`, `live-tree`, `read-save-api`, `editing-saving`, `browser-drafts`, `changes-on-disk` | FB-26 (only the backend is built)                                                                                                                                            | AC-FILE-001.20                                                                             |
| [REQ-EDIT-001](../requirements/editor.md)               | 2    | In progress | #40, #51 to #54, #56, #57, `view-modes`                                                                                                                                        | ED-19 (GC-12's exception for the merge's conflicting files), ED-25                                                                                                           | —                                                                                          |
| [REQ-EDIT-002](../requirements/preview-html.md)         | 2    | Done        | #55 to #57                                                                                                                                                                     | —                                                                                                                                                                            | —                                                                                          |
| [REQ-EDIT-003](../requirements/preview-images.md)       | 2    | Done        | #59, #60                                                                                                                                                                       | —                                                                                                                                                                            | —                                                                                          |
| [REQ-GIT-001](../requirements/commit-author.md)         | 3    | Not started | —                                                                                                                                                                              | All                                                                                                                                                                          | All                                                                                        |
| [REQ-REPO-002](../requirements/repo-credentials.md)     | 3    | Not started | —                                                                                                                                                                              | All                                                                                                                                                                          | All                                                                                        |
| [REQ-GIT-002](../requirements/git-advanced.md)          | 3, 4 | Not started | —                                                                                                                                                                              | All                                                                                                                                                                          | All                                                                                        |
| [REQ-GIT-003](../requirements/git-conflicts.md)         | 4    | Not started | —                                                                                                                                                                              | All                                                                                                                                                                          | All                                                                                        |
| [REQ-REPO-003](../requirements/repo-manage.md)          | 5    | In progress | #30, #35                                                                                                                                                                       | All except the RM-6 and RM-8 labels on the dashboard                                                                                                                         | All                                                                                        |
| [Deployment guide](../wiki/deployment.md)               | 6    | In progress | —                                                                                                                                                                              | The operator-facing parts listed in `docs/wiki/todo.md`                                                                                                                      | —                                                                                          |

## Risks

- **Locked out without SMTP.** With one administrator and no password reset, a
  forgotten password locks the operator out. REQ-AUTH-001 leaves recovering an
  instance where every administrator is lost to a separate requirement, as an
  operator task. The MVP needs at least a documented recovery procedure in the
  deployment guide.
- **Typing speed on phones.** _Resolved._ The check on a real phone (spike 3,
  `docs/wiki/typing-test.md`) found typing in large files too slow for NF-2.4,
  because of syntax highlighting. Files over 100 KB therefore open without
  highlighting on narrow screens, with a button that turns it on (ED-9a).
- **Large repositories.** Spike 4 (git at 100,000 files, A-5.14) is still to do.
  The file browser's lazy loading and the status call are the parts most at
  risk.

## Open questions

None at the moment.
