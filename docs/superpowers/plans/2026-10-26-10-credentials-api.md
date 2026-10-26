# Saved Credentials and Key Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 10 of [the index](2026-10-26-00-roadmap.md): a user's HTTPS
credentials and SSH keys are stored encrypted in their profile and listed
without secrets; Front Burner can generate an SSH key for them; a
passphrase-protected key can be unlocked for one session, in memory only; and a
user can trust an SSH host. Plan 11 uses all of it to add repositories.

**Architecture:** A new `server/feature/credentials` library with two tables
(`saved_credentials`, `known_hosts`), a service that creates and resolves
credentials for git (decrypting with plan 3's `SecretBox`, unlocking with plan
8's `unlockPrivateKey`), and an in-memory `KeyUnlockStore` per session with an
idle timer (A-5.5). Revoking a session drops its unlocks through a small
`SessionLifecycle` notifier in `server/core/security`, so that the auth feature
does not depend on credentials (A-7.2). Every lookup is by ID **and** user;
anything else is the `404` of an unknown ID (AR-56, A-7.3).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-add.md` AR-2, AR-17, AR-18, AR-20, AR-21,
AR-24 to AR-32, AR-56; criteria 9, 10, 11, 12 (key part), 21, 22;
`docs/architecture/git-engine.md` A-5.5, A-5.6; `docs/architecture/data.md`
A-4.4, A-4.8, A-4.11; `docs/architecture/security.md` A-7.2, A-7.3;
`docs/architecture/non-functional.md` NF-8.3, NF-8.6;
`docs/architecture/overview.md` A-1.15 (`FRONT_BURNER_KEY_UNLOCK_IDLE`).

## Global Constraints

- The shared constraints of [the index](2026-10-26-00-roadmap.md) apply.
- Uses plan 3's `SECRET_BOX` and `ENCRYPTED_COLUMNS`; plan 8's
  `inspectPrivateKey`, `unlockPrivateKey`, `generateEd25519Key`,
  `fingerprintOf`, `UnlockedKey`, `SshKeyError`, `HostKey`, `knownHostsLine`;
  plan 7's `GitCredentials`; plan 1's `RequestAuth` and `SessionService`.
- Encrypted values are bound to `{ table: 'saved_credentials', recordId: <id>,
  userId: <owner> }` (NF-8.3). A row is inserted first and its secret written in
  the same transaction once its ID is known.
- The stored private key is the text as pasted (still passphrase-encrypted when
  it was), encrypted again with `SecretBox` (AR-28). Passphrases and decrypted
  keys are never stored, logged or returned (AR-31).
- A secret set to `null` by an encryption key reset (NF-8.6) makes the
  credential "missing": it is listed, and using it fails with
  `credentials-missing`.

## Review Focus

- **A key unlocked in one session** must stay locked in the user's other
  sessions and be dropped when that session is revoked (AR-31, criterion 10) →
  Task 3 tests `keeps an unlock to its session` and `drops a revoked session's
  unlocks`.
- **Uses that are not git operations** (listing credentials, the push channel)
  must not keep a key unlocked past the idle time (AR-31) → Task 3 test `does
  not extend the unlock when only looking`.
- **Another user's credential ID** in any request must be answered exactly as an
  ID that does not exist (AR-56, criterion 22) → Task 5 test `answers 404 for
  another user's credential`.
- **A generated key** must stay in the user's saved keys if they cancel or the
  add fails (AR-29, AR-30) → Task 4 test `saves a generated key at once`.
- **Trusting a host whose key changed** must be refused: the endpoint cannot be
  used to replace a known key (AR-32) → Task 4 test `refuses to trust a changed
  key`.

---

### Task 1: `saved_credentials` and `known_hosts` tables

**Files:**

- Create: `libs/server/core/database/src/schema/saved-credentials.ts`,
  `known-hosts.ts`
- Modify: `schema/index.ts`, `schema/encrypted-columns.ts` (+ `schema.spec.ts`)
- Create (generated):
  `libs/server/core/database/migrations/0006_credentials.sql` (renumber if
  needed)

**Interfaces:**

- Produces:
  - `CREDENTIAL_KINDS = ['https', 'ssh-key']` (provider tokens come later).
  - `savedCredentials` (`saved_credentials`): `id` integer primary key
    autoincrement; `userId` not null, `ON DELETE CASCADE`; `kind`; `name` text
    not null; `username` text nullable (HTTPS); `secret` text nullable
    (encrypted: the password or token, or the private key); `sshKeyType`,
    `sshPublicKey`, `sshFingerprint` text nullable; `sshPassphraseProtected`
    boolean nullable; `sshGenerated` boolean nullable; `createdAt`. Unique index
    on `(user_id, kind, lower(name))` (AR-18). `secret` is registered in
    `ENCRYPTED_COLUMNS`.
  - `knownHosts` (`known_hosts`): `id`; `userId` not null, `ON DELETE CASCADE`;
    `host` (lower case), `port` integer, `keyType`, `publicKey` (base64 blob),
    `fingerprint`, `createdAt`. Unique index on `(user_id, host, port,
    key_type)`.

- [ ] **Step 1: Write the failing tests**: `refuses a second name of the same
      kind differing only in case`; `allows the same name for an HTTPS
      credential and an SSH key`; `refuses a second key of one type for one host
      and port`; `registers the secret as encrypted`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-database`.
- [ ] **Step 3: Define the tables and generate the migration** (`credentials`).
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-core-database server`.
- [ ] **Step 5: Commit** — `feat(database): add saved credentials and known
      hosts`

---

### Task 2: Credentials contracts

**Files:**

- Create: `libs/shared/contracts/src/credentials/credentials.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`, `errors/error-codes.ts`

**Interfaces:**

- Produces:
  - `credentialName = z.string().trim().min(1).max(100)` (AR-18).
  - `NewHttpsCredentialsSchema` (`id: 'NewHttpsCredentials'`): `{ name:
    credentialName; username: z.string().min(1).max(256); password:
    z.string().min(1).max(4096) }` (AR-20; neither trimmed).
  - `NewSshKeySchema` (`id: 'NewSshKey'`): `{ name: credentialName; privateKey:
    z.string().min(1).max(16_384); passphrase: z.string().max(1024).optional()
    }` (AR-26).
  - `SavedHttpsCredentialsSchema` (`id: 'SavedHttpsCredentials'`): `{ id; name;
    username; missing: boolean }`.
  - `SavedSshKeySchema` (`id: 'SavedSshKey'`): `{ id; name; keyType: 'ed25519' |
    'ecdsa' | 'rsa'; fingerprint; passphraseProtected: boolean; unlocked:
    boolean (in the current session); generated: boolean; missing: boolean }`
    (AR-24, AR-25).
  - `SavedCredentialsSchema` (`id: 'SavedCredentials'`): `{ https:
    SavedHttpsCredentials[]; sshKeys: SavedSshKey[] }`, each sorted by name.
  - `GenerateSshKeyRequestSchema` (`id: 'GenerateSshKeyRequest'`): `{ name }`;
    `GeneratedSshKeySchema` (`id: 'GeneratedSshKey'`): `{ key: SavedSshKey;
    publicKey: string }` (AR-29).
  - `UnlockSshKeyRequestSchema` (`id: 'UnlockSshKeyRequest'`): `{ passphrase:
    z.string().min(1).max(1024) }`.
  - `HostKeySchema` (`id: 'HostKey'`): `{ host; port: z.int().min(1).max(65535);
    type; key; fingerprint }` (from plan 8's `host-key-unknown` params);
    `TrustHostRequestSchema` (`id: 'TrustHostRequest'`) is `HostKeySchema`
    without `fingerprint`.
  - Field codes (feature codes on `privateKey`/`passphrase`): plan 8's
    `SSH_KEY_PROBLEMS`, and `'name-taken'` on `name`.
  - `ERROR_CODES` gains `'key-locked'`, `'credentials-missing'`,
    `'host-key-changed'`.

- [ ] **Step 1: Write the failing tests**: `does not trim a password or a
      passphrase`; `refuses a private key over 16 KiB`; `trims names`; ids.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-contracts`.
- [ ] **Step 5: Commit** — `feat(contracts): add saved credentials schemas`

---

### Task 3: `server/feature/credentials` and the key unlock store

**Files:**

- Create (generated): `libs/server/feature/credentials` (`@nx/nest:library`,
  `server-feature-credentials`, tags `scope:server,type:feature`)
- Create: `src/unlocks/key-unlock-store.ts` (+ `.spec.ts`),
  `src/credentials.module.ts`, `src/testing/test-database.ts`
- Create: `libs/server/core/security/src/auth/session-lifecycle.ts` (+
  `.spec.ts`)
- Modify: `libs/server/feature/auth/src/sessions/session.service.ts` (+
  `.spec.ts`), `libs/server/core/config/src/config/*` (+ spec):
  `FRONT_BURNER_KEY_UNLOCK_IDLE` (default `1h`)

**Interfaces:**

- Produces:
  - `SessionLifecycle` (injectable, global from the security module): `revoked:
    Observable<string>` (session IDs); `notifyRevoked(sessionId: string): void`.
    `SessionService` calls it for every revoked session.
  - `KeyUnlockStore` (injectable):
    - `unlock(sessionId: string, credentialId: number, privateKeyText: string,
      passphrase: string): void` — `unlockPrivateKey`; throws `SshKeyError`;
    - `get(sessionId, credentialId, options: { touch: boolean }): UnlockedKey |
      undefined` — `touch: true` for git operations started by the user, which
      restarts the idle timer; `false` for everything else (AR-31, A-5.5);
    - `isUnlocked(sessionId, credentialId): boolean` (never touches);
    - `lock(sessionId, credentialId)`; drops every unlock of a session when
      `SessionLifecycle.revoked` emits it, and every unlock of a credential on
      `forgetCredential(credentialId)`. Timers are `unref`'d.

- [ ] **Step 1: Write the failing tests** (fake timers, plan 8's passphrase
      fixture): `unlocks with the right passphrase`; `refuses a wrong
      passphrase` (`SshKeyError` `wrong-passphrase`); `keeps an unlock to its
      session`; `locks after the idle time`; `extends the unlock on a git
      operation`; `does not extend the unlock when only looking`; `drops a
      revoked session's unlocks` (through `SessionService.revokeByRefreshToken`
      and `SessionLifecycle`).
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-credentials server-feature-auth`.
- [ ] **Step 3: Implement**; `npm run check:tags`.
- [ ] **Step 4: Run them and see them pass** — the same command.
- [ ] **Step 5: Commit** — `feat(credentials): unlock SSH keys per session`

---

### Task 4: Saved credentials and known hosts services

**Files:**

- Create:
  `libs/server/feature/credentials/src/saved/saved-credentials.service.ts` (+
  `.spec.ts`)
- Create:
  `libs/server/feature/credentials/src/known-hosts/known-hosts.service.ts` (+
  `.spec.ts`)

**Interfaces:**

- Consumes: Tasks 1 to 3, `SECRET_BOX`, plan 8's key functions.
- Produces:
  - `type Tx` = the Drizzle transaction type of `Database['db']`, exported from
    `server-core-database` if it is not already.
  - `SavedCredentialsService`:
    - `list(userId: number, sessionId: string): SavedCredentials`;
    - `findOwned(userId: number, id: number): SavedCredential` — throws the
      unknown-route `NotFoundException` for an unknown ID or another user's
      (AR-56);
    - `createHttps(tx: Tx, userId: number, input: NewHttpsCredentials): number`
      — `name-taken` as a field error on `name` (AR-18);
    - `createPastedKey(tx: Tx, userId: number, input: NewSshKey): number` —
      `inspectPrivateKey(privateKey, passphrase)`; errors as field errors on
      `privateKey` or `passphrase` (AR-27); stores the public key, fingerprint,
      type and whether it is protected (AR-28);
    - `generateKey(userId: number, name: string, comment: string):
      GeneratedSshKey` — saved at once (AR-29), `sshGenerated: true`;
    - `resolveForGit(userId: number, sessionId: string, id: number, options: {
      touch: boolean }): GitCredentials` — HTTPS → decrypted username and
      password; an unprotected key → `unlockPrivateKey(decrypted)`; a protected
      key → the session's unlock, or `ApiErrorException(409, 'key-locked', {
      keyId, keyName })` (AR-31); a `null` secret → `ApiErrorException(409,
      'credentials-missing')`.
    - `unlock(userId, sessionId, id, passphrase): void` — `findOwned`, decrypt,
      `KeyUnlockStore.unlock`; a wrong passphrase → field error `passphrase`
      `wrong-passphrase`.
  - `KnownHostsService`:
    - `linesFor(userId: number): string[]` (plan 8's `knownHostsLine`);
    - `trust(userId: number, request: TrustHostRequest): void` — recomputes the
      fingerprint; when the user already trusts another key of the same type for
      that host and port → `ApiErrorException(409, 'host-key-changed')` (AR-32:
      no way to replace it here); an identical key is accepted again without a
      second row.

- [ ] **Step 1: Write the failing tests** (test database): `stores HTTPS
      credentials encrypted` (the `secret` column does not contain the password;
      decrypting with the right binding gives it); `refuses a taken name`;
      `stores a pasted key with its public parts`; `refuses a DSA key on
      privateKey`; `saves a generated key at once`; `resolves HTTPS credentials
      for git`; `resolves an unprotected key without an unlock`; `asks for the
      passphrase of a locked key` (`key-locked` with `keyName`); `reports a
      reset secret as missing`; `lists without secrets and with the session's
      unlock state`; `answers 404 for another user's credential`; known hosts
      `trusts a host`, `writes the user's lines`, `refuses to trust a changed
      key`, `keeps one row when the same key is trusted twice`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-credentials`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      server-feature-credentials`.
- [ ] **Step 5: Commit** — `feat(credentials): save, generate and resolve
      credentials`

---

### Task 5: Credentials endpoints

**Files:**

- Create: `libs/server/feature/credentials/src/saved/credentials.controller.ts`
  (+ `.spec.ts`), `credentials.dto.ts`
- Create:
  `libs/server/feature/credentials/src/known-hosts/known-hosts.controller.ts` (+
  `.spec.ts`)
- Modify: `apps/server/src/app/app.module.ts`

**Interfaces:**

- Produces (all authenticated; generated as `CredentialsApi.list()`,
  `CredentialsApi.generateSshKey()`, `CredentialsApi.unlockSshKey()`,
  `KnownHostsApi.trust()`):
  - `GET credentials` → `SavedCredentials`;
  - `POST credentials/ssh-keys/generate` (`GenerateSshKeyRequest`) → `201
    GeneratedSshKey`, the comment `front-burner@<host>` with the host of the
    request without its port (AR-29);
  - `POST credentials/ssh-keys/:id/unlock` (`UnlockSshKeyRequest`) → `204`;
    `:id` parsed as a positive integer, else the unknown-route `404`;
  - `POST known-hosts` (`TrustHostRequest`) → `204`.

- [ ] **Step 1: Write the failing tests** (`supertest`, two users): `lists only
      the user's credentials`; `generates a key with the instance host as
      comment`; `unlocks a key and reports it unlocked in the same session
      only`; `reports a wrong passphrase on the field`; `answers 404 for another
      user's credential` (identical to an unknown ID, apart from
      `X-Request-Id`); `answers 404 for a non-numeric ID`; `trusts a host`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-credentials`.
- [ ] **Step 3: Implement**; regenerate the API client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test lint -p
      server-feature-credentials server web-api-client`.
- [ ] **Step 5: Commit** — `feat(credentials): add the credentials endpoints`

---

### Task 6: Credentials end-to-end test

**Files:**

- Create: `apps/server-e2e/src/credentials.e2e.spec.ts`

- [ ] **Step 1: Write the tests**. Pasting a key arrives with plan 11's add
      endpoint, so these tests seed a passphrase-protected key directly: a
      `saved_credentials` row whose secret is encrypted with `SecretBox` and the
      instance's test encryption key.
  - REQ-REPO-001 criterion 10, storage half: unlock the seeded key, log out, log
    in again: `unlocked` is `false`; the database file (with its `-wal`) and the
    server's log output contain neither the passphrase nor the decrypted key's
    base64 body.
  - Criterion 22: a second, seeded user's credential ID answers 404 to the first
    user, on `unlock` and in `list`.
  - `a generated key survives a restart`.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`. Expected: PASS.
- [ ] **Step 3: Commit** — `test(server-e2e): cover saved credentials`
