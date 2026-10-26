# Add Repository API and Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 11 of [the index](2026-10-26-00-roadmap.md): the API checks every
field of a new repository, runs an access check with the chosen credentials,
saves new credentials and the repository in one step, and clones it in the
background; the user's tabs hear when the clone ends, and a clone interrupted by
a restart fails cleanly.

**Architecture:** `server/feature/repositories` (plan 6) gains the add flow: an
access check endpoint for the branch list (AR-35), the add endpoint (AR-41,
AR-44), and an index of the user's names and remotes for the form's early checks
(AR-12, AR-15). Credentials in a request are resolved by plan 10's services; the
git work is plan 7 and 8's `GitEngine`. The clone is a job of plan 9's runner in
the `clone` pool; a passphrase-protected key is copied into an in-memory map for
the job when it is queued (AR-49, A-6.3). A new `server/core/storage` library
owns the data layout (NF-5.1, NF-5.2).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-add.md` (REQ-REPO-001: AR-2, AR-3, AR-8 to
AR-22, AR-25 to AR-29 server side, AR-31 to AR-37, AR-38 to AR-46 server side,
AR-49 to AR-57; criteria 2, 3, 5, 7, 9, 11, 12 (submit), 13 (API), 14 (API), 15
(API), 16, 17, 19, 21 to 25); `docs/requirements/dashboard.md` DS-7 (on add);
`docs/requirements/repo-manage.md` RM-6 (labels). Architecture: `overview.md`
A-1.13; `jobs.md` A-6.3, the **Clone** job; `git-engine.md` A-5.5, A-5.13;
`non-functional.md` NF-5.1 to NF-5.3, NF-9.5, NF-11.4; `data.md` A-4.4, A-4.5b.

## Global Constraints

- The shared constraints of [the index](2026-10-26-00-roadmap.md) apply.
- Uses: plan 3's `parseRemoteUrl`, `remoteKey`, `defaultRepositoryName`; plan
  6's `repositories`, `toSummary`, `RepositoriesController`; plan 7 and 8's
  `GitEngine.accessCheck`/`clone`, `GitOperationError`, `GitCredentials`; plan
  9's `JobRunner`, `EventsHub`, `PushEvent`; plan 10's
  `SavedCredentialsService`, `KeyUnlockStore`, `KnownHostsService`; plan 1's
  `ApiErrorException.forFields` and `RateLimitGroup`.
- AR-42's messages belong to the web client (plan 12); the API answers with
  codes and parameters only: field errors through `forFields`, form-level ones
  as `ApiErrorException` codes. The mapping is in Task 4 and nowhere else.
- The submit is all-or-nothing (AR-41): nothing is written before the access
  check passed, except a key generated earlier and a host trusted earlier.
- Logs: remote URLs only after `redactCredentials`; repository names and the
  user's email only at `debug` (NF-10.5); git's full error at `warn` with the
  repository ID (AR-53).
- The MVP allows only the Advanced level: `users.allowed_git_levels` defaults to
  `["advanced"]`, and nothing in the MVP changes it.

## Review Focus

- **Pressing Add repository twice quickly** must create one repository; the
  second request gets `name-taken` (AR criterion 2) → Task 5 test `creates one
  repository for two quick submits`.
- **New credentials with a failing access check** must leave nothing behind: no
  credentials, no repository, no job (AR-21, AR-41, criterion 16) → Task 5 test
  `saves nothing when the access check fails`.
- **A passphrase-protected key and a logout while the clone waits for a free
  slot** must still clone: the job holds its own copy of the key (AR-49,
  criterion 25) → Task 6 test `clones with a protected key after the session
  ended`.
- **The backend stopping in the middle of a clone** must leave the repository in
  **Error** "Clone failed" after the restart, with nothing in `tmp/` or at the
  working copy path (AR-54, NF-9.5) → Task 6 test `fails an interrupted clone on
  start` and Task 7 test `criterion 19 after a restart`.
- **A remote whose host resolves to the metadata address** must fail with the
  unreachable code on `remoteUrl`, the same as a host that does not answer
  (AR-57, criterion 24) → Task 7 test `criterion 24`.

---

### Task 1: Schema additions and allowed levels

**Files:**

- Modify: `libs/server/core/database/src/schema/repositories.ts`, `jobs.ts`,
  `users.ts` (+ `schema.spec.ts`)
- Create (generated):
  `libs/server/core/database/migrations/0007_add_repository.sql` (renumber if
  needed)
- Modify: `libs/shared/contracts/src/auth/current-user.schema.ts` (+ spec),
  `libs/server/feature/auth/src/users/me.controller.ts` (+ spec)

**Interfaces:**

- Produces:
  - `repositories.credentialId` (`credential_id`), nullable, references
    `saved_credentials.id` `ON DELETE SET NULL` (A-4.5b: credentials outlive
    repositories, and a deleted credential leaves the repository without).
  - `jobs.repositoryId` (`repository_id`), nullable, references
    `repositories.id` `ON DELETE CASCADE` (A-4.5b).
  - `users.allowedGitLevels` (`allowed_git_levels`), text (JSON array of
    `GIT_LEVELS`) not null, default `'["advanced"]'`; typed with Drizzle's
    `text({ mode: 'json' }).$type<GitLevel[]>()`.
  - `CurrentUser` gains `allowedGitLevels: GitLevel[]` in the order Simple,
    Guided, Advanced (AR-38).

- [ ] **Step 1: Write the failing tests**: schema `sets the credential to null
      when it is deleted`; `deletes a repository's jobs with it`; `allows only
      Advanced by default`; `GET me` `returns the allowed levels`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-database server-feature-auth`.
- [ ] **Step 3: Implement**; generate the migration (`add_repository`) and read
      it: every change must be an `ADD COLUMN`; regenerate the API client.
- [ ] **Step 4: Run them and see them pass** — the same command plus `npx nx
      test server`.
- [ ] **Step 5: Commit** — `feat(database): link repositories to credentials and
      jobs`

---

### Task 2: `server/core/storage` and the data layout

**Files:**

- Create (generated): `libs/server/core/storage` (`@nx/nest:library`,
  `server-core-storage`, tags `scope:server,type:core`)
- Create: `src/layout/data-layout.ts` (+ `.spec.ts`), `src/storage.module.ts`
- Modify: `apps/server/src/startup/prepare-data-dir.ts` (+ `.spec.ts`),
  `apps/server/src/app/app.module.ts`
- Modify: `docs/architecture/modules.md` A-2 (`storage` now exists; path
  resolution for files comes with REQ-FILE-001)

**Interfaces:**

- Produces:
  - `DataLayout` (plain class, `new DataLayout(dataDir)`, provided as
    `DATA_LAYOUT`): `reposDir` (`<data>/repos`), `tmpDir` (`<data>/tmp`),
    `workingCopy(userId: number, repositoryId: number): string`
    (`repos/<user-id>/<repo-id>`, NF-5.1, NF-5.2).
  - `prepareDataDir` also creates `repos/` and `tmp/`, checks both are writable
    (NF-5.6), and empties `tmp/` (NF-5.1: a half-finished clone never survives a
    restart).

- [ ] **Step 1: Write the failing tests**: `places a working copy under the
      user's and repository's IDs`; `creates repos and tmp`; `empties tmp on
      start` (a leftover file and folder are gone; `repos/` is untouched).
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-storage server`.
- [ ] **Step 3: Implement**; `npm run check:tags`.
- [ ] **Step 4: Run them and see them pass** — the same command.
- [ ] **Step 5: Commit** — `feat(storage): add the data layout`

---

### Task 3: Add repository contracts

**Files:**

- Create: `libs/shared/contracts/src/repositories/add-repository.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`, `errors/error-codes.ts`

**Interfaces:**

- Consumes: `parseRemoteUrl` (plan 3), `NewHttpsCredentialsSchema`,
  `NewSshKeySchema` (plan 10), `CLONE_MODES`, `GIT_LEVELS`.
- Produces:
  - `RemoteUrlSchema = z.string().superRefine(…)` — one issue with `params: {
    code: <RemoteUrlProblem> }` when `parseRemoteUrl` fails (AR-8 to AR-10).
  - `RepositoryNameSchema = z.string().trim().min(1).max(100)` refusing `\p{Cc}`
    with code `control-character` (AR-14).
  - `RepositoryCredentialsSchema` (`id: 'RepositoryCredentials'`), a
    discriminated union on `mode`: `{ mode: 'none' }`; `{ mode: 'saved';
    credentialId: z.int().positive(); passphrase?: string }`; `{ mode:
    'new-https'; ...NewHttpsCredentials }`; `{ mode: 'new-ssh-key'; ...NewSshKey
    }`. A generated key is already saved, so it is sent as `saved` (AR-29).
  - `AccessCheckRequestSchema` (`id: 'AccessCheckRequest'`): `{ remoteUrl;
    credentials }`; `AccessCheckResultSchema` (`id: 'AccessCheckResult'`): `{
    branches: string[]; defaultBranch: string | null }`.
  - `AddRepositoryRequestSchema` (`id: 'AddRepositoryRequest'`): `{ remoteUrl;
    name; credentials; cloneMode; branch?: z.string().min(1).max(255);
    gitLevel?: GitLevel }` with object rules (issues on the named path):
    `credentials` mode `none` or a new key only with a matching protocol (`none`
    and `new-https` need HTTPS, `new-ssh-key` needs SSH; code
    `protocol-mismatch`, AR-16, AR-22); `branch` required exactly for
    `single-branch` (code `required`). A saved credential's kind is checked by
    the backend.
  - `RepositoryIndexSchema` (`id: 'RepositoryIndex'`): `{ repositories: { name:
    string; remoteKey: string }[] }` — every repository of the user (at most 50,
    NF-1.3), for AR-12 and AR-15.
  - Field codes, all feature codes, on the paths named: `remoteUrl`:
    `host-unreachable` `{ host }`, `tls-untrusted`, `repository-not-found`,
    `host-key-changed` `{ host }`; `name`: `name-taken` `{ name }`;
    `credentials`: `credentials-refused` `{ generatedKey: boolean }`,
    `credentials-required` (AR-22), `kind-mismatch`; `credentials.passphrase`:
    `passphrase-required`, `wrong-passphrase`, plus plan 8's key problems on
    `credentials.privateKey` and `credentials.passphrase`; `branch`:
    `branch-not-found`, `no-branches` (AR-37); `gitLevel`: `level-not-allowed`
    (AR-40).
  - `ERROR_CODES` gains `'remote-timeout'` `{ host }` and `'remote-failed'`
    (form-level, AR-42) and `'host-key-unknown'` (409, params of plan 8's
    `HostKey`, AR-32).

- [ ] **Step 1: Write the failing tests**: `refuses http and local URLs with the
      parser's codes`; `refuses a name with a control character`; `requires a
      branch for a single-branch clone`; `refuses no credentials for an SSH URL`
      (`protocol-mismatch`); `refuses new HTTPS credentials for an SSH URL`;
      `accepts a saved credential for either protocol`; ids.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-contracts`.
- [ ] **Step 5: Commit** — `feat(contracts): add the add-repository schemas`

---

### Task 4: Credentials of a request and remote errors

**Files:**

- Create: `libs/server/feature/repositories/src/add/request-credentials.ts` (+
  `.spec.ts`)
- Create: `libs/server/feature/repositories/src/add/remote-errors.ts` (+
  `.spec.ts`)
- Modify: `libs/server/feature/repositories/src/repositories.module.ts` (imports
  `CredentialsModule`)

**Interfaces:**

- Consumes: plan 10's services, plan 8's `inspectPrivateKey` and
  `unlockPrivateKey`.
- Produces:
  - `RequestCredentials.resolve(user: { id; sessionId }, protocol: 'https' |
    'ssh', input: RepositoryCredentials): ResolvedCredentials` where
    `ResolvedCredentials = { git: GitCredentials; savedId: number | undefined;
    generated: boolean }`:
    - `none` → `{ kind: 'none' }`;
    - `saved` → `findOwned` (another user's ID: the unknown-route 404, AR-56);
      its kind must match the protocol (`kind-mismatch`); a protected key: with
      `passphrase`, unlock it for the session first (AR-31: kept unlocked once
      checked, even if the submit then fails); without, the session's unlock or
      `passphrase-required`; then `resolveForGit(…, { touch: true })`;
    - `new-https` → in-memory credentials, nothing saved;
    - `new-ssh-key` → `unlockPrivateKey(privateKey, passphrase)` in memory; key
      problems as field errors under `credentials.`.
  - `toAddRepositoryError(error: GitOperationError, context: { host: string;
    credentialsMode: RepositoryCredentials['mode']; generatedKey: boolean }):
    ApiErrorException` — the only mapping from git failures to API answers
    (AR-42): `host-unreachable` → field `remoteUrl` `host-unreachable`;
    `timeout` → 504 `remote-timeout`; `tls-untrusted`, `repository-not-found`,
    `host-key-changed` → fields on `remoteUrl`; `auth-failed` → field
    `credentials`: `credentials-required` when the mode is `none`, otherwise
    `credentials-refused` with `generatedKey`; `branch-not-found` → field
    `branch`; `host-key-unknown` → 409 `host-key-unknown` with the host key;
    `failed` and anything else → 502 `remote-failed`.

- [ ] **Step 1: Write the failing tests**: one per mode of `resolve`, plus
      `unlocks a protected key with the passphrase and keeps it unlocked`, `asks
      for the passphrase of a locked key`, `refuses an HTTPS credential for an
      SSH URL`, `answers 404 for another user's credential`; one test per row of
      AR-42's table for `toAddRepositoryError`, asserting status, code and path.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 5: Commit** — `feat(repositories): resolve request credentials and
      map remote errors`

---

### Task 5: Access check, index and add endpoints

**Files:**

- Create: `libs/server/feature/repositories/src/add/add-repository.service.ts`
  (+ `.spec.ts`)
- Modify: `repositories.controller.ts` (+ `.spec.ts`), `repositories.dto.ts`,
  `repository-queries.ts` (+ spec)
- Modify: `libs/server/core/security/src/rate-limit/rate-limit.module.ts` (+
  spec): the group limit becomes per group, `{ 'setup-token': 10, login: 10,
  oidc: 10, 'access-check': 30 }`, keyed by the same tracker (user when
  authenticated, AR-55)
- Modify: `libs/server/core/jobs/src/runner/job-runner.ts` (+ spec):
  `enqueue(request, tx?)` writes through the given transaction and wakes the
  loop after it commits; `request.repositoryId` is stored

**Interfaces:**

- Consumes: Tasks 1 to 4; `JobRunner`, `KnownHostsService.linesFor`.
- Produces:
  - `AddRepositoryService`:
    - `accessCheck(user, request: AccessCheckRequest):
      Promise<AccessCheckResult>` — parse, resolve credentials, `GitEngine
      .accessCheck(url, git, knownHosts)`; errors through
      `toAddRepositoryError`;
    - `add(user, request: AddRepositoryRequest): Promise<RepositorySummary>` —
      in order (AR-41): the level (absent → the highest allowed, AR-39; not
      allowed → `level-not-allowed`, AR-40); the name (`name-taken`, ignoring
      case); credentials; the access check; for `single-branch`, the branch is
      in the result (`branch-not-found`; an empty remote → `no-branches`,
      AR-37); then **one transaction** (AR-44): save new credentials
      (`createHttps` / `createPastedKey`), insert the repository (`status:
      'cloning'`, `lastAccessedAt` and `createdAt` now, DS-7), enqueue
      `repositories.clone` with `{ repositoryId }`, `repositoryId`, the user and
      dedupe key `clone:<id>`. A protected key goes into the clone key map
      (Task 6) before the job can start. A unique-index error on the name inside
      the transaction becomes `name-taken` (two quick submits).
  - `RepositoryQueries.index(userId): RepositoryIndex` (`remoteKey` of each
    remote URL).
  - Routes (tag `repositories`): `index()`: `GET repositories/index`;
    `accessCheck()`: `POST repositories/access-check` (`@HttpCode(200)`,
    `@RateLimitGroup('access-check')`); `add()`: `POST repositories` → `201
    RepositorySummary` (`@RateLimitGroup('access-check')`).

- [ ] **Step 1: Write the failing tests** (test database, plan 7's
      `startGitHttpServer`, a fake `JobRunner` where noted): `lists branches for
      the form`; `adds a public repository with no credentials` (row `cloning`,
      job queued, no credential saved, criterion 7's first half); `saves new
      HTTPS credentials with the repository`; `saves nothing when the access
      check fails` (wrong token: no rows in `repositories`, `saved_credentials`
      or `jobs`); `defaults to the highest allowed level` and `refuses a level
      the user is not allowed` (criterion 15); `refuses a taken name in any
      case` (criterion 5); `accepts a remote the user already has under a new
      name`; `creates one repository for two quick submits` (two `add` calls
      started together); `checks that the single branch exists`; `refuses a
      single-branch clone of an empty remote`; the rate limit `refuses the 31st
      access check in a minute` (criterion 23, `supertest`, 30 + 1 requests
      through both routes).
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-repositories server-core-security server-core-jobs`.
- [ ] **Step 3: Implement**; regenerate the API client.
- [ ] **Step 4: Run them and see them pass** — the same command plus `npx nx
      run-many -t lint -p server-feature-repositories web-api-client`.
- [ ] **Step 5: Commit** — `feat(repositories): add repositories`

---

### Task 6: The clone job, its outcome and recovery

**Files:**

- Create: `libs/server/feature/repositories/src/clone/clone.job.ts` (+
  `.spec.ts`), `src/clone/clone-keys.ts`
- Create: `libs/server/feature/repositories/src/recovery/working-copy-check.ts`
  (+ `.spec.ts`)
- Modify: `libs/server/core/jobs/src/runner/job-runner.ts` (+ spec):
  `JobTypeDefinition.onFinished?(job, outcome: 'done' | 'failed' | 'cancelled',
  errorCode: string | null): void`, called after every end, including a job
  failed by `onInterrupted: 'fail'` at start
- Modify: `libs/shared/contracts/src/events/push-event.schema.ts` (no change
  expected: `repository.status` exists)

**Interfaces:**

- Produces:
  - `CloneKeys` (injectable, in memory): `hold(jobId: number, key:
    UnlockedKey)`, `take(jobId): UnlockedKey | undefined`, `release(jobId)`
    (A-6.3, AR-49).
  - Job type `repositories.clone` (pool `clone`, `perUserLimit: 3`,
    `onInterrupted: 'fail'`, `maxAttempts: 1`): loads the repository (gone →
    done, nothing to do); credentials: none; saved HTTPS or unprotected key
    resolved at run time; protected key from `CloneKeys` (missing →
    `key-locked`); `GitEngine.clone({ …, tmpRoot: layout.tmpDir, destination:
    layout.workingCopy(userId, id) })` with the user's known hosts; releases the
    key in `finally`.
  - `onFinished`: `done` → `status: 'ready'`, `errorCode: null`; `failed` →
    `status: 'error'`, `errorCode: 'clone-timed-out'` for a git `timeout`, else
    `'clone-failed'` (interrupted included, AR-54, RM-6); `cancelled` → nothing.
    Each change publishes `repository.status` to the owner, and a failure logs
    git's redacted error at `warn` with the repository ID (AR-53). The partial
    copy is already gone (`GitEngine.clone` cleans up; `tmp/` is emptied at
    start).
  - `WorkingCopyCheck.onApplicationBootstrap()`: every `ready` repository whose
    working copy has no `.git` gets `status: 'error'`, `errorCode:
    'working-copy-missing'` (RM-6) _(plan's call: only "clone again" in
    REQ-REPO-003 brings it back)_.

- [ ] **Step 1: Write the failing tests** (real runner, test database, plan 7's
      HTTPS test server and plan 8's SSH test server): `clones and becomes
      ready` (event `repository.status` `ready` published to the owner only);
      `fails with Clone failed when the remote disappears` (delete the bare
      repository after `add`); `fails with Clone timed out` (`cloneTimeoutMs:
      300`, a stalling server); `clones with a protected key after the session
      ended` (add with a protected saved key, revoke the session before the job
      starts, the clone still succeeds); `fails an interrupted clone on start`
      (a `running` clone row and a `cloning` repository before `start()` →
      `error`, `clone-failed`); `marks a missing working copy`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-repositories server-core-jobs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — the same command.
- [ ] **Step 5: Commit** — `feat(repositories): clone in the background`

---

### Task 7: Add repository end-to-end tests

**Files:**

- Create: `apps/server-e2e/src/add-repository.e2e.spec.ts`
- Modify: `apps/server-e2e/src/support/server-process.ts` (start the built
  server with `GIT_SSL_CAINFO` set to the test certificate, and helpers to run
  the HTTPS and SSH git test servers from
  `@front-burner/server-core-git/testing`)

- [ ] **Step 1: Write the tests**, one per REQ-REPO-001 criterion the API owns:
      2 (two parallel `POST repositories` → one `201`, one `400 name-taken`); 3;
      5; 7 (public with no credentials; a private one with `none` →
      `credentials-required`); 9 (wrong passphrase on `credentials.passphrase`;
      after a correct one `GET credentials` reports it unlocked); 11; 12 (a
      generated key not yet on the SSH server → `credentials-refused` with
      `generatedKey: true`; after adding it to the server's authorized keys the
      submit succeeds; the key is listed even after a failed submit); 13
      (unknown host → 409 `host-key-unknown` with the fingerprint; `POST
      known-hosts`; the check passes; a server restarted with a new host key →
      `host-key-changed` on `remoteUrl`); 14 (`access-check` lists the branches
      and the default branch); 15; 16; 17 (the test servers only serve fetches);
      18, API half (the push channel delivers `repository.status` `ready` and
      `recent` lists it first, `cloning` before); 19 (a timed-out clone, and
      `criterion 19 after a restart`: kill the server with `SIGKILL` during a
      stalled clone, start it again: `error`, `clone-failed`, `tmp/` empty); 21
      (scan the server log, the database file, the stored `remote_url` and,
      while a clone runs, the `cmdline` and `environ` of every process for the
      token, the passphrase and the private key); 22; 23; 24 (a host name
      resolving to `169.254.169.254` through `/etc/hosts` is not possible in CI,
      so use the literal `https://169.254.169.254/x.git` and
      `https://[::ffff:169.254.169.254]/x` → `host-unreachable`; loopback works
      by default and is refused with
      `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS=true`); 25.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`. Expected: PASS.
- [ ] **Step 3: Commit** — `test(server-e2e): cover adding and cloning
      repositories`
