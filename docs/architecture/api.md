# Front Burner — API and push channel

> Status: **Draft**

How clients talk to the backend. See [overview.md](overview.md) for the
numbering conventions.

## A-3: REST API

- **A-3.1** The API is REST under `/api/v1` (NF-7.6), JSON in and out except for
  file uploads and raw file downloads. It must not assume the web client is its
  only consumer (vision goal 12). Every response, errors and `304` included,
  carries the instance's version in `X-Front-Burner-Version`, for example
  `X-Front-Burner-Version: 1.4.2`; the health endpoints and the metrics (A-3.2j)
  do not (NF-10.9). The version is fixed when the backend is built, from the
  root `package.json`'s `version`, which a release image's build sets from its
  tag; the web client's build reads the same field, so a client compares the two
  for equality only, never orders them (A-8.7). It is not an environment
  variable, so that it cannot differ from the web client's.
- **A-3.2** Long operations return `202 Accepted` with a job ID (A-1.13). A git
  job's state is read with `GET /repositories/:id/git/jobs/:jobId`: its status
  and, once it has ended, its outcome, such as a push's commits and upstream, a
  fetch's whether a remote branch moved and whether the current branch's
  upstream did, a pull's result (`up-to-date`, `fast-forward`, `merged` or
  `conflicted`) with its commits and upstream, or an error code with its params.
  A client reads it after `job.finished`, since events are not state (A-3.11).
  An operation git refused, such as a push the remote rejected, is a job that
  finished with a `failed` outcome; a job the runner failed, such as one a
  restart interrupted, reports its error code without params. Another user's
  job, or a job of another repository, is answered like a missing one. _(Plan
  57's call.)_
- **A-3.2a** `GET /repositories` answers all of the user's repositories, in any
  status, as the `RepositorySummary` of the dashboard, sorted by name ignoring
  case and then by ID (RM-5). Names are compared in TypeScript with
  `shared-util`, not with SQLite's `lower`, which folds ASCII only:
  `compareRepositoryNames` sorts with a fixed-locale collator, as file names are
  sorted (FB-17), so `É` is next to `e`, and the dashboard's ties (DS-17) use it
  too; `sameRepositoryName` is AR-15's check when adding, with Unicode case
  folding, as the web client's early check. The database's unique index stays
  ASCII-only, as a backstop. The list is not paged and its schema has no
  maximum, since a user is expected to have about 50 repositories (NF-1.3);
  adding does not enforce that number. Listing changes nothing, not even the
  last access time (DS-9). _(Plan 104's call.)_ Every `RepositorySummary`
  carries `clone` while the repository is `cloning` and its clone job has not
  ended: the job's ID, `waiting` while it is queued (AR-52) or `running`, and
  the last percentage it reported, read from the `jobs` row, for all listed
  repositories in one query. Lists follow it with the `job.progress` events of
  that job ID; the clone job reports 0 % as it starts, so that a waiting clone
  shows as running at once. Adding and cloning again answer the clone they
  queued as waiting. _(Plan 114's call.)_
- **A-3.2b** `GET /repositories/:id/details` answers what the settings page
  shows that a list entry does not, as `RepositoryDetails`: the
  `RepositorySummary` as `summary`, the clone mode, the cloned `branch` of a
  single-branch clone (else `null`), the git control level, `addedAt` and a
  failed clone's error record, `errorDetail` and `errorRequestId` (RM-10,
  RM-16), which are `null` outside the `error` status, as is every summary's
  `error`, even when a stale value is left in the row. A separate endpoint, so
  that the lists do not carry git's error text for every repository. Another
  user's repository is answered like a missing one (RM-1). _(Plan 106's call.)_
  It also answers `remoteProblems`, the stored problems of the last fetch or
  pull (`fetch`) and of the last push (`push`) that RM-8's warnings come from,
  each a `GitProblemState` with its params or `null`, and both `null` outside
  `ready`: **Review the new key** needs the new host key that the problem's
  params hold (RC-21). The params never hold a secret, and the remote's messages
  are not stored. _(Plan 120's call.)_
- **A-3.2c** `GET /repositories/:id/removal` answers what removing the
  repository would lose, as `RemovalCheckResult` (RM-18): `uncommittedFiles`
  (untracked files counted, ignored ones not), `unpushedCommits` (on `HEAD` or
  any local branch, and on no remote branch as of the last fetch), `stashes`
  (the entries of `git stash list`), `mergeInProgress`, and `unreadable`, true
  when git could not read the working copy, or its status is already "Working
  copy is missing or damaged": nothing then proves that there is nothing to
  lose, so the dialog asks for the typed name; a git failure here, a timeout
  included, is answered the same way. A repository being cloned, or whose clone
  failed, has nothing to lose, and git is not run. Work would be lost when a
  count is above 0 or a flag is true (`wouldLoseWork` in `shared/contracts`).
  The check is read-only, runs outside the working-tree lock, and never changes
  the status, not even for a working copy that git finds damaged; removing runs
  it again inside the lock. Another user's repository is answered like a missing
  one (RM-1). _(Plan 110's call.)_
- **A-3.2d** `DELETE /repositories/:id?confirmName=` removes the repository in
  any status and answers `204` (RM-17 to RM-21). When the removal check of
  A-3.2c says work would be lost, `confirmName` must be the repository's name
  exactly, spaces around it trimmed (`confirmsName` in `shared/contracts`), or
  the answer is `409 removal-needs-confirmation` with the check's answer as
  params, and nothing changes, not even its jobs. Without lost work no name is
  needed. The name is a query parameter, as a `DELETE` body is not portable. The
  check runs inside the working-tree lock, so that a file saved since the dialog
  opened is caught. The rest is **Remove repository** in A-6: the response comes
  once the working copy is moved out and the row deleted, so the repository is
  gone from every list, cannot be opened, and its name is free at once (RM-20,
  RM-21). A move that fails changes nothing but the cancelled jobs, and a row
  that cannot be deleted puts the working copy back. A request that waited for
  the working-tree lock behind the removal answers `404 not-found`
  (`WorkingTreeLock.isRemoved`). Publishes `repository.removed` to the owner.
  Another user's repository is answered like a missing one (RM-1,
  AC-REPO-003.14). _(Plan 111's call.)_
- **A-3.2e** `POST /repositories/:id/clone` clones a repository in the `error`
  status again and answers its summary, now `cloning` (`200`): **Retry clone**
  after a failed, timed out or interrupted clone (RM-11) and **Clone again**
  after a missing or damaged working copy (RM-12) are one endpoint, as the error
  code says which applies. Any other status answers `409
  repository-not-in-error` with `{ status }` (RM-2), so a second retry while the
  first clones changes nothing; so does a clone job still queued or running,
  answered with `{ status: 'cloning' }` whatever the row says. The clone uses
  the same remote, clone mode and branch and the repository's current
  credentials; a protected key not unlocked in this session answers `409
  key-locked` with the key, as adding does, so that the client unlocks it and
  sends again (RC-16). Limited as adding is: the `access-check` rate limit group
  and the clone per-user limit (RM-13). Every refusal changes nothing. Inside
  the working-tree lock and then the network lock, as removing: what is left of
  the working copy is moved into `tmp/`, and one transaction sets the status,
  clears the error record and the `sync_state` row, which describes the old
  working copy, and queues the clone with this request's ID. If that fails, the
  working copy is put back. Then, before the clone can start: the work that
  waited for the working-tree lock for the old working copy refuses with `409
  repository-not-openable` (`WorkingTreeLock.markReplaced` and `generation`);
  the repository's jobs of the `fetch` pool (fetch, pull, push) are cancelled,
  while its Delete folder jobs run on; `repository.status` is published, so that
  it comes before the clone's own end; and the delete job of **Remove
  repository** (A-6) is queued for the old working copy alone, leaving the
  trash. Kept: the name, credentials, level, commit author override, last access
  time and date added. Another user's repository is answered like a missing one
  (RM-1). _(Plan 112's call.)_
- **A-3.2f** Every endpoint of REQ-REPO-003 that names a repository answers
  another user's repository exactly as a missing one, `404 not-found` with the
  same body apart from the request ID, and changes nothing (RM-1,
  AC-REPO-003.14): the summary, A-3.2b to A-3.2e, `GET` and `PUT
  /repositories/:id/credentials`, `PUT /repositories/:id/credentials/token`, and
  `GET`, `PUT` and `DELETE /repositories/:id/commit-author`. A request body that
  would be accepted is not checked against the remote first, so the answer tells
  nothing about the repository. One server end-to-end test goes through them
  all, as a user who is not an administrator. It covers these routes only, not
  everything that A-7.5 asks for: the other routes that take an ID, such as
  `/open`, `/git/*`, the file routes and `ssh-keys/:id/unlock`, have their own
  tests or none yet. _(Plan 126's call.)_
- **A-3.2g** While the server is low on storage (`DiskMonitor.isLow()`, NF-9.7),
  the requests that start a new clone answer `507 low-storage` and change
  nothing: adding a repository (`POST /repositories`), and **Retry clone** and
  **Clone again** (A-3.2e). Both check it before a locked key's passphrase is
  asked for, so that the user does not unlock a key for nothing. Adding checks
  it after the request's own fields and before the access check, so a form error
  still comes first and the remote is not contacted for nothing, and again in
  the transaction that queues the clone, as the disk may run low while the
  access check waits for the remote; cloning again checks it after its `404` and
  `409` answers and before the working copy is moved. A clone already queued or
  running goes on. Saves, commits and synchronisation are not refused. The
  English fallback is NF-9.7's text. A `507 low-storage` is not logged as an
  unhandled exception: the disk monitor logs the state once. _(Plan 131's call:
  `507 Insufficient Storage`.)_
- **A-3.2h** `GET /instance/storage` answers `{ low }`, `DiskMonitor.isLow()` as
  of its last check, for the administrators' low-space banner (NF-9.7). It is
  `@AdminOnly()` (A-7.4), so anyone else gets `403 forbidden`. Storage belongs
  to the instance, not to a user, so it is neither part of `/me` nor under
  `/admin/`, which is for administering users and their repositories. The disk
  monitor publishes no event, so the web client reads it again from time to time
  (A-8.7). _(Plan 132's call.)_
- **A-3.2i** When the disk is full (NF-9.8), a request that writes to a working
  copy answers `507 storage-full` and leaves it as it was: a save, **Recreate
  it**, creating, renaming and deleting files and folders, resolving a conflict,
  and the git requests that write, such as a commit. A branch switch that ran
  out of space partway tells clients that files may have changed, as one killed
  at its timeout does. Adding a repository whose access check could not run
  answers it too, not `remote-failed`. A full disk is a file-system error
  `ENOSPC`, `EDQUOT` for a quota that is used up, or SQLite's `SQLITE_FULL`
  (`isStorageFull` in `server/core/storage`), or git saying "No space left on
  device" (A-5.1); `isDiskFull` in `server/core/git` tells all of them. Any such
  error that nothing mapped, such as a database write's, is answered `507
  storage-full` by the exception filter. A save writes a temporary file in
  `tmp/` and renames it over the old one, so a failed save never leaves part of
  a file. The git jobs end as `failed` with `storage-full` (A-5.1), and the web
  client offers **Try again**. Like `low-storage`, it is not logged as an
  unhandled exception. The web client keeps the draft and retries the save
  (A-8). _(Plan 133's call.)_
- **A-3.2j** `GET /api/metrics` serves Prometheus metrics in the text format
  (NF-10.10), outside `/api/v1` like the health endpoints, with no version
  header, and left out of the OpenAPI document: it is for the operator's
  scraper, not part of the API. It exists only when `FRONT_BURNER_METRICS_TOKEN`
  (or `…_FILE`, NF-8.2) is set; otherwise it is answered like any unknown route.
  The request must send the token as `Authorization: Bearer <token>`, compared
  in constant time; a missing, malformed or wrong one gets the same `401
  unauthenticated` with `WWW-Authenticate: Bearer`. It needs no login
  (`@Public()`), so the unauthenticated rate limit of NF-11.4 applies, which a
  scrape every 15 s stays far below. The token is at least 16 characters; a
  shorter one stops the startup. `MetricsModule` in `server/core/observability`
  owns one `prom-client` registry, `METRICS_REGISTRY`, where every library
  registers its own metrics, all named `front_burner_…`, with no label that
  names a user, a repository or a path (NF-10.11). Besides Node's process
  metrics, they include:
  - `front_burner_http_request_duration_seconds{method, route, status}`, a
    histogram of every request under `/api/`, timed by an Express middleware
    attached right after the request logger, so that requests refused by a guard
    (`401`, `429`) or the body parser count too. `route` is the pattern of the
    controller route that answered (`/api/v1/repositories/:id`), never the path,
    or `unmatched` when none did, such as for an unknown path;
  - `front_burner_active_sessions`, the sessions neither revoked nor expired,
    counted in the database on each scrape.

  _(Plan 134's call.)_

## A-3: Contracts

- **A-3.3** Every request body, query, path parameter and response body is a
  **Zod schema** in `shared/contracts`. The backend validates requests with them
  in a global validation pipe _(My call: `nestjs-zod`)_, and the OpenAPI
  document is generated from them.
- **A-3.4** Every schema used by an endpoint is **named** with Zod 4 metadata
  (`.meta({ id })`), so that it appears as a named component in the OpenAPI
  document and the client template can map it back to its export.
- **A-3.5** Response schemas never contain secret fields (passwords, tokens,
  private keys); a secret cannot leak through a response by accident (AR-17,
  D-8.5). The one exception is `SessionTokens`: the auth token and, with body
  delivery, the refresh token of LG-27 and LG-31, sent only to the client that
  logged in or refreshed.

## A-3: Generated API client

- **A-3.6** `web/api-client` is generated from the OpenAPI document with
  `swagger-typescript-api` and our own template:
  - it contains **methods only**, built on Angular's `HttpClient`;
  - every type is imported from `shared/contracts` (`z.infer` types), never
    generated; type-only imports add no Zod code to the bundle. The generator
    fails on inline or unknown types, and a test checks that every imported name
    resolves to a `shared/contracts` schema with a matching `.meta` id;
  - there is one client class per OpenAPI tag, and methods are named by
    `operationId`, which is the controller method's name;
  - OpenAPI component names come from the Zod schemas' `.meta({ id })`;
  - a route whose only responses are redirects (`3xx`), such as `GET
    /api/v1/auth/oidc/start`, is a browser navigation: it is in the OpenAPI
    document but gets no client method;
  - the health endpoints are under `/api/health`, outside `/api/v1`; the metrics
    (A-3.2j) are outside it too, and not in the document.
- **A-3.7** CI regenerates the OpenAPI document and the client and fails if
  either differs from what is committed.

## A-3: Errors

- **A-3.8** Every error response has a stable **error code**, its parameters,
  the request ID, and an English fallback message (NF-14.3, NF-10.6). Error
  codes are part of `shared/contracts`. Clients turn codes into text; the web
  client does it with Transloco.
- **A-3.9** Validation errors list each failing field with its own code, so that
  forms can show errors next to fields.

## A-3: Push channel

- **A-3.10** The backend pushes updates over **Server-Sent Events** at `GET
  /api/v1/events`:
  - clients read the stream with `fetch` (not `EventSource`), sending the auth
    token in the `Authorization` header like any other request;
  - one stream per client tab, carrying events for the logged-in user only;
  - the backend closes the stream when the auth token expires or the session is
    revoked; the client reconnects with a fresh token, or the web client hands
    the stream over to a new one before the token expires (A-8.5);
  - the response sets `X-Accel-Buffering: no` and `Cache-Control: no-cache`, and
    the backend sends a comment line every 30 seconds to keep proxies from
    closing an idle stream. _(My call: 30 seconds.)_ It also sends one as soon
    as the stream opens, because some browsers resolve `fetch` only once body
    bytes arrive, and the client counts a connection from then (A-3.11).
- **A-3.11** **Events are notifications, not state.** Each says what changed,
  with a small payload, for example `repository.status` (repository ID, new
  status), `job.progress` (job ID, percentage), `job.finished` (job ID,
  outcome), `sync.state` (repository ID: "not uploaded", conflict episode),
  `resolution.lock` (repository ID, taken over). After connecting or
  reconnecting, the client fetches current state over REST; events are never
  replayed.
  - The MVP requirements add: `files.changed` (repository ID, the folders whose
    entries changed, or "all" after an operation that may change many, such as a
    pull or a branch switch; FB-41, ED-23, GA-12), `repository.removed`
    (repository ID; RM-20), `repository.warning` (repository ID, when a stored
    problem of the operations with the remote changed, so that the client reads
    the summary's `warnings` again; RM-8), `key.unlocked` (key ID, to the
    streams of the session that unlocked it; RC-16) and `key.locked` (key ID, to
    the streams of that session, when its unlock ended by the idle time, so that
    the screen says why fetches stopped; AR-31, RC-15, GA-35).
  - `git.changed` (repository ID) says that git state changed. It is an event of
    its own, since a commit or a push changes no files. _(Plan's call.)_ It is
    also sent when a push is queued, so that the user's other tabs read the
    status's unfinished network job and show the push as running (GA-9). _(Plan
    58's call.)_ A fetch publishes it when it is queued, as a push does, and
    when it ends only if a remote branch moved or the stored fetch problem
    changed, so that an idle tab does not read the status after every background
    fetch. _(Plan 70's call.)_ Aborting a merge publishes it with
    `files.changed` for "all", also when the abort fails partway, as it may have
    changed files. _(Plan 80's call.)_
  - There is no `remote.changed` event: when the status's `behind` changes, the
    client reads `GET /repositories/:id/git/incoming?path=` for the incoming
    commits and whether they change the open file (GA-34, D-4.2), which also
    works after a reconnect. _(Plan 70's call.)_
  - There is no `merge.state` event: the status's `mergeInProgress` says when a
    merge starts or ends, here or elsewhere (GC-2, GC-21), and the client reads
    `GET /repositories/:id/git/merge` then and on every `git.changed`, which
    resolving a file also publishes, and after a reconnect. _(Plan 81's call.)_
  - `commit-author.changed` says that the user's commit author, a repository's
    override or the confirmation changed, so that every tab shows who commits.
    It names no repository, as the default concerns them all. _(Plan's call.)_
  - The user's own saves also cause `files.changed`; the web client ignores a
    change to the open file whose content hash matches its last save (ED-24).
    _(My call.)_
- **A-3.12** The client tells the backend which repository it is viewing by
  opening the stream with `?repository=<id>` and reopening it when that changes.
  The backend uses this to schedule background fetches (A-6, job types). _(My
  call.)_
  - A `repository` that is not a positive integer is ignored, not refused, so it
    is parsed by hand rather than with a Zod schema (A-3.3). _(Plan 71's call.)_
  - Reopening counts as a reconnect (A-3.11): `reconnected` fires and the client
    reloads its state over REST. _(Plan 71's call.)_
  - The backend does not check the ID against the user's repositories, so
    whatever uses it must ignore an ID that is not the user's. _(Plan 71's
    call.)_
- **A-3.13** Over HTTP/1.1, browsers allow 6 connections per origin. Reverse
  proxies normally serve HTTP/2, where this does not apply. If it becomes a
  problem, one tab can share its stream with the others through
  `BroadcastChannel`; this is not built at launch.
- **A-3.14** Besides JSON, the API returns raw bytes in one place in the MVP:
  the **image endpoint** (IM-7), in the `files` feature. It serves image files
  of the working copy with the headers of NF-11.3, a content type from the
  extension, and an `ETag` from the file's size and modification time, and
  answers `If-None-Match` with `304`. _(My call: no content hash, so a 10 MB
  image is not read just to answer a revalidation.)_
