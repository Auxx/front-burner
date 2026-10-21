# Front Burner — Glossary

> Status: **Draft**

This glossary defines the terms used in Front Burner's documentation, code and
UI. Where a word has more than one common meaning, the glossary picks one and
lists the words to avoid.

Terms are grouped by area. Within each group they are listed in a logical
order rather than alphabetically.

## Naming the product

Two vocabularies meet in this repository:

- **NX vocabulary**, which describes how the source code is organised
  (workspace, project, application, library);
- **product vocabulary**, which describes what Front Burner does and who uses
  it.

To keep them apart:

- Front Burner as a whole is called **the product** (or simply "Front
  Burner"). It is never called "the project" or "the application".
- A running deployment of the product is an **instance**.
- "Workspace", "project", "application project" and "library project" are
  used **only** in their NX meaning, and only in developer documentation.
- In product documentation and the UI, the user's things are **repositories**,
  never "projects" or "workspaces".

## Development (NX)

**Workspace**
: The NX monorepo that contains all of Front Burner's source code: every
project, shared configuration and tooling. Synonym: _the codebase_. _Avoid_
using "workspace" for anything user-facing.

**Project**
: A distinct unit of code inside the workspace, as defined by NX. Every
project is either an application project or a library project. Always used
in its NX sense; see [Naming the product](#naming-the-product).

**Application project**
: A project that builds into something deployable or runnable, such as the
backend (NestJS) or the web client (Angular).

**Library project**
: A project that holds code shared by other projects and is not deployed on
its own.

## Product and deployment

**Front Burner** / **the product**
: The self-hosted, browser-based Markdown editor built in this workspace,
taken as a whole. _Avoid_: "the project", "the app", "the application".

**Instance**
: One running deployment of Front Burner (a rootless Docker container plus
its data), administered by one or more administrators.

**Backend**
: The server side of Front Burner (NestJS application project). It owns git
operations, storage, authentication and access control, and exposes the
API.

**API**
: The interface the backend exposes to clients. It must not assume that the
web client is its only consumer.

**Client**
: Any program that uses the API. Currently only the web client exists.

**Web client**
: The browser UI of Front Burner (Angular application project). Responsive;
desktop and mobile browsers are both first-class targets.

**Native client** _(future)_
: A possible desktop or mobile app that uses the same API as the web client.

## People and roles

**Persona**
: An archetypal user described in the vision: self-hoster, family and
friends, tech lead, software developer, tech writer. Personas are a design
tool, not something the product knows about.

**Operator**
: A person who installs, configures, upgrades and backs up an instance
(personas: self-hoster, tech lead). An operator usually also has an
administrator account. Operator is a real-world role; the product itself
only knows about users and administrators.

**End user**
: A person who uses Front Burner to work with Markdown files. In the product,
every end user is a **user**.

**User**
: An account on an instance. Each user sees only their own repositories,
working copies, files, user preferences and credentials.

**Administrator**
: A user account with the administrator role on an instance: manages users
and their access, sets their allowed git control levels, manages system
settings, and can add repositories on a user's behalf. _Short form_: admin.
_Avoid_: "instance admin", and using "operator" for the account.

**User preferences**
: Per-user choices that affect only that user, such as hiding non-Markdown
files or the chosen git control level for each repository. Managed by the
user, not by administrators. _Avoid_: "user settings", which is easily
confused with system settings.

## Repositories and storage

**Repository**
: A git repository that a user has added to Front Burner from a remote. The
only place where Front Burner stores the user's content. Front Burner never
creates repositories. _Avoid_: "project", "notebook", "workspace".

**Remote**
: The git repository on a git hosting provider (or any git server) that a
repository is cloned from and synchronised with. Identified by an **HTTPS
URL** or an **SSH URL**. Called the _origin_ in git terms.

**Working copy**
: A user's own clone of a repository on the instance. Two users who add the
same remote get two separate working copies.

**Clone mode**
: How a repository is cloned when it is added. One of:
- **Full clone** — all branches and history;
- **Single branch** — a shallow clone of one chosen branch only, which
limits the git workflow.

**Repository name**
: The name a user gives a repository when they add it. Unique among that
user's repositories, ignoring case.

**Repository credentials**
: What a user provides to access a remote: username + password/token (HTTPS)
or an SSH key (SSH). Belongs to one user and is never visible to others,
including administrators. Always kept as saved credentials. A **public
repository** (one anyone can read over HTTPS) can be added without any. Not
to be confused with login credentials.

**Saved credentials**
: Credentials stored, encrypted, in a user's profile and reused across that
user's repositories. Each has a name. One of: **HTTPS credentials**
(username + password/token) or an **SSH key**, which are repository
credentials, or a **provider token**. _Avoid_: "secrets", "keychain".

**SSH key**
: A saved private key and its public key, used to access remotes over SSH.
Either **pasted** by the user or **generated** by Front Burner, in which case
the user adds its public key on the git hosting provider.

**Passphrase-protected key**
: An SSH key whose private key is encrypted with a passphrase. Front Burner
never stores the passphrase.

**Key unlock**
: Decrypting a passphrase-protected key with its passphrase for the rest of a
session. The decrypted key is kept only in the backend's memory and is
forgotten when the session ends, after an idle time, or on restart.

**Known host**
: An SSH server host key fingerprint that a user has accepted. Stored per
user. The fingerprints of GitHub and Bitbucket are built in.

**Access check**
: A quick, read-only connection to a remote with the chosen repository
credentials (`git ls-remote`). Proves that the remote can be read and lists
its branches; does not prove write access.

**Add on behalf of a user**
: An administrator adds a repository (and chooses its clone mode) for a
user. The user must then **confirm** the repository and provide their own
repository credentials before it can be used.

**Last access time**
: When a user last opened a repository in the editor. Also set when the
repository is added, so every repository has one. Stored per user, so each
user has their own last access time for each of their repositories. _Avoid_:
"accessed", "last used", "last visited".

**Git hosting provider**
: A service that hosts remotes and pull requests. At launch: GitHub
(`github.com`) and Bitbucket Cloud (`bitbucket.org`). _Short form_: provider.

**Provider abstraction**
: The part of the backend that hides differences between git hosting
providers, so new ones can be added without changing core git or editor
code.

## Files and editing

**Markdown file**
: A file that Front Burner can create, edit, rename and delete, with syntax
highlighting and live preview.

**Front matter**
: A YAML block at the start of a Markdown file. Highlighted in the editor,
preserved on save, and not rendered as body text in the preview.

**AI-agent file**
: A Markdown file (often with front matter) used as a skill, spec or prompt
for an AI agent. Treated as an ordinary Markdown file.

**Non-Markdown file**
: Any other file in a repository (images, source code, PDFs, …). Can be
viewed in the file tree, uploaded and deleted, but not edited. Each user
can hide them in their user preferences.

**Upload**
: Adding a new non-Markdown file to a repository, for example an image to
embed in a Markdown document.

**Live preview**
: The rendered view of a Markdown file shown alongside or instead of its
source while editing.

## Git workflows

**Git control level**
: How much of git the web client shows to a user for a given repository. One
of Simple, Guided or Advanced. An administrator decides which levels each
user may use; the user picks one level per repository and it is stored as
a user preference. Levels are a frontend concern
only: the backend stores the chosen level but behaves the same for all of
them. _Short form_: level.

**Simple level**
: Git is hidden. Changes are committed and synchronised automatically on the
current branch.

**Guided level**
: Git is shown in plain language (see guided terms below), with guided
conflict help.

**Advanced level**
: Full, explicit control over branches, commits, push, pull and conflict
resolution, using standard git vocabulary.

**Synchronisation**
: Pulling changes from the remote and pushing local commits to it. Automatic
at the Simple level; explicit at the others. _Short form_: sync.

**Fetch**
: Downloading new commits from the remote without changing the user's files
or branch. Front Burner fetches often, at every level, to warn about remote
changes early.

**Automatic commit**
: A commit that Front Burner makes on its own at the Simple level, after a
minute without changes. Its message names the changed files and ends with a
`Front-Burner-Auto-Commit` trailer.

**Pull request**
: A request, created on a git hosting provider, to merge one branch into
another.

**Provider token**
: A personal access token for a git hosting provider's API, saved in a
user's profile and used only to open pull requests. Pushing still uses
repository credentials.

### Guided-level terms

These are the plain-language names the Guided level uses for git concepts.
They are UI labels, not separate concepts.

| Guided term           | Git concept                  |
|-----------------------|------------------------------|
| **Draft**             | Branch                       |
| **Start a new draft** | Create a branch              |
| **Save version**      | Commit                       |
| **Submit for review** | Push and open a pull request |

## Conflicts

**Conflict**
: A situation in which local and remote changes to the same file cannot be
combined automatically.

**Conflict episode**
: At the Simple level, the time from the first automatic pull that conflicts
until the user's changes are pushed. One reminder email is sent per episode.

**Base / Ours / Theirs**
: The git terms for the three versions of a conflicting file: the common
ancestor (base), the user's local version (ours) and the incoming version
(theirs). The backend exposes every conflict in this form. Used in the API,
code and Advanced-level UI.

**Mine**
: The UI word for the user's own, personal artefacts, such as their version
of a conflicting file (git's _ours_). Used in place of "ours", which
suggests something shared.

**Resolution method**
: A way of resolving a conflict in the web client. Which methods are offered
depends on the git control level. The methods are:
- **Choose a whole file** — keep mine or theirs for the entire file;
- **Keep both** — keep theirs in place and save mine as a copy next to it;
- **Choose per change** — pick mine, theirs or both for each conflicting
block;
- **Three-way merge editor** — base, ours and theirs plus an editable
result;
- **Edit conflict markers** — edit the file with highlighted `<<<<<<<`
markers;
- **Resolve on the provider** — push to a branch, open a pull request and
resolve on the git hosting provider.

## Authentication and administration

**Login method**
: How a user signs in to an instance: **username + password** or **OIDC**.

**Username**
: The name a password user signs in with. The username is always the user's
email address.

**Login credentials**
: What a user signs in to Front Burner with. Not to be confused with
repository credentials.

**Password user**
: A user who signs in with username + password. Always created by an
administrator; never self-registered.

**Password policy**
: The rules that every password of a password user must meet when it is set
(see [REQ-AUTH-002](../requirements/auth-password-policy.md)). The same on
every instance; administrators cannot change it. It is not checked at login.

**Invitation**
: The email an instance sends to a new password user. Following it starts
onboarding.

**Onboarding**
: The first-time flow in which an invited user sets their own password. Not
to be confused with administrator onboarding.

**Administrator onboarding**
: The one-time flow that creates the first administrator of a new instance,
either on the Administrator onboarding page or through environment
variables. Once it is completed, it is disabled for good. _Short form_:
admin onboarding.

**Setup token**
: A secret the operator sets in an environment variable of the container. It
must be entered on the Administrator onboarding page, so that only the
operator can create the first administrator.

**OIDC user**
: A user who signs in through an OpenID Connect provider.

**Automatic registration**
: A system setting. When enabled, anyone who authenticates with the OIDC
provider gets an account on first login; when disabled, only emails
added by an administrator can sign in through OIDC.

**Disabled user**
: A user whose account an administrator has disabled. The account and its
data are kept, but the user cannot log in or reset their password, and all
their sessions are revoked (see
[REQ-AUTH-003](../requirements/auth-login.md)). _Avoid_: "deleted",
"blocked", "locked".

**Session**
: One login of one user on one client, stored by the backend so that it can
be revoked. Ends when it expires, the user logs out, or it is revoked.

**Auth token**
: A short-lived signed JWT that a client sends with every API request.
Belongs to one session. _Avoid_: "access token", "session token".

**Refresh token**
: A long-lived secret that a client exchanges for a new auth token when the
current one expires. Belongs to one session. The web client keeps it in an
`HttpOnly` cookie.

**Reset code**
: A six-character one-time code emailed to a password user who forgot their
password, so that they can set a new one. _Avoid_: "reset token",
"confirmation code".

**Login audit log**
: The database record of every login attempt, with its outcome and the
detailed reason for a failure. Users see only generic errors; the reasons are
kept here.

**System settings**
: Instance-wide configuration managed by administrators, such as outgoing
mail (SMTP) and automatic registration. _Avoid_: "instance settings".

## Open questions

None at the moment.
