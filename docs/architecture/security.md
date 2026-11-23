# Front Burner — Security boundaries

> Status: **Draft**

Where the trust boundaries are and what enforces each one. These rules sit on
top of the security rules in the requirements and NF-11. See
[overview.md](overview.md) for the numbering conventions.

## A-7: Trust boundaries

- **A-7.1** The boundaries, from the outside in:

  | Boundary                         | Enforced by                                                             |
  | -------------------------------- | ----------------------------------------------------------------------- |
  | Internet → backend               | Authentication (A-7.2), rate limits (NF-11.4), validation (A-3.3)       |
  | One user → another user's data   | Ownership guards (A-7.3)                                                |
  | Administrator → a user's content | No bypass of ownership (A-7.4)                                          |
  | Client path → server file system | Path resolution (A-7.6)                                                 |
  | Stored data → secrets            | Encryption module (A-4.8), response schemas (A-3.5)                     |
  | Backend → other hosts            | Egress proxy for git (A-5.7), shared HTTP client for the rest (A-7.8)   |
  | Repository content → browser     | Sanitised preview (D-7.6), CSP (NF-11.1), sandboxed raw files (NF-11.3) |

## A-7: Authentication

- **A-7.2** A global NestJS guard authenticates every request as LG-34
  describes; only routes marked `@Public()` skip it (login, refresh, onboarding,
  health). An Express middleware that runs before every guard checks the auth
  token and its session and puts the result on the request (`req.auth`, or
  `req.authFailure`), so that the rate limit can count authenticated requests
  per user (NF-11.4); the guard then refuses what needs a login (A-1.12). Active
  sessions are cached in memory, which one process allows (NF-4.2). Revoking a
  session (LG-37) removes it from the cache, closes its push channel streams
  (A-3.10) and drops its key unlocks (AR-31).
- **A-7.2a** **A lost password.** Without SMTP there is no password reset by
  email (LG-48), so the operator gets back in with a command run in the
  container while the instance is stopped: `node main.js reset-password
  <email>`. It loads the configuration and opens the database, refuses one that
  needs migrations or is newer (NF-7.3), and touches nothing else. It reads the
  new password twice from standard input (without echo on a terminal, or as two
  lines from a pipe), never from the arguments, checks it against the password
  policy (REQ-AUTH-002) and, in one transaction, stores its hash and revokes
  every session of the user. Only a password user who is not disabled can be
  reset. It logs one line at `warn` with the user's ID and writes nothing to the
  login audit log, as a reset is not a login attempt. Any refusal is one line on
  standard error and exit code 1.

  The command does not detect a running instance _(accepted limit)_. A running
  instance caches active sessions in memory (A-7.2, NF-4.2) and would go on
  accepting the sessions the command revoked until it restarts, which defeats
  the reset when a session was stolen. So the command runs only in a new
  container on the stopped instance's volumes (`docker compose run --rm`), never
  with `docker exec` in the running container, whose main process is the
  instance itself. The command's `--help` and the deployment guide say so.

## A-7: Authorisation

- **A-7.3** **Ownership.** A route that names a repository or saved credential
  gets it from a guard that looks it up by **ID and current user**; anything
  else gets `404`, as if it did not exist (AR-56). Services receive the resolved
  object, never a bare ID.

  As built _(security review, plan 145)_: there is no ownership guard. Each
  service looks the repository, saved credential or job up by ID and the current
  user before using it (for example `SavedCredentialsService.findOwned` and
  `GitJobsService.state`), with the same `404 not-found` for another user's ID
  and a missing one. A-7.5's test proves this for every route, so a new route
  cannot skip the lookup unnoticed.
- **A-7.4** **Role.** Administrator routes are marked `@AdminOnly()` and live
  under `/api/v1/admin/`. Administrators reach other users' repositories through
  administration pages (REQ-DASH-001), so admin routes may read and manage
  **repository metadata** (which fields is for the administration requirements),
  through an admin variant of the ownership guard. They never reach another
  user's files, working copies or credentials. Adding a repository on a user's
  behalf creates a pending repository owned by that user.

  As built _(plan 132)_: `@AdminOnly()` is in `server/core/security`; the
  `AdminOnlyGuard`, a second global guard of `server/feature/auth` registered
  after the auth guard, so that a request without a valid auth token gets `401`
  first, answers `403 forbidden` to a user who is not an administrator. It reads
  the role from the user's row on admin routes only: the auth middleware reads
  no row, so ordinary requests get no query, and a role taken away applies at
  once. It does not answer `401` itself: a request without `req.auth` means the
  guards are in the wrong order, which `authOf` reports as a bug. The guard
  lives beside the auth guard rather than in the security library, which cannot
  import `ApiErrorException` from the observability library without a cycle. The
  first admin route is the instance's storage (A-3.2h), which is not under
  `/admin/`: it is about the instance, not about users.
- **A-7.5** An API test goes through every non-admin route that takes an ID and
  checks that another user's IDs get `404`, and through every admin route to
  check that a non-administrator gets `403`.

  As built _(plan 145)_: `apps/server-e2e/src/access.e2e.spec.ts` finds the
  routes itself in the OpenAPI document, which CI keeps equal to the code.
  `@Public()` and `@AdminOnly()` mark their routes there with the extension
  `x-front-burner-access` (`public` or `admin`), which clients ignore. The test
  also checks that the public routes are exactly A-7.2's. A route that needs a
  query or a body to pass validation, which runs before the lookup, gets one in
  the test; without it, the test fails and names the route. Routes left out of
  the OpenAPI document (the push channel and the metrics) take no ID in their
  path, and the security review covers them by reading.

## A-7: File system

- **A-7.6** Every path that comes from a client goes through one function in
  `server/storage`, which:
  - resolves it inside the repository's working copy;
  - rejects `..` segments, absolute paths and NUL characters;
  - rejects anything inside `.git`;
  - **never follows symbolic links**: a symbolic link appears in the file tree
    but cannot be opened, edited, renamed onto, or served. Without this rule a
    malicious remote could make the backend read files outside the working copy.
  - **The check holds only until the entry is opened.** Listing and reading run
    outside the working-tree lock (A-5.3), so a merge can replace a folder with
    a symbolic link between the check and the open. Code that reads a resolved
    entry therefore opens it with `O_NOFOLLOW` (and `O_DIRECTORY` for a folder),
    checks that the descriptor's real path (`/proc/self/fd/<fd>`) is still
    inside the working copy, and reads through that descriptor, never through
    the path again. Changes need no such step: they run inside the lock, where
    no merge can run at the same time. _(My call.)_

## A-7: Outbound connections

- **A-7.7** Git connects only through the egress proxy (A-5.7).
- **A-7.8** Every other outbound HTTP call (provider APIs, OIDC discovery and
  token exchange) uses one shared HTTP client, `EgressHttpClient` in
  `server/core/security`, that applies the same address rules as AR-57
  (`resolveAllowed`, shared with the git egress proxy of A-5.8). It is built on
  `undici` with a connector that checks every connection, redirects included:
  host names through a checked `lookup` that hands the socket only the checked
  addresses, IP addresses before connecting. It speaks HTTPS only, plain HTTP
  redirects included, and aborts a request after 10 seconds unless the caller
  sets another timeout. SMTP connections are checked the same way. Provider
  hosts are fixed at launch (D-8.2).

## A-7: Browser

- **A-7.9** The backend serves `index.html` itself, adding a fresh CSP nonce per
  request (NF-11.1) and the version header (NF-7.6, A-3.1). Every GET or HEAD
  path that is not a file of the build gets `index.html`, so that reloading a
  deep link such as `/repositories/1/files/docs/README.md` works; only a missing
  file under a folder of the build (`assets/`, `i18n/`, `media/`) or a missing
  root-level file with an extension (a hashed chunk) gets 404. The build
  compresses the web client's files once (`web:precompress`, plan 159): a `.br`
  and a `.gz` next to each `.js`, `.css`, `.json`, `.svg`, `.txt`,
  `.webmanifest` or `.map` file of 1 KB or more, kept only when smaller, never
  for `index.html`. For a file with variants, the backend sends the best one
  that `Accept-Encoding` allows (`br`, then `gzip`, `q=0` honoured) with the
  file's own `Content-Type`, `Content-Encoding`, no `Range` support, and `Vary:
  Accept-Encoding` on every answer for that file, compressed or not; a variant
  asked for by its own name (`main-X.js.br`) gets 404. The files the build names
  by their content, every root-level `.js` and `.css` file and every file in
  `media/`, are cached for good (`public, max-age=31536000, immutable`); the
  rule is a list of places, and `precompress.mjs` fails the build when a file in
  them has no hash in its name. `index.html` is `no-store`; other files are
  revalidated on every use (`max-age=0`), except one asked for with `?v=` and
  the instance's version, which is cached for good too: the web client asks for
  its icon sprite as `assets/icons.svg?v=<version>`, so that icons drawn while
  offline, such as the offline banner's (NV-15), are there, and an upgrade
  changes the URL.
- **A-7.10** HTML from Markdown is sanitised by `rehype-sanitize` and then
  DOMPurify, both configured from the safe HTML whitelist (REQ-EDIT-002), and
  passed to Angular in one shared preview component (D-7.6). Raw repository
  files are served from a separate endpoint with sandboxing headers (NF-11.3).
- **A-7.11** Cross-site request forgery: the API authenticates with a bearer
  header, which browsers do not send on their own; the refresh-token cookie is
  protected by LG-33.
- **A-7.11a** The image loader of the preview is the only code that sets an
  image's address (IM-24): repository images become `blob:` URLs, and remote
  `https:` images are set only after **Show remote images**. No address from a
  file reaches the page on its own.

## A-7: Accepted limits

- **A-7.12** Git and `ssh` run as the same UID as the backend. A rootless
  container cannot switch users, so there is no sandbox around git beyond
  NF-11.6 to NF-11.8 and A-5.1.
- **A-7.13** The Content Security Policy allows `https:` images (NF-11.1,
  IM-23), so that remote images can be shown on request. If the sanitising steps
  were ever bypassed, injected markup could make the browser load an image from
  any `https:` host, for example to leak that a file was viewed; it still could
  not run script. A-7.11a keeps this from happening while the sanitisers work.
- **A-7.14** `Server-Timing` is off unless `FRONT_BURNER_SERVER_TIMING` is
  `true` (A-1.15). Turned on, every API response but the health endpoints' and
  the metrics' carries `Server-Timing: app;dur=<ms>`: only a duration, never a
  route or ID. A duration can hint at work a request did that its answer does
  not show, so the variable is meant for a measuring run (plan 150's
  `perf-api.mjs`), not for an instance in use.
- **A-7.15** API answers of 1 KB or more are compressed as they are sent, by
  Express's `compression` middleware (plan 159): compressible types only, gzip
  at level 6, or Brotli at quality 4 when the client prefers it. It is always
  on, with no variable. Left out:
  - the **push channel** (`text/event-stream`, A-3.10), whose events would wait
    in the compressor's buffer;
  - the **authentication and onboarding routes** (`/api/v1/auth/` and
    `/api/v1/onboarding/`), whose answers carry auth and refresh tokens. When a
    secret and text the request chose share one compressed body, the body's size
    can reveal the secret a guess at a time (BREACH). These answers are small,
    so nothing is lost. Any other route that returns a secret must be added to
    this list;
  - everything outside `/api/`: the web client's files are compressed at build
    and sent by A-7.9, and `index.html` holds a nonce.

  The encoding is chosen when the headers are written, so `Server-Timing`
  (A-7.14) still leaves out the time to compress and send.
