# Review: Git and Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 146 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
second part of the security review: the file system, git and every outbound
connection, where a user's input becomes a path, a command or an address.

**Architecture:** As plan 145: a section, "Git and files", in
`docs/wiki/security-review.md`, with a table of rules, where they are enforced,
the test that proves them, and the outcome.

**Tech Stack:** as before.

**Spec:** `docs/architecture/security.md` A-7.6 to A-7.8, A-7.12;
`docs/architecture/git-engine.md`; `docs/architecture/non-functional.md` NF-11.6
to NF-11.8; `docs/requirements/repo-add.md` AR-51 to AR-57;
`docs/requirements/repo-credentials.md`.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  and plan 145's rules for findings apply.
- What to read, at least:
  - every path from a client goes through A-7.6's one function: search for `fs`
    and `path` calls in feature libraries that bypass it; symlinks inside a
    working copy that point out of it, for reading, writing, renaming, deleting
    and images; `..`, absolute paths, NUL, `.git` in any case, Unicode that
    normalises to `.git`;
  - git's arguments: every user value after `--` or validated (branch names,
    paths, remote URLs: `--upload-pack=`, `-c`, `ext::`); NF-11.6's protocol
    allow-list and NF-11.7's hardening on every command, including the ones the
    engine added in steps 4 and 5;
  - a repository's own `.git/config` and `.gitattributes` after a clone: can
    they make git run something (`core.fsmonitor`, `core.sshCommand`, filters,
    `diff.external`)?
  - the egress proxy (A-5.8, A-7.7): DNS rebinding between check and connect,
    redirects, IPv6 forms of private and link-local addresses, `0.0.0.0`;
  - credentials on the way to git: askpass helpers, environment, temporary files
    and their modes, removal on every path;
  - known hosts and host key checks (AR-32): no `StrictHostKeyChecking=no`
    anywhere;
  - NF-11.8's timeouts on every command, and the clone timeout.

## Review Focus

- **A cloned repository that sets `core.fsmonitor`** in its committed config →
  test that the engine's next `status` does not run it.
- **A symlink in a repository to `/etc/passwd`** → test that opening, the image
  endpoint and rename refuse it.
- **A remote whose name resolves to a public address at check time and
  `127.0.0.1` at connect time** → test of the egress proxy, with
  `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS=true`.

---

### Task 1: The review

**Files:**

- Modify: `docs/wiki/security-review.md` (the "Git and files" section), whatever
  a finding fixes with its test, the index's Part F if needed

- [ ] **Step 1: Read and record** each item in the section's table.
- [ ] **Step 2: Fix the small findings**, each test first.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs: security review of git and files`.
