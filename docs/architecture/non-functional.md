# Front Burner — Non-functional requirements

> Status: **Draft**

This document records the non-functional requirements (NFRs) and
architecture drivers of Front Burner: scale, performance, storage, backup,
upgrades, secrets, resilience, observability, security, browser support,
accessibility and localisation. Together with
[decisions.md](decisions.md), it is the input for the architecture.

Rules are numbered **NF-x.y** so that requirements and the architecture can
cite them. Rules marked _(My call.)_ were decided during writing and not
explicitly confirmed; they can be revisited cheaply.

## Reference host

Performance targets assume a host with **2 vCPU, 4 GB RAM and an SSD**,
running the instance at the scale in NF-1. Screen targets marked "slow 4G"
use the Chrome DevTools "Slow 4G" throttling preset.

## NF-1: Scale

These are design targets: what Front Burner is built and tested for. The
product does not enforce them as hard limits.

- **NF-1.1** Up to **50 registered users** per instance.
- **NF-1.2** Up to **10 users active at the same time**.
- **NF-1.3** Up to **50 repositories per user**, so about 2,500 working
  copies per instance.
- **NF-1.4** Largest supported repository (full clone): **2 GB on disk**,
  including `.git`, and **100,000 files**.
- **NF-1.5** Largest Markdown file that can be edited: **1 MB**. Above about
  **200 KB**, the live preview may update more slowly (NF-2.5).
- **NF-1.6** Largest upload: **25 MB** per file by default; the operator can
  change it.
- **NF-1.7** Disk use grows with users, not with remotes: every user has their
  own working copy (vision goal 7), so ten users who add the same 2 GB remote
  use 20 GB. The deployment guide gives operators a sizing formula.

## NF-2: Performance

Targets are p95. "API" is measured on the server; "screen" is until the user
sees the result.

| ID     | Operation                                                    | API target                                       | Screen target                                                          |
|--------|--------------------------------------------------------------|--------------------------------------------------|------------------------------------------------------------------------|
| NF-2.1 | Open one folder in the file tree (up to 1,000 entries)        | 300 ms                                           | 1 s on slow 4G                                                         |
| NF-2.2 | Open a Markdown file (up to 100 KB)                          | 200 ms                                           | Editor usable within 1 s on desktop broadband, 2 s on slow 4G          |
| NF-2.3 | Save (D-1.1)                                                 | 200 ms                                           | The "saved" indicator updates without blocking typing                  |
| NF-2.4 | Typing in the editor (files up to 1 MB)                       | —                                                | Keystroke shown within 50 ms on a mid-range phone                      |
| NF-2.5 | Live preview refresh (files up to 200 KB)                     | —                                                | 300 ms after typing stops                                              |
| NF-2.6 | Pull or push started by the user                             | At most 1 s added on top of git's network time   | Progress shown at once                                                 |
| NF-2.7 | First load of the web client                                 | —                                                | Usable within 5 s on slow 4G                                           |

- **NF-2.8** Any operation that can take longer than about 2 seconds runs as
  a job, and its progress and result are pushed to the client. No API request
  is held open for more than 30 seconds.
- **NF-2.9** The initial JavaScript of the web client is at most **300 KB
  gzipped**. The editor, the live preview, Shiki languages and the conflict
  resolution screens are loaded on demand.
- **NF-2.10** The file tree is loaded one folder at a time. No request walks
  the whole working copy just to show a folder or a file (NF-1.4).

## NF-3: Unsaved edits on unreliable connections

- **NF-3.1** The editor always shows the save status: "Saved", "Saving…" or
  "Not saved — offline, retrying".
- **NF-3.2** When a save fails, the web client keeps the content in memory and
  retries with backoff until the connection returns. Typing is never blocked.
- **NF-3.3** Unsaved content is also written to the browser's IndexedDB, keyed
  by user, repository and file, so that it survives a reload or a crashed
  tab. It is deleted as soon as the backend confirms the save.
- **NF-3.4** A draft found in IndexedDB is offered, never applied
  automatically: when the file is opened, the user sees "You have unsaved
  changes from _&lt;time&gt;_" and chooses **Restore** or **Discard**. Applying
  an old draft silently could overwrite newer changes (D-1.3).
- **NF-3.5** All drafts are deleted from the browser on logout, and when the
  session ends and the user cannot log back in, to protect borrowed
  computers. The browser warns before closing a tab with unsaved changes.
- **NF-3.6** There is no offline mode: files that were never opened cannot
  be read or edited without a connection.

## NF-4: Database

- **NF-4.1** The database is **SQLite**, in WAL mode, stored on the data
  volume (NF-5.1). No other database is supported or tested.
- **NF-4.2** The backend runs as **a single process**. This follows from the
  in-memory key unlock (AR-31), per-working-copy serialisation of git
  operations, and the resolution lease (D-3.5a); SQLite's single writer fits
  it. Running several backend replicas is not supported.
- **NF-4.3** The job runner keeps its state in a database table and polls it.
  Queue libraries that need Postgres are not used.

## NF-5: Data layout

- **NF-5.1** The operator mounts **one volume at `/data`**. The backend
  creates and owns this layout:

  ```
  /data/
    db/front-burner.sqlite        SQLite database (+ -wal, -shm files)
    repos/<user-id>/<repo-id>/    working copies
    tmp/                          clones and uploads in progress; emptied on start
    backups/                      database snapshots (NF-6.2, NF-7.1)
    orphans/                      working copies without a repository (NF-6.4)
  ```

- **NF-5.2** Paths use internal IDs, never user or repository names. Renaming
  never moves files, and paths reveal nothing about users or content.
- **NF-5.3** `tmp/` is on the same file system as `repos/`, so that a finished
  clone is moved into place with one atomic rename and a half-finished clone
  never appears as a working copy (AR-53, AR-54).
- **NF-5.4** `FRONT_BURNER_REPOS_DIR` optionally puts working copies on another
  volume, for example a larger, slower disk while the database stays on an
  SSD. `tmp/` and `orphans/` then move with them.
- **NF-5.5** No secrets are stored on the volume. The encryption key (NF-8)
  and `FRONT_BURNER_JWT_SECRET` come from the environment, so a stolen volume
  or backup contains encrypted credentials but not the key to them.
- **NF-5.6** The container runs as a fixed non-root UID, documented in the
  deployment guide. On start the backend checks that `/data` (and the
  repositories directory) is writable; if not, it stops, and the log names
  the path and the UID it needs.

## NF-6: Backup and restore

- **NF-6.1** The operator backs up the `/data` volume (and the repositories
  directory, if separate) **and the secrets kept outside it** (NF-8). Without
  the encryption key, saved credentials cannot be decrypted (NF-8.5).
- **NF-6.2** Backing up while the instance runs is supported. Front Burner
  writes a consistent database snapshot (`VACUUM INTO`) to `/data/backups/`
  every day and keeps the last 7; the operator can change both. A file-level
  copy of a running instance may catch the live database file in an
  inconsistent state, but always includes that day's consistent snapshot.
  For a fully consistent backup, the operator stops the container first.
- **NF-6.3** Working copies are backed up on a best-effort basis. They can be
  re-cloned; what a backup protects is unpushed commits and uncommitted
  changes. A copy taken during a git operation may be damaged.
- **NF-6.4** On start, the backend compares the database with the
  repositories directory:
  - a repository whose working copy is missing or fails a quick integrity
    check gets the status **Error** ("Working copy missing or damaged"), and
    its user can re-clone it;
  - a working copy with no repository in the database is moved to
    `orphans/` and logged, never deleted, since it may hold unpushed work;
  - leftover jobs are handled as in NF-9.
- **NF-6.5** Restore: stop the container, restore the volume(s), optionally
  replace the database with a snapshot from `backups/`, start the container.
- **NF-6.6** A snapshot made by a newer version cannot be restored into an
  older one (NF-7.3).

## NF-7: Upgrades

- **NF-7.1** Database migrations run automatically on start, forward-only,
  each in a transaction. Before the first pending migration, Front Burner
  writes a **pre-upgrade snapshot** to `backups/`, named after the old
  version. If a migration fails, it is rolled back, the container stops and
  the log says so; the previous image still starts, since the database is
  unchanged.
- **NF-7.2** Versions follow semantic versioning. Any 1.x upgrades directly
  to any later 1.x. A new major version may require upgrading to the last
  minor release of the previous major first; the release notes say so.
- **NF-7.3** Downgrades are not supported. A version that finds a newer
  database schema refuses to start and logs "Database is from version X;
  restore the pre-upgrade snapshot to go back". Going back means restoring
  that snapshot, losing database changes made since the upgrade; working
  copies that no longer match are handled by NF-6.4.
- **NF-7.4** Working copies are plain git repositories and do not depend on
  the Front Burner version.
- **NF-7.5** Every encrypted value starts with a format and key version
  marker, so that the encryption scheme or key can change without a one-off
  migration (NF-8.3).
- **NF-7.6** The API is versioned (`/api/v1/…`) for native clients (vision
  goal 12). The web client is served by the same container, so it always
  matches the API; a tab left open across an upgrade notices the new version
  from a response header and asks the user to reload. Unsaved edits are
  protected by NF-3.
- **NF-7.7** There is no zero-downtime upgrade: the instance is unavailable
  while it restarts. Interrupted jobs are handled as in NF-9.

## NF-8: Secrets

- **NF-8.1** The instance encryption secret (AR-17) is provided in the
  required variable `FRONT_BURNER_ENCRYPTION_KEY`: a random value of at least
  32 characters, from which the key is derived with HKDF. The container does
  not start if it is missing, too short, or equal to
  `FRONT_BURNER_JWT_SECRET`.
- **NF-8.2** Every secret variable (`FRONT_BURNER_ENCRYPTION_KEY`,
  `FRONT_BURNER_JWT_SECRET`, `FRONT_BURNER_OIDC_CLIENT_SECRET`,
  `FRONT_BURNER_SETUP_TOKEN`, `FRONT_BURNER_METRICS_TOKEN`) also has a
  `…_FILE` variant that names a file holding the value, for Docker and
  Podman secrets.
- **NF-8.3** The key encrypts every saved credential (HTTPS credentials, SSH
  keys, provider tokens), the SMTP password, and the OIDC client secret when
  it is stored in system settings. Encryption is AES-256-GCM with a random
  nonce per value and the version marker of NF-7.5. Each value is bound to
  its owner (user ID and record ID as associated data), so a value copied
  into another row does not decrypt.
- **NF-8.4** Rotation: the operator sets the new key in
  `FRONT_BURNER_ENCRYPTION_KEY`, the old one in
  `FRONT_BURNER_ENCRYPTION_KEY_PREVIOUS`, and restarts. Front Burner
  re-encrypts every value in the background and logs when it has finished;
  the operator then removes the previous key. Nobody loses access during
  rotation.
- **NF-8.5** The database holds an encrypted check value. If the key cannot
  decrypt it, the container refuses to start, and the log explains why.
- **NF-8.6** Recovery from a lost key: the operator starts once with the new
  key and `FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm`. Front Burner deletes
  every encrypted value and stores a new check value. Then:
  - repositories, working copies, their content, unpushed commits, users and
    their logins are unaffected;
  - users enter their HTTPS credentials and provider tokens again;
  - users with SSH keys (pasted or generated) add a new key, and for a
    generated one register its public key on their provider; until then
    their repositories show "Credentials missing";
  - administrators enter the SMTP password and OIDC client secret again.

  The deployment guide tells operators to back up this key separately from
  the volume.

## NF-9: Availability and resilience

### Restart and shutdown

- **NF-9.1** The deployment guide recommends `restart: unless-stopped` and a
  stop grace period of 30 seconds (Docker's default is 10).
- **NF-9.2** On `SIGTERM`, the backend stops starting jobs and waits up to 25
  seconds for running git operations, then kills the git processes that are
  left and exits.
- **NF-9.3** The instance reports itself ready (NF-10.8) only once startup
  checks, migrations and the recovery below are done.

### Recovery on start

- **NF-9.4** Every working copy is brought back to a known state. Stale
  `index.lock` files are removed, since only the backend uses the working
  copies.
- **NF-9.5** Interrupted jobs:

  | Interrupted job                                  | On start                                                                                                         |
  |--------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
  | Clone                                            | Fails; the partial copy is removed (AR-54).                                                                       |
  | Simple-level synchronisation cycle               | A half-done merge is aborted as in D-3.1; the cycle is rescheduled. Overdue timers are spread over the first few minutes. |
  | Pull or push started by the user                 | Marked failed; the user is notified and can retry. A half-applied merge is reset to the commit recorded before it (D-4.6). |
  | Merge or rebase waiting for resolution (D-4.4)   | Left in progress; the user carries on resolving (D-4.4a).                                                        |
  | Simple-level resolution (D-3.4)                  | The resolution lease expires on its own, which undoes the half-finished resolution (D-3.5a).                     |
  | Fetch                                            | Rescheduled.                                                                                                     |
  | Conflict reminder email (D-3.7)                  | Delivered at least once: a crash between sending and recording may send a duplicate, never miss one.             |

- **NF-9.6** Key unlocks are lost on restart (AR-31); the next Simple-level
  cycle that needs one reports "saved but not uploaded" (D-2.6).

### Low disk space

- **NF-9.7** Front Burner watches free space on `/data` and on the
  repositories directory. Below the low-space threshold (default **2 GB**,
  changeable by the operator):
  - new clones and uploads are refused with "The server is running low on
    storage. Contact your administrator.";
  - administrators see a banner, the log gets a warning, and the readiness
    check reports `degraded`;
  - saves, commits and synchronisation keep working, because they protect
    the user's work.
- **NF-9.8** When the disk is full (`ENOSPC`):
  - a failed save returns "Server storage is full — not saved", and the web
    client keeps the draft (NF-3);
  - a failed git operation is handled like an interrupted one (NF-9.5) and
    its temporary files are removed;
  - SQLite rolls the transaction back, so the database stays consistent.
- **NF-9.9** There are no per-user disk quotas at launch.

## NF-10: Observability

### Backend log

- **NF-10.1** The backend logs to stdout only. There are no log files on the
  volume.
- **NF-10.2** The format is JSON lines by default;
  `FRONT_BURNER_LOG_FORMAT=pretty` gives readable output for development.
- **NF-10.3** `FRONT_BURNER_LOG_LEVEL` is `error`, `warn`, `info` (default) or
  `debug`.
- **NF-10.4** Every entry has a UTC ISO 8601 time, level, message and module,
  and when they apply `requestId`, `jobId`, `userId` and `repoId`, always as
  internal IDs.
- **NF-10.5** In addition to the existing rules against logging secrets
  (AR-17, LG-66, AO-38), logs never contain file contents; email addresses,
  repository names and file paths appear only at `debug`; remote URLs are
  always logged with embedded credentials removed.
- **NF-10.6** Every response carries an `X-Request-Id`. Error messages in the
  web client show a short reference that the user can give to their
  administrator, who finds it in the log.

### Health

- **NF-10.7** `GET /api/health/live` reports that the process is running.
- **NF-10.8** `GET /api/health/ready` checks that the database is reachable,
  migrations are done and `/data` is writable, and returns `ok`, `degraded`
  (low disk, NF-9.7) or `fail`.
- **NF-10.9** Both endpoints are unauthenticated and reveal no version or
  internal details. The image has a Docker `HEALTHCHECK` that calls
  `/api/health/ready`.

### Metrics

- **NF-10.10** Prometheus metrics are served at `/api/metrics`, off by
  default. Setting `FRONT_BURNER_METRICS_TOKEN` enables them, and requests
  must send it as a bearer token.
- **NF-10.11** Metrics cover HTTP latency by route, job queue depth, job
  durations and failures by job type, git operation durations, clones
  running and waiting, free disk space and active sessions. No metric has a
  per-user label.

## NF-11: Security baseline

These rules add to the security rules already in the requirements.

### HTTP headers

- **NF-11.1** The web client is served with this Content Security Policy:

  ```
  default-src 'none'; script-src 'self'; style-src 'self' 'nonce-…';
  img-src 'self' blob: data:; connect-src 'self'; font-src 'self';
  manifest-src 'self'; worker-src 'self'; base-uri 'none';
  form-action 'self'; frame-ancestors 'none'; object-src 'none';
  require-trusted-types-for 'script'
  ```

  - The backend puts a fresh nonce into `index.html` for every request, used
    by Angular (`ngCspNonce`) and CodeMirror (`EditorView.cspNonce`). There is
    no `'unsafe-inline'` and no `'unsafe-eval'`.
  - The Shiki + remark + Angular spike (D-7.8) confirms that this policy,
    including Trusted Types, works.
  - `img-src` is revisited by the image loading requirement (D-7.7).
- **NF-11.2** Other headers: `Strict-Transport-Security` (when the request
  arrived over HTTPS), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, a `Permissions-Policy` that denies every
  feature, `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Resource-Policy: same-origin`.
- **NF-11.3** Repository files served as they are (uploads, images, SVG,
  HTML, …) are sent with `Content-Security-Policy: default-src 'none';
  sandbox` and `X-Content-Type-Options: nosniff`; non-image files are also
  sent with `Content-Disposition: attachment`. An uploaded SVG or HTML file
  can never run script on the instance's origin.

### Limits

- **NF-11.4** In addition to LG-65, AO-37 and AR-55: 600 API requests per user
  per minute; 60 requests per IP address per minute on unauthenticated
  endpoints; at most 3 clones waiting or running per user. Refused requests
  get `429` with `Retry-After`.
- **NF-11.5** Request bodies are limited to 2 MB for JSON (enough for a 1 MB
  Markdown file, NF-1.5) and to the upload limit (NF-1.6) for uploads.

### Git

- **NF-11.6** Git may use only the `https` and `ssh` protocols
  (`protocol.allow=never` with an allow-list): no `file://`, `ext::`, `git://`
  or plain `http`. This complements the address restrictions of AR-57.
- **NF-11.7** Git runs with hooks disabled (`core.hooksPath=/dev/null`), no
  system or global configuration, `GIT_TERMINAL_PROMPT=0` and a cleaned
  environment.
- **NF-11.8** Every git operation has a timeout: the clone timeout for clones
  (AR-51), and 5 minutes by default for all other operations, changeable by
  the operator.

### Supply chain and container

- **NF-11.9** Lockfiles are committed and CI installs with `npm ci`. Renovate
  or Dependabot proposes dependency updates.
- **NF-11.10** **Trivy** runs in the CI/CD pipeline:
  - on the dependencies (lockfiles), failing the build on a high or critical
    vulnerability in a production dependency;
  - on the built container image.
- **NF-11.11** The image is built on a slim base with only Node.js, git and
  `openssh-client`, and runs as a fixed non-root UID (NF-5.6).
- **NF-11.12** Every release publishes an SBOM (CycloneDX), is signed with
  **cosign**, and comes with build provenance.
- **NF-11.13** The compose example in the deployment guide runs the container
  with a read-only root file system, `/tmp` as a tmpfs, `cap_drop: ALL` and
  `no-new-privileges`. Front Burner must work in that setup.

## NF-12: Browser and device support

- **NF-12.1** Front Burner supports the browsers that the Angular version it
  uses supports: the **Baseline Widely available** set of Chrome, Edge,
  Firefox and Safari on desktop and mobile, including Chrome on Android,
  Safari on iOS and iPadOS, and Samsung Internet. The window moves with
  Angular upgrades.
- **NF-12.2** CI runs end-to-end tests (Playwright) in Chromium, Firefox and
  WebKit on desktop, and in Chromium and WebKit with a phone-sized viewport.
  Before each release, the web client is checked by hand on a real iPhone and
  a real Android phone.
- **NF-12.3** Not supported: Internet Explorer, legacy Edge, browsers with
  JavaScript disabled, and in-app webviews (they usually work but are not
  tested).
- **NF-12.4** The smallest supported screen is **320 CSS pixels** wide.
  Nothing scrolls sideways at that width, except content that must, such as
  wide tables or code blocks in the preview.
- **NF-12.5** Touch, mouse and keyboard are all first-class. Every action can
  be done by touch alone. The editor stays usable with the on-screen
  keyboard open: the toolbar and the cursor are not hidden behind it.
- **NF-12.6** Portrait and landscape are both supported on phones and
  tablets.

## NF-13: Accessibility

- **NF-13.1** The web client meets **WCAG 2.2 level AA**, including the
  editor, the live preview and the conflict resolution screens, with one
  exception: the **three-way merge editor** has a best-effort target.
- **NF-13.2** _(My call.)_ The three-way merge editor must still be usable
  with the keyboard alone, and **Edit conflict markers**, which uses the
  normal editor and meets AA, is always offered next to it at the Advanced
  level. Every Advanced user therefore has an accessible way to resolve
  conflicts.
- **NF-13.3** Everything can be done with the keyboard alone, with a visible
  focus indicator and no keyboard traps. In the editor, `Tab` inserts a tab;
  `Esc` then `Tab` moves focus out, as CodeMirror does by default.
- **NF-13.4** **Choose per change** has a sensible reading order and labelled
  controls for screen readers; its side-by-side layout is not the only way to
  understand it.
- **NF-13.5** Touch targets are at least 24 px (WCAG 2.5.8), and at least
  44 px on touch screens.
- **NF-13.6** Dragging is never the only way to do something, for example
  resizing panes or moving files (WCAG 2.5.7).
- **NF-13.7** `prefers-reduced-motion` is respected. Colour is never the only
  signal, for example in diffs and conflict markers.
- **NF-13.8** axe-core runs in the end-to-end tests and fails the build on
  any violation, except in the three-way merge editor. Before each release
  there is a manual pass with the keyboard alone, VoiceOver on iOS and NVDA
  on Windows.

## NF-14: Localisation

- **NF-14.1** At launch the UI, emails and automatic commit messages (D-2.3)
  are in English only.
- **NF-14.2** The web client is ready for translation from the start:
  - every UI string goes through **Transloco**, which loads translation files
    on demand and switches language at run time without a reload;
  - plurals and similar forms use ICU message format
    (`@jsverse/transloco-messageformat`); strings are never built by
    concatenation;
  - dates and numbers are formatted in the browser's locale.
- **NF-14.3** API errors are a stable code plus parameters, with an English
  message only as a fallback. Clients turn codes into text, so translations
  live in the clients.
- **NF-14.4** Content may be in any language. Markdown files and file names
  may use any Unicode, including right-to-left scripts; the editor and the
  live preview handle bidirectional text.

## Consequences for the architecture

- **Single process.** One NestJS process owns the database, the job runner,
  git operations and in-memory key unlocks (NF-4.2). No design needs to
  coordinate several backend replicas.
- **Job runner on SQLite.** A small runner that polls a jobs table, with
  startup recovery for each job type (NF-9.5), graceful shutdown (NF-9.2)
  and per-user clone limits (NF-11.4).
- **Git engine.** Runs the `git` command-line program under a hardened
  configuration (NF-11.6, NF-11.7) with timeouts (NF-11.8), one operation at
  a time per working copy, and recovers working copies on start (NF-9.4).
  Folder listings and status must stay fast at 100,000 files (NF-1.4,
  NF-2.10).
- **Startup sequence.** Check configuration and secrets (NF-8.1, NF-8.5) →
  check the volume (NF-5.6) → pre-upgrade snapshot and migrations (NF-7.1) →
  key rotation if requested (NF-8.4) → working copy and job recovery
  (NF-6.4, NF-9.4, NF-9.5) → ready (NF-9.3).
- **Encryption module.** One shared module for every encrypted value, with
  versioned values, key rotation and the check value (NF-7.5, NF-8).
- **Serving the web client.** The backend serves `index.html` itself, to add
  the CSP nonce (NF-11.1) and the version header (NF-7.6). Repository files
  go through a separate endpoint with sandboxing headers (NF-11.3).
- **Long operations as jobs.** Anything that can exceed about 2 seconds is a
  job whose progress goes through the push channel (NF-2.8).
- **Web client.** Lazy-loaded feature areas within the bundle budget
  (NF-2.9), a save queue with IndexedDB drafts (NF-3), Transloco (NF-14) and
  mapping of API error codes to text (NF-14.3).
- **Disk monitor.** A periodic free-space check that feeds the low-space
  rules, the readiness check and metrics (NF-9.7, NF-10.8, NF-10.11).
- **Spikes.** The Shiki + remark + Angular spike (D-7.8) also confirms the
  CSP with nonces and Trusted Types (NF-11.1).

## Open questions

None at the moment.
