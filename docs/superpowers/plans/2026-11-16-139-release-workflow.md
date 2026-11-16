# Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 139 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): a tag
`v<major>.<minor>.<patch>` builds the image with that version, scans it, pushes
it, signs it with cosign, attaches build provenance and a CycloneDX SBOM, and
creates a GitHub release (NF-11.12, NF-7.2, NF-7.6).

**Architecture:** `.github/workflows/release.yml`, on `push: tags: ['v*.*.*']`
and on `workflow_dispatch` with `push: false` for a dry run. One job:

1. check that the tag is semantic versioning (NF-7.2) and strip the `v`;
2. build `tools/docker/Dockerfile` for `linux/amd64` only, loaded into the
   runner's Docker, with `FRONT_BURNER_VERSION` set to the version (plan 123's
   build argument). An `arm64` image is left until after the MVP (the index's
   "Left out"; `docs/wiki/todo.md`);
3. scan the loaded image with Trivy, as plan 137 does, before pushing;
4. push to `ghcr.io/<owner>/front-burner` _(plan's call: the GitHub Container
   Registry, with the workflow's own token)_ as `<version>`, `<major>.<minor>`
   and, for a version without a pre-release part, `latest`;
5. sign the pushed digest with keyless cosign (OIDC, `id-token: write`);
6. attest provenance with `actions/attest-build-provenance` and the SBOM with
   `actions/attest-sbom`, the SBOM made by Trivy in CycloneDX;
7. verify the signature with `cosign verify` against the workflow's identity, as
   the guide will tell operators to do (plan 140);
8. create a draft GitHub release with the SBOM attached and a body from
   `.github/release-notes.md`, a template with an "Upgrading" section (NF-7.2).

The release stays a draft until the operator publishes it.

**Tech Stack:** `docker/*` actions, `sigstore/cosign-installer`,
`aquasecurity/trivy-action`, `actions/attest-*`, all pinned to SHAs.

**Spec:** `docs/architecture/non-functional.md` NF-11.10 to NF-11.12, NF-7.2,
NF-7.6; plan 123's "As built" (the build argument).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Permissions are the least the job needs: `contents: write` (the release),
  `packages: write`, `id-token: write`, `attestations: write`.
- A dry run pushes, signs and releases nothing, and still builds, scans and
  makes the SBOM.
- The version in the image is the tag's: a step checks that the built image's
  `/api/v1` responses carry `X-Front-Burner-Version: <version>` before pushing.

## Review Focus

- **A tag that is not semantic versioning** (`v1.0`, `release-1`) fails before
  building → step 1.
- **A vulnerability found at release time** stops the push, not just the report
  → step 3 runs before step 4.
- **The image's version** matches the tag → the header check before pushing.

---

### Task 1: The workflow

**Files:**

- Create: `.github/workflows/release.yml`, `.github/release-notes.md`
- Modify: `README.md` (how a release is made), `docs/architecture/
  non-functional.md` (NF-11.12: where it runs), `docs/wiki/todo.md` (an `arm64`
  image, after the MVP: it needs a native ARM runner or a long emulated build,
  and `better-sqlite3` built for ARM in the deps stage)

- [ ] **Step 1: Write the workflow** with the eight steps above.
- [ ] **Step 2: Lint it** — `npx --yes @action-validator/cli
      .github/workflows/release.yml` or `actionlint` if installed; fix what it
      reports.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `ci: release workflow`.
- [ ] **Step 4: Ask the operator to run the dry run** from the Actions tab once
      the pull request is merged (a `workflow_dispatch` run needs the workflow
      on the default branch), and record its result in the pull request or,
      after plan 148, in `docs/wiki/release-checks.md`.
