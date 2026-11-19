# Guide: Secrets and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 143 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
guide explains the instance's secrets, how to make and keep them, and how to
recover from losing the encryption key or the administrator's password. This
closes the MVP's first risk ("Locked out without SMTP").

**Architecture:** Documents only. A "Secrets" section gathers what is now spread
over "Environment variables": the two required secrets and how to generate them
(`openssl rand -base64 48`), the setup token, the metrics token, `…_FILE` and
Docker secrets, why the encryption key is backed up apart from the volume
(NF-5.5, NF-6.1), and what changing the JWT secret does. A "Recovery" section
has two procedures:

- **A lost encryption key** (NF-8.6): the reset variable, what is lost and what
  each user must enter again, removing the variable afterwards, and the warning
  logged if it stays.
- **A lost password** (plan 136): stop the instance, `docker compose run --rm
  front-burner node main.js reset-password <email>`, start it; every session of
  that user ends. The guide warns, as A-7.2a does, never to use `docker exec` in
  the running container: the command does not detect a running instance, which
  would keep accepting the revoked sessions. An OIDC administrator recovers
  through their provider instead.

**Tech Stack:** Markdown.

**Spec:** `docs/architecture/non-functional.md` NF-5.5, NF-6.1, NF-8.1, NF-8.2,
NF-8.5, NF-8.6; `docs/product/mvp.md` ("Risks"); plan 136.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Key rotation (NF-8.4) is not described: it is not in the MVP. The guide says
  the key can't be changed in place yet and that a new key means the reset.
- `docs/product/mvp.md`'s first risk gets "_Resolved._" with a link to the
  section, as the second risk has.

## Review Focus

- **Running `reset-password` while the instance runs** is not detected (plan
  136, A-7.2a): the procedure stops the instance first, uses `docker compose run
  --rm`, and warns against `docker exec`.
- **Leaving `FRONT_BURNER_ENCRYPTION_KEY_RESET` set** after a reset deletes
  nothing but logs a warning: the procedure says so, so that nobody panics.

---

### Task 1: The two sections

**Files:**

- Modify: `docs/wiki/deployment.md`, `docs/wiki/todo.md`, `docs/product/mvp.md`
  ("Risks" and the **Deployment guide** row)

- [ ] **Step 1: Write the sections.**
- [ ] **Step 2: Follow both procedures once** against `tools/docker/
      compose.yaml` and fix the text where it is wrong.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs(deployment): secrets and recovery`.
