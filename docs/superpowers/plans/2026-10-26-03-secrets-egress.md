# Stored Secrets and Outbound Address Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 3 of [the index](2026-10-26-00-roadmap.md): the backend can
encrypt and decrypt stored secrets with `FRONT_BURNER_ENCRYPTION_KEY`, refuses
to start with the wrong key, and every outbound connection it makes can be
checked against AR-57's address rules, with one shared HTTP client for
everything that is not git. Remote URLs are parsed once, for every later plan
that names a remote.

**Architecture:** A new `server/core/crypto` library owns AES-256-GCM with a key
derived by HKDF (A-4.8) and the startup check value (A-4.10). The address rules
of the egress spike (`spike/egress-proxy`, `lib/policy.js`) move into
`server/core/security` as typed functions, used by a new `EgressHttpClient`
built on `undici` (A-7.8) and, in plan 7, by the git egress proxy (A-5.8).
Nothing in this plan stores a real secret yet: plans 4, 5 and 10 register their
encrypted columns. Remote URL parsing and its "host/path" form go into plan 1's
`shared/util`, for the dashboard (plan 6), the git engine (plan 7) and the Add
repository form (plans 11 and 12).

**Tech Stack:** as before, plus `undici` 7.30.1 (the version bundled with Node
24.22, so that `fetch` behaves the same).

**Spec:** `docs/architecture/non-functional.md` NF-8.1 to NF-8.3, NF-8.5,
NF-8.6, NF-5.5; `docs/architecture/data.md` A-4.8, A-4.10, A-4.11;
`docs/architecture/overview.md` A-1.11 step 5, A-1.15;
`docs/architecture/security.md` A-7.8; `docs/architecture/git-engine.md` A-5.8;
`docs/requirements/repo-add.md` AR-8 to AR-10, AR-12, AR-13 (parsing only),
AR-17, AR-57; `docs/requirements/dashboard.md` DS-18, DS-19. Spike:
`spike/egress-proxy` (`spike/egress-proxy/lib/policy.js`, findings in
`docs/architecture/spikes.md`).

## Global Constraints

- The shared constraints of [the index](2026-10-26-00-roadmap.md) apply.
- Builds on plan 1: its `jwtSecret` (NF-8.1 compares the two keys) and its
  `shared/util` library.
- `FRONT_BURNER_ENCRYPTION_KEY` becomes **required**: update `.env.example`,
  `apps/server-e2e`'s `server-process.ts`, `apps/web-e2e`'s `instance.ts` and
  every server spec that builds an environment, in Task 1. Its test value
  differs from the JWT secret.
- The derived key, the plaintext and the encryption key never appear in a log or
  an error message; errors name the variable only.
- Address rules are exactly those of A-5.8 (AR-57's ranges plus `0.0.0.0/8`,
  `::/128`, multicast, `240.0.0.0/4`; with `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`
  also `100.64.0.0/10` and `fec0::/10`), after unwrapping IPv4-mapped, NAT64 and
  6to4 addresses.
- Port the spike's logic; do not copy its CommonJS style. The spike branch is
  never merged (A-9.1).

## Review Focus

- **An encrypted value copied into another row or another user's row** must not
  decrypt (NF-8.3) → Task 2 test `refuses a value bound to another record`.
- **A restart with the wrong key** must stop with a log entry that names
  `FRONT_BURNER_ENCRYPTION_KEY` and change nothing in the database → Task 3 test
  `refuses the wrong key and leaves the values alone`.
- **`FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm` left in place after the reset**
  (operators forget to remove it) must not delete secrets again on every restart
  → Task 3 test `ignores a reset when the key matches`.
- **The metadata address in a disguised form** (`::ffff:169.254.169.254`,
  `64:ff9b::a9fe:a9fe`, `2002:a9fe:a9fe::`, a host name resolving to it) must be
  refused like the plain address → Task 4 tests `refuses embedded IPv4 forms`
  and `refuses a name with any blocked address`.
- **A redirect from an allowed HTTPS server to a blocked address** must be
  refused at the second hop → Task 5 test `refuses a redirect to a blocked
  address`.

---

### Task 1: Encryption and egress configuration

**Files:**

- Modify: `libs/server/core/config/src/config/config.model.ts`, `load-config.ts`
  (+ `load-config.spec.ts`)
- Modify: `.env.example`, `apps/server-e2e/src/support/server-process.ts`,
  `apps/web-e2e/src/support/instance.ts`, server specs that pass an `env`

**Interfaces:**

- Produces (on `Config`): `encryptionKey: string` (also from
  `FRONT_BURNER_ENCRYPTION_KEY_FILE`, NF-8.2); `encryptionKeyReset: boolean`
  (`FRONT_BURNER_ENCRYPTION_KEY_RESET`, only the value `confirm` is accepted);
  `blockPrivateNetworks: boolean` (`FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`, `true`
  or `false`, default `false`).

- [ ] **Step 1: Write the failing tests**: `requires the encryption key`;
      `refuses a key shorter than 32 characters`; `refuses a key equal to the
      JWT secret` (issue on `FRONT_BURNER_ENCRYPTION_KEY`, message `must differ
      from FRONT_BURNER_JWT_SECRET`, NF-8.1); `reads the key from a file`;
      `accepts only confirm as a reset` (`yes` → issue `must be confirm`);
      `parses the private network switch` (`true`, `false`, default; `1` → issue
      `must be true or false`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-config`.
- [ ] **Step 3: Implement**, and update the environment files and specs.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-core-config server && npx nx e2e server-e2e`.
- [ ] **Step 5: Commit** — `feat(config): add the encryption key and the private
      network switch`

---

### Task 2: `server/core/crypto`

**Files:**

- Create (generated): `libs/server/core/crypto` with `npx nx g @nx/nest:library
  --directory=libs/server/core/crypto --name=server-core-crypto
  --importPath=@front-burner/server-core-crypto --unitTestRunner=vitest --strict
  --tags=scope:server,type:core --no-interactive`
- Create: `libs/server/core/crypto/src/secret-box/secret-box.ts` (+ `.spec.ts`),
  `src/crypto.module.ts`
- Modify: `docs/architecture/data.md` A-4.8 (the library is
  `server/core/crypto`; the stored format and the binding, as below)

**Interfaces:**

- Produces:
  - `interface SecretBinding { table: string; recordId: string | number;
    userId?: number }` — the associated data is
    `` `${table}\0${recordId}\0${userId ?? ''}` `` (NF-8.3).
  - `class SecretBox` (plain class, `new SecretBox(encryptionKey: string)`):
    - key: HKDF-SHA-256 of the UTF-8 key, empty salt, info
      `front-burner/secrets/v1`, 32 bytes;
    - `keyId: string` — 8 base64url characters of HKDF with info
      `front-burner/key-id` (identifies the key without revealing it, A-4.8);
    - `encrypt(plaintext: string, binding: SecretBinding): string` →
      `` `fb1.${keyId}.${base64url(nonce ‖ ciphertext ‖ tag)}` `` with a random
      12-byte nonce (NF-7.5);
    - `decrypt(stored: string, binding: SecretBinding): string` — throws
      `SecretDecryptionError` (message without the value) for another format,
      another key ID, or a failed tag check.
  - `CryptoModule.forRoot(config: Config)`: global, provides `SECRET_BOX`
    (`'FRONT_BURNER_SECRET_BOX'`) as `new SecretBox(config.encryptionKey)`.

- [ ] **Step 1: Write the failing tests**: `decrypts what it encrypted`; `uses a
      fresh nonce every time` (two encryptions differ); `refuses a value bound
      to another record` (other `recordId`, other `userId`, other `table`);
      `refuses another key` (`SecretDecryptionError`, and the message contains
      neither key nor plaintext); `refuses a tampered value`; `starts with the
      format and the key ID` (`/^fb1\.[\w-]{8}\./`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-crypto`.
- [ ] **Step 3: Implement** with `node:crypto` (`hkdfSync`,
      `createCipheriv('aes-256-gcm')`).
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test lint -p
      server-core-crypto && npm run check:tags`.
- [ ] **Step 5: Commit** — `feat(crypto): add server-core-crypto`

---

### Task 3: Check value and key reset at startup

**Files:**

- Modify: `libs/server/core/database/src/schema/instance-state.ts`,
  `schema/index.ts` (+ `schema.spec.ts`)
- Create: `libs/server/core/database/src/schema/encrypted-columns.ts`
- Create (generated):
  `libs/server/core/database/migrations/0002_encryption_check.sql`
- Create: `libs/server/core/crypto/src/check/check-encryption-key.ts` (+
  `.spec.ts`)
- Modify: `apps/server/src/startup/start-server.ts` (+ `.spec.ts`),
  `apps/server/src/app/app.module.ts` (`CryptoModule.forRoot`)
- Modify: `docs/architecture/data.md` A-4.10 and `non-functional.md` NF-8.6 (a
  reset acts only when the check value does not decrypt _(plan's call)_)

**Interfaces:**

- Produces:
  - `instanceState.encryptionCheck` (`encryption_check`), text, nullable.
  - `ENCRYPTED_COLUMNS: readonly EncryptedColumn[]` where `EncryptedColumn = {
    table: SQLiteTable; column: SQLiteColumn }`; empty in this plan. Every later
    table with an encrypted column adds its entry here; the columns are
    nullable, and `null` means "deleted by a key reset" (NF-8.6).
  - `checkEncryptionKey(database: Database, box: SecretBox, options: { reset:
    boolean }): 'stored' | 'verified' | 'reset'` — plaintext
    `front-burner-check`, binding `{ table: 'instance_state', recordId: 1 }`. No
    check value → stores one (`stored`). It decrypts → `verified` (a requested
    reset is ignored, with a returned flag the caller logs as a warning:
    "FRONT_BURNER_ENCRYPTION_KEY_RESET is set but the key matches; nothing was
    deleted. Remove the variable."). It does not decrypt: with `reset`, sets
    every `ENCRYPTED_COLUMNS` column to `null` and stores a new check value in
    one transaction (`reset`); without, throws `EncryptionKeyMismatchError` with
    the message "FRONT_BURNER_ENCRYPTION_KEY does not match the key this
    instance's secrets were encrypted with. Use the right key, or start once
    with FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm to delete every stored secret
    (NF-8.6)."
  - `StartupStep` gains `'encryption-key'`, run after `'migrations'` (A-1.11
    step 5).

- [ ] **Step 1: Write the failing tests**: in `check-encryption-key.spec.ts` (a
      test database with a temporary table registered in a local
      `ENCRYPTED_COLUMNS` replacement passed as a fourth, test-only argument):
      `stores a check value on first start`; `verifies the same key`; `refuses
      the wrong key and leaves the values alone`; `resets with the wrong key and
      confirm` (the column is `null`, the new key verifies); `ignores a reset
      when the key matches`. In `start-server.spec.ts`: `stops at encryption-key
      with another key` (start twice on one data directory with two keys; the
      second throws `StartupError` with step `encryption-key`).
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-crypto server`.
- [ ] **Step 3: Implement**: the column and its migration (named
      `encryption_check`), the registry, the check, and the startup step.
- [ ] **Step 4: Run them and see them pass** — the same command, then `npx nx
      e2e server-e2e`.
- [ ] **Step 5: Commit** — `feat(crypto): check the encryption key at startup`

---

### Task 4: Address policy

**Files:**

- Create: `libs/server/core/security/src/egress/address-policy.ts` (+
  `.spec.ts`)
- Modify: `libs/server/core/security/src/index.ts`

**Interfaces:**

- Produces:
  - `interface EgressOptions { blockPrivateNetworks: boolean }`.
  - `checkAddress(address: string, options: EgressOptions): 'allowed' |
    'reserved' | 'private'` — ranges as in the Global Constraints, built on
    `net.BlockList`; checks the address and its embedded IPv4 address
    (IPv4-mapped `::ffff:a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`).
  - `isValidHost(host: string): boolean` — a DNS name (the spike's `HOSTNAME`
    pattern) or an IP address; brackets around IPv6 removed by the caller.
  - `class EgressRefusedError extends Error` with `reason: 'invalid-host' |
    'not-found' | 'blocked'` and `host: string`.
  - `resolveAllowed(host: string, options: EgressOptions, lookup?: Lookup):
    Promise<LookupAddress[]>` — every address from `dns.lookup(host, { all:
    true, order: 'verbatim' })` (or the IP itself); throws
    `EgressRefusedError('blocked')` when **any** address is not `allowed`
    (A-5.8), `'not-found'` when there is none, `'invalid-host'` before
    resolving. `type Lookup = (host: string) => Promise<LookupAddress[]>`.

- [ ] **Step 1: Write the failing tests** (a fake `lookup` for names):
  - `refuses link-local and reserved addresses` (`169.254.169.254`, `fe80::1`,
    `0.0.0.0`, `::`, `224.0.0.1`, `240.0.0.1`, `ff02::1` → `reserved`, with and
    without the switch);
  - `refuses embedded IPv4 forms` (`::ffff:169.254.169.254`,
    `64:ff9b::a9fe:a9fe`, `2002:a9fe:a9fe::` → `reserved`);
  - `allows private and loopback addresses by default` (`10.0.0.1`,
    `192.168.1.1`, `127.0.0.1`, `::1`, `fd00::1`, `100.64.0.1`);
  - `refuses them with the switch` (the same list plus `fec0::1` → `private`);
  - `allows public addresses` (`140.82.112.3`, `2606:4700::1111`);
  - `refuses a name with any blocked address` (lookup gives a public and
    `169.254.169.254` → `blocked`);
  - `refuses an invalid host before resolving` (`'a b'`, `'-x.com'`,
    `'x'.repeat(254)`; the lookup is not called);
  - `resolves a numeric host form` (real `dns.lookup` of `'2852039166'` →
    `blocked`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-security`.
- [ ] **Step 3: Implement**, porting `policy.js` and the host check of
      `egress.js` from `spike/egress-proxy`.
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      server-core-security`.
- [ ] **Step 5: Commit** — `feat(security): add the outbound address policy`

---

### Task 5: The shared HTTP client

**Files:**

- Create: `libs/server/core/security/src/egress/egress-http-client.ts` (+
  `.spec.ts`)
- Create: `libs/server/core/security/src/egress/egress.module.ts`
- Create: `libs/server/core/security/src/testing/https-test-server.ts` and
  `src/testing/fixtures/test.crt`, `test.key`: copied from
  `spike/egress-proxy:spike/egress-proxy/fixtures/` (self-signed, valid until
  2036 for `localhost`, `127.0.0.1` and `::1`). Exported from a `testing` entry
  point (`@front-burner/server-core-security/testing`) as
  `startHttpsTestServer(handler): Promise<{ url: string; ca: string; close():
  Promise<void> }>`, for this and later specs
- Modify: `libs/server/core/security/src/index.ts`,
  `apps/server/src/app/app.module.ts`, `tsconfig.base.json` (the `testing` path
  alias, as for `@front-burner/web-core/app`)
- Modify: `docs/architecture/security.md` A-7.8 (built on `undici` with a
  checked `lookup`; HTTPS only; 10-second default timeout)

**Interfaces:**

- Consumes: `resolveAllowed`, `EgressRefusedError` (Task 4), `Config`.
- Produces:
  - `EGRESS_HTTP_OPTIONS = 'FRONT_BURNER_EGRESS_HTTP_OPTIONS'`, an optional `{
    ca?: string }` that tests provide; production trusts the system's
    certificate authorities and `NODE_EXTRA_CA_CERTS`.
  - `EgressHttpClient` (injectable, from the global `EgressModule`): `fetch(url:
    string | URL, init?: RequestInit & { timeoutMs?: number }):
    Promise<Response>` — refuses any scheme but `https:` with
    `EgressRefusedError('blocked')`; uses `undici`'s `fetch` with an `Agent`
    whose `connect.lookup` calls `resolveAllowed` with
    `config.blockPrivateNetworks` and hands back only checked addresses; follows
    redirects (each new connection goes through the lookup); aborts after
    `timeoutMs` (default 10 000). A refused lookup surfaces as
    `EgressRefusedError`, whatever error `undici` wraps it in.

- [ ] **Step 1: Write the failing tests** with the HTTPS test server: `fetches
      from an allowed address` (127.0.0.1, default options); `refuses loopback
      with the switch`; `refuses plain HTTP`; `refuses a redirect to a blocked
      address` (the server answers 302 to `https://169.254.169.254/`); `times
      out` (a server that never answers, `timeoutMs: 200`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-security`.
- [ ] **Step 3: Implement** the client and module; install `undici` 7.30.1.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test lint -p
      server-core-security server`.
- [ ] **Step 5: Commit** — `feat(security): add the shared outbound HTTP client`

---

### Task 6: Remote URL parsing in `shared/util`

**Files:**

- Create: `libs/shared/util/src/remote-url/remote-url.ts` (+ `.spec.ts`)
- Modify: `libs/shared/util/src/index.ts`

**Interfaces:**

- Produces:
  - `REMOTE_URL_MAX_LENGTH = 2048`.
  - `type RemoteUrlProblem = 'required' | 'too-long' | 'unsupported' |
    'credentials-in-url' | 'empty-path' | 'query-or-fragment'`.
  - `interface ParsedRemote { protocol: 'https' | 'ssh'; host: string; port:
    number | undefined; user: string | undefined; path: string }` (`host`
    without brackets; `path` as written, without the leading `/` of the URL
    forms).
  - `parseRemoteUrl(input: string): { ok: true; remote: ParsedRemote } | { ok:
    false; problem: RemoteUrlProblem }` — trims first (AR-8); then, in order:
    empty → `required`; longer than 2048 → `too-long`; `https://…` (WHATWG
    `URL`): user or password → `credentials-in-url` (AR-10), query or fragment →
    `query-or-fragment`, empty path → `empty-path`;
    `ssh://[user@]host[:port]/path` (`URL`, no password allowed: a password →
    `credentials-in-url`); any other `<scheme>://` → `unsupported`; scp-like
    `[user@]host:path` only when the part before the first `:` contains no `/`
    and no `\`, the host is a valid DNS name, an IPv4 address or a bracketed
    IPv6 address, and is longer than one character (so `C:\x` is a local path);
    everything else → `unsupported` (AR-9).
  - `remoteKey(remote: ParsedRemote): string` —
    `` `${host.toLowerCase()}/${path}` `` with leading `/` and `~/`, and
    trailing `/` and `.git` removed: the display form of DS-18 and the identity
    of AR-12.
  - `remoteDisplay(url: string): string` — removes any `user[:password]@` from
    an `https://` URL first, then gives `remoteKey` of the result; for a URL
    that still does not parse, the input with the credentials removed (DS-19).
  - `defaultRepositoryName(remote: ParsedRemote): string` — the last path
    segment without `.git` (AR-13).

- [ ] **Step 1: Write the failing tests**:
  - `accepts HTTPS and SSH forms` — `https://github.com/acme/handbook.git`,
    `https://git.example.com:8443/x/y`, `ssh://git@host:2222/srv/x.git`,
    `git@github.com:acme/handbook.git`, `host:repo`, `git@[::1]:x.git`,
    `'  https://h/x  '` (trimmed);
  - `refuses other schemes` — `http://h/x`, `git://h/x`, `file:///x`,
    `ftp://h/x` → `unsupported` (criterion 3);
  - `refuses local paths` — `/srv/x.git`, `./x`, `../x`, `~/x`, `C:\repos\x`,
    `x` → `unsupported`;
  - `refuses credentials` — `https://u:t@h/x`, `https://u@h/x`, `ssh://u:p@h/x`
    → `credentials-in-url`;
  - `refuses a query or a fragment`, `refuses an empty path` (`https://h/`,
    `git@h:`), `refuses a URL over 2048 characters`;
  - `gives one key for every form of a remote` —
    `https://github.com/acme/handbook.git`, `git@github.com:acme/handbook.git`,
    `ssh://git@GitHub.com:22/acme/handbook/` → `github.com/acme/handbook`;
  - `drops credentials from the display form`
    (`remoteDisplay('https://u:t@github.com/acme/handbook.git')` →
    `github.com/acme/handbook`; `remoteDisplay('https://u:t@h')` → `https://h`);
  - `names the repository after the last segment` (`handbook`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-util`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-util`.
- [ ] **Step 5: Commit** — `feat(util): parse remote URLs`
