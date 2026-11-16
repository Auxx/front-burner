# Review: Browser and Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 147 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
third part of the security review: what the browser runs and shows, and where
secrets live, travel and could leak.

**Architecture:** As plan 145: a section, "Browser and secrets", in
`docs/wiki/security-review.md`.

**Tech Stack:** as before.

**Spec:** `docs/architecture/security.md` A-7.9 to A-7.13;
`docs/architecture/web-client.md` A-8.12, A-8.13 (Trusted Types);
`docs/requirements/preview-html.md`, `docs/requirements/preview-images.md`;
`docs/architecture/non-functional.md` NF-3.5, NF-5.5, NF-8, NF-10.5, NF-11.1 to
NF-11.3; `docs/architecture/data.md` A-4.8 to A-4.11.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  and plan 145's rules for findings apply.
- What to read, at least:
  - the CSP as served, letter by letter against NF-11.1, on `index.html`, on
    deep links, on the 404 page and on errors; the nonce fresh per request;
  - every `innerHTML`, `bypassSecurityTrust…` and Trusted Types policy in the
    web client; what each lets through;
  - the sanitiser's whitelist against REQ-EDIT-002, with known bypasses (SVG,
    MathML, `<form>`, `<base>`, `srcset`, `xlink:href`, CSS in `style`);
  - the image loader as the only setter of image addresses (A-7.11a);
  - the image endpoint's headers (NF-11.3), for an SVG with a script;
  - CSRF (A-7.11): every state change needs the bearer token; the refresh
    endpoint's own check;
  - secrets at rest (NF-8.3): every encrypted column, associated data, the check
    value; nothing secret in a plain column;
  - secrets in transit and in logs (NF-10.5, A-3.5): API responses, events on
    the push channel, error messages from git, the log at `debug`;
  - the browser: drafts deleted on logout (NF-3.5), nothing secret in
    `localStorage`, the refresh cookie's scope.

## Review Focus

- **A Markdown file with `<svg><script>`** or `<img src=x onerror=…>` → test
  that the preview drops it and no request or script runs.
- **A git error that echoes a URL with a token** → test that neither the API's
  error record nor the log has the token.
- **`debug` logging** turned on → test that a full clone, save and push log no
  secret and no file content.

---

### Task 1: The review

**Files:**

- Modify: `docs/wiki/security-review.md` (the "Browser and secrets" section and
  a closing summary of all three), whatever a finding fixes with its test, the
  index's Part F if needed

- [ ] **Step 1: Read and record** each item in the section's table.
- [ ] **Step 2: Fix the small findings**, each test first.
- [ ] **Step 3: Write the summary**: the findings of plans 145 to 147, their
      outcomes, and the accepted limits (A-7.12, A-7.13) restated for the
      operator.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs: security review of the browser and
      secrets`.
