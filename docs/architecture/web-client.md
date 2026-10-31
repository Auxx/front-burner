# Front Burner — Web client

> Status: **Draft**

How the Angular web client is structured. See [modules.md](modules.md) for its
libraries and [overview.md](overview.md) for the numbering conventions.

## A-8: Structure and state

- **A-8.1** `apps/web` holds the shell and routes; each feature library is
  loaded lazily from a route (A-2.2). The initial JavaScript stays within 300 KB
  gzipped (NF-2.9). The bundler puts every module that the initial code can
  reach into the initial bundle, even one only a lazy feature uses, so the shell
  imports `web/core` only through its `@front-burner/web-core/app` entry point
  and loads `ui` components it does not need at first render with `@defer`. _(My
  call.)_
- **A-8.2** Component state uses **signals**. Services that hold more complex or
  shared state (current repository, file tree, sync state) use **RxJS** and
  expose signals to components where that is simpler. No NgRx.
- **A-8.3** API calls go through `web/api-client` (A-3.6). Forms validate with
  the same Zod schemas as the backend (A-3.3).

## A-8: Core services (`web/core`)

- **A-8.4** **Auth:** follows LG-40: keeps the auth token and token expiry times
  in `localStorage`, refreshes through the cookie (LG-31, LG-32), and runs at
  most one refresh at a time across tabs with the Web Locks API.
- **A-8.5** **Push channel client:** opens `GET /api/v1/events` with `fetch`
  streaming and the auth token (A-3.10); reconnects with backoff, after a token
  refresh, and when the page becomes visible again; after every reconnect it
  asks the affected services to fetch current state (A-3.11).
- **A-8.6** **Errors:** maps error codes to text with Transloco (A-3.8) and
  shows the request ID reference (NF-10.6).
- **A-8.7** **Version check:** when a response's version header differs from the
  loaded version, asks the user to reload (NF-7.6).
- **A-8.8** **Transloco:** English at launch, translation files loaded on
  demand, language switched without reloading, ICU messages through our own
  Transloco transpiler on `intl-messageformat` (FormatJS, no `eval`), because
  `@jsverse/transloco-messageformat` compiles with `new Function`, which
  NF-11.1's CSP forbids. Zod runs `jitless` in the web client for the same
  reason. A message uses one syntax: `{{ x }}` messages are Transloco
  interpolation, not ICU (a plain `{name}` in them stays literal), and a message
  that mixes both is logged and shown raw. A malformed message is logged and
  shown raw (NF-14).

## A-8: Saving

- **A-8.9** **Save queue** (D-1, NF-3):
  - a save is sent after the user stops typing for **1.5 seconds** _(My call,
    within D-1.1's 1–2 seconds)_;
  - saves for one file are sent one at a time; when a save is in flight, only
    the newest content waits behind it;
  - a failed save is kept and retried with backoff; the status shows "Saved",
    "Saving…" or "Not saved — offline, retrying" (NF-3.1, NF-3.2).
- **A-8.10** **Drafts:** unsaved content is written to IndexedDB, keyed by user,
  repository and file, and deleted when the save is confirmed; drafts are
  offered back, never applied automatically, and deleted on logout (NF-3.3 to
  NF-3.5).

## A-8: Editor and preview

- **A-8.11** `web/code-editor` wraps **CodeMirror 6**, with Markdown and YAML
  front matter highlighting, `EditorView.cspNonce` set (NF-11.1), and the
  accessibility behaviour of NF-13.3. The editor, the conflict-marker view and
  the three-way merge editor all use it.
  - The extensions used (no `basicSetup`): history, selection drawing, search,
    the key bindings, the Markdown language with front matter, syntax
    highlighting, soft wrap (switched with a `Compartment`, with the wrap-marker
    gutter that marks wrapped lines), line numbers with the active-line gutter,
    per-line text direction and the spell-check attributes. Line numbers and the
    wrap-marker gutter left the median unchanged in emulation (one run each);
    one keystroke in 50 reached 74 ms; to be repeated on a phone (spike 3, note
    of 2026-10-31). The phone check of this list is to be repeated
    (`docs/wiki/typing-test.md`).
  - Typing stays within NF-2.4 on its own: at a 4× CPU slowdown, keystrokes in a
    200 KB file took at most 32–40 ms, and in a 1 MB file 40–56 ms, right at the
    limit (spike 3).
  - The editor's lazy chunk was 224 KB gzipped, a large share of it the HTML,
    CSS and JavaScript languages that `@codemirror/lang-markdown` always pulls
    in for embedded HTML. NF-2.2 on slow 4G needs it trimmed: no `basicSetup`,
    only the extensions used. Trimmed so, the repository screen's editor pane
    chunk, loaded with `@defer`, is 163 KB gzipped (estimated transfer size of
    `nx build web`, 2026-10-29), and the initial bundle 108 KB (NF-2.9). A 100
    KB file is editable within 2 s on slow 4G with the chunk not cached
    (`apps/web-e2e/src/editor.spec.ts`, AC-EDIT-001.2).
  - On a real phone (spike 3, rounds 2 and 3), typing in a 1 MB file was too
    slow with highlighting and as fast as in a 2 KB file without it; soft wrap,
    spell check and per-line text direction made no difference. So on narrow
    screens a file over 100 KB opens without the Markdown language (ED-9a), and
    **Turn on highlighting** adds it through a `Compartment`, without recreating
    the editor or losing its undo history (ED-8).
  - Syntax colours are CSS classes, never inline styles: `classHighlighter` plus
    a small highlighter for the Markdown tags it has no class for (quote, inline
    code, marks, HTML tags and attributes), styled on the `--ui-syntax-*` tokens
    (A-10.14). Both run in the same pass over the syntax tree.
  - Enter inserts a line break and Tab a tab, nothing more: CodeMirror's own
    Enter indents the new line and clears a line of spaces, and `indentWithTab`
    indents the whole line (ED-9, ED-11, ED-12). `Esc` then `Tab` moves the
    focus out, which CodeMirror handles before any key binding (NF-13.3).
- **A-8.12** `web/markdown` holds the preview pipeline (D-7.3 to D-7.5) and the
  one component that writes sanitised HTML to the page (D-7.6). It is loaded
  lazily with the editor. Confirmed by spike 3 (spikes.md).
  - **Rendering is incremental.** Rendering a whole 200 KB file took 0.8–0.9 s
    at a 4× CPU slowdown, mostly parsing (about 110 ms on a desktop even with
    highlighting cached), so NF-2.5 cannot be met by re-rendering everything.
    The source is split into top-level blocks by a line scanner (a block ends
    before a non-indented line after a blank line, unless it is a list item, and
    before an ATX heading; never inside a fenced code block or a multi-line raw
    HTML block). Each block is keyed by a hash of its text and only blocks the
    page does not hold yet are rendered. Link reference definitions are appended
    to every block, so references work across blocks. With this, the preview
    updated 120–130 ms after the last keystroke, debounce included.
  - **Footnotes are numbered across blocks.** _(Plan 29's call: rendered on its
    own, every block would number its footnotes from 1 and list them.)_ The
    worker numbers footnotes in the order they are first referenced in the whole
    file; each block is rendered with stand-in definitions of the footnotes it
    references, given their numbers and reference IDs in the file, and without a
    footnote list. One last block, keyed by the definitions and their order,
    lists every footnote. A block's key includes the numbers of its footnotes,
    so a renumbered footnote re-renders the blocks that reference it.
  - **Heading IDs** are GitHub's slugs with the `user-content-` prefix, computed
    per block in the worker; the preview component de-duplicates them in
    document order.
  - **The DOM is patched per block.** The component keeps one element per block,
    sanitises only new blocks, removes blocks that are gone and inserts new ones
    without moving the rest. Blocks use `content-visibility: auto`, and the
    preview pane has a fixed size with `contain: strict`, so its contents never
    affect the page's layout.
  - **The preview follows GitHub's Markdown layout** (its spacing, sizes and
    structure) in the product's colours. Each block is its own formatting
    context, so the space between blocks is set on the block elements, whose
    margins collapse as GitHub's elements' do.
  - DOMPurify returns `TrustedHTML` (`RETURN_TRUSTED_TYPE`), which the component
    assigns to each block's `innerHTML`; Angular's `bypassSecurityTrustHtml` is
    not used (D-7.6).
  - **Hostile markup is stripped twice.** `rehype-sanitize` (GitHub's schema
    plus `className`) removes it from the syntax tree before Shiki and before
    the HTML exists; DOMPurify stays the one gate. Without the first step,
    Chrome reports every inline handler and style that DOMPurify meets as a CSP
    violation, because its inert document inherits the page's policy: blocked
    and harmless, but it would flood violation reports.
  - Shiki's styles become classes through a small transformer of our own on the
    `pre`, `code`, `line` and `span` hooks (D-7.5). Shiki's theme is our own:
    each colour is a `--ui-syntax-*` token, given to a list of TextMate scopes,
    and the transformer turns it into a class `sk-<token>` that the preview's
    stylesheet colours with that token (A-10.14). So code blocks match the
    editor in both schemes, and no CSS is generated at run time. Highlighting
    uses `@shikijs/rehype`'s `cache` option.
  - The preview waits 100 ms after typing stops for files up to 256 KB and 1 s
    above that (NF-2.5 allows larger files to update more slowly), so a large
    preview never updates between keystrokes. _(My call: 256 KB leaves a margin
    above NF-2.5's 200 KB.)_
  - **On phones, the preview is not on screen while typing** (Edit and Preview
    tabs). At 1 MB, a visible preview of ~4,400 blocks made 10–17 of 48
    keystrokes exceed 50 ms (worst 64–88 ms), although it updated only once;
    hidden, typing matched the editor alone. A preview that is not on screen
    (Edit on any screen) neither reads the text nor renders; shown again, it
    renders the newest text at once.
  - **Scroll syncing works in places of the file** (ED-35, ED-36). A place is a
    fractional line: in the preview, the top block's first line plus the share
    of the block's height above the top, spread over the block's lines
    (`data-from-line`, `data-to-line`); in the editor, the top line plus the
    share of its height above the top. So both panes show the same block, and
    the same share of it. Only the pane the user last scrolled, touched, clicked
    or typed in leads, so the scrolls that syncing causes, which come late and
    keep coming while a scroll on a phone glides, never sync back. When the view
    mode or the screen size changes, the place that the panes on screen last
    reported while scrolling is applied to the panes shown after it. It is not
    read at the switch: by then the tabs may have hidden the pane already.
- **A-8.13** The pipeline (remark, `rehype-sanitize`, Shiki) runs in a **Web
  Worker**; DOMPurify runs on the main thread, since it needs a DOM. Per update
  both modes were equally fast, but the first render of a 200 KB file blocked
  the main thread for about 3 s at a 4× slowdown, while the worker took about 1
  s (unthrottled; more on a phone) without blocking typing.
  - Trusted Types make `new Worker(url)` require a `TrustedScriptURL`, and the
    Angular builder only bundles a worker written literally as `new Worker(new
    URL('./x.worker', import.meta.url))`. The code shadows `Worker` with a
    subclass that passes the URL through a policy (`fb-worker`) allowing only
    same-origin `worker-*.js` files, with no query or with the
    `?worker_file&type=module` that the development server adds.
  - The build adds the `worker` export condition (`conditions: ["module",
    "worker"]`). The builder resolves the worker with the `browser` condition,
    which picks DOM-based builds of some packages
    (`decode-named-character-reference` calls `document.createElement`);
    `worker` comes first in their export maps. The development server's
    dependency pre-bundling (Vite) ignores these conditions, so `ng serve` runs
    with `prebundle: false` and the builder bundles the dependencies itself.
    _(Plan 30's call: with pre-bundling, the worker got the DOM build and failed
    with `document is not defined`.)_
  - The main thread loads only CodeMirror, DOMPurify and the component; the
    pipeline is 164 KB gzipped in the worker, and each Shiki language and theme
    is its own chunk.

## A-8: Shell and repository screen

- **A-8.14** `web/shell` (A-2.5) renders the app header, the user menu, the
  global banners, page titles and breadcrumbs (REQ-APP-001). The routes of NV-1
  live in `apps/web`; logging out in one tab reaches the others through a
  `storage` event (NV-8).
- **A-8.15** `feature-repository-screen` keeps the state of the open file —
  content, undo history, save queue, browser draft, content hash of the last
  load or save — in a per-file store keyed by repository and path, not in the
  screen, so that tabs can be added later (ED-3). Changes to the open file on
  disk are found by comparing `files.changed` events with that hash (A-3.11,
  ED-24).
- **A-8.16** **Image loader** (REQ-EDIT-003), in `web/markdown`: DOMPurify's
  step moves every image address into a pipeline attribute (`data-md-src` on
  `img`, `data-md-srcset` on `source`), which the browser does not read, so no
  address written in the file loads anything on its own (IM-24). After each
  patch of the preview, the loader puts a placeholder in each image's place. On
  the main thread, an `IntersectionObserver` loads repository images within 200
  px of the viewport, at most 4 at a time per tab (IM-8), through `HttpClient`
  with `responseType: 'blob'`, so the auth interceptor adds the token and
  refreshes it as for any other request, into `blob:` URLs cached per repository
  screen and revalidated with `If-None-Match` (A-3.14, IM-10). _(Plan 33's call:
  `HttpClient` rather than `fetch`, to keep one token path.)_ Remote images are
  set only after **Show remote images**. It also picks the `<source>` of a
  `<picture>` with `matchMedia` (IM-12).
