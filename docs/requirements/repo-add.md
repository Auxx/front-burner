# REQ-REPO-001: Add a repository

> Status: **Accepted**

## Summary

A user adds a repository on their own, without help from an administrator, on
the **Add repository** page. The page is a single form where the user:

- enters the **remote URL** (HTTPS or SSH);
- names the repository;
- picks **repository credentials**: saved credentials from their profile, or new
  ones. For SSH they can also paste a key or let Front Burner generate one. A
  public repository over HTTPS can be added without credentials;
- chooses a **clone mode** and, for _Single branch_, the branch;
- chooses the **git control level** for the repository.

When the user submits the form, the backend checks every field and runs an
**access check** against the remote. If the remote can be reached and read, the
backend creates the repository with the status **Cloning**, starts the clone in
the background and responds right away. The user is sent to the dashboard, where
they can follow the clone.

Repositories that an administrator adds on a user's behalf are covered by a
separate requirement.

## Context

- Front Burner never creates repositories (vision goal 1). The user must bring a
  remote that already exists and credentials that can read it.
- Many users have several repositories on the same provider. Saving credentials
  in the user's profile means they enter a token or key once and reuse it. Saved
  credentials are private to their owner, administrators included (vision goal
  7).
- Users with low technical skill may not have an SSH key. Front Burner can
  generate one for them; they only have to add its public key on the provider.
- Mistakes such as a wrong URL, a wrong token or a missing key are common. They
  should be reported on the form, while the user is still there to fix them, not
  later as a failed clone. Cloning can take minutes, so only a quick access
  check runs while the user waits; the clone itself runs in the background.
- A passphrase-protected SSH key is only useful if the passphrase is not stored
  next to the key. Asking for it on every git operation would break automatic
  synchronisation and background pulls (vision goals 4 and 5). The key is
  therefore unlocked once per session and kept only in memory.
- Read access is enough to add a repository. Some users only want to read a
  repository, or plan to change its remote later. Push permissions and changing
  remotes are covered by a separate requirement.
- Self-hosters often run git servers on their local network, so private network
  addresses are allowed.
- The API must not assume that the web client is its only consumer (vision goal
  12). Every rule here is enforced by the backend.

## Terms

**Add repository page**
: The page described in this requirement. Reached from **Add repository** on the
  dashboard (DS-14) and from the repository management page.

**Repository name**
: The name a user gives a repository when they add it. Unique among that user's
  repositories. Shown on the dashboard and on the repository management page.

**Saved credentials**
: Repository credentials stored in a user's profile and reused across that
  user's repositories. One of:

- **HTTPS credentials**: a name, a username and a password or token;
- **SSH key**: a name, a private key, its public key, and whether it is
  passphrase-protected. An SSH key is either _pasted_ by the user or _generated_
  by Front Burner.

**Passphrase-protected key**
: An SSH key whose private key is encrypted with a passphrase. Front Burner
  never stores the passphrase.

**Key unlock**
: Decrypting a passphrase-protected key with its passphrase for the rest of the
  user's session. The decrypted key is kept only in the backend's memory.

**Access check**
: A quick, read-only connection to the remote with the chosen credentials (in
  git terms, `git ls-remote`). It proves that the remote exists and can be read,
  and lists its branches. It does not prove write access.

**Known host**
: An SSH host key fingerprint that a user has accepted for a host. Stored per
  user.

## Requirements

### General

- **AR-1** The Add repository page needs a login. A visitor who is not logged in
  is sent to the login page as in LG-4. Its route is `/repositories/new`. _(My
  call.)_
- **AR-2** Every user, administrator or not, can add repositories for
  themselves. The repository, its working copy and any credentials saved through
  this page belong to the logged-in user only.
- **AR-3** The backend enforces every rule in this requirement. The web client
  checks the form so that the user gets quick feedback, but does not replace the
  backend checks (vision goal 12).
- **AR-4** The page is fully usable in desktop and mobile browsers. Nothing
  scrolls sideways on a phone-sized screen.

### Form layout

- **AR-5** The form has these fields, in this order:
  1. **Remote URL** (AR-8 to AR-12);
  2. **Repository name** (AR-13 to AR-15);
  3. **Credentials** (AR-16 to AR-32), whose content depends on the protocol of
     the remote URL;
  4. **Clone mode** and, for _Single branch_, **Branch** (AR-33 to AR-37);
  5. **Git control level** (AR-38 to AR-40);

  and two buttons: **Add repository** (submit) and **Cancel**.
- **AR-6** Each field shows its validation error next to it once the user has
  left the field or tried to submit. Errors returned by the backend are shown
  next to the field they concern, or above the buttons when they concern no
  single field.
- **AR-7** **Add repository** is disabled while:
  - any field is invalid or a required field is empty;
  - a request from this form is in progress (the branch list, generating a key,
    or the submit itself);
  - an access check is still needed and has not passed, where the form requires
    one (AR-35).

  Every other control of the form stays enabled while the branch list loads, but
  the whole form is read-only while the submit request is in progress.

### Remote URL

- **AR-8** The remote URL is required and at most 2048 characters long. Leading
  and trailing spaces are removed.
- **AR-9** Only these forms are accepted:
  - **HTTPS**: `https://host[:port]/path`;
  - **SSH**: `ssh://[user@]host[:port]/path`, or the scp-like form
    `[user@]host:path`.

  `http://`, `git://`, `file://`, local paths and every other scheme are
  rejected with the message "Use an HTTPS or SSH URL". The path must not be
  empty. URLs with a query string or a fragment are rejected.
- **AR-10** An HTTPS URL that contains a user name or password
  (`https://user:token@host/…`) is rejected with the message "Don't put
  credentials in the URL. Use the credentials fields below." Remote URLs are
  therefore stored without secrets (see also DS-19).
- **AR-11** The protocol of a valid URL decides which credentials fields are
  shown (AR-16). There is no separate protocol selector. Until the URL is valid,
  the credentials section shows "Enter the remote URL first".
- **AR-12** When the URL is valid and the user already has a repository with the
  same remote, the form shows a warning under the URL: "You already have this
  remote as _&lt;name&gt;_." (all names, if there are several). The warning does
  not block submitting. Two remotes are the same when their host (ignoring case)
  and their path (without a trailing `/` or `.git`) match, whatever the
  protocol, user and port. This is the same normalisation as the remote shown on
  the dashboard (DS-18). _(How the web client learns about existing remotes is
  left to the builder.)_

### Repository name

- **AR-13** When the user enters a valid remote URL and has not edited the name
  yet, the name is filled in with the last segment of the URL's path, without
  `.git`. Once the user edits the name, changing the URL no longer changes it.
- **AR-14** The name is required and, after removing leading and trailing
  spaces, 1 to 100 characters long. It must not contain control characters.
- **AR-15** The name must be unique among the user's repositories, ignoring
  case. A name that is taken shows "You already have a repository named
  _&lt;name&gt;_". The web client checks this while the user types; the backend
  checks it again on submit. _(The mechanism of the early check is left to the
  builder.)_

### Credentials: common rules

- **AR-16** For an HTTPS URL the credentials section shows the HTTPS options
  (AR-19 to AR-22); for an SSH URL, the SSH options (AR-23 to AR-32). When the
  protocol of the URL changes, the other protocol's choices are cleared.
- **AR-17** Saved credentials are encrypted at rest with an instance secret.
  Passwords, tokens and private keys are never returned by the API after they
  are saved, never written to logs, and never passed to git on the command line
  or inside a URL. _(How the instance secret is provided is left to the builder
  and the deployment guide.)_
- **AR-18** Saved credentials names are required, 1 to 100 characters long, and
  unique, ignoring case, among the user's saved credentials of the same kind
  (HTTPS credentials or SSH keys).

### Credentials: HTTPS

- **AR-19** The user chooses one of:
  - **Use saved credentials**: a dropdown listing the user's saved HTTPS
    credentials by name and username. Shown only when the user has at least one.
    It is the default when shown.
  - **Add new credentials**: the default when the user has none.
  - **No credentials (public repository)**: no fields. A hint says "For
    repositories anyone can read. You will need credentials to push changes."
- **AR-20** **Add new credentials** shows these fields, all required:
  - **Credentials name** (AR-18);
  - **Username**: at most 256 characters;
  - **Password or token**: masked, with a show/hide toggle, at most 4096
    characters. A hint says that GitHub and Bitbucket need an access token, not
    the account password.
- **AR-21** New HTTPS credentials are saved to the user's profile only when the
  submit succeeds (AR-44). If the submit fails, nothing is saved.
- **AR-22** A repository added with **No credentials** is stored without
  credentials, and git connects to the remote anonymously. If the access check
  is refused, the user is told "This repository needs credentials." on the
  credentials section. There is no such option for SSH, because SSH servers
  practically always require a key. _(My call.)_ Adding credentials to the
  repository later is covered by [REQ-REPO-002](repo-credentials.md).

### Credentials: SSH

- **AR-23** The user chooses one of:
  - **Use a saved key**: shown only when the user has at least one saved SSH
    key. It is the default when shown.
  - **Paste a key**: the default when the user has no saved key.
  - **Generate a key**.
- **AR-24** **Use a saved key** shows a dropdown listing the user's saved SSH
  keys by name, with key type and the public key's SHA256 fingerprint. Keys that
  are passphrase-protected are marked with a lock and the label "Passphrase".
- **AR-25** When the chosen saved key is passphrase-protected:
  - if it is already unlocked in the current session (AR-31), the form shows
    "Unlocked for this session" and no passphrase field;
  - otherwise the form shows a required, masked **Passphrase** field below the
    dropdown.
- **AR-26** **Paste a key** shows:
  - **Key name** (required, AR-18);
  - **Private key**: a required multi-line text field for a private key in
    OpenSSH or PEM format, at most 16 KB;
  - **Passphrase**: optional and masked. Required when the pasted key is
    encrypted.
- **AR-27** The backend accepts Ed25519, ECDSA and RSA keys of at least 2048
  bits, and rejects DSA keys and anything it cannot parse. It checks that the
  passphrase opens an encrypted key, and rejects a passphrase given for a key
  that is not encrypted. These errors are reported on the private key or
  passphrase field. _(My call.)_
- **AR-28** A pasted key is saved to the user's profile only when the submit
  succeeds (AR-44). It is saved with its public key, worked out by the backend,
  and with whether it is passphrase-protected. The private key is stored in its
  encrypted form and the passphrase is never stored.
- **AR-29** **Generate a key** shows a required **Key name** field and a
  **Generate** button. When the user presses **Generate**:
  - the backend generates an Ed25519 key pair without a passphrase and saves it
    to the user's profile right away, because the user has to add its public key
    on the provider before the access check can pass;
  - the form replaces the button with the **public key** (read-only, in
    `authorized_keys` format), a **Copy** button, and instructions: "Add this
    key to your git server, for example as a deploy key on GitHub or an access
    key on Bitbucket. Give it write access if you want to push changes.";
  - the form shows a required checkbox, "I have added this key to my git
    server".

  The public key comment is `front-burner@<instance host>`. _(My call.)_
- **AR-30** A key is generated at most once per visit to the page. If the user
  then switches to another option, the generated key stays in their profile and
  appears under **Use a saved key**. Leaving the page does not delete it.
- **AR-31** Key unlock:
  - the first time a git operation in a session needs a passphrase-protected key
    that is not unlocked, the backend refuses it with an error that asks for the
    passphrase, and the client asks the user for it;
  - a correct passphrase unlocks the key for that session. The backend keeps the
    decrypted key only in memory and never writes it or the passphrase to disk,
    the database or logs;
  - the unlock ends when the session ends (logout, expiry or revocation, as in
    REQ-AUTH-003), when the key has not been used by a git operation of that
    session for the unlock idle time, or when the backend restarts. Requests
    that do not use the key, such as status polling (DS-23), do not keep it
    unlocked. The unlock idle time defaults to 1 hour and can be changed by the
    operator. _(My call.)_
  - a key unlocked in one session is not unlocked in the user's other sessions.

  On this page, a passphrase given for a saved key (AR-25) or a pasted key
  (AR-26) unlocks that key for the session as soon as it has been checked. How
  other pages ask for the passphrase is covered by
  [REQ-REPO-002](repo-credentials.md).
- **AR-32** Host keys:
  - Front Burner ships with the published host key fingerprints of `github.com`
    and `bitbucket.org`, which every user trusts. The operator can replace or
    extend this list through configuration, so that a provider's key rotation
    does not have to wait for an upgrade. _(My call.)_
  - when the access check meets a host that the user has not accepted yet, it
    stops and returns the host's key type and SHA256 fingerprint. The web client
    shows them in a dialog, "Do you trust this server?", with **Trust** and
    **Cancel**;
  - **Trust** saves the fingerprint as a known host for that user, host and
    port, and runs the access check again;
  - when a host's key does not match the built-in or accepted fingerprint, the
    access check fails with "The server's identity has changed. This may be an
    attack." There is no option to accept the new key on this page. _(Managing
    known hosts is out of scope.)_

### Clone mode and branch

- **AR-33** Clone mode is a choice between **Full clone** (default) and **Single
  branch**, each with a one-line description: "All branches and history" and
  "One branch, latest commit only. Faster, but limits the git workflow."
- **AR-34** Choosing **Single branch** shows:
  - a required **Branch** dropdown (AR-35);
  - the warning: "A single-branch clone contains only the chosen branch and its
    latest commit. Other branches and older history won't be available, and some
    git operations will be limited.";
  - a required checkbox, "I understand".
- **AR-35** The **Branch** dropdown is filled from an access check. The web
  client runs it when Single branch is chosen and the URL and credentials are
  valid, and again when the URL or the credentials change. _(My call: the
  timing, such as a short delay after typing stops, is left to the builder.)_
  While it runs the dropdown shows a loading state. When it passes, the dropdown
  lists the remote's branches, sorted by name, with the remote's default branch
  preselected. When it fails, the error is shown under the dropdown, with **Try
  again**.
- **AR-36** For a full clone, the working copy checks out the remote's default
  branch.
- **AR-37** An empty remote (no branches) can be added with **Full clone**.
  **Single branch** is not possible for it: the branch dropdown shows "This
  repository has no branches". _(My call.)_

### Git control level

- **AR-38** The **Git control level** dropdown lists the levels that the
  administrator allows the user, in the order Simple, Guided, Advanced, each
  with a one-line description.
- **AR-39** The default is the highest level the user is allowed, where Simple
  is the lowest and Advanced the highest.
- **AR-40** When the user is allowed only one level, the dropdown is hidden and
  that level is used. The backend refuses a level the user is not allowed
  (vision goal 4).

### Submit

- **AR-41** On submit, the backend:
  1. checks every field again as in AR-8 to AR-40;
  2. runs the access check with the chosen credentials, unlocking a
     passphrase-protected key first if a passphrase was given;
  3. for Single branch, checks that the branch exists on the remote;
  4. if everything passes, does AR-44.

  The submit is all-or-nothing: if any step fails, nothing is saved and no
  repository is created, except for a key generated earlier (AR-29) and a known
  host the user trusted (AR-32).
- **AR-42** The access check gives up after 30 seconds. _(My call.)_ Its
  failures are reported on the form with these messages:

  | Failure                                | Message                                                                                                                    | Shown at      |
  | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------- |
  | Host not found or not reachable        | "Can't reach _&lt;host&gt;_. Check the URL."                                                                               | Remote URL    |
  | Timeout                                | "_&lt;host&gt;_ didn't answer in time. Try again later."                                                                   | Above buttons |
  | TLS certificate not valid              | "The server's certificate isn't trusted."                                                                                  | Remote URL    |
  | Authentication failed or access denied | "These credentials can't access the repository." (for a generated key, also: "Has the key been added to your git server?") | Credentials   |
  | Repository not found                   | "Repository not found, or these credentials can't see it."                                                                 | Remote URL    |
  | Wrong passphrase                       | "Wrong passphrase."                                                                                                        | Passphrase    |
  | Unknown SSH host key                   | dialog as in AR-32                                                                                                         | —             |
  | Changed SSH host key                   | as in AR-32                                                                                                                | Remote URL    |
  | Branch not found                       | "This branch no longer exists on the remote."                                                                              | Branch        |
  | Anything else                          | "Something went wrong while contacting the remote."                                                                        | Above buttons |

  The messages never contain credentials. The full git error is written to the
  backend log, with secrets removed.
- **AR-43** HTTPS connections check the server's TLS certificate against the
  certificate authorities trusted by the container. There is no option to skip
  the check. _(My call: operators who use a private certificate authority add it
  to the container; the deployment guide should explain how.)_
- **AR-44** When the submit succeeds, the backend, in one step:
  - saves any new HTTPS credentials or pasted SSH key to the user's profile;
  - creates the repository for the user with its name, remote URL, the chosen
    saved credentials (none for a public repository), clone mode, branch (Single
    branch only) and git control level, with the status **Cloning**;
  - sets its last access time to now (DS-7);
  - starts the clone in the background;

  and responds without waiting for the clone.
- **AR-45** After a successful submit, the web client goes to the dashboard and
  shows the message "Cloning _&lt;name&gt;_. It will be ready to open soon." The
  new repository is at the top of the recent repositories with the status
  **Cloning**, and becomes openable without a reload when the clone ends
  (DS-23).
- **AR-46** If the submit request fails, the form keeps everything the user
  entered, except passphrases, and shows the error as in AR-6 and AR-42.

### Cancel and leaving the page

- **AR-47** **Cancel** goes back to the page the user came from, or the
  dashboard if there is none.
- **AR-48** If the user has changed any field, **Cancel**, navigating away
  inside the web client, or closing or reloading the tab asks them to confirm
  that they want to discard their changes. A generated key (AR-29) is not
  discarded (AR-30).

### Background clone

- **AR-49** The clone runs in the background, independent of the user's session
  and browser. A full clone fetches all branches and history; a single-branch
  clone fetches only the chosen branch at depth 1. When the clone uses a
  passphrase-protected key, the clone job takes its own in-memory copy of the
  decrypted key when it is queued, and drops it when the clone ends. The clone
  therefore finishes even if the session ends or the key unlock expires
  meanwhile.
- **AR-50** Submodules and Git LFS objects are not fetched. _(My call.)_
- **AR-51** A clone that has not finished within the clone timeout is stopped
  and fails. The clone timeout defaults to 30 minutes and can be changed by the
  operator. _(My call.)_
- **AR-52** The backend runs at most a limited number of clones at the same time
  on the instance; further clones wait their turn and stay **Cloning**
  meanwhile. _(My call: the limit and how it is set are left to the builder.)_
- **AR-53** When the clone succeeds, the repository becomes openable. When it
  fails, the repository gets the status **Error** with a short label, for
  example "Clone failed" or "Clone timed out", any partial working copy is
  removed, and the full git error is written to the backend log with secrets
  removed. How the user sees the full error and retries is in
  [REQ-REPO-003](repo-manage.md).
- **AR-54** A clone that is interrupted because the backend stops is treated as
  failed when the backend starts again. _(My call.)_

### Security

- **AR-55** The backend limits access checks to 30 per user per minute, so that
  the page cannot be used to scan networks or hammer remotes. Requests over the
  limit get "Too many attempts. Try again in a minute." _(My call.)_
- **AR-56** Every API call of this page acts only on the logged-in user's
  repositories, saved credentials and known hosts. A request that names another
  user's saved credentials is refused as if they did not exist.
- **AR-57** Any user can make the backend connect to any host, so the backend
  restricts which addresses git may connect to, for the access check, the clone
  and every later git operation with the remote:
  - link-local addresses (`169.254.0.0/16`, `fe80::/10`), which include cloud
    metadata services, are always blocked;
  - private network addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
    `fc00::/7`) and loopback (`127.0.0.0/8`, `::1`) are allowed by default, so
    that self-hosters can use git servers on their own network or machine;
  - an operator setting also blocks private network and loopback addresses, for
    instances where users must not reach the internal network;
  - the rules are checked against every address that the host name resolves to,
    at the time of connecting, so that a host name cannot point git at a blocked
    address.

  A blocked address fails the access check with "Can't reach _&lt;host&gt;_.
  Check the URL.", the same message as an unreachable host, so that it does not
  reveal what is on the network.

## Acceptance criteria

- **AC-REPO-001.1** A logged-in user opens the Add repository page from **Add
  repository** on the dashboard. A visitor who is not logged in is sent to the
  login page.
- **AC-REPO-001.2** **Add repository** is disabled while the form is empty or
  invalid, and while a submit is in progress. Submitting twice quickly creates
  only one repository.
- **AC-REPO-001.3** `http://`, `git://` and `file://` URLs, local paths, and an
  HTTPS URL with a token in it are rejected with the messages of AR-9 and AR-10.
- **AC-REPO-001.4** Entering `https://github.com/acme/handbook.git` fills the
  name with `handbook` and shows the HTTPS options. Changing it to
  `git@github.com:acme/handbook.git` shows the SSH options. After the user edits
  the name, changing the URL no longer changes it.
- **AC-REPO-001.5** A name that the user already uses, in any letter case, is
  rejected. A remote that the user already has shows the duplicate warning, and
  the form can still be submitted with a new name.
- **AC-REPO-001.6** A user with no saved HTTPS credentials sees **Add new
  credentials** and **No credentials (public repository)** only; after adding a
  repository with them, the next visit offers **Use saved credentials** with
  them preselected.
- **AC-REPO-001.7** A public HTTPS repository can be added with **No
  credentials**, and nothing is saved to the user's profile. Choosing **No
  credentials** for a private repository reports "This repository needs
  credentials."
- **AC-REPO-001.8** A user with no saved SSH keys sees **Paste a key** and
  **Generate a key** only. A user with saved keys also sees **Use a saved key**,
  with passphrase-protected keys marked.
- **AC-REPO-001.9** Choosing a passphrase-protected saved key shows a passphrase
  field. A wrong passphrase is reported on that field. After a correct one,
  choosing the same key again in the same session shows "Unlocked for this
  session".
- **AC-REPO-001.10** After logout and login, the same key asks for its
  passphrase again. The passphrase and decrypted key cannot be found in the
  database or logs.
- **AC-REPO-001.11** A pasted encrypted key without a passphrase, a DSA key, or
  text that is not a key are rejected on the right field.
- **AC-REPO-001.12** **Generate a key** shows the public key with **Copy** and
  the instructions; **Add repository** stays disabled until "I have added this
  key to my git server" is ticked. If the key has not been added on the
  provider, submit reports that the credentials can't access the repository. The
  generated key stays in the user's saved keys even if they cancel.
- **AC-REPO-001.13** Adding an SSH remote on a host other than GitHub or
  Bitbucket for the first time shows the host fingerprint dialog. **Trust**
  continues; **Cancel** leaves the form as it was. A later attempt with a
  changed host key fails with the warning of AR-32.
- **AC-REPO-001.14** Choosing **Single branch** shows the branch dropdown,
  filled from the remote with the default branch preselected, the warning, and
  the "I understand" checkbox, which must be ticked to submit.
- **AC-REPO-001.15** The git control level defaults to the highest level the
  user is allowed. With only one allowed level, the dropdown is hidden. A
  request for a level the user is not allowed is refused by the API.
- **AC-REPO-001.16** Wrong credentials, a repository that does not exist, and an
  unreachable host are each reported on the form within 30 seconds, and nothing
  is saved: no repository, no new credentials.
- **AC-REPO-001.17** Read-only credentials are accepted.
- **AC-REPO-001.18** A successful submit lands on the dashboard with the
  "Cloning" message, the repository at the top as **Cloning**, and it becomes
  openable without a reload when the clone ends.
- **AC-REPO-001.19** A clone that fails or exceeds the clone timeout leaves the
  repository in **Error** with a short label, and no partial working copy.
- **AC-REPO-001.20** **Cancel** after changing a field asks for confirmation;
  **Cancel** on an untouched form leaves at once.
- **AC-REPO-001.21** No password, token, private key or passphrase appears in
  API responses, logs, stored remote URLs or git process arguments.
- **AC-REPO-001.22** A user cannot use, list or see another user's saved
  credentials or known hosts through the API.
- **AC-REPO-001.23** More than 30 access checks in a minute by one user are
  refused.
- **AC-REPO-001.24** A remote URL whose host is or resolves to `169.254.169.254`
  is refused with "Can't reach _&lt;host&gt;_". A git server on `192.168.x.x` or
  `localhost` can be added by default, and is refused once the operator blocks
  private network addresses.
- **AC-REPO-001.25** A clone that uses a passphrase-protected key finishes even
  if the user logs out while it is queued or running.
- **AC-REPO-001.26** The page is fully usable on a phone-sized screen.

## Out of scope

- Adding repositories on a user's behalf and confirming them (administration
  requirements).
- The repository management page, including showing clone errors in full and
  retrying a failed clone.
- Managing saved credentials and known hosts: listing, renaming, deleting,
  changing a passphrase, replacing a changed host key.
- Push permissions, changing a repository's remote, and asking for a passphrase
  on other pages.
- Commit author name and email.
- Changing a repository's name, clone mode or git control level after it is
  added.
- Adding credentials to a repository that was added without them.
- Submodules and Git LFS.

## Open questions

None at the moment.
