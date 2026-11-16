# Password Reset Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 136 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
operator who forgot their password gets back in without email: `node main.js
reset-password <email>`, run in the stopped instance's container, reads a new
password, checks it against the password policy, stores it and revokes every
session of that user. This answers the MVP's first risk ("Locked out without
SMTP"), which plan 143 documents.

**Architecture:** `apps/server/src/startup/cli.ts` already parses
`--write-openapi`; it learns a second form, `reset-password <email>` _(plan's
call: a command, not a flag, since it does something)_. The command runs the
start-up steps up to the encryption key check (configuration, data directory,
database, newer-schema check), but **does not migrate**: a database that needs
migrations is refused, "Start the instance once to upgrade the database, then
stop it and run this again". It reads the password twice from standard input,
without echo on a terminal and as two lines from a pipe, and uses the auth
library's existing password hashing and policy check (REQ-AUTH-002). It logs one
line at `warn` with the user's ID, "Password of user 1 reset from the command
line; every session revoked", and exits 0. Any refusal exits 1 with one line on
stderr. The login audit log is not written: a reset is not a login attempt, and
LG-43's reasons stay as they are.

The command is new MVP scope. `mvp.md` gets it in section 1 of "In scope", as an
operator tool with no requirement points, and plan 143 marks the risk resolved.

**Tech Stack:** as before. `node:readline` for the prompt. No new packages.

**Spec:** `docs/product/mvp.md` ("Risks": locked out without SMTP);
`docs/requirements/auth-onboarding.md` ("Out of scope": recovering an instance
where all administrators are lost); `docs/requirements/auth-password-policy.md`;
`docs/requirements/auth-login.md` (sessions, the login audit log).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Only a password user can be reset; an OIDC user is refused with "This user
  signs in with OIDC". An unknown email is refused with "No password user with
  this email". Emails match ignoring case, as at login.
- The password never appears in the process arguments or the log.
- The command does not detect a running instance. The guide (plan 143) says to
  stop the instance first, and the command's `--help` says the same. NF-4.2
  allows one process.
- `docs/requirements/auth-onboarding.md` is not changed: this is an operator
  tool, recorded in `docs/architecture/security.md` (A-7) and the guide.

## Review Focus

- **A password that breaks the policy** is refused with the policy's own message
  and changes nothing → test `refuses a password that breaks the policy`.
- **Two entries that differ** → test `refuses when the two entries differ`.
- **Old sessions** on the operator's lost phone stop working → test `revokes
  every session of the user`.

---

### Task 1: The command

**Files:**

- Create: `apps/server/src/startup/reset-password.ts` (+ spec)
- Modify: `apps/server/src/startup/cli.ts` (+ spec), `apps/server/src/main.ts`,
  the auth library's exports if the hashing and policy are not exported yet,
  `docs/architecture/security.md`, `docs/product/mvp.md` (section 1 of "In
  scope": the command, as an operator tool)

**Interfaces:**

- Produces: `parseCommand(argv: string[]): { kind: 'serve' } | { kind:
  'write-openapi'; file: string } | { kind: 'reset-password'; email: string }`;
  `resetPassword(options: { env; email: string; input: Readable; output:
  Writable; migrationsFolder: string }): Promise<number>` (the exit code).

- [ ] **Step 1: Write the failing tests**: `parses reset-password with an
      email`; `refuses reset-password without an email`; `sets a new password
      and the user can log in with it`; `revokes every session of the user`;
      `refuses a password that breaks the policy`; `refuses when the two entries
      differ`; `refuses an unknown email`; `refuses an OIDC user`; `refuses a
      database that needs migrations`; `logs the reset with the user's ID and
      without the password`; `writes nothing to the login audit log`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Test end to end**: in `apps/server-e2e/src/login.e2e.spec.ts`,
      `after reset-password the old password fails and the new one works`, with
      the server stopped between. Run `npx nx e2e server-e2e`.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(server): reset-password command`.
