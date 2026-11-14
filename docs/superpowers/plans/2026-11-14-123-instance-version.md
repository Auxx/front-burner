# Instance Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 123 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
backend knows the instance's version and sends it with every API response, and
the user menu shows it as "Front Burner 1.4.2" (NV-7's last bullet). Plan 124
uses the header to ask for a reload.

**Architecture:** The version is fixed at build time: the root `package.json`'s
`version` (now `0.0.0`), or `FRONT_BURNER_VERSION` set by the Docker build, read
once by `server/core/config` _(plan's call: a release image's build sets it from
the release tag; any other build says its `package.json` version)_. The release
image itself is step 6's; here only `tools/docker/Dockerfile`, the testing
image, passes the build argument. A middleware sets `X-Front-Burner-Version` on
every `/api` response, errors included. The web client's build embeds the same
version (an Angular environment value written at build time), so that the two
can be compared (A-8.7). The user menu reads the web client's own version: it is
the code that runs.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/navigation.md` (NV-7, AC-APP-001.3);
`docs/architecture/non-functional.md` (NF-7.6, NF-10.9);
`docs/architecture/web-client.md` (A-8.7).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- The health endpoints stay free of the version (NF-10.9): the header is on
  `/api/v1` responses only.
- The header is listed in `docs/architecture/security.md`'s headers and in
  CORS's exposed headers if CORS is configured.
- The version is a plain string; a client compares it for equality only, never
  orders it.
- `docs/wiki/deployment.md` is not changed here (step 6).

## Review Focus

- **Every API response,** an error and a `304` included, has the header → test
  `sets the version on errors too`.
- **Health** has no version → test `the health endpoints have no version`.
- **The menu** shows the web client's version → test `shows the version in the
  user menu`.

---

### Task 1: The version header

**Files:**

- Modify: `libs/server/core/config/src/` (the config, + spec),
  `apps/server/src/startup/start-server.ts`, `tools/docker/Dockerfile` (the
  build argument), `apps/server-e2e/src/api.e2e.spec.ts`,
  `docs/architecture/api.md`

**Interfaces:**

- Produces: `Config.version: string`; the header `X-Front-Burner-Version`.

- [ ] **Step 1: Write the failing tests**: `sets the version on every API
      response`; `sets the version on errors too`; `the health endpoints have no
      version`; `takes the version from FRONT_BURNER_VERSION`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-config`,
      then `npx nx e2e server-e2e`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same commands.
- [ ] **Step 5: Commit** — `feat(server): send the instance's version`

---

### Task 2: The user menu's version line

**Files:**

- Modify: `apps/web/` (the build-time version value), `libs/web/core/src/` (an
  injection token for it), `libs/web/shell/src/shell/components/user-menu/*` (+
  spec), `apps/web/public/i18n/en.json`, `apps/web-e2e/src/app-header.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces: `APP_VERSION: InjectionToken<string>`.

- [ ] **Step 1: Write the failing tests**: `shows the version in the user menu`;
      end to end, `the user menu shows the display name, email and version`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-shell`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-APP-001 adds `instance-version`, and
      removes NV-7. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(shell): show the version in the user
      menu`.
