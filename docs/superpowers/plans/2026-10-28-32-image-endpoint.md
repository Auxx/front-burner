# Image Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 32 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
API serves image files of the user's own working copy, as they are on disk, so
that the preview can show repository images. It serves only supported image
formats of up to 10 MB, never through a symbolic link, with headers that keep an
SVG from running anything, and with an `ETag` that makes revalidation cheap.

**Architecture:** In `server/feature/files`, one `GET` route answers raw bytes
instead of JSON (A-3.14): it resolves the path with plan 13's rules, checks the
extension and size, and streams the file. The `ETag` comes from the size and
modification time, so a revalidation never reads the file. The route is in the
OpenAPI document for other clients, and the generated web client skips it, as it
skips redirect routes, since the web client loads images with `fetch` (plan 33).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/preview-images.md` (REQ-EDIT-003: IM-4, IM-7, IM-9,
IM-23, IM-25, IM-26; the API halves of criteria 3, 6, 7, 13 and 16);
`docs/architecture/api.md` A-3.6, A-3.14; `non-functional.md` NF-11.1, NF-11.3;
`security.md` A-7.6.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- Route: `GET /api/v1/repositories/:id/image?path=` (`image`).
- **Formats** (IM-9), by extension, ignoring case, with the content type from
  the extension (never sniffed): `.png` `image/png`; `.jpg`, `.jpeg`
  `image/jpeg`; `.gif` `image/gif`; `.webp` `image/webp`; `.avif` `image/avif`;
  `.svg` `image/svg+xml`. Anything else: `415 image-format-unsupported` ("This
  image format isn't supported").
- **Size**: more than **10 MB = 10,485,760 bytes** is `413 image-too-large`
  ("This image is too large to preview").
- **Headers** (NF-11.3, A-3.14): `Content-Type` as above;
  `Content-Security-Policy: default-src 'none'; sandbox`;
  `X-Content-Type-Options: nosniff`; `ETag: "<size>-<mtimeMs>"`; `Cache-Control:
  private, no-cache`. A matching `If-None-Match` gets `304` with no body.
- Files are served from the working copy as on disk: uncommitted and ignored
  files too (IM-7). No lock is taken (A-5.3), so the file is opened through plan
  14's descriptor helper (`O_NOFOLLOW`, real path checked) and streamed from
  that descriptor, never reopened by path (A-7.6).
- Missing: `404 entry-not-found`; a path outside the working copy, in `.git` or
  through a symbolic link: `400 path-refused` (IM-4); another user's repository:
  `404 not-found`, as for one that does not exist (IM-25).
- The CSP's `img-src` is already `'self' blob: data: https:` (IM-23, NF-11.1);
  this plan only pins it with a test.

## Review Focus

- **An image replaced by a pull with the same size** must still get a new
  `ETag`: the modification time is part of it → Task 2 test `changes the ETag
  when the file is replaced`.
- **An SVG with an embedded script**, opened directly in a tab from the
  endpoint, must run nothing: the sandbox header is on every answer, `304`
  included → Task 2 test `sends the sandbox headers on every answer`.
- **A file named `x.png` that holds HTML** must still be sent as `image/png`
  with `nosniff`, never as HTML → Task 2 test `takes the content type from the
  extension only`.
- **A symbolic link named `logo.png`** pointing at `/etc/passwd` must be
  refused, not streamed → Task 2 test `refuses an image through a symbolic
  link`.
- **The generated client** must still compile and have no `image` method, and
  the generator must fail loudly if a JSON route stops being JSON → Task 1 test
  `skips routes that answer raw bytes`.

---

### Task 1: Contracts and the generator

**Files:**

- Create: `libs/shared/contracts/src/files/image.schema.ts` (+ `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `apps/web/public/i18n/en.json`, `libs/web/api-client/templates/api.ejs`, the
  api-client's template test

**Interfaces:**

- Produces: `ImageQuerySchema` (`id: 'ImageQuery'`): `{ path: string }`; shared
  error codes `image-format-unsupported` and `image-too-large` with their texts;
  `api.ejs` skips a route whose success responses (`2xx`) have no
  `application/json` content, like a redirect-only route, with a comment saying
  why.

- [ ] **Step 1: Write the failing tests**: `skips routes that answer raw bytes`
      (the template test, with a fixture operation whose `200` is `image/png`);
      contracts: `ImageQuery` id.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      shared-contracts web-api-client`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(api-client): skip routes that answer raw bytes`

---

### Task 2: Serving images

**Files:**

- Create: `libs/server/feature/files/src/images/image-files.ts` (+ `.spec.ts`),
  `src/images/images.controller.ts` (+ `.spec.ts`)
- Modify: `src/files.module.ts`

**Interfaces:**

- Consumes: `OpenableRepository.root`, `toFilesError` (plan 14);
  `resolveInWorkingCopy` (plan 13).
- Produces:
  - `IMAGE_TYPES: Readonly<Record<string, string>>` (extension → content type);
    `ImageFiles.open(root: string, path: string): Promise<{ absolute: string;
    type: string; size: number; etag: string }>`.
  - `ImagesController.image(req, params, query, res)` — answers as Global
    Constraints say, streaming with `createReadStream`; documented in OpenAPI
    with each image content type as a binary `200`, and `304`, `400`, `404`,
    `413`, `415`.

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-003.3: serves an image that
      is not committed`; `serves an ignored image`; `takes the content type from
      the extension only`; `sends the sandbox headers on every answer`; `answers
      304 to a matching If-None-Match`; `changes the ETag when the file is
      replaced`; `AC-EDIT-003.7: refuses a missing image, a 12 MB PNG and a
      .tiff with their codes`; `refuses an image through a symbolic link`;
      `AC-EDIT-003.6: refuses ../ paths and .git paths`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-files`.
- [ ] **Step 3: Implement**; regenerate the OpenAPI document and the client (no
      new method).
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-feature-files server web-api-client`.
- [ ] **Step 5: Commit** — `feat(files): serve repository images`

---

### Task 3: API end-to-end tests and status

**Files:**

- Modify: `apps/server-e2e/src/files.e2e.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `AC-EDIT-003.13: serves an SVG with a script
      sandboxed`; `AC-EDIT-003.16: answers another user's repository like a
      missing one`; `keeps img-src as IM-23 says` (the CSP header of
      `index.html`); `counts image requests in the per-user rate limit`
      (NF-11.4).
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`; all pass.
- [ ] **Step 3: Update the status**: REQ-EDIT-003 → **In progress**, Built in
      `image-endpoint`, MVP points not built: everything except IM-4's backend
      check, IM-7, IM-9's backend check, IM-23, IM-25 and IM-26's headers. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(files): cover
      the image endpoint`.
