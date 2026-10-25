# Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull request 2 of the walking skeleton: every project of the skeleton
with its foundations, so that `nx serve server` + `nx serve web` run, the
backend serves the built web client under the CSP in production, and a
placeholder login page proves routing, Transloco, page titles, the `ui` styles
and the generated API client end to end.

**Architecture:** The backend is a NestJS 11 application whose startup sequence
(config → data directory → database → migrations → Nest) lives in
`apps/server/src/startup/` and runs before Nest is created; infrastructure lives
in four `server/core/*` libraries. The OpenAPI document is written by the built
server (`--write-openapi`), committed, and turned into Angular `HttpClient`
methods by `swagger-typescript-api` with our template. The web client is an
Angular application whose app-wide providers come from `web/core`; its only page
in this pull request is the placeholder login page in `web/feature-auth`.

**Tech Stack:** Node.js 24.22.1, Nx 23.3.1, NestJS 11.2.8, `nestjs-zod` 5.5.0,
Zod 4.6.7, Drizzle ORM 0.45.4 + `better-sqlite3` 13.0.3, `nestjs-pino` 5.3.1,
`@nestjs/throttler` 6.7.1, Angular 22.2, Transloco 8.4.0,
`swagger-typescript-api` 13.13.0, Vitest 4.1.12 (+ `unplugin-swc` for Nest),
Playwright 1.64.1 with `@axe-core/playwright` 4.14.0.

**Spec:** `docs/superpowers/specs/2026-10-25-walking-skeleton-design.md`
(Delivery item 2, "Foundations"). Architecture: `docs/architecture/overview.md`
A-1.11–A-1.15, `api.md` A-3.1–A-3.9, `data.md` A-4.1–A-4.7, `security.md` A-7.9,
`web-client.md` A-8.1–A-8.8, `non-functional.md` NF-5.1, NF-5.6, NF-7.3, NF-8.2,
NF-10.1–NF-10.9, NF-11.1, NF-11.2, NF-11.4, NF-11.5, NF-12.2, NF-12.4, NF-13.8,
NF-14.2, NF-14.3; `requirements/navigation.md` NV-13.

## Global Constraints

- Branch `foundations` (already created off `master`). `gh` is not installed;
  push only when the user asks, then hand them the pull request text.
- **NestJS 11, not 12** (user's decision, 2026-10-25): `nestjs-zod` supports
  Nest only up to 11 (its issue #471). All `@nestjs/*` packages on 11.x.
- **Exact versions** in `package.json`, as the workspace already does. After any
  generator runs, replace the ranges it wrote with the exact versions below and
  run `npm install`. Every `@nx/*` package stays at **23.3.1**.
  - dependencies: `@nestjs/common` `@nestjs/core` `@nestjs/platform-express`
    11.2.8, `@nestjs/swagger` 11.4.7, `@nestjs/throttler` 6.7.1, `nestjs-zod`
    5.5.0, `zod` 4.6.7, `drizzle-orm` 0.45.4, `better-sqlite3` 13.0.3,
    `nestjs-pino` 5.3.1, `pino` 10.4.0, `pino-http` 11.0.0, `pino-pretty` 13.2.0
    (runtime: `FRONT_BURNER_LOG_FORMAT=pretty`, NF-10.2), `reflect-metadata`
    0.2.2, `express` 5.2.1, `proxy-addr` 2.0.7, `@jsverse/transloco` 8.4.0,
    `@jsverse/transloco-messageformat` 8.4.0.
  - devDependencies: `@nestjs/testing` 11.2.8, `@nestjs/schematics` 11.1.0,
    `drizzle-kit` 0.31.11, `@types/better-sqlite3` 9.6.0, `@types/express`
    5.0.6, `@types/proxy-addr` (latest 2.x), `@types/node` 24.19.2,
    `swagger-typescript-api` 13.13.0, `@playwright/test` 1.64.1,
    `@axe-core/playwright` 4.14.0, `supertest` 7.3.1, `@types/supertest` 7.2.1,
    `unplugin-swc` 2.0.0, `@swc/core` 1.16.20, plus whatever `@nx/*` 23.3.1
    plugins the generators add (`@nx/webpack`, `@nx/node`, `@nx/vite`,
    `@nx/playwright`, …).
- Every new project has exactly one `scope:` and one `type:` tag (A-2.4); `npm
  run check:tags` must pass. Tags per project are in each task.
- Import aliases are `@front-burner/<project-name>`.
- Angular artefacts (pages, components, services, directives) are created with
  the `@hexmode/toolkit-nx` generators (`toolkit-nx` skill), never by hand or
  with `nx g @nx/angular:<artefact>`. Applications and libraries are created
  with the `@nx/*` application/library generators named in each task.
- Server code is tested with Vitest. Every server project's Vitest config uses
  `unplugin-swc` (`swc.vite()`), because Nest's dependency injection needs
  `emitDecoratorMetadata`, which Vitest's default transform does not emit.
- Format with `npx dprint fmt`; `npx dprint check` passes. Generated files
  (`openapi.json`, the API client) are formatted by their generating target, so
  regenerating is stable.
- English UI text only through Transloco (NF-14.2); no hard-coded strings in
  templates.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A relative `FRONT_BURNER_DATA_DIR`** (`tmp/data` in `.env`) must resolve
  against the working directory once, at startup, and be logged as an absolute
  path, so `nx serve` and the e2e servers agree → Task 2 test `resolves a
  relative data directory against the working directory`.
- **A `…_FILE` secret ending in a newline** (Docker and Podman secrets usually
  do) must give the value without it → Task 2 test `strips one trailing newline
  from a _FILE value`.
- **A deep link or reload in production** (`GET /login`) must get `index.html`,
  but a missing asset (`/assets/missing.png`) must get `404`, not `index.html` →
  Task 5 tests `serves index.html for a route` and `returns 404 for a missing
  file with an extension`.
- **An unknown API path requested by a browser** (`Accept: text/html`) must get
  the JSON `404` error, never `index.html` → Task 7 test `unknown API path
  returns the JSON 404 even for HTML requests`.
- **The server started before the web client was built** (`nx serve server`
  alone) must still start, serve the API, and log once that the web client is
  not served; **a port already in use** must stop it with a log entry that names
  the port → Task 6 test `starts without a web client build` and Task 7 test
  `refuses to start when the port is in use`.

---

### Task 1: Shared contracts

**Files:**

- Create (generator): `libs/shared/contracts/` — project `shared-contracts`,
  tags `scope:shared`, `type:contracts`
- Create: `libs/shared/contracts/src/errors/error-codes.ts`
- Create: `libs/shared/contracts/src/errors/api-error.schema.ts` (+ `.spec.ts`)
- Create: `libs/shared/contracts/src/health/health-status.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`

**Interfaces:**

- Produces:
  - `ERROR_CODES = ['not-found', 'validation-failed', 'malformed-request',
    'payload-too-large', 'rate-limited', 'internal'] as const`; `type
    ErrorCode = (typeof ERROR_CODES)[number]`.
  - `FieldErrorSchema` (`.meta({ id: 'FieldError' })`): `{ path: string; code:
    string; params: Record<string, unknown> }`.
  - `ApiErrorSchema` (`.meta({ id: 'ApiError' })`): `{ code: string; params:
    Record<string, unknown>; requestId: string; message: string; fields?:
    FieldError[] }`. `code` is a plain string, not the enum, so that clients
    accept codes newer than themselves _(plan's call)_.
  - `HealthStatusSchema` (`.meta({ id: 'HealthStatus' })`): `{ status: 'ok' |
    'degraded' | 'fail' }` (NF-10.8).
  - Types `ApiError`, `FieldError`, `HealthStatus` (`z.infer`).

- [ ] **Step 1: Generate the library and install Zod**

```bash
npx nx g @nx/js:library --directory=libs/shared/contracts --name=shared-contracts --importPath=@front-burner/shared-contracts --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:shared,type:contracts --no-interactive
npm install --save-exact zod@4.6.7
```

Delete the generator's sample source and spec. Pin any `@nx/*` package it added
to 23.3.1.

- [ ] **Step 2: Write the failing tests**

`api-error.schema.spec.ts`:

- parses `{ code: 'not-found', params: {}, requestId: 'r1', message: 'Not found'
  }`;
- parses an unknown code `'some-future-code'`;
- parses `fields: [{ path: 'email', code: 'invalid-email', params: {} }]`;
- rejects a body without `requestId`;
- `z.globalRegistry.get(ApiErrorSchema)?.id === 'ApiError'` and the same for
  `FieldError`.

`health-status.schema.spec.ts`: parses each of `ok`, `degraded`, `fail`; rejects
`'up'`; registry id is `HealthStatus`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test shared-contracts` Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the schemas and codes; export them from `index.ts`**

- [ ] **Step 5: Run the tests, lint and commit**

```bash
npx nx run-many -t test lint -p shared-contracts && npm run check:tags
git add -A libs/shared package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add shared contracts: API error and health schemas (A-3.3, A-3.8)"
```

---

### Task 2: Server configuration

**Files:**

- Create (generator): `libs/server/core/config/` — project `server-core-config`,
  tags `scope:server`, `type:core`
- Create: `src/config/load-config.ts` (+ `.spec.ts`),
  `src/config/config.model.ts`, `src/config/config.module.ts` (all under
  `libs/server/core/config/`)

**Interfaces:**

- Produces:
  - `interface Config { port: number; trustedProxies: string[]; logLevel:
    'error' | 'warn' | 'info' | 'debug'; logFormat: 'json' | 'pretty'; dataDir:
    string; setupToken: string | undefined }` — `dataDir` is always absolute.
  - `loadConfig(env: Record<string, string | undefined>, options?: { cwd?:
    string; readFile?: (path: string) => string }): { config: Config; warnings:
    string[] }`.
  - `class ConfigError extends Error { readonly issues: { variable: string;
    message: string }[] }` — thrown with **every** invalid variable, never
    containing a secret value.
  - `CONFIG` injection token (`'FRONT_BURNER_CONFIG'`) and
    `ConfigModule.forRoot(config: Config): DynamicModule` (global).

| Variable                       | Default                            | Rule                                                                                                                                |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `FRONT_BURNER_PORT`            | `8080`                             | Integer 1–65535                                                                                                                     |
| `FRONT_BURNER_TRUSTED_PROXIES` | `loopback, linklocal, uniquelocal` | Comma list, trimmed; each entry accepted by `proxy-addr`'s `compile` (Express `trust proxy` names, IPs, CIDRs) (A-1.15)             |
| `FRONT_BURNER_LOG_LEVEL`       | `info`                             | `error`, `warn`, `info`, `debug` (NF-10.3)                                                                                          |
| `FRONT_BURNER_LOG_FORMAT`      | `json`                             | `json`, `pretty` (NF-10.2)                                                                                                          |
| `FRONT_BURNER_DATA_DIR`        | `/data`                            | Resolved against `cwd` (default `process.cwd()`) _(design: new variable)_                                                           |
| `FRONT_BURNER_SETUP_TOKEN`     | —                                  | Also `FRONT_BURNER_SETUP_TOKEN_FILE` (NF-8.2); both set is an issue; shorter than 16 characters → `undefined` plus a warning (AO-8) |

Any other `FRONT_BURNER_*` variable gives the warning `Unknown variable
FRONT_BURNER_X is ignored.` _(plan's call: catches typos)_.

- [ ] **Step 1: Generate the library**

```bash
npx nx g @nx/nest:library --directory=libs/server/core/config --name=server-core-config --importPath=@front-burner/server-core-config --unitTestRunner=vitest --strict --tags=scope:server,type:core --no-interactive
```

Install the Nest packages and `proxy-addr` at the Global Constraints versions;
add `swc.vite()` to its Vitest config. Remove generated sample code.

- [ ] **Step 2: Write the failing tests in `load-config.spec.ts`**

- `uses the defaults` for `{}` → `port 8080`, `trustedProxies ['loopback',
  'linklocal', 'uniquelocal']`, `logLevel 'info'`, `logFormat 'json'`, `dataDir
  '/data'`, `setupToken undefined`, no warnings.
- `resolves a relative data directory against the working directory`: `{
  FRONT_BURNER_DATA_DIR: 'tmp/data' }`, `cwd: '/work'` → `'/work/tmp/data'`.
- `reports every invalid variable`: `PORT: 'abc'`, `LOG_LEVEL: 'loud'` →
  `ConfigError` whose `issues` name both variables.
- `rejects a port of 0 and 65536`.
- `rejects an invalid trusted proxy`: `'loopback, not-an-ip'` → issue for
  `FRONT_BURNER_TRUSTED_PROXIES`.
- `reads the setup token from a _FILE variable` (fake `readFile`).
- `strips one trailing newline from a _FILE value`: file `'abcdefghijklmnop\n'`
  → `'abcdefghijklmnop'`; `'\r\n'` too.
- `rejects both the variable and its _FILE variant`.
- `reports an unreadable _FILE` naming the variable, not the path's content.
- `ignores a short setup token with a warning`: 15 characters → `undefined`, one
  warning naming the variable; 16 characters → kept.
- `never puts a secret in an issue or warning`: for a too-short token
  `'short-secret'`, no message contains `'short-secret'`.
- `warns about unknown FRONT_BURNER_ variables`; non-prefixed variables are not
  mentioned.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test server-core-config` Expected: FAIL, `loadConfig` not found.

- [ ] **Step 4: Implement `loadConfig` with one Zod schema (A-1.15),
      `ConfigError`, `CONFIG` and `ConfigModule.forRoot`; export them**

- [ ] **Step 5: Run the tests, lint and commit**

```bash
npx nx run-many -t test lint -p server-core-config && npm run check:tags
git add -A libs/server package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add server configuration (A-1.15, NF-8.2)"
```

---

### Task 3: Database and migrations

**Files:**

- Create (generator): `libs/server/core/database/` — project
  `server-core-database`, tags `scope:server`, `type:core`
- Create: `src/database/open-database.ts` (+ spec), `src/database/migrations.ts`
  (+ spec), `src/database/database.module.ts`, `src/schema/index.ts`,
  `src/test-fixtures/migrations-*/` (fixture migration folders for tests)
- Create: `libs/server/core/database/drizzle.config.ts`,
  `libs/server/core/database/migrations/.gitkeep`
- Modify: `libs/server/core/database/project.json` (target `db-generate`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Database { sqlite: BetterSqlite3.Database; db:
    BetterSQLite3Database<typeof schema> }`.
  - `openDatabase(file: string): Database` — one connection with
    `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`,
    `busy_timeout=5000` (A-4.1).
  - `assertNoNewerMigrations(database: Database, migrationsFolder: string):
    void` — throws `NewerSchemaError` (`readonly unknown: number[]`, the
    `created_at` values the folder does not know) (NF-7.3, A-4.7).
  - `applyMigrations(database: Database, migrationsFolder: string): void` —
    Drizzle's `migrate`.
  - `DATABASE` injection token (`'FRONT_BURNER_DATABASE'`) and
    `DatabaseModule.forRoot(database: Database): DynamicModule` (global).
  - `MIGRATIONS_DIR = 'libs/server/core/database/migrations'` is where
    `drizzle-kit` writes; the server build copies it (Task 6).
- A missing folder or a folder without `meta/_journal.json` counts as **no
  migrations**: `applyMigrations` does nothing, and `assertNoNewerMigrations`
  treats every applied migration as newer _(plan's call: no tables exist until
  pull request 3, and `drizzle-kit` writes the journal with the first
  migration)_.
- `schema/index.ts` exports no tables yet; its comment says tables live here
  (A-4.3) and come with the features that need them.

- [ ] **Step 1: Generate the library, install packages**

```bash
npx nx g @nx/nest:library --directory=libs/server/core/database --name=server-core-database --importPath=@front-burner/server-core-database --unitTestRunner=vitest --strict --tags=scope:server,type:core --no-interactive
```

Install `drizzle-orm`, `better-sqlite3`, `drizzle-kit`, `@types/better-sqlite3`
at the pinned versions. Add `swc.vite()` to the Vitest config.

- [ ] **Step 2: Write the failing tests**

`open-database.spec.ts` (temporary directory per test):

- `sets the pragmas`: `journal_mode` is `wal`, `foreign_keys` is `1`,
  `synchronous` is `1`, `busy_timeout` is `5000`.

`migrations.spec.ts`, with two fixture folders written by hand in Drizzle's
format (`meta/_journal.json` with entries `{ idx, version: '6', when, tag,
breakpoints: true }` and `<tag>.sql`): `migrations-one` (creates table `a`) and
`migrations-two` (`a`, then table `b`):

- `applies pending migrations`: `migrations-two` on an empty database → tables
  `a` and `b` exist.
- `does nothing without a journal`: an empty folder and a missing folder → no
  error, no `__drizzle_migrations` table rows.
- `accepts a database migrated by the same or an older version`: apply
  `migrations-one`, then `assertNoNewerMigrations` with `migrations-two` → no
  error.
- `refuses a database migrated by a newer version`: apply `migrations-two`, then
  `assertNoNewerMigrations` with `migrations-one` → `NewerSchemaError` whose
  `unknown` is `[<when of b>]`.
- `refuses any applied migration when the folder has none`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test server-core-database` Expected: FAIL, functions not found.

- [ ] **Step 4: Implement, add `drizzle.config.ts` and the `db-generate`
      target**

`drizzle.config.ts`: `dialect: 'sqlite'`, `schema:
'libs/server/core/database/src/schema/index.ts'`, `out:
'libs/server/core/database/migrations'`. Target `db-generate`
(`nx:run-commands`): `drizzle-kit generate --config
libs/server/core/database/drizzle.config.ts`. Running it now prints "No schema
changes" and writes nothing.

- [ ] **Step 5: Run the tests, lint and commit**

```bash
npx nx run-many -t test lint -p server-core-database && npm run check:tags
git add -A libs/server package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add database with migrations and newer-schema check (A-4, NF-7.3)"
```

---

### Task 4: Logging, request IDs, errors and health

**Files:**

- Create (generator): `libs/server/core/observability/` — project
  `server-core-observability`, tags `scope:server`, `type:core`
- Create: `src/logging/logger-options.ts` (+ spec),
  `src/logging/logging.module.ts`, `src/errors/api-error.exception.ts`,
  `src/errors/api-exception.filter.ts` (+ spec),
  `src/health/health.controller.ts`, `src/health/health.module.ts`,
  `src/health/readiness.service.ts` (+ spec)

**Interfaces:**

- Consumes: `Config`, `CONFIG` (Task 2); `Database`, `DATABASE` (Task 3);
  `ApiErrorSchema`, `ErrorCode`, `HealthStatus` (Task 1).
- Produces:
  - `createLoggerOptions(config: Pick<Config, 'logLevel' | 'logFormat'>):
    pino.LoggerOptions` — ISO 8601 UTC `time`, `level` as its label, message key
    `message` (NF-10.4); `pino-pretty` transport when `logFormat` is `pretty`;
    redacts `req.headers.authorization`, `req.headers.cookie`,
    `res.headers["set-cookie"]` (NF-10.5).
  - `createBootstrapLogger(config?: Pick<Config, 'logLevel' | 'logFormat'>):
    pino.Logger` — for startup before Nest exists; defaults `info`/`json`.
  - `LoggingModule.forRoot(config: Config): DynamicModule` — `nestjs-pino` with
    `renameContext: 'module'`, `genReqId` = `randomUUID()`, the ID written to
    the `X-Request-Id` response header and logged as `requestId` (NF-10.6).
  - `class ApiErrorException extends HttpException { constructor(status: number,
    code: ErrorCode | string, params?: Record<string, unknown>, message?:
    string) }` — what features throw.
  - `ApiExceptionFilter` (`@Catch()`), registered globally by the app (Task 6),
    always answering with an `ApiError` body whose `requestId` is `req.id` (set
    by `pino-http`), which equals the `X-Request-Id` header:

| Caught                                        | Status | `code`                                                        |
| --------------------------------------------- | ------ | ------------------------------------------------------------- |
| `ApiErrorException`                           | its    | its                                                           |
| `NotFoundException` (includes unknown routes) | 404    | `not-found`                                                   |
| `ZodValidationException` (nestjs-zod)         | 400    | `validation-failed`, with `fields` (A-3.9)                    |
| body-parser `entity.parse.failed`             | 400    | `malformed-request`                                           |
| body-parser `entity.too.large`                | 413    | `payload-too-large`                                           |
| `ThrottlerException`                          | 429    | `rate-limited` (the `Retry-After` header is already set)      |
| any other `HttpException` below 500           | its    | `not-found` for 404, else `malformed-request` _(plan's call)_ |
| anything else                                 | 500    | `internal`, logged at `error` with the stack                  |

Each `fields` entry: `path` = the issue path joined with `.`, `code` =
`issue.params.code` when a schema set one, otherwise the Zod issue code with `_`
turned into `-`; `params` = the remaining issue details without the input value.
`message` is an English fallback per code from one map in the filter.

- `HealthModule.forRoot(options: { migrationsApplied: boolean })` with
  `HealthController` at `api/health` (`@ApiTags('health')`, `@SkipThrottle()`):
  `GET live` → `200 { status: 'ok' }`; `GET ready` → `200 { status: 'ok' }` or
  `503 { status: 'fail' }` (NF-10.7, NF-10.8). Response DTOs from
  `HealthStatusSchema` via `createZodDto`. No version or internals (NF-10.9).
- `ReadinessService.check(): HealthStatus['status']` — `fail` unless `select 1`
  works on `DATABASE`, migrations were applied, and the config's `dataDir` is
  writable (`fs.accessSync(dataDir, W_OK)`). `degraded` (low disk) comes later.

- [ ] **Step 1: Generate the library; install `nestjs-pino`, `pino`,
      `pino-http`, `pino-pretty`, `@nestjs/swagger`, `nestjs-zod`,
      `@nestjs/throttler`, `supertest`, `@types/supertest`; add `swc.vite()`**

```bash
npx nx g @nx/nest:library --directory=libs/server/core/observability --name=server-core-observability --importPath=@front-burner/server-core-observability --unitTestRunner=vitest --strict --tags=scope:server,type:core --no-interactive
```

- [ ] **Step 2: Write the failing tests**

`logger-options.spec.ts` — write through a pino instance into a memory stream:

- `writes ISO time, level label, message and module` (`module` from a child
  logger's `context` once renamed is tested in the filter/app tests).
- `redacts authorization and cookie headers`: logging `{ req: { headers: {
  authorization: 'Bearer x', cookie: 'a=b' } } }` → neither value in the line.
- `honours the level`: `logLevel: 'warn'` drops `info`.

`api-exception.filter.spec.ts` — a Nest testing module with `LoggingModule`, the
filter as `APP_FILTER`, a test controller and `supertest`:

- `unknown route → 404 not-found with requestId = X-Request-Id header`.
- `ApiErrorException(409, 'some-code', { a: 1 }) → 409 { code: 'some-code',
  params: { a: 1 } }`.
- `ZodValidationException from a body { email: 1 } → 400 validation-failed,
  fields[0].path 'email', no input value in the body`.
- `malformed JSON → 400 malformed-request`.
- `a thrown Error → 500 internal; the response does not contain its message`.
- Every response body parses with `ApiErrorSchema`.

`readiness.service.spec.ts`:

- `ok` with a real temporary database and directory;
- `fail` when the database is closed;
- `fail` when `migrationsApplied` is false;
- `fail` when the data directory is not writable (`chmod 0o500`; skip when
  running as root).

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test server-core-observability` Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the logger options, `LoggingModule`,
      `ApiErrorException`, `ApiExceptionFilter`, `ReadinessService`,
      `HealthController` and `HealthModule`; export them**

- [ ] **Step 5: Run the tests, lint and commit**

```bash
npx nx run-many -t test lint -p server-core-observability && npm run check:tags
git add -A libs/server package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add logging, request IDs, API errors and health (NF-10, A-3.8)"
```

---

### Task 5: Security headers, CSP, web client serving and rate limits

**Files:**

- Create (generator): `libs/server/core/security/` — project
  `server-core-security`, tags `scope:server`, `type:core`
- Create: `src/headers/security-headers.ts` (+ spec), `src/csp/csp.ts` (+ spec),
  `src/web-client/serve-web-client.ts` (+ spec),
  `src/rate-limit/rate-limit.module.ts`, `src/rate-limit/throttler.guard.ts` (+
  spec)

**Interfaces:**

- Produces:
  - `securityHeaders(): RequestHandler` — on every response (NF-11.2):
    `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
    `Permissions-Policy: <PERMISSIONS_POLICY>`, `Cross-Origin-Opener-Policy:
    same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and
    `Strict-Transport-Security: max-age=31536000` only when `req.secure`.
  - `PERMISSIONS_POLICY`: every policy-controlled feature denied (`=()`):
    accelerometer, autoplay, bluetooth, camera, display-capture,
    encrypted-media, fullscreen, gamepad, geolocation, gyroscope, hid,
    identity-credentials-get, idle-detection, local-fonts, magnetometer,
    microphone, midi, payment, picture-in-picture, publickey-credentials-create,
    publickey-credentials-get, screen-wake-lock, serial, storage-access,
    sync-xhr, usb, web-share, xr-spatial-tracking — **except
    `clipboard-write=(self)`** _(plan's call: AO-22's copy button and copying a
    generated SSH public key need it; flagged for the user to confirm, and
    NF-11.2 is updated in Task 12)_.
  - `createNonce(): string` — 16 random bytes, base64.
  - `contentSecurityPolicy(nonce: string): string` — exactly NF-11.1's policy,
    with `'nonce-<nonce>'` in `style-src`.
  - `CSP_NONCE_PLACEHOLDER = '__CSP_NONCE__'`.
  - `serveWebClient(app: express.Application, webRoot: string): boolean` —
    returns `false` and registers nothing when `webRoot/index.html` does not
    exist. Otherwise, for `GET`/`HEAD` requests whose path does not start with
    `/api`: an existing file under `webRoot` is sent (`express.static`, `index:
    false`); a path whose last segment has an extension and no file → `404`; any
    other path → `index.html` read once at startup, with every
    `CSP_NONCE_PLACEHOLDER` replaced by a fresh nonce, `Content-Type: text/html;
    charset=utf-8`, `Cache-Control: no-store` and `Content-Security-Policy` from
    `contentSecurityPolicy(nonce)` (A-7.9).
  - `RateLimitModule` — `ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000,
    limit: 60 }], setHeaders: false })` with `AppThrottlerGuard` as `APP_GUARD`
    (NF-11.4: 60 per IP per minute for unauthenticated endpoints; every endpoint
    is unauthenticated so far). Keyed on `req.ip`, which honours `trust proxy`
    (Task 6).
  - `AppThrottlerGuard extends ThrottlerGuard` — overrides
    `throwThrottlingException` to set `Retry-After` to
    `Math.ceil(detail.timeToBlockExpire)` seconds before throwing. If 6.7.1 has
    no `setHeaders` option, the guard removes the `X-RateLimit-*` headers
    instead; the test below decides.

- [ ] **Step 1: Generate the library; add `swc.vite()`**

```bash
npx nx g @nx/nest:library --directory=libs/server/core/security --name=server-core-security --importPath=@front-burner/server-core-security --unitTestRunner=vitest --strict --tags=scope:server,type:core --no-interactive
```

- [ ] **Step 2: Write the failing tests**

`csp.spec.ts`:

- `builds NF-11.1's policy`: `contentSecurityPolicy('abc')` equals `"default-src
  'none'; script-src 'self'; style-src 'self' 'nonce-abc'; img-src 'self' blob:
  data: https:; connect-src 'self'; font-src 'self'; manifest-src 'self';
  worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors
  'none'; object-src 'none'; require-trusted-types-for 'script'"`.
- `creates a fresh nonce`: two calls differ; each decodes to 16 bytes.

`security-headers.spec.ts` (Express app + `supertest`):

- `sets NF-11.2's headers` (all five values above).
- `sends HSTS only over HTTPS`: absent by default; present with
  `X-Forwarded-Proto: https` when the app trusts the proxy.
- `allows clipboard-write for the page itself only`.

`serve-web-client.spec.ts` (temporary `webRoot` with `index.html` containing
`<app-root ngCspNonce="__CSP_NONCE__">` and `main.js`):

- `serves index.html for a route`: `GET /login` → 200, HTML with a nonce in
  place of the placeholder, and that same nonce in the CSP header;
  `Cache-Control: no-store`.
- `uses a new nonce per request`.
- `serves an existing file`: `GET /main.js` → 200, body as on disk.
- `returns 404 for a missing file with an extension`: `GET /assets/missing.png`
  → 404.
- `leaves /api paths alone`: `GET /api/v1/x` falls through to the next handler.
- `does nothing without a build`: returns `false` for an empty `webRoot`.

`throttler.guard.spec.ts` (Nest testing module, `RateLimitModule`, a test
controller, `supertest`):

- `allows 60 requests per minute`, and the 61st gets `429`.
- `sets Retry-After on 429` (a positive integer).
- `sends no X-RateLimit headers`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test server-core-security` Expected: FAIL, modules not found.

- [ ] **Step 4: Implement and export**

- [ ] **Step 5: Run the tests, lint and commit**

```bash
npx nx run-many -t test lint -p server-core-security && npm run check:tags
git add -A libs/server package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add security headers, CSP, web client serving and rate limits (NF-11)"
```

---

### Task 6: Server application and startup sequence

**Files:**

- Create (generator): `apps/server/` — project `server`, tags `scope:server`,
  `type:app`
- Create: `apps/server/src/startup/prepare-data-dir.ts` (+ spec),
  `apps/server/src/startup/start-server.ts` (+ spec),
  `apps/server/src/startup/write-openapi.ts`,
  `apps/server/src/app/app.module.ts`
- Modify: `apps/server/src/main.ts`, `apps/server/webpack.config.js` (assets),
  `apps/server/project.json` (target `openapi`)
- Create: `apps/server/openapi.json` (generated, committed), `.env.example`
- Modify: `.gitignore` (`.env`, `.env.*`, `!.env.example`)

**Interfaces:**

- Consumes: Tasks 2–5 exports; `ApiExceptionFilter`, `LoggingModule`,
  `HealthModule`, `RateLimitModule`, `securityHeaders`, `serveWebClient`.
- Produces:
  - `prepareDataDir(dataDir: string): { databaseFile: string }` — creates
    `dataDir/db/` (NF-5.1), proves `dataDir` writable by writing and removing
    `dataDir/.write-test`; throws `Error` naming the path (NF-5.6).
    `databaseFile` is `dataDir/db/front-burner.sqlite`.
  - `startServer(options: { env: Record<string, string | undefined>; cwd?:
    string; webRoot: string; migrationsFolder: string; listen: boolean }):
    Promise<INestApplication>` — runs A-1.11 steps 1–4 and 7 in order:
    `loadConfig` (log each warning) → `prepareDataDir` → `openDatabase` →
    `assertNoNewerMigrations` → `applyMigrations` → `NestFactory.create(
    AppModule.register(…), { bodyParser: false, bufferLogs: true })` → configure
    → `listen(config.port)` when `listen` is true. Each failure is rethrown as
    `StartupError { step: 'config' | 'data-dir' | 'database' | 'migrations' |
    'http'; cause }`.
  - Configure, in this order: `app.useLogger(app.get(Logger))`; `set('trust
    proxy', config.trustedProxies)`; `securityHeaders()`; `useBodyParser('json',
    { limit: '2mb' })` (NF-11.5); `setGlobalPrefix('api/v1', { exclude:
    ['api/health/live', 'api/health/ready'] })`; `serveWebClient(expressApp,
    webRoot)` — when it returns `false`, log once at `info`: `Web client not
    found at <webRoot>; serving the API only.`; `enableShutdownHooks()`.
  - `AppModule.register(deps: { config: Config; database: Database;
    migrationsApplied: boolean }): DynamicModule` — imports
    `ConfigModule.forRoot`, `DatabaseModule.forRoot`, `LoggingModule.forRoot`,
    `RateLimitModule`, `HealthModule.forRoot`; provides `APP_FILTER`
    `ApiExceptionFilter`, `APP_PIPE` `ZodValidationPipe`, `APP_INTERCEPTOR`
    `ZodSerializerInterceptor`.
  - `writeOpenApi(app: INestApplication, file: string): void` —
    `SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Front
    Burner API').setVersion('1').build(), { operationIdFactory: (_controller,
    method) => method })`, then `cleanupOpenApiDoc` (nestjs-zod), written as
    JSON with a final newline.
  - `main.ts`: `webRoot = resolve(__dirname, '../web/browser')`,
    `migrationsFolder = join(__dirname, 'migrations')`; with `--write-openapi
    <file>` it starts with `listen: false`, writes the document, closes the app
    and exits `0`. On `StartupError` it logs `fatal` with `step` and the cause
    through `createBootstrapLogger` and exits `1`.
  - Target `openapi` (`nx:run-commands`, `dependsOn: ['build']`): `node
    dist/apps/server/main.js --write-openapi apps/server/openapi.json && npx
    dprint fmt apps/server/openapi.json`, with env `FRONT_BURNER_DATA_DIR=
    tmp/openapi-data`, `FRONT_BURNER_LOG_LEVEL=warn`.
  - Webpack `assets` add `{ input: 'libs/server/core/database/migrations', glob:
    '**/*', output: 'migrations' }`. Node modules stay external (the Nx
    default), so `better-sqlite3`'s native module loads from `node_modules`.
  - `.env.example`: `FRONT_BURNER_PORT=8080`, `FRONT_BURNER_DATA_DIR=tmp/data`,
    `FRONT_BURNER_LOG_FORMAT=pretty`, `FRONT_BURNER_LOG_LEVEL=debug`, and a
    commented `# FRONT_BURNER_SETUP_TOKEN=` with one line on what it is for.

- [ ] **Step 1: Generate the application**

```bash
npx nx g @nx/nest:application --directory=apps/server --name=server --unitTestRunner=vitest --e2eTestRunner=none --strict --tags=scope:server,type:app --no-interactive
```

Remove the generated sample controller/service. Pin versions; add `swc.vite()`
to its Vitest config if the generator did not.

- [ ] **Step 2: Write the failing tests**

`prepare-data-dir.spec.ts`: `creates db/ and returns the database file`; `throws
naming the path when the directory is not writable` (skip as root).

`start-server.spec.ts` (temporary data dir and web root, `listen: false`, then
`supertest(app.getHttpServer())`):

- `serves the health endpoints outside /api/v1`: `GET /api/health/live` → 200.
- `prefixes other routes with /api/v1`: `GET /api/v1/nope` → 404 `not-found`.
- `limits JSON bodies to 2 MB`: a 3 MB JSON `POST /api/v1/nope` → 413
  `payload-too-large`.
- `starts without a web client build`: empty `webRoot` → `GET /api/health/live`
  200, and the log contains `serving the API only` exactly once.
- `serves the web client when built`: `webRoot` with `index.html` → `GET /login`
  200 with a CSP header.
- `fails at the config step`: `env: { FRONT_BURNER_PORT: 'abc' }` →
  `StartupError` with `step: 'config'`.
- `fails at the migrations step for a newer database`: a data dir whose database
  has a `__drizzle_migrations` row → `step: 'migrations'`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test server` Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `prepareDataDir`, `startServer`, `AppModule`,
      `writeOpenApi`, `main.ts`, the webpack assets and the `openapi` target**

- [ ] **Step 5: Run the tests**

Run: `npx nx test server` Expected: PASS.

- [ ] **Step 6: Run it for real**

```bash
cp .env.example .env
npx nx serve server
```

In a second shell: `curl -si localhost:8080/api/health/ready` → `200`,
`{"status":"ok"}`, an `X-Request-Id` header, NF-11.2's headers; the log is
pretty and shows the absolute data directory and "serving the API only". Stop
the server.

- [ ] **Step 7: Generate the OpenAPI document**

Run: `npx nx run server:openapi && git status --short apps/server/openapi.json`
Expected: the file exists, has `HealthStatus` under `components.schemas`, the
operations `live` and `ready` with tag `health`, and running the target again
leaves it unchanged.

- [ ] **Step 8: Lint and commit**

```bash
npx nx run-many -t lint build -p server && npx dprint check && npm run check:tags
git add -A apps/server .env.example .gitignore package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add server application and startup sequence (A-1.11, A-1.12)"
```

---

### Task 7: Server e2e tests

**Files:**

- Create: `apps/server-e2e/` — project `server-e2e`, tags `scope:server`,
  `type:app`, `implicitDependencies: ['server']`
- Create: `apps/server-e2e/src/support/server-process.ts`,
  `apps/server-e2e/src/api.e2e.spec.ts`,
  `apps/server-e2e/src/startup.e2e.spec.ts`

**Interfaces:**

- Consumes: the built server `dist/apps/server/main.js` (Task 6).
- Produces:
  - Target `e2e`: `vitest run` with this project's config, `dependsOn:
    ['server:build']`, not cached.
  - `startServerProcess(env?: Record<string, string>): Promise<{ url: string;
    stop(): Promise<void>; output(): string }>` — spawns `node
    dist/apps/server/main.js` with a new `mkdtemp` data dir, a free port (from
    `net.createServer().listen(0)`), `FRONT_BURNER_LOG_FORMAT=json`, plus `env`;
    resolves once `GET /api/health/ready` answers 200 (10 s timeout).
  - `runServerToExit(env: Record<string, string>): Promise<{ code: number |
    null; output: string }>` — for startup failures (10 s timeout).

- [ ] **Step 1: Create the project**

```bash
npx nx g @nx/js:library --directory=apps/server-e2e --name=server-e2e --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:server,type:app --no-interactive
```

Remove the sample code and the library's `test` target; add the `e2e` target and
`implicitDependencies`; `projectType: application`.

- [ ] **Step 2: Write the tests**

`api.e2e.spec.ts` (one server for the file):

- `live and ready answer ok` with `X-Request-Id` (a UUID).
- `API responses carry NF-11.2's headers, no HSTS over HTTP, no X-RateLimit
  headers`.
- `unknown API path returns the JSON 404`: `ApiError` with `code: 'not-found'`
  and `requestId` equal to the header.
- `unknown API path returns the JSON 404 even for HTML requests` (`Accept:
  text/html`).
- `refuses a JSON body over 2 MB with 413 payload-too-large`.
- `refuses malformed JSON with 400 malformed-request`.

`startup.e2e.spec.ts`:

- `refuses to start with an invalid port`: `FRONT_BURNER_PORT=abc` → exit code
  1, output mentions `FRONT_BURNER_PORT` and step `config`.
- `refuses to start with an unwritable data directory` (`chmod 0o500`; skip as
  root) → exit 1, output names the directory.
- `refuses to start with a newer database`: prepare the data dir's
  `db/front-burner.sqlite` with a `__drizzle_migrations` row (`created_at`
  `9999999999999`) → exit 1, step `migrations`.
- `refuses to start when the port is in use`: hold a port with
  `net.createServer`, start with it → exit 1, output names the port.
- `logs the absolute data directory`: start with a relative
  `FRONT_BURNER_DATA_DIR` and a `cwd` → the output contains the absolute path.

- [ ] **Step 3: Run them**

Run: `npx nx e2e server-e2e` Expected: PASS. Any failure here is a bug in Tasks
2–6: fix it there with a failing unit test first.

- [ ] **Step 4: Lint and commit**

```bash
npx nx lint server-e2e && npm run check:tags
git add -A apps/server-e2e package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add server e2e tests"
```

---

### Task 8: Generated API client

**Files:**

- Create (generator): `libs/web/api-client/` — project `web-api-client`, tags
  `scope:web`, `type:data-access`
- Create: `libs/web/api-client/templates/` (our `swagger-typescript-api`
  templates), `libs/web/api-client/src/generated/` (generated, committed),
  `libs/web/api-client/src/generated/health-api.spec.ts` _(hand-written)_
- Modify: `libs/web/api-client/project.json` (target `generate`)

**Interfaces:**

- Consumes: `apps/server/openapi.json` and the `server:openapi` target (Task 6);
  types from `@front-burner/shared-contracts` (Task 1).
- Produces:
  - One `@Injectable({ providedIn: 'root' })` class per OpenAPI tag, named
    `<Tag>Api` (`HealthApi`), with one method per operation named by its
    `operationId` (`live(): Observable<HealthStatus>`, `ready():
    Observable<HealthStatus>`), using `inject(HttpClient)` and root-relative
    URLs (`/api/health/live`).
  - Request and response types are **imported**, type-only, from
    `@front-burner/shared-contracts` by their schema id; the generated code
    declares no types of its own (A-3.6).
  - `src/index.ts` exports the generated classes.
  - Target `generate` (`nx:run-commands`, `dependsOn: ['server:openapi']`): runs
    `swagger-typescript-api` with `--path apps/server/openapi.json`,
    `--templates libs/web/api-client/templates`, output
    `libs/web/api-client/src/generated`, then `npx dprint fmt` on the output.
    Template design is the builder's (spec: left to the builder).

- [ ] **Step 1: Generate the library**

```bash
npx nx g @nx/angular:library --directory=libs/web/api-client --name=web-api-client --importPath=@front-burner/web-api-client --prefix=api --unitTestRunner=vitest-angular --tags=scope:web,type:data-access --no-interactive
```

Install `swagger-typescript-api` 13.13.0.

- [ ] **Step 2: Write the failing test `health-api.spec.ts`**

With `provideHttpClient()` and `provideHttpClientTesting()`:

- `live() GETs /api/health/live and emits the body`.
- `ready() GETs /api/health/ready`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx nx test web-api-client` Expected: FAIL, `HealthApi` not found.

- [ ] **Step 4: Write the templates and the `generate` target; run it**

Run: `npx nx run web-api-client:generate` Expected: `src/generated/` contains
`HealthApi`; a second run leaves `git status` unchanged.

- [ ] **Step 5: Run the test, lint, build and commit**

```bash
npx nx run-many -t test lint build -p web-api-client && npm run check:tags
git add -A libs/web package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Generate the web API client from OpenAPI (A-3.6)"
```

---

### Task 9: Web core

**Files:**

- Create (generator): `libs/web/core/` — project `web-core`, tags `scope:web`,
  `type:data-access`
- Create (toolkit-nx): feature `core`; service `api-error-text`
- Create (manual, no generator): `src/core/providers/provide-core.ts`,
  `src/core/i18n/transloco-http.loader.ts` (+ spec),
  `src/core/routing/page-title.strategy.ts` (+ spec),
  `src/core/errors/to-api-error.ts` (+ spec)

**Interfaces:**

- Consumes: `ApiErrorSchema`, `ApiError`, `ERROR_CODES` (Task 1).
- Produces:
  - `provideCore(): EnvironmentProviders` — `provideHttpClient(withFetch())`;
    `provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en',
    fallbackLang: 'en', reRenderOnLangChange: true, prodMode: !isDevMode() },
    loader: TranslocoHttpLoader })`; `provideTranslocoMessageformat()`; `{
    provide: TitleStrategy, useClass: PageTitleStrategy }`.
  - `TranslocoHttpLoader` — `GET i18n/<lang>.json`, loaded on demand (A-8.8).
  - `PageTitleStrategy` — a route's `title` is a translation key; the document
    title is `<translated> · Front Burner`, or `Front Burner` without a title
    (NV-13). "Front Burner" is the product name and is not translated.
  - `toApiError(error: unknown): ApiError` — an `HttpErrorResponse` whose body
    parses with `ApiErrorSchema` → that body; status `0` → `{ code: 'network',
    params: {}, requestId: '', message: 'Network error' }`; anything else →
    `code: 'internal'`, `requestId` from the `X-Request-Id` header when present.
  - `ApiErrorTextService.describe(error: ApiError): { text: string; reference:
    string | null }` — translates `errors.<code>` with `params`; an unknown code
    falls back to `error.message`; `reference` is the first 8 characters of
    `requestId`, or `null` when empty (A-8.6, NF-10.6).
  - Translation keys `errors.<code>` for every `ERROR_CODES` entry and
    `errors.network`, with one short English sentence each. `apps/web` does not
    exist yet: Task 10 writes them into `apps/web/public/i18n/en.json`, and a
    Task 10 test checks that every key is there.

- [ ] **Step 1: Generate the library and the feature; install Transloco**

```bash
npx nx g @nx/angular:library --directory=libs/web/core --name=web-core --importPath=@front-burner/web-core --prefix=core --unitTestRunner=vitest-angular --tags=scope:web,type:data-access --no-interactive
npm install --save-exact @jsverse/transloco@8.4.0 @jsverse/transloco-messageformat@8.4.0
npx nx g @hexmode/toolkit-nx:feature --project=web-core --name=core --no-interactive --dry-run
npx nx g @hexmode/toolkit-nx:feature --project=web-core --name=core --no-interactive
npx nx g @hexmode/toolkit-nx:service --project=web-core --feature=core --name=api-error-text --no-interactive
```

(Dry-run each toolkit command first, as the `toolkit-nx` skill says.)

- [ ] **Step 2: Write the failing tests**

- `page-title.strategy.spec.ts`: with `TranslocoTestingModule` (`en: {
  'feature.title': 'Log in' }`) and a router: navigating to a route titled
  `feature.title` sets `document.title` to `Log in · Front Burner`; a route
  without a title sets `Front Burner`.
- `to-api-error.spec.ts`: the three cases above, plus a 500 with an HTML body →
  `internal`.
- `api-error-text.service.spec.ts`: `not-found` → its English text; a code
  without a key → `error.message`; `requestId 'abcdef1234'` → reference
  `abcdef12`; empty → `null`.
- `transloco-http.loader.spec.ts`: `getTranslation('en')` GETs `i18n/en.json`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx nx test web-core` Expected: FAIL.

- [ ] **Step 4: Implement and export from `src/index.ts`**

- [ ] **Step 5: Run the tests, lint and commit**

```bash
npx nx run-many -t test lint -p web-core && npm run check:tags
git add -A libs/web package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add web core: Transloco, page titles, API error texts (A-8.6, A-8.8)"
```

---

### Task 10: Web application and the placeholder login page

**Files:**

- Create (generator): `apps/web/` — project `web`, tags `scope:web`, `type:app`;
  `apps/web-e2e/` — project `web-e2e`, tags `scope:web`, `type:app`
- Create (generator): `libs/web/feature-auth/` — project `web-feature-auth`,
  tags `scope:web`, `type:feature`
- Create (toolkit-nx): feature `auth` in `web-feature-auth`; page `login` with
  `--translations=true`
- Create: `apps/web/proxy.conf.json`, `apps/web/public/i18n/en.json`
- Modify: `apps/web/project.json`, `apps/web/src/index.html`,
  `apps/web/src/app/app.config.ts`, `apps/web/src/app/app.routes.ts`,
  `apps/web/src/app/app.html`

**Interfaces:**

- Consumes: `provideCore` (Task 9); `ui` components and styles.
- Produces:
  - Routes: `''` → `loadChildren` of `authRoutes` from
    `@front-burner/web-feature-auth`; `'**'` → `redirectTo: 'login'`. In
    `authRoutes`: `''` (`pathMatch: 'full'`) → `redirectTo: 'login'`; `login` →
    `LoginPage`, `title: 'web-feature-auth.LoginPage.title'`. _(Plan's call: the
    placeholder login page moves from pull request 3 to this one, so that a lazy
    feature, Transloco, titles and the CSP are proven with real content; pull
    request 3 adds onboarding and its guard.)_
  - `LoginPage`: a `ui-empty-state` with heading `Log in` and the message
    `Signing in isn't available yet.` — keys `web-feature-auth.LoginPage.title`
    and `web-feature-auth.LoginPage.message` in `en.json`. Centred on the page,
    no app header (NV-5 is for pages behind a login), usable at 320 px
    (NF-12.4).
  - `apps/web/project.json`:
    - build `styles`: `libs/ui/src/styles/index.scss`;
    - build `assets`: `apps/web/public` and `{ glob: 'icons.svg', input:
      'libs/ui/src/assets', output: 'assets' }` (A-10.35);
    - production configuration `optimization.styles.inlineCritical: false`
      (NF-11.1);
    - serve `proxyConfig: apps/web/proxy.conf.json` (`/api` →
      `http://localhost:8080`).
  - `index.html`: `<html lang="en">`, `<title>Front Burner</title>`, `<app-root
    ngCspNonce="__CSP_NONCE__"></app-root>` (NF-11.1).
  - `app.html` is only `<router-outlet />`; the generated welcome component is
    deleted.

- [ ] **Step 1: Generate the application (with `web-e2e`) and the feature
      library**

```bash
npx nx g @nx/angular:application --directory=apps/web --name=web --bundler=esbuild --e2eTestRunner=playwright --unitTestRunner=vitest-angular --style=scss --prefix=app --routing --ssr=false --tags=scope:web,type:app --no-interactive
npx nx g @nx/angular:library --directory=libs/web/feature-auth --name=web-feature-auth --importPath=@front-burner/web-feature-auth --prefix=auth --unitTestRunner=vitest-angular --tags=scope:web,type:feature --no-interactive
```

Set `web-e2e`'s tags to `scope:web`, `type:app`. Pin `@nx/playwright`,
`@playwright/test` versions.

- [ ] **Step 2: Create the feature and the page with the toolkit**

```bash
npx nx g @hexmode/toolkit-nx:feature --project=web-feature-auth --name=auth --no-interactive --dry-run
npx nx g @hexmode/toolkit-nx:feature --project=web-feature-auth --name=auth --no-interactive
npx nx g @hexmode/toolkit-nx:page --project=web-feature-auth --feature=auth --name=login --translations=true --no-interactive --dry-run
npx nx g @hexmode/toolkit-nx:page --project=web-feature-auth --feature=auth --name=login --translations=true --no-interactive
```

Export `authRoutes` from the library's `index.ts`.

- [ ] **Step 3: Write the failing tests**

`login.page.spec.ts`: keep the generated `TranslocoTestingModule`; give it the
two `en` keys. Assert the heading `Log in` and the message `Signing in isn't
available yet.` render.

`apps/web/src/app/translations.spec.ts`: `en.json` has `errors.<code>` for every
`ERROR_CODES` entry and `errors.network` (Task 9), and both
`web-feature-auth.LoginPage` keys.

- [ ] **Step 4: Run it to verify it fails**

Run: `npx nx test web-feature-auth` Expected: FAIL (the generated page has no
heading or message yet); `npx nx test web` fails too (no `en.json`).

- [ ] **Step 5: Implement the page, routes, `app.config.ts` (`provideCore()`,
      `provideRouter(appRoutes)`), `en.json`, `index.html`, project settings and
      proxy**

- [ ] **Step 6: Run the tests and build**

Run: `npx nx run-many -t test lint build -p web web-feature-auth` Expected:
PASS; `dist/apps/web/browser/index.html` contains `ngCspNonce="__CSP_NONCE__"`
and no inline `<script>`.

- [ ] **Step 7: Check both ways of running it**

1. `npx nx serve server` and `npx nx serve web`; open `http://localhost:4200/` →
   redirected to `/login`, tab title `Log in · Front Burner`, Inter font and
   `ui` colours applied; `http://localhost:4200/api/health/live` answers through
   the proxy.
2. `npx nx build web --configuration=production && npx nx build server && node
   --env-file=.env dist/apps/server/main.js` → the same at
   `http://localhost:8080/login`, with no CSP errors in the browser console.

- [ ] **Step 8: Commit**

```bash
npm run check:tags && npx dprint check
git add -A apps/web apps/web-e2e libs/web package.json package-lock.json tsconfig.base.json nx.json
git commit -m "Add web application and placeholder login page"
```

---

### Task 11: Web e2e tests on the production path

**Files:**

- Modify: `apps/web-e2e/playwright.config.ts`, `apps/web-e2e/project.json`
- Create: `apps/web-e2e/src/login.spec.ts`,
  `apps/web-e2e/src/support/fixtures.ts`
- Delete: the generator's sample test

**Interfaces:**

- Consumes: built `dist/apps/web/browser` and `dist/apps/server/main.js`.
- Produces:
  - `web-e2e:e2e` with `dependsOn: ['web:build:production', 'server:build']`.
  - `playwright.config.ts`: `webServer` = `node dist/apps/server/main.js` with
    `FRONT_BURNER_PORT=4300`, a fresh `FRONT_BURNER_DATA_DIR` under `tmp/`
    (removed first), `FRONT_BURNER_LOG_FORMAT=json`; `url:
    http://localhost:4300/api/health/ready`; `reuseExistingServer:
    !process.env.CI`; `baseURL http://localhost:4300`. Projects (NF-12.2):
    `chromium`, `firefox`, `webkit` (desktop), `mobile-chromium` (`Pixel 7`),
    `mobile-webkit` (`iPhone 14`).
  - `fixtures.ts`: a `test` fixture that records `securitypolicyviolation`
    events (through `page.addInitScript`) and console errors, and fails the test
    if any were recorded.

- [ ] **Step 1: Install `@axe-core/playwright` 4.14.0 and write the tests in
      `login.spec.ts`**

- `any URL ends on the login page`: `/` and `/no/such/page` → URL `/login`,
  heading `Log in` visible, `document.title` `Log in · Front Burner`.
- `has no accessibility violations` (`AxeBuilder`, NF-13.8).
- `is served with a nonce-based CSP`: the `/login` response's
  `content-security-policy` contains `'nonce-` and `require-trusted-types-for
  'script'`; two loads have different nonces.
- `runs without CSP or Trusted Types violations` (the fixture).
- `applies the global styles`: `getComputedStyle(document.body).fontFamily`
  contains `Inter` (proves `inlineCritical: false`).
- `serves the icon sprite`: `GET /assets/icons.svg` → 200, `image/svg+xml`.
- `does not scroll sideways at phone width`: in the mobile projects and at a 320
  px viewport, `scrollWidth <= clientWidth` (NF-12.4).

- [ ] **Step 2: Run them**

```bash
npx playwright install chromium firefox webkit
npx nx e2e web-e2e
```

Expected: PASS in all five projects. A failure is a bug in Tasks 5, 6 or 10: fix
it there with a failing unit test first.

- [ ] **Step 3: Lint and commit**

```bash
npx nx lint web-e2e && npx dprint check
git add -A apps/web-e2e package.json package-lock.json
git commit -m "Add web e2e tests on the production path (NF-11.1, NF-12.2, NF-13.8)"
```

---

### Task 12: CI and documentation

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `docs/architecture/overview.md` (A-1.4, A-1.15),
  `docs/architecture/data.md` (A-4.3, A-4.7), `docs/architecture/api.md`
  (A-3.6), `docs/architecture/non-functional.md` (NF-11.2),
  `docs/architecture/modules.md` (A-2 tree), `README.md` (CI section, local
  development)

**Interfaces:**

- Consumes: `server:openapi`, `web-api-client:generate`, `server-e2e:e2e`,
  `web-e2e:e2e`.

- [ ] **Step 1: Update `ci.yml`**

- The "Find affected browser tests" step also checks `nx show projects
  --affected -t e2e --json` for `web-e2e`; output `browsers` is `chromium` when
  only Storybook tests are affected, `chromium firefox webkit` when `web-e2e`
  is, and empty otherwise. The install step runs `npx playwright install
  --with-deps ${{ steps.browsers.outputs.browsers }}` when it is not empty.
- New step after the affected run, **API client drift** (A-3.7): `npx nx run
  web-api-client:generate` then `git diff --exit-code --
  apps/server/openapi.json libs/web/api-client/src/generated`.

- [ ] **Step 2: Run the whole CI sequence locally**

```bash
npm run format:check && npm run check:tags && NX_BASE=master NX_HEAD=HEAD npx nx affected -t lint test build test-storybook e2e --parallel=3 && npx nx run web-api-client:generate && git diff --exit-code -- apps/server/openapi.json libs/web/api-client/src/generated
```

Expected: everything passes; the diff is empty.

- [ ] **Step 3: Update the documents**

- `overview.md` A-1.4: NestJS **11**, until `nestjs-zod` supports 12 (user's
  decision, 2026-10-25). A-1.15: `server/config` → `server/core/config`; add
  `FRONT_BURNER_DATA_DIR` (default `/data`; relative paths resolve against the
  working directory; for development).
- `data.md` A-4.3: `server/database` → `server/core/database`. A-4.7: a folder
  without a journal means no migrations.
- `api.md` A-3.6: one client class per OpenAPI tag, methods named by
  `operationId`, which is the controller method's name; health endpoints are
  under `/api/health`, outside `/api/v1`.
- `non-functional.md` NF-11.2: the `Permissions-Policy` keeps
  `clipboard-write=(self)` for copy buttons _(pending the user's confirmation)_.
- `modules.md` A-2 tree: unchanged paths; note that `shared/util` is created
  with its first helper _(plan's call: the spec created it empty; nothing in the
  skeleton needs it, and an empty library adds a project to every graph for
  nothing)_.
- `README.md`: "Local development" — copy `.env.example` to `.env`, then `nx
  serve server` and `nx serve web`; CI section mentions the e2e suites and the
  drift check.

Run `node tools/ai-tools/src/bin/doc-ids.mjs check` and `npx dprint fmt`.

- [ ] **Step 4: Commit**

```bash
git add .github docs README.md
git commit -m "Run e2e and API client drift check in CI; update architecture docs"
```

- [ ] **Step 5: Final check of the branch**

```bash
npx nx run-many -t lint test build test-storybook e2e --skip-nx-cache && npm run format:check && npm run check:tags
git log --oneline master..HEAD
```

Expected: everything passes; twelve commits after `master`.
