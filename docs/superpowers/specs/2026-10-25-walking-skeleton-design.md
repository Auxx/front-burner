# Walking Skeleton — Design

> Status: **Draft**

## Intent

The `ui` library is done, but Front Burner has no application projects yet:
there is no `apps/` folder and no backend. The walking skeleton is the first
runnable Front Burner. It proves the whole stack end to end and lays the
foundations that every later MVP feature builds on (MVP order of work, step 1).

It is finished when a developer can:

1. run `nx serve server` and `nx serve web` from the workspace;
2. open the web client and be sent to the Administrator onboarding page from any
   URL;
3. enter the setup token, choose **username + password**, fill in the form and
   submit;
4. see a confirmation and land on the login page, with onboarding closed for
   good.

The work is judged as much by the foundations as by the feature. Contracts, the
generated API client, Transloco, configuration, the database and migrations,
security headers and the CSP, logging and CI are all set up the way the
architecture describes, so that later features only add to them.

## Goals

- **Administrator onboarding, username + password path**, per
  [REQ-AUTH-001](../../requirements/auth-onboarding.md): AO-1 to AO-20 and AO-37
  to AO-39, restricted to the `required` and `completed` states, and the
  password policy of [REQ-AUTH-002](../../requirements/auth-password-policy.md)
  in full, including the strength meter (PP-14) and one shared policy
  implementation (PP-15).
- **Projects and boundaries** from the module map (A-2), created only where the
  skeleton needs them, with the NX tags and `@nx/enforce-module-boundaries`
  rules of A-2.4 and A-2.5 in force from day one.
- **Backend foundations**: configuration (A-1.15), the startup sequence up to
  migrations (A-1.11 steps 1–4, without the snapshot), the request path (A-1.12,
  without authentication guards), the error format (A-3.8, A-3.9), logging and
  request IDs (NF-10.1 to NF-10.6), health endpoints (NF-10.7 to NF-10.9),
  security headers and CSP (NF-11.1, NF-11.2, A-7.9), rate limits (NF-11.4,
  AO-37) and body size limits (NF-11.5).
- **Web client foundations**: lazily loaded feature routes (A-2.2), Transloco
  with ICU messages (A-8.8, NF-14.2), the generated API client (A-3.6), error
  code to text mapping (A-8.6), page titles (NV-13).
- **CI** in GitHub Actions.

## Non-goals

These are deferred, not dropped. They are added by the first feature that needs
them.

- **OIDC**, in every form: the OIDC onboarding form, the `oidc-pending` state,
  the OIDC environment variables (AO-21 to AO-36), and `openid-client`. OIDC is
  its own piece of work. The skeleton must not rule it out (see
  [Onboarding](#onboarding)).
- **Login, sessions, tokens** (REQ-AUTH-003). The login page is a placeholder.
- **Startup steps after migrations**: the pre-upgrade snapshot (NF-7.1),
  periodic snapshots (NF-6.2), the encryption key and its check value (NF-8),
  recovery (NF-9.4, NF-9.5), the job runner (A-6) and the push channel (A-3.10).
  Server `core/crypto`, `jobs`, `events`, `git`, `storage` and `mail` are not
  created. `FRONT_BURNER_ENCRYPTION_KEY` and `FRONT_BURNER_JWT_SECRET` are not
  required yet.
- **The app header** and `web/shell` (REQ-APP-001). Pages without a login have
  no app header (navigation.md, Context), so the skeleton does not need it.
- **Metrics** (NF-10.10, NF-10.11) and the version header and version check
  (NF-7.6, A-8.7).
- **Docker, the deployment guide and CD.** CD (publishing images) comes with the
  deployment guide, when images are ready to be published.

## Anti-goals

The skeleton fails even if onboarding works when:

- a foundation is built as a shortcut that later features would have to undo,
  for example hand-written API calls, hard-coded English strings, types
  duplicated between server and web, or a password policy defined twice;
- the onboarding endpoints can be distinguished from an unknown route once
  onboarding is closed or the token is wrong (AO-3, AO-10);
- the setup token or a password appears in a log, a response or browser storage
  (AO-11, AO-38, PP-11);
- the backend relies on the web client to enforce any onboarding rule (AO-4).

## Constraints

- Follow the architecture documents. Where this design adds or changes a
  decision, the architecture document is updated in the same change.
- Stack as in A-1.3 to A-1.10: Node.js 24, NestJS, Drizzle on `better-sqlite3`,
  Zod 4 with `nestjs-zod`, `swagger-typescript-api` with our own template,
  Angular with signals, Transloco, `nestjs-pino`, `@nestjs/throttler`, `argon2`,
  Vitest, Playwright with axe-core.
- Use the workspace's `development-workflow` skill, and the `toolkit-nx`
  generators for every Angular artefact. Use `@nx/nest` generators for the
  server projects.
- No `dotenv`. In development, Nx loads `.env` files into the environment of
  every task. The backend reads only real environment variables.

## How it is run

- **Development.** `nx serve server` runs the NestJS backend. `nx serve web`
  runs the Angular dev server and proxies `/api` to the backend, so both sides
  reload on change. Configuration lives in a git-ignored `.env` (Nx loads it); a
  committed `.env.example` lists every variable with a development value or a
  comment.
- **Production path.** The backend also serves the built web client and its
  `index.html` with a fresh CSP nonce per request (A-7.9, NF-11.1). This path is
  built and checked by an e2e test in the skeleton, so that the CSP, including
  Trusted Types and `inlineCritical: false`, works from the first commit. Docker
  is not part of the skeleton.

## Projects

Created by the skeleton (paths and tags from A-2):

| Project                          | Tags                             | Holds in the skeleton                                                                   |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/server`                    | `scope:server`, `type:app`       | Bootstrap, startup sequence, serving the web client and `index.html` with the CSP nonce |
| `apps/server-e2e`                | `scope:server`, `type:app`       | API tests against a running backend                                                     |
| `apps/web`                       | `scope:web`, `type:app`          | App config, routes, Transloco setup, title strategy                                     |
| `apps/web-e2e`                   | `scope:web`, `type:app`          | Playwright tests with axe-core                                                          |
| `libs/shared/contracts`          | `scope:shared`, `type:contracts` | Onboarding and error schemas, error codes, the password policy                          |
| `libs/shared/util`               | `scope:shared`, `type:util`      | Created empty unless something fits                                                     |
| `libs/server/core/config`        | `scope:server`, `type:core`      | The configuration schema and loading                                                    |
| `libs/server/core/database`      | `scope:server`, `type:core`      | Drizzle client, `users` and `instance_state` tables, migrations                         |
| `libs/server/core/security`      | `scope:server`, `type:core`      | Headers, CSP nonce, rate limits, constant-time comparison helper                        |
| `libs/server/core/observability` | `scope:server`, `type:core`      | Logging, request IDs, health                                                            |
| `libs/server/feature/auth`       | `scope:server`, `type:feature`   | Onboarding module only                                                                  |
| `libs/web/core`                  | `scope:web`, `type:data-access`  | Error-code texts, HTTP error handling, Transloco loader                                 |
| `libs/web/api-client`            | `scope:web`, `type:data-access`  | Generated client                                                                        |
| `libs/web/feature-auth`          | `scope:web`, `type:feature`      | Onboarding page, placeholder login page                                                 |

The existing `ui` library stays at `libs/ui` and gets the tags `scope:web` and
`type:ui`. _(My call: moving it to `libs/web/ui`, as A-2 shows, would touch
every import and Storybook path for no gain. A-2's tree is updated to say
`libs/ui`.)_

Every project's `lint` target enforces the A-2.4 table, so a wrong import fails
CI.

## Backend

### Configuration

- One Zod schema in `server/core/config` parses `process.env` at startup
  (A-1.15). Invalid configuration stops the backend with a log entry naming each
  bad variable. Secret variables accept the `…_FILE` variant (NF-8.2); in the
  skeleton that is `FRONT_BURNER_SETUP_TOKEN`.
- Variables used by the skeleton: `FRONT_BURNER_PORT`,
  `FRONT_BURNER_TRUSTED_PROXIES`, `FRONT_BURNER_LOG_LEVEL`,
  `FRONT_BURNER_LOG_FORMAT`, `FRONT_BURNER_SETUP_TOKEN` (and `…_FILE`), and a
  new **`FRONT_BURNER_DATA_DIR`**, default `/data`. _(My call: NF-5.1 fixes
  `/data` inside the container, but development needs a folder in the workspace,
  such as `tmp/data`. It is added to A-1.15's table.)_
- A setup token shorter than 16 characters counts as not set and logs a warning
  (AO-8); it does not stop the backend.

### Startup

In this order, any failure stopping the process with a log entry that names the
cause (A-1.11):

1. read and validate the configuration;
2. create the data directory layout that the skeleton uses (`db/`) and check
   that it is writable (NF-5.6);
3. open the database with the A-4.1 pragmas;
4. refuse a database that has a migration this version does not know (NF-7.3,
   A-4.7), then apply pending migrations with Drizzle's migrator;
5. work out the onboarding state (AO-1);
6. start the HTTP server.

The pre-upgrade snapshot that A-1.11 puts before migrations is deferred (see
Non-goals).

### Database

- Tables in `server/core/database` (A-4.3), migrations generated by
  `drizzle-kit` and committed (A-4.6).
- `users`: the columns that REQ-AUTH-001 and REQ-AUTH-002 need now (internal ID,
  email, display name, role, login method, Argon2id hash, created time), shaped
  so that OIDC users (issuer + `sub`) and the columns of A-4.4 can be added by
  later migrations without rewriting rows. Email is unique, ignoring case.
- `instance_state`: one row holding the onboarding state (A-4.4). The pending
  administrator email column comes with OIDC.

### Onboarding

- Endpoints under `/api/v1/onboarding`. Names and shapes are left to the
  builder, within these rules:
  - a **state** endpoint, unauthenticated, returns `required`, whether OIDC is
    configured through environment variables (always `false` for now), and
    **`setupTokenConfigured`**: whether a valid setup token is set (AO-5). The
    page uses it to show the no-token explanation (AO-9). _(Decided: AO-5's "no
    other data" means no secrets; knowing that an instance has no token gives
    nothing away, since nothing can be submitted without one. AO-5 is updated to
    say so.)_
  - a **check token** endpoint lets the page verify the setup token before
    showing the choice of login method (AO-10, AO-14);
  - a **password setup** endpoint takes the token, email, display name and
    password, and creates the administrator (AO-17, AO-19).
- The state type in `shared/contracts` already lists `oidc-pending`, so that
  clients are written for all three states; the backend never produces it yet.
- **404 rules** (AO-3, AO-9, AO-10): once the state is `completed`, every
  onboarding endpoint, including the state endpoint, returns exactly the same
  response as an unknown route. While the state is `required`, data-changing
  endpoints return that same 404 when no valid token is configured or the token
  is missing or wrong. The token is compared in constant time.
- **Atomic completion** (AO-6): creating the user and setting the state happen
  in one SQLite transaction that also checks that the state is still `required`;
  of two concurrent requests, exactly one succeeds. The other gets the same 404.
- **Password**: normalised to NFC, never trimmed, checked against the shared
  policy with every failing rule reported (PP-1 to PP-11), hashed with Argon2id
  (PP-12). Validation errors use A-3.9's per-field codes.
- **Rate limit** on onboarding endpoints (AO-37), with `429` and `Retry-After`
  (NF-11.4). _(My calls:)_
  - 10 requests per IP address per minute across the check-token and password
    setup endpoints together, so the token cannot be guessed faster through
    either; within the general 60 per minute for unauthenticated endpoints;
  - the limit stays on after `completed`;
  - the throttler's `X-RateLimit-*` headers are turned off everywhere, so they
    mark no route as special;
  - the "same as an unknown route" rule (AO-3) is about a single response:
    status, body and headers apart from `X-Request-Id`. Rate-limit behaviour
    over many requests is not covered by it.
- **Logging** (AO-39): started, setup token rejected, completed, with no
  secrets. Email addresses appear only at `debug` (NF-10.5).
- The OIDC path must be addable later as one more endpoint and one more
  transition into `oidc-pending`, without reshaping these.

### Errors, request path and headers

- Global Zod validation pipe from `nestjs-zod` (A-3.3); all schemas named with
  `.meta({ id })` (A-3.4); the OpenAPI document generated from them.
- One exception filter produces A-3.8's error body: code, parameters, request
  ID, English fallback message. Error codes live in `shared/contracts`.
- Every response has `X-Request-Id` (NF-10.6) and the headers of NF-11.2. HTML
  responses have the CSP of NF-11.1 with a fresh nonce.
- `GET /api/health/live` and `GET /api/health/ready` (database reachable,
  migrations done, data directory writable; NF-10.7 to NF-10.9).
- Trusted proxies from `FRONT_BURNER_TRUSTED_PROXIES`, so that rate limits key
  on the real client address.

## Web client

### Foundations

- Routes in `apps/web`, each feature library loaded lazily (A-2.2). Routes _(my
  call, NV-1 leaves them to the builder)_: `/onboarding` and `/login`.
- A guard asks the state endpoint once per page load and sends every route to
  `/onboarding` while the state is `required` (AO-2), and `/onboarding` to
  `/login` once it is `completed` or the endpoint returns 404 (AO-3).
- Transloco with English only, translation files loaded on demand, ICU messages
  through our own transpiler on `intl-messageformat`, because
  `@jsverse/transloco-messageformat` needs `eval` (A-8.8, NF-14.2). Every string
  in the skeleton goes through Transloco, including error-code texts (A-8.6).
- The API client is generated by an Nx target that builds the OpenAPI document
  from the server and runs `swagger-typescript-api` with our `HttpClient`
  template (A-3.6). Generated methods import types from `shared/contracts`. The
  generated files are committed.
- Forms validate with the same Zod schemas as the backend (A-8.3), and the
  password policy is the shared one (PP-15).
- Page titles end with "· Front Burner" (NV-13), for example "Set up Front
  Burner · Front Burner" _(my call)_.
- The production build has `inlineCritical: false` and Trusted Types support,
  and Angular reads the CSP nonce (`ngCspNonce`) (NF-11.1).

### Onboarding page

Built only from `ui` components; a feature may add a component of its own where
`ui` has nothing that fits. The visual layout is left to the builder, within the
design system (A-10). It covers, in order:

1. **No token configured** (AO-9): an explanation of how to set
   `FRONT_BURNER_SETUP_TOKEN` and restart. The skeleton's version mentions the
   `.env` file only through the generic text; the wording is reviewed with the
   deployment guide.
2. **Setup token** (AO-10): one field. A wrong token shows "invalid setup
   token". The token is held in memory only (AO-11).
3. **Login method** (AO-14, AO-15): a short explanation and a choice between
   **Username and password** and **OIDC**. The OIDC choice is shown but
   disabled, with a note that it is not available yet. _(My call: this keeps the
   page's shape for the OIDC work.)_ The user can go back until they submit.
4. **Password form** (AO-17, AO-18): email, display name, password, password
   confirmation; the password policy is shown before submitting and checked as
   the user types (PP-13); a strength meter (PP-14); errors inline, including
   the backend's per-rule codes.
5. **Confirmation** (AO-20): a short success message, then the login page. The
   user is not logged in.

The strength meter's estimator is left to the builder, but it must not count
against the 300 KB initial bundle (NF-2.9), for example by loading it lazily. If
the meter is generic, it goes into `ui` with a story.

Usable on desktop and mobile down to 320 px (AO-7, NF-12.4).

### Login page placeholder

A page at `/login` that says login is not available yet, with no form. It is
replaced by REQ-AUTH-003.

## Tests

- **Unit and integration (Vitest)**: the configuration schema; the password
  policy against every REQ-AUTH-002 acceptance criterion that does not need
  login (1 to 9, 11 for the "never trimmed" half, 12); the onboarding service,
  including the concurrent-completion case; web components and the guard.
- **`server-e2e`** against a running backend with a fresh data directory:
  REQ-AUTH-001 acceptance criteria 2, 3, 4 (up to "can log in"), 5, 13 and 14;
  the health endpoints; the 404 of a closed onboarding endpoint, and of a wrong
  token, compared with an unknown route: same status, body and headers apart
  from `X-Request-Id`.
- **`web-e2e` (Playwright, axe-core)** against the production path (backend
  serving the built web client): criterion 1, the happy path from any URL to the
  login page, the no-token page, and no CSP violations in the console. The
  browser matrix of NF-12.2 (Chromium, Firefox, WebKit on desktop; Chromium and
  WebKit at phone size). axe fails on any violation (NF-13.8).
- Criterion 4's "that user can log in" is tested with REQ-AUTH-003.

## CI (GitHub Actions)

On every pull request and every push to `master`:

- `npm ci` (NF-11.9), with Node.js 24 and the npm cache;
- `nx affected` for `lint`, `test`, `build` and `e2e`, and `dprint check` (the
  workspace formats with dprint, not Prettier);
- the API client drift check: regenerate the OpenAPI document and the client and
  fail if they differ from what is committed (A-3.7);
- Trivy on the lockfile, failing on a high or critical vulnerability in a
  production dependency (NF-11.10);
- Playwright browsers installed for the e2e job.

Also a Dependabot configuration for npm and GitHub Actions (NF-11.9). _(My
call.)_ Nx Cloud is not used.

## Documentation updates

In the same change:

- `docs/architecture/overview.md` A-1.15: add `FRONT_BURNER_DATA_DIR`, and say
  `server/core/config`.
- `docs/architecture/data.md` A-4.3: say `server/core/database`.
- `docs/architecture/modules.md` A-2: `ui` lives at `libs/ui`.
- `docs/requirements/auth-onboarding.md` AO-5: the state endpoint also says
  whether a valid setup token is set; it exposes no secrets.
- Any other decision the builder makes that the architecture documents should
  record.

## Delivery

Three pull requests, merged in order, each leaving CI green _(decided)_:

1. **CI and boundaries**: the GitHub Actions workflow, Dependabot, tags on `ui`,
   and the A-2.4 module boundary rules.
2. **Foundations**: every project above with its foundations: configuration,
   startup and migrations, errors, headers and CSP, logging, health, the
   production path, Transloco, the API client generation and its drift check,
   and both e2e projects with health and smoke tests.
3. **Onboarding**: the tables, endpoints, shared password policy, onboarding
   page, login placeholder, and their tests. Documentation updates go in the PR
   whose change they describe.

`gh` is not installed: the user opens each pull request by hand.

## Left to the builder

- Endpoint names and request/response shapes within the rules above.
- Column names and types beyond those listed.
- Internal structure of each library, Nx target names, the template details of
  the API client generator.
- The onboarding page's visual layout and the strength meter's estimator.
- How the dev proxy and the production static serving are wired in Nx.
