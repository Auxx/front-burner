# Front Burner — Product Vision

> Status: **Accepted**

## Problem

People who keep Markdown files in git repositories have no tool that is
simultaneously **Markdown-first**, **git-native**, **usable from any device**
and **self-hosted**. Existing tools each cover only part of this:

| Category                 | Strengths                                                            | Gaps                                                                                                                          |
|--------------------------|----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Basic text editors       | Simple; available on every platform; create and edit Markdown files. | Local file system only; no remote access; no git integration; no Markdown tooling (highlighting, preview).                    |
| Code editors and IDEs    | Syntax highlighting, Markdown preview, git synchronisation.          | Heavy and complex; local only; rarely usable on mobile; Markdown features and workflows are an afterthought.                  |
| Note-taking applications | Good note management; often Markdown-based.                          | Markdown is a vehicle for notes, not the focus; good ones are rarely self-hosted; rarely work with git repositories directly. |

The result: to edit a Markdown file that lives in a git repository from a phone
or a borrowed computer, a user must either install a heavy IDE (often
impossible), give their content to a third-party SaaS, or give up on git
history and synchronisation.

**Front Burner closes this gap:** a self-hosted, browser-based Markdown editor
whose only storage model is the git repository, with git workflows (branches,
commits, push/pull, conflict resolution) exposed as first-class features for
non-developers and developers alike.

## Users

Front Burner has two kinds of users: **operators**, who install and run an
instance, and **end users**, who work with Markdown files. An operator usually
also has an **administrator** account on their instance and is an end user of
it too.

| Persona            | Role     | Technical level | Primary use                                                                                          |
|--------------------|----------|-----------------|------------------------------------------------------------------------------------------------------|
| Self-hoster        | Operator | High            | Documents their infrastructure; personal note-taking; invites family and friends.                    |
| Family and friends | End user | Low             | Note-taking only.                                                                                    |
| Tech lead          | Operator | High            | Runs an instance for an organisation; gives access to team members and software developers.          |
| Software developer | End user | High            | Maintains Markdown docs across several repositories; writes skills, specs and prompts for AI agents. |
| Tech writer        | End user | Low             | Maintains Markdown docs across several repositories in an organisation.                              |

### Self-hoster

A technically capable person who runs their own services and wants to stay in
control of their data. Installs, configures, upgrades and backs up the
instance. Uses Front Burner to document their infrastructure and as a personal
note-taking app. May invite family members or friends to the instance.

### Family and friends of a self-hoster

Non-technical people invited by a self-hoster. They use Front Burner purely as
a note-taking app and should not need to understand git to use it.

### Tech lead

Installs and manages a Front Burner instance for an organisation and grants
access to team members and software developers. Cares about authentication
integration (OIDC), access control, and operational simplicity.

### Software developer

Manages and updates Markdown documents across multiple software repositories
using familiar git workflows (branches, commits, push/pull, conflict
resolution). Also writes skills, specs and prompts for AI agents, which are
typically Markdown files that live alongside the code in the same
repositories.

### Tech writer

Works in an organisation and maintains Markdown documentation across several
repositories, often the same ones the software developers use. Their
technical skill level is low: they are fluent in Markdown but not in git, yet
they still have to work within the team's git workflow (for example, working on
a branch so that developers can review changes).

### Implications for design

- **Operator and end-user concerns are separate.** Administration (user
  management, system settings) is a distinct administrator role from editing
  files.
- **Git must be both hideable and fully exposed.** Non-technical users need
  note-taking without git vocabulary; developers need explicit control over
  branches, commits and conflicts. The same product has to serve both.
- **Low git skill does not mean simple repositories.** The tech writer works in
  the same code repositories as developers and must follow team workflows
  (branches, reviews), so the simplified experience has to guide them through
  branching and conflicts, not just hide git.
- **Mobile matters most for note-taking users**; developers mostly work on
  desktop but still benefit from quick edits on mobile.
- **Developer repositories are code repositories**, not documentation-only
  repositories: Markdown files sit among source code, so Front Burner must work
  inside repos that contain many non-Markdown files.

## Goals

### 1. Git repositories are the only storage

- Front Burner manages files that live inside git repositories, and nothing
  else. There is no separate database of notes.
- A repository is added from a remote origin given as an **HTTPS URL** or an
  **SSH URL**.
- Remote authentication supports **username + password/token** (HTTPS) and **SSH
  keys** (SSH).
- Front Burner **never creates repositories**. Every repository must already
  exist on a remote.
- When a repository is added, the user picks a **clone mode**:
  - **Full clone** — all branches and history;
  - **Single branch** — a **shallow** clone of one chosen branch only. Before
    the user confirms this mode, Front Burner shows a **warning** that it
    limits the git workflow (for example, other remote branches and older
    history are not available).

  For users with low technical skill, the administrator makes this choice
  when adding the repository on their behalf.

### 2. Markdown-first editing

- Markdown editor with syntax highlighting and live preview.
- **YAML front matter** is supported (highlighted, preserved, and not rendered
  as body text in the preview). This covers AI-agent files such as skills,
  specs and prompts. AI-agent files need no special support beyond this.
- **Markdown files** can be created, edited, renamed and deleted.
- **Non-Markdown files** (images, source code, PDFs, …):
  - are **visible by default**; each user can choose to hide them in their
    user preferences;
  - **existing ones cannot be edited**, but **can be deleted**;
  - **new ones can be uploaded** (for example, images to embed in a Markdown
    document).

### 3. Available everywhere through the browser

- Fully usable in desktop and mobile browsers, remotely.
- Responsive UI; mobile is a first-class target, not an afterthought.

### 4. Git workflows with three levels of control

The same git capabilities are offered at three **git control levels**:

| Level        | Intended for                   | Experience                                                                                                                                                |
|--------------|--------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Simple**   | Family and friends             | Git is hidden. Changes are committed and synchronised (pull/push) automatically on the current branch.                                                    |
| **Guided**   | Tech writers                   | Git is visible in plain language: "Start a new draft" (branch), "Save version" (commit), "Submit for review" (push + pull request), guided conflict help. |
| **Advanced** | Software developers, operators | Full, explicit control over branches, commits, push, pull and conflict resolution.                                                                        |

Rules:

- An **administrator decides which levels each user may use**.
- Each user picks **one level per repository** from the levels allowed to
  them, as a user preference.
- The per-user, per-repository level is **stored on the backend**, which
  checks that the chosen level is one the user is allowed to use.
- **Levels are a frontend concern only.** The backend exposes one set of git
  operations regardless of level; the frontend decides which operations to
  show, how to name them, and which to run automatically.
- **Only the Simple level is automatic.** At the Guided and Advanced levels
  nothing is committed, pulled or pushed automatically: every such action is
  started by the user.

### 5. Conflict resolution

Principles:

- **Prevent first.** Fetch often (when a file is opened, and in the background
  while editing) and warn early when a file has changed on the remote.
  Fetching never changes the user's files or branch; only the Simple level's
  automatic synchronisation pulls without being asked.
- **Never lose work.** The user's state is saved before any merge or rebase,
  so every resolution can be undone.
- **Always resolvable inside Front Burner.** No user ever has to fall back to
  a terminal.
- **One conflict model on the backend.** The backend exposes each conflicting
  file as base / ours / theirs and accepts the resolved content. How
  resolution is presented is decided by the frontend, according to the git
  control level.
- **Works on mobile.** Every level offers at least one resolution method that
  works well on small screens.

Resolution methods:

| Method                      | Description                                                                                    |
|-----------------------------|------------------------------------------------------------------------------------------------|
| **Choose a whole file**     | Keep mine or keep theirs for the entire file. The only option for non-Markdown files.          |
| **Keep both**               | Keep theirs in place and save the user's version as a **copy of the file** next to it.         |
| **Choose per change**       | Pick mine / theirs / both for each conflicting block, shown side by side as rendered Markdown. |
| **Three-way merge editor**  | Base, ours and theirs, plus an editable result pane.                                           |
| **Edit conflict markers**   | Edit the file with highlighted `<<<<<<<` markers in the normal editor.                         |
| **Resolve on the provider** | Push to a branch, open a pull request, and resolve on GitHub or Bitbucket.                     |

Methods available at each git control level:

| Level        | Methods                                                                                              |
|--------------|------------------------------------------------------------------------------------------------------|
| **Simple**   | Choose a whole file; keep both.                                                                      |
| **Guided**   | Choose per change; resolve on the provider as an escape hatch.                                       |
| **Advanced** | All methods. The three-way merge editor and editing conflict markers are preferred and listed first. |

Details (merge vs rebase, screen design, how work is backed up) belong in the
requirements, not in this vision.

### 6. Pull requests ("Submit for review")

- Supported git hosting providers at launch: **GitHub** (`github.com`) and
  **Bitbucket Cloud** (`bitbucket.org`).
- Pull requests are opened with a **personal access token** that the user
  saves in their profile.
- Providers sit behind a **provider abstraction** so new ones (GitLab, Gitea,
  …) can be added later without changing the core git or editor code.

### 7. Multi-user with strict privacy and isolation

- **Everything a user does is private.** No user can see another user's
  repositories, working copies, files, user preferences or credentials.
- Each user gets their **own working copy** of every repository they add, even
  when two users clone the same remote.
- Collaboration happens **through the shared git remote**, never inside Front
  Burner.

### 8. Roles: administrator and user

- **Administrator** manages users, their access, their allowed git control
  levels, and system settings.
- An administrator can **add repositories on behalf of a user** (for users
  with low technical skill). The user then only has to **confirm** the
  repository and **provide their own credentials** (username/password or SSH
  key). In this case the administrator also chooses the clone mode.
- **Users** (non-administrators) can access only their own repositories and
  files.

### 9. Authentication

- Two login methods: **username + password** and **OIDC**.
- **Password users are invited, never self-registered:**
  1. an administrator creates the user with their email;
  2. Front Burner sends an **invitation email**;
  3. the user follows the invitation and sets their own password during
     onboarding. Administrators never set or see user passwords.

  Sending email requires an outgoing mail (SMTP) configuration in the system
  settings.
- OIDC user registration is controlled by a system setting:
  - **Automatic registration enabled** — any user who authenticates with the
    OIDC provider gets a Front Burner account on first login;
  - **Automatic registration disabled** — an administrator adds the user's
    email first; only emails added this way can log in through OIDC.

### 10. Deployment

- Runs as a **rootless Docker container**.

### 11. Secure and private by default

- Follows established security best practices (for example, protecting stored
  git credentials and keys, secure session handling, least privilege).

### 12. Architecture ready for native clients

- Desktop and mobile native apps may be added later. The backend API must not
  assume the Angular web client is its only consumer.

## Non-goals

- **Real-time collaboration inside Front Burner.** No shared editing sessions,
  no sharing files between users. Users collaborate through the git remote.
- **Editing existing non-Markdown files.** They can be uploaded or deleted,
  but not modified.
- **Storage outside git.** No local-only notes, no database-backed documents.
- **Self-registration for password users.** Only an administrator can
  create them.
- **Creating repositories.** Front Burner only clones repositories that
  already exist on a remote; it never runs `git init` or creates repositories
  on a hosting provider.
- **Special AI-agent file support** beyond Markdown and YAML front matter.
- **Backend-driven git control levels.** The backend stores the selected
  level, but it does not change git behaviour based on it.

### Not in the initial scope (future)

- Pull request support for GitLab, Gitea and other providers (the abstraction
  must allow them).
- Pull request support for self-hosted **GitHub Enterprise Server** and
  **Bitbucket Data Center**.
- Connecting to a git hosting provider by **OAuth** sign-in instead of a
  personal access token.
- Native desktop and mobile applications (the architecture must allow them).
- **Markdown-aware merging** (for example, merging front matter key by key or
  merging paragraph by paragraph) to reduce conflicts.
- **AI-suggested conflict resolution**, which the user reviews before
  accepting.

## Open questions

None at the moment.
