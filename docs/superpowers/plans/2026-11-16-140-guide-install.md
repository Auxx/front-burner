# Guide: Installing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 140 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
deployment guide takes an operator from nothing to a running, hardened instance:
the image and how to verify it, the compose file, volumes, the UID, restart and
stop settings, first start, and what the MVP does not have yet.

**Architecture:** Documents only, plus one example file. The guide's compose
example lives in `docs/wiki/compose.example.yaml` _(plan's call: a real file, so
plan 138's suite can start the exact example)_ and is quoted in the guide. It
has the image by tag, `read_only: true`, `/tmp` as tmpfs, `cap_drop: ALL`,
`no-new-privileges`, `restart: unless-stopped`, `stop_grace_period: 30s`, the
`/data` volume, the optional repositories volume, secrets as Docker secrets with
`…_FILE` variables, and a Caddy service in front _(plan's call: Caddy, as the
simplest HTTPS)_.

**Tech Stack:** Markdown, YAML.

**Spec:** `docs/architecture/non-functional.md` NF-5.1, NF-5.4, NF-5.6, NF-9.1,
NF-11.13, NF-8.2; `docs/product/mvp.md` (target user, out of scope);
`docs/wiki/todo.md` (the guide's list).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Every command in the guide is one an operator can paste; placeholders are
  `<like-this>`.
- The guide's current sections that describe features outside the MVP are
  rewritten for the MVP: SMTP is "not available yet" rather than "configure it
  later in the system settings"; OIDC stays, since it is in the MVP.
- Verifying the image uses the identity that plan 139's workflow signs with:
  `cosign verify --certificate-identity-regexp '…/release.yml@refs/tags/v.*'
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ghcr.io/<owner>/front-burner:<version>`.

## Review Focus

- **The example compose file** must actually start → plan 138's suite runs it
  (step 2).
- **A bind-mounted `/data`** owned by root is the most common first failure → a
  "Volumes and the UID" section with `chown 1000:1000`.

---

### Task 1: Installing

**Files:**

- Create: `docs/wiki/compose.example.yaml`
- Modify: `docs/wiki/deployment.md` (new sections: "The image", "Verifying the
  image", "Volumes and the UID", "Compose example", "First start", "What this
  release does not have"; the "Before you start" list),
  `apps/server-e2e/src/container.e2e.spec.ts` (start the example too),
  `docs/wiki/todo.md` (remove what is now written), `docs/product/mvp.md` (the
  **Deployment guide** row: **Built in**)

- [ ] **Step 1: Write the sections and the example.**
- [ ] **Step 2: Prove the example**: add `the guide's compose example becomes
      healthy` to the container suite, with the image and secrets overridden by
      a test override file; run it as plan 138 says.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs(deployment): installing`.
