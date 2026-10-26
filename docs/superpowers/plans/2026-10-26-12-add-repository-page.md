# Add Repository Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 12 of [the index](2026-10-26-00-roadmap.md): from **Add
repository** on the dashboard the user fills in one form (remote URL, name,
credentials, clone mode and branch), sees mistakes next to the field they
concern, and lands on the dashboard, where the new repository shows **Cloning**
and becomes openable without a reload.

**Architecture:** A new `web/feature-repositories` library, loaded lazily under
`/repositories` (A-2.2), with the Add repository page split into one component
per form section; the page owns one Signal Forms model and passes each section
its slice. Field checks use the contracts' schemas (A-8.3); the backend's field
codes from plan 11 are mapped to AR-42's texts in one place. The dashboard
listens to plan 9's push channel for `repository.status` and reloads its list
after every reconnect (DS-23, A-3.11).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-add.md` (REQ-REPO-001: AR-1, AR-4 to AR-16,
AR-19 to AR-26, AR-29 to AR-48 client side; criteria 1, 2, 4 to 9, 12 to 15, 18,
20, 26); `docs/requirements/dashboard.md` DS-14, DS-23 (criterion 14);
`docs/requirements/navigation.md` NV-13, NV-14. Architecture: `web-client.md`
A-8.2, A-8.3, A-8.5; `api.md` A-3.11.

## Global Constraints

- The shared constraints of [the index](2026-10-26-00-roadmap.md) apply.
- Uses plan 11's API exactly: `RepositoriesApi.index()`, `.accessCheck()`,
  `.add()`; plan 10's `CredentialsApi.list()`, `.generateSshKey()`,
  `.unlockSshKey()`, `KnownHostsApi.trust()`; plan 3's `parseRemoteUrl`,
  `remoteKey`, `defaultRepositoryName`; plan 9's `PushChannelService`; plan 2's
  `authGuard`, `CurrentUserService` (with plan 11's `allowedGitLevels`).
- Every text of AR-9, AR-10, AR-11, AR-12, AR-15, AR-19, AR-20, AR-22, AR-29,
  AR-33, AR-34, AR-37, AR-42, AR-45 and AR-55 is used exactly as written there.
- Page title "Add repository · Front Burner"; breadcrumbs "Repositories › Add
  repository" with **Repositories** a link (NV-13, NV-14).
- Passphrases, passwords, tokens and private keys stay in component memory only:
  never in a URL, `localStorage`, `sessionStorage` or a log (AR-17).
- `web-e2e` cannot import server libraries (A-2.4), so it runs its own small
  HTTPS git server (`git http-backend` behind Node's `https`, with a copy of the
  test certificate, the backend started with `GIT_SSL_CAINFO`) for the real
  paths, and stubs the API with `page.route` for the SSH-only screens.

## Review Focus

- **Editing the URL after editing the name** must leave the name alone, and
  switching the URL from HTTPS to SSH must clear the HTTPS choices (AR-13,
  AR-16, criterion 4) → Task 1 test `stops filling the name once edited` and
  Task 2 test `clears the other protocol's choices`.
- **A failed submit** must keep every field except passphrases, and the form
  must become editable again (AR-46) → Task 5 test `keeps the form but not the
  passphrases after a failure`.
- **Typing in the URL or token while a branch list is loading** must not show a
  stale branch list for the previous URL or credentials (AR-35) → Task 4 test
  `drops a branch list for an outdated URL`.
- **Leaving with changes**, by **Cancel**, a link, the back button or closing
  the tab, must ask first; an untouched form, or one only holding a generated
  key, must not (AR-48, criterion 20) → Task 5 tests.
- **The tab staying open while the backend restarts during a clone** must still
  show the final status without a reload (DS-23) → Task 6 test `reloads the list
  after a reconnect`.

---

### Task 1: `web/feature-repositories`, the route, URL and name

**Files:**

- Create (generated): `libs/web/feature-repositories` (`npx nx g
  @nx/angular:library --directory=libs/web/feature-repositories
  --name=web-feature-repositories
  --importPath=@front-burner/web-feature-repositories --prefix=repo
  --unitTestRunner=vitest-angular --tags=scope:web,type:feature
  --no-interactive`), feature `repositories`, page `add-repository`, component
  `remote-section`
- Create:
  `libs/web/feature-repositories/src/repositories/repositories.routes.ts`
- Modify: `apps/web/src/app/app.routes.ts` (+ `app.spec.ts`): under the shell,
  `{ path: 'repositories', canActivate: [ authGuard ], loadChildren: … }` before
  `**`; `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces:
  - `repositoriesRoutes`: `new` → `AddRepositoryPage`, title
    `web-feature-repositories.AddRepositoryPage.title`. An unmatched child
    (`/repositories` itself, until REQ-REPO-003) falls through to "Page not
    found".
  - `AddRepositoryPage`: `h1` "Add repository" (`tabindex="-1"`),
    `ui-breadcrumbs`, one Signal Forms model `AddRepositoryForm` (`remoteUrl`,
    `name`, `credentials`, `cloneMode`, `branch`, `understood`, `gitLevel`), and
    the index from `RepositoriesApi.index()` loaded once.
  - `RemoteSectionComponent` (inputs: the `remoteUrl` and `name` fields, the
    index): **Remote URL** with `RemoteUrlSchema` (problem codes → AR-9 and
    AR-10's texts); the duplicate warning "You already have this remote as
    {names}." when `remoteKey` matches an indexed remote (AR-12, not blocking);
    **Repository name**, filled with `defaultRepositoryName` while the user has
    not edited it (AR-13), checked with `RepositoryNameSchema` and against the
    index ignoring case ("You already have a repository named {name}", AR-15).
  - `protocol: Signal<'https' | 'ssh' | undefined>` on the page, from
    `parseRemoteUrl`.

- [ ] **Step 1: Write the failing tests**: `rejects http, git, file URLs and
      local paths with "Use an HTTPS or SSH URL"`; `rejects a URL with
      credentials` (criterion 3's texts); `fills the name from the URL`
      (`handbook`); `stops filling the name once edited` (criterion 4); `warns
      about a remote the user already has` (an index entry for
      `github.com/acme/handbook`, the URL in its SSH form); `rejects a taken
      name in any case` (criterion 5); page `shows the breadcrumbs`; routes
      `opens the page at /repositories/new` and `shows Page not found at
      /repositories`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      web-feature-repositories web`.
- [ ] **Step 3: Implement**; `npm run check:tags`.
- [ ] **Step 4: Run them and see them pass** — the same command and `npx nx
      build web`.
- [ ] **Step 5: Commit** — `feat(repositories): add the Add repository page with
      URL and name`

---

### Task 2: Credentials for HTTPS

**Files:**

- Create (generated components): `credentials-section`, `https-credentials`
  (each + `.spec.ts`)
- Modify: `add-repository.page.*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `CredentialsApi.list()` (loaded once with the page).
- Produces:
  - `CredentialsSectionComponent` (inputs: `protocol`, the `credentials` field,
    the saved credentials): "Enter the remote URL first" while the protocol is
    unknown (AR-11); the HTTPS or SSH component otherwise; when the protocol
    changes, the `credentials` value is reset to that protocol's default
    (AR-16).
  - `HttpsCredentialsComponent`: a `ui-choice` of **Use saved credentials**
    (only with saved HTTPS credentials; then the default; a `ui-select` listing
    "name (username)"), **Add new credentials** (the default otherwise;
    **Credentials name**, **Username**, **Password or token** with
    `uiPasswordReveal` and AR-20's hint), **No credentials (public repository)**
    (AR-22's hint) (AR-19, AR-20). It writes the `RepositoryCredentials` value
    (`saved`, `new-https` or `none`).

- [ ] **Step 1: Write the failing tests**: `asks for the URL first`; `offers new
      and no credentials without saved ones` (criterion 6's first half);
      `preselects saved credentials when there are some`; `checks the new
      credentials' fields`; `clears the other protocol's choices`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 5: Commit** — `feat(repositories): choose HTTPS credentials`

---

### Task 3: Credentials for SSH

**Files:**

- Create (generated components): `ssh-credentials`, `generated-key` (each +
  `.spec.ts`)
- Modify: `credentials-section.component.*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `CredentialsApi.generateSshKey()`, `CredentialsApi.unlockSshKey()`.
- Produces:
  - `SshCredentialsComponent`: **Use a saved key** (only with saved keys; then
    the default; options show name, key type and fingerprint, and a lock icon
    with "Passphrase" for protected keys, AR-24); for a protected key, "Unlocked
    for this session" when `unlocked`, otherwise a required masked
    **Passphrase** (AR-25), sent as `credentials.passphrase`; **Paste a key**
    (the default without saved keys; **Key name**, **Private key** as a
    `ui-textarea`, optional masked **Passphrase**, AR-26); **Generate a key**
    (AR-29).
  - `GeneratedKeyComponent`: **Key name** and **Generate**; after a successful
    `generateSshKey` it shows the public key read-only, **Copy** (clipboard and
    the toast "Copied"), AR-29's instructions and the required checkbox "I have
    added this key to my git server"; the key becomes a `saved` credential of
    the form. **Generate** is offered once per visit; switching away and back
    shows the same key, which also appears under **Use a saved key** (AR-30).
  - The page keeps passphrases only in their fields and clears them after every
    submit (AR-46).

- [ ] **Step 1: Write the failing tests**: `offers paste and generate without
      saved keys` and `offers saved keys with protected ones marked` (criterion
      8); `asks for the passphrase of a locked key` and `says a key is unlocked
      for this session` (criterion 9); `generates a key once and shows its
      public key with Copy`; `requires the key-added checkbox` (criterion 12's
      first half); `keeps the generated key when switching options`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 5: Commit** — `feat(repositories): choose, paste or generate an SSH
      key`

---

### Task 4: Clone mode, branch and git control level

**Files:**

- Create (generated components): `clone-section`, `level-section` (each +
  `.spec.ts`)
- Create (generated service): `branch-list` (+ `.spec.ts`)
- Modify: `add-repository.page.*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `RepositoriesApi.accessCheck()`.
- Produces:
  - `BranchListService` (provided by the page): `state: Signal<{ kind: 'idle' }
    | { kind: 'loading' } | { kind: 'loaded'; branches: string[]; defaultBranch:
    string | null } | { kind: 'failed'; error: ApiError }>`; `request(remoteUrl,
    credentials)` — waits 500 ms after the last call _(plan's call for AR-35's
    timing)_, cancels any request in flight, and ignores a response whose inputs
    are no longer current; `retry()`.
  - `CloneSectionComponent`: **Full clone** / **Single branch** with AR-33's
    descriptions (`ui-segmented-control` or `ui-choice`); for single branch the
    **Branch** `ui-select` (loading state; branches sorted as received, the
    default preselected; the error under it with **Try again**; "This repository
    has no branches" for an empty remote, AR-37), AR-34's warning and the
    required "I understand" checkbox. The page calls `request` when single
    branch is chosen and the URL and credentials are valid, and again when
    either changes (AR-35).
  - `LevelSectionComponent`: hidden when `allowedGitLevels` has one entry, which
    is then used (AR-40); otherwise a `ui-select` in the order Simple, Guided,
    Advanced, each with a one-line description, defaulting to the highest
    (AR-38, AR-39).

- [ ] **Step 1: Write the failing tests**: `loads the branches when single
      branch is chosen` (criterion 14: the default preselected, warning and
      checkbox shown); `drops a branch list for an outdated URL`; `shows the
      error with Try again`; `says an empty remote has no branches`; `hides the
      level with one allowed level` (criterion 15's UI half); `defaults to the
      highest allowed level`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 5: Commit** — `feat(repositories): choose the clone mode and
      branch`

---

### Task 5: Submit, errors, the host key dialog and leaving the page

**Files:**

- Create:
  `libs/web/feature-repositories/src/repositories/utils/add-repository-errors.ts`
  (+ `.spec.ts`)
- Create (generated dialog): `trust-host` (+ `.spec.ts`)
- Create:
  `libs/web/feature-repositories/src/repositories/guards/unsaved-changes.guard.ts`
  (+ `.spec.ts`)
- Modify: `add-repository.page.*`, `repositories.routes.ts`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces:
  - `fieldErrorText(path: string, code: string, params): string` and
    `formErrorText(error: ApiError): string` — the one place where plan 11's
    codes become AR-42's texts (`host-unreachable` → "Can't reach {host}. Check
    the URL.", `remote-timeout` → "{host} didn't answer in time. Try again
    later.", `credentials-refused` → "These credentials can't access the
    repository." plus "Has the key been added to your git server?" when
    `generatedKey`, `credentials-required` → "This repository needs
    credentials.", `rate-limited` → "Too many attempts. Try again in a minute.",
    and so on for every row).
  - `TrustHostDialogComponent` (`DIALOG_DATA`: `HostKey`): "Do you trust this
    server?", the host, key type and fingerprint (monospace), **Trust** and
    **Cancel** (AR-32).
  - Page submit: **Add repository** disabled while invalid, while a request of
    the form runs, while single branch has no loaded branches, and until a
    generated key's checkbox and "I understand" are ticked (AR-7); the whole
    form is read-only during the submit. `add()`: on `201` it navigates to `/`
    with `history.state.addedRepository = name` (AR-45); on `409
    host-key-unknown` (from either the access check or the submit) it opens the
    dialog, and **Trust** calls `KnownHostsApi.trust` and repeats the request,
    **Cancel** leaves the form as it was; field errors go to their fields,
    others above the buttons (AR-6); passphrases are cleared (AR-46).
  - **Cancel**: back to the previous page in the web client's history, or `/`
    (AR-47).
  - `unsavedChangesGuard: CanDeactivateFn<AddRepositoryPage>` — when any field
    was changed (a generated key alone does not count) and no submit succeeded,
    asks with `DialogService.confirm` "Discard your changes?"; the page also
    sets `beforeunload` while changed (AR-48).

- [ ] **Step 1: Write the failing tests**: `maps every AR-42 failure to its text
      and place`; `disables Add repository while a submit runs and makes the
      form read-only` (criterion 2's UI half); `goes to the dashboard after
      adding`; `keeps the form but not the passphrases after a failure`; `asks
      to trust an unknown host and repeats the check` and `leaves the form as it
      was on Cancel` (criterion 13's UI half); guard `asks before leaving a
      changed form`, `leaves an untouched form at once`, `does not count a
      generated key as a change` (criterion 20).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test lint -p
      web-feature-repositories && npx nx build web`.
- [ ] **Step 5: Commit** — `feat(repositories): submit the new repository`

---

### Task 6: The dashboard after adding, and live status

**Files:**

- Modify:
  `libs/web/feature-dashboard/src/dashboard/pages/dashboard/dashboard.page.*` (+
  spec), `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `PushChannelService.events` and `.reconnected`, `ToastService`.
- Produces:
  - On arrival with `history.state.addedRepository`, the toast "Cloning {name}.
    It will be ready to open soon." (AR-45).
  - While the page is open it subscribes to the push channel: a
    `repository.status` event for a listed repository updates that entry's
    status and error in place (DS-23); an event for an unlisted one, and every
    `reconnected`, reloads the list (A-3.11). The subscription ends with the
    page.

- [ ] **Step 1: Write the failing tests** (a fake `PushChannelService`): `shows
      the cloning message after adding`; `makes a cloning repository openable
      when its clone ends` (criterion 14); `reloads the list after a reconnect`;
      `reloads the list for an unknown repository`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-dashboard`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      web-feature-dashboard && npx nx build web`.
- [ ] **Step 5: Commit** — `feat(dashboard): follow clones as they finish`

---

### Task 7: Add repository end-to-end tests

**Files:**

- Create: `apps/web-e2e/src/add-repository.spec.ts`
- Create: `apps/web-e2e/src/support/git-http-server.ts` and
  `apps/web-e2e/src/support/fixtures/test.crt`, `test.key` (copies of plan 3's
  fixtures)
- Modify: `apps/web-e2e/src/support/instance.ts` (option `gitCaFile`, passed as
  `GIT_SSL_CAINFO`)

- [ ] **Step 1: Write the tests**, against a logged-in, onboarded instance and a
      local HTTPS git server with a public bare repository (`main`, `feature/x`)
      and a private one (Basic auth):
  - REQ-REPO-001 criteria 1, 2 (double click on **Add repository** → one
    repository on the dashboard), 4, 6 (add with new credentials, then the next
    visit preselects them), 7 (the public one with **No credentials**), 14, 15
    (no level dropdown), 18 (lands on the dashboard with "Cloning handbook. It
    will be ready to open soon.", the entry first as **Cloning**, then openable
    without a reload; DS criterion 14), 20, 26 (phone projects and 320 px: no
    sideways scroll); axe on the empty form, the HTTPS form with errors, and the
    single-branch section; title and breadcrumbs.
  - With `page.route` stubs of `credentials`, `credentials/ssh-keys/generate`
    and `repositories/access-check`: criteria 8, 9 (the passphrase field, and
    "Unlocked for this session" after a stubbed unlock), 12 (generated key,
    **Copy**, the checkbox gate), 13 (the trust dialog: **Trust** repeats the
    check; **Cancel** leaves the form), and the generated-key hint of AR-42.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`. Expected: PASS in every
      project of the matrix.
- [ ] **Step 3: Commit** — `test(web-e2e): cover adding a repository`
