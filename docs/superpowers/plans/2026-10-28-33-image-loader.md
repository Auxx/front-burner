# Image Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 33 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
live preview shows the images a Markdown file embeds. Repository images are
loaded through the API with the auth token and shown through `blob:` URLs, only
when they are near the visible part and at most four at a time. Remote images
wait for **Show remote images**. Every image that is not shown gets a
placeholder with its alt text and the reason.

**Architecture:** In `web/markdown` (A-8.16). DOMPurify's step moves every image
address into a pipeline attribute, so no address written in the file reaches the
page on its own (IM-24). After each patch, an `ImageLoader` turns every image
into a placeholder and resolves its address. An `IntersectionObserver` then
queues the repository images near the viewport, fetched by an `ImageCache` that
the repository screen provides once and that revalidates with `If-None-Match`.
Remote images are set only after the user asks, per open file.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/preview-images.md` (REQ-EDIT-003: IM-1 to IM-6,
IM-8, IM-10 to IM-22, IM-24, IM-26; criteria 1 to 15 in the browser);
`docs/architecture/web-client.md` A-8.16; `api.md` A-3.14.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- **Addresses** (IM-1 to IM-5): no scheme and no host is a repository path,
  resolved from the Markdown file's folder, or from the root when it starts with
  `/`; percent-decoded; query and fragment dropped; case kept. Climbing above
  the root or into `.git` (any case) is refused without a request. `https:` and
  protocol-relative are remote; `http:` is insecure; anything else is refused.
  The same for every `srcset` candidate.
- **Pipeline attributes**: DOMPurify's hook replaces `src` on `img` with
  `data-md-src` and `srcset` on `source` with `data-md-srcset`; plan 28's first
  step has already removed every `data-` attribute written in the file, so the
  file cannot set them (SH-5, IM-24). `purifyConfig()` allows exactly these two.
- **Loading** (IM-6, IM-8, IM-10): through `HttpClient` with `responseType:
  'blob'` and `observe: 'response'`, so the auth interceptor adds the token and
  refreshes it _(plan's call: A-8.16 said `fetch`; this keeps one token path,
  and A-8.16 is updated)_; at most **4** requests in flight per tab; queued when
  within 200 px of the preview's viewport, dropped from the queue when it
  scrolls away before its turn. The cache keeps `{ blobUrl, etag }` per path
  while the repository screen is open; it revalidates an entry with
  `If-None-Match` when its file is opened again and when `files.changed` names
  its folder or `all`; `304` keeps it. Blob URLs that no image uses are revoked,
  keeping at most 100 unused ones _(plan's call)_.
- **Placeholders** (IM-18), exactly: "Image not found: {address}" (`404`, the
  address as written); "This image is too large to preview" (`413`); "This image
  format isn't supported" (any extension outside IM-9, without a request;
  `415`); "Can't show this image" (refused address, `400`); "This image couldn't
  be loaded" (anything else); "Remote image from {host}"; "Remote image couldn't
  be loaded"; "Insecure image (http) isn't shown". A placeholder is a
  `role="img"` element whose accessible name is the alt text and the reason
  (IM-21), built with DOM methods only (never HTML strings), inside the image's
  link if it has one (IM-19).
- **Sizes** (IM-11): the file's `width` and `height` are kept; images never
  exceed the preview's width and keep their proportions; space is reserved with
  `aspect-ratio` when both are known. The loading state respects
  `prefers-reduced-motion` (IM-22).
- **Remote images** (IM-13 to IM-17): one **Show remote images** button, with
  the note "Loading them lets these sites see your IP address.", inserted before
  the first block that holds a remote image; it loads every remote image of the
  open file, including ones added later, with `referrerPolicy = 'no-referrer'`;
  the choice ends when another file is opened. `http:` images are never loaded.
- **`<picture>`** (IM-12): the first `<source>` whose `media` matches and whose
  `type` is empty or one of IM-9's types, else the `<img>`; within a `srcset`,
  the `x` candidate closest above the device pixel ratio (or the largest), or
  for `w` candidates the smallest at least the preview's width times the ratio
  (or the largest). Changes of the colour scheme or the window size re-pick, and
  load only the newly picked image.

## Review Focus

- **An image address written in the file appearing in the page's HTML at any
  moment** (even for one frame before the loader runs) would let the browser
  load it → Task 2 test `leaves no src or srcset in purified HTML`.
- **Typing in a paragraph above 200 images** must re-request none of them, since
  unchanged blocks keep their elements and re-rendered blocks hit the cache →
  Task 5 test `AC-EDIT-003.8: loads only nearby images, four at a time, and none
  again while typing`.
- **An expired auth token during image loading** must refresh once and load the
  images, not show "couldn't be loaded" → Task 3 test `refreshes an expired
  token and loads`.
- **`![](../../etc/passwd)` from `docs/a.md`** must be refused before any
  request, and a percent-encoded `..` (`%2e%2e/`) the same → Task 1 test
  `refuses climbing above the root, also percent-encoded`.
- **Switching the colour scheme with a dark-mode `<picture>`** must request only
  the newly picked image, once → Task 4 test `re-picks a picture source when the
  scheme changes`.

---

### Task 1: Resolving addresses

**Files:**

- Create: `libs/web/markdown/src/markdown/images/resolve-image.ts`,
  `libs/web/markdown/src/markdown/images/pick-source.ts` (each + `.spec.ts`)

**Interfaces:**

- Produces:
  - `type ImageTarget = { kind: 'repository'; path: string } | { kind: 'remote';
    url: string; host: string } | { kind: 'insecure' } | { kind: 'refused' } | {
    kind: 'unsupported' }`.
  - `resolveImageAddress(filePath: string, address: string): ImageTarget`
    (`unsupported` for a repository path whose extension is not in IM-9).
  - `parseSrcset(value: string): { url: string; x?: number; w?: number }[]`;
    `pickCandidate(candidates, env: { ratio: number; width: number }): string |
    null`; `pickPictureSource(picture: { sources: { media: string | null; type:
    string | null; srcset: string }[]; img: string | null }, env: {
    matches(media: string): boolean; ratio: number; width: number }): string |
    null`.

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-003.1: resolves relative,
      parent and root paths from docs/guide.md`; `AC-EDIT-003.5: decodes
      percent-encoding and drops the query`; `refuses climbing above the root,
      also percent-encoded`; `refuses .git in any case`; `classifies https,
      protocol-relative and http`; `marks unsupported extensions`; srcset and
      picture rules, one test each.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): resolve image addresses`

---

### Task 2: Taking addresses out of the HTML

**Files:**

- Modify: `src/markdown/purify/purify-html.ts` (+ spec),
  `src/markdown/whitelist/derive.ts` (+ spec), the XSS corpus spec

**Interfaces:**

- Produces: `purifyHtml` moves image addresses into `data-md-src` and
  `data-md-srcset` as Global Constraints say.

- [ ] **Step 1: Write the failing tests**: `leaves no src or srcset in purified
      HTML`; `keeps the address in the pipeline attribute`; `drops a data-md-src
      written in the file` (it never reaches DOMPurify: the first step removed
      it); the corpus spec additionally asserts no `src` on `img`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): keep image addresses out of the
      page`

---

### Task 3: The image cache

**Files:**

- Create: `src/markdown/images/image-cache.ts` (+ `.spec.ts`)
- Modify: `libs/web/markdown/src/index.ts`

**Interfaces:**

- Produces:
  - `type ImageResult = { kind: 'loaded'; url: string } | { kind: 'failed';
    reason: 'not-found' | 'too-large' | 'unsupported' | 'refused' | 'error' }`.
  - `ImageCache` (provided by the repository screen page, so one per screen):
    `load(repositoryId: number, path: string): Promise<ImageResult>` (shares one
    request between images of the same path, and the tab-wide limit of 4);
    `use(path): () => void` (counts users; the returned function releases);
    `revalidate(paths: readonly string[] | 'all'): void`; `changed:
    Observable<string>` (a path whose bytes changed on revalidation, so the
    loader swaps the image); `destroy()` revokes every URL.

- [ ] **Step 1: Write the failing tests** (`HttpTestingController`): `loads an
      image as a blob URL with the token` (the request has `Authorization` and
      no token in its URL); `maps each error status to its reason`; `shares one
      request for the same path`; `never runs more than four requests`;
      `revalidates with If-None-Match and keeps the URL on 304`; `reports a
      changed image after revalidation`; `revokes unused URLs over the limit`;
      `refreshes an expired token and loads`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): cache repository images`

---

### Task 4: The loader and placeholders

**Files:**

- Create: `src/markdown/images/image-loader.ts` (+ `.spec.ts`),
  `src/markdown/images/image-placeholder.ts` (+ `.spec.ts`),
  `src/markdown/images/remote-images.ts` (+ `.spec.ts`)
- Modify: `markdown-preview.component.*` (+ spec),
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: Tasks 1 to 3.
- Produces:
  - `MarkdownPreviewComponent` gains the input `repositoryId: number`; after
    each patch it calls `ImageLoader.attach(newBlocks)` and, for removed blocks,
    `detach`.
  - `ImageLoader` (one per preview): placeholders, the observer and queue,
    swapping a loaded image in, picture re-picking on `matchMedia` changes,
    re-trying a failed image when its block is rendered again or the file is
    opened again (IM-19).
  - `RemoteImages` (one per preview, reset on `path` change): `shown:
    Signal<boolean>`, the button and note, loading with no referrer.

- [ ] **Step 1: Write the failing tests**: `shows a placeholder until the image
      is near the viewport`; `AC-EDIT-003.7: shows each reason with the alt
      text`; `AC-EDIT-003.14: keeps the link around a placeholder`;
      `AC-EDIT-003.15: names a placeholder by alt text and reason`; `reserves
      the space of an image with width and height`; `re-picks a picture source
      when the scheme changes`; `AC-EDIT-003.11: shows remote placeholders and
      loads them after Show remote images, with no referrer`; `AC-EDIT-003.12:
      never loads http images`; `forgets Show remote images when another file is
      opened`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): load images in the preview`

---

### Task 5: On the repository screen, and end-to-end tests

**Files:**

- Modify:
  `libs/web/feature-repository-screen/src/repository-screen/pages/repository-screen/*`
  (provides `ImageCache`), `services/tree-sync/*` (revalidates on
  `files.changed`), `components/editor-pane/*` (passes `repositoryId`);
  `apps/web-e2e/src/support/fixtures/*` (images: PNG, SVG with a script, a 12 MB
  PNG, a `.tiff`, a symbolic link to an image outside, 200 small images, a dark
  and a light logo); `apps/web-e2e/src/preview.spec.ts`;
  `docs/architecture/web-client.md` (A-8.16: `HttpClient` instead of `fetch`);
  `docs/product/mvp.md`

- [ ] **Step 1: Write the failing test**: `revalidates images when their folder
      changes` (screen spec).
- [ ] **Step 2: Run it and see it fail, implement, see it pass** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Write the end-to-end tests**: `AC-EDIT-003.1` to
      `AC-EDIT-003.15`, each in the browser; for `AC-EDIT-003.4` the requests
      are read from `page.on('request')` (the `Authorization` header, no token
      in any URL, `blob:` sources in the page); for `AC-EDIT-003.8: loads only
      nearby images, four at a time, and none again while typing` the image
      requests are counted while scrolling and typing; for `AC-EDIT-003.9` the
      test writes new bytes into the image file in the instance's `dataDir`,
      then creates a file in the same folder through the API so that
      `files.changed` names the folder (the pull of the criterion comes with
      step 4), and the preview shows the new image; for `AC-EDIT-003.11` no
      request to the remote host is made before the button; `has no axe
      violations` with placeholders shown.
- [ ] **Step 4: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 5: Update the status**: REQ-EDIT-003 → **Built** or **Done** as its
      criteria say, Built in adds `image-loader`; REQ-EDIT-001 and the other
      step 2 rows checked against their definitions. Run `doc-ids.mjs criteria`
      and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit
      `feat(repository-screen): show images in the preview`.
