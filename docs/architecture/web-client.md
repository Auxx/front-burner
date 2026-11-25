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
  asks the affected services to fetch current state (A-3.11). Shortly before the
  auth token expires (30 seconds, or half the time left for a shorter-lived
  token), it renews the token and opens a second stream with it, closing the
  first only once the second is open: no event falls between them, so this is
  not a reconnect, and the screen does not reload its state at every token
  expiry. A renewal that cannot reach the backend leaves the session alone; the
  first stream then ends at the expiry and reconnects. _(My call: the stream
  handover, after reloads at every expiry were seen to blink the screen and lose
  the editor's focus.)_
- **A-8.6** **Errors:** maps error codes to text with Transloco (A-3.8) and
  shows the request ID reference (NF-10.6).
- **A-8.7** **Version check:** when a response's version header differs from the
  loaded version, asks the user to reload (NF-7.6). An HTTP interceptor in
  `web/core` reads `X-Front-Burner-Version` (`VERSION_HEADER` of the contracts)
  on every answer of `HttpClient`, errors too, and the push channel on each
  answer of its stream, so that a tab that only listens learns of an upgrade
  when the stream reconnects. Both compare it with `APP_VERSION` for equality
  only; an answer without the header, such as a proxy's error page, changes
  nothing. Once on, the new-version banner (NV-15) stays until the page reloads.

  **Reload** runs what the open pages registered with
  `VersionCheckService.beforeReload`, for up to 5 seconds, then reloads whatever
  they answered. The repository screen writes its waiting content as browser
  drafts and sends its waiting saves (ED-17), so a save that fails or hangs
  keeps its draft (NF-3), and it does not ask "Leave page?" while
  `VersionCheckService.reloading` is on. A page whose unsaved work would be
  lost, such as the Add repository form, still asks; when the user stays,
  **Reload** can be used again.

  The offline banner follows the browser's `online` and `offline` events
  (`OnlineStatusService`). The low-space banner (NF-9.7) follows
  `StorageStatusService.low`, which only an administrator's tab reads from `GET
  /instance/storage` (A-3.2h): on start, every 5 minutes while the tab is
  visible, after a push channel reconnect, and at once after a `low-storage`
  error, which an HTTP interceptor reports, so that a refused clone shows the
  banner without waiting. A tab that comes back into view reads at once only
  when the last read is older than 5 minutes. A read that fails keeps the last
  state; a `403`, for a user who is no longer an administrator, and a logout
  turn it off, and the `403` stops the reads until the next login. _(Plan 132's
  call: the disk monitor publishes no event, and a disk fills slowly.)_ The
  banners are `shell-app-banners`, below the app header and, on the repository
  screen, below its bar, above the page's own notices (NV-16); each is announced
  once when it appears. Its icon comes from the sprite, which the backend lets
  the browser cache for good (A-7.9), so that it is drawn while offline. _(Plan
  124's call: the banners show whenever the user is logged in, also before the
  user has loaded and while the repository screen opens, as the offline banner
  then says why nothing comes.)_
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
    "Saving…" or "Not saved — offline, retrying" (NF-3.1, NF-3.2). A save
    answered `507 storage-full` (A-3.2i) is retried the same way, and the status
    shows "Server storage is full — not saved" (NF-9.8). _(Plan 133's call.)_
- **A-8.10** **Drafts:** unsaved content is written to IndexedDB, keyed by user,
  repository and file, and deleted when the save is confirmed; drafts are
  offered back, never applied automatically, and deleted on logout (NF-3.3 to
  NF-3.5).
  - A removed repository's drafts are deleted too (RM-19): by the tab that
    removed it, and by every tab that hears `repository.removed`
    (`RemovedRepositoriesService` in `web/core`). That service listens only
    while a page that shows a repository, or a list of them, watches, so no page
    opens the push channel for it alone. A device that missed the event learns
    it from a `404 not-found`: the repository screen deletes the user's own
    drafts of a repository it cannot open, and one that disappears while the
    repository screen or the settings page shows it is followed as after the
    event. A removal is followed once per tab, however many times it is heard.
    Pages that show the repository drop its waiting saves, close their dialogs,
    say "Repository _name_ removed." (adding that unsaved changes were not
    saved, when there were some) and go to the dashboard (RM-20). The removing
    tab marks its own removal before the request, since the event may come
    before the answer. _(Plan 122's call.)_

## A-8: Editor and preview

- **A-8.11** `web/code-editor` wraps **CodeMirror 6**, with Markdown and YAML
  front matter highlighting, `EditorView.cspNonce` set (NF-11.1), and the
  accessibility behaviour of NF-13.3. The editor, the conflict-marker view and
  the three-way merge editor all use it.
  - The extensions used (no `basicSetup`): history, selection drawing, search
    (with the product's own compact find panel, whose texts and icon sprite the
    client passes in, since the library has no Transloco), the key bindings, the
    Markdown language with front matter, syntax highlighting, soft wrap
    (switched with a `Compartment`, with the wrap-marker gutter that marks
    wrapped lines), line numbers with the active-line gutter, per-line text
    direction and the spell-check attributes. Line numbers and the wrap-marker
    gutter left the median unchanged in emulation (one run each); one keystroke
    in 50 reached 74 ms; to be repeated on a phone (spike 3, note of
    2026-10-31). The phone check of this list is to be repeated
    (`docs/wiki/typing-test.md`).
  - The conflict view (GC-10, GC-11), in its own `Compartment` like soft wrap
    and read-only, so that it can be switched on and off without losing the undo
    history: empty for every file except one with unresolved conflicts, whose
    typing it alone can change. A `StateField` keeps the conflict regions,
    parsed again in one pass over the lines only when the document changed, and
    decorations computed from it give mine and theirs their backgrounds, the
    labels "Mine (main)" and "Theirs (origin/main)" on the marker lines, and the
    **Accept** buttons above each conflict, left out in a read-only editor. Each
    **Accept** is one transaction, its own undo step. The buttons can't be
    reached with `Tab`, which the editor keeps, so they are hidden from
    assistive technology and the conflict bar outside the editor offers the same
    to the keyboard and screen readers. With a conflict every 40 lines of the 1
    MB test file (about 380), typing at a 4× CPU slowdown in desktop emulation
    took a median of 19 ms and at most 47 ms by the browser's timing, against 16
    ms and 39 ms without the view (`typing-test.mjs`, `?conflicts=on`,
    2026-11-14); the phone check waits for step 6.
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
  - **Two languages** (plan 163). The editor starts with the **basic language**:
    CommonMark and YAML front matter, built from `@lezer/markdown`'s parser,
    which parses HTML tags as `HTMLTag` without highlighting their names and
    attributes. Like `commonmarkLanguage`, it hangs its language data (the HTML
    comment markers, so that `Mod-/` comments out a line) and its indentation on
    the parser's `Document` node, as `yamlFrontmatter` takes only the parser; it
    leaves out the folding props, as the editor has no folding. What the full
    language adds beyond HTML, such as making a link of a URL pasted over a
    selection, comes with it. The **full language**, `markdown({ codeLanguages:
    [], addKeymap: false })` with front matter, is in `state/markdown-html.ts`,
    which only `loadHtmlInMarkdown()` imports, so the HTML, CSS and JavaScript
    grammars that `markdown()` brings (about 51 KB of Brotli) arrive in a chunk
    of their own. The code editor loads it once it has shown a state, after
    `fb:editor-ready` when it sets that mark, and for a read-only state too,
    such as the conflict version view, which sets none. Then `upgradeLanguage`
    swaps it into the highlighting `Compartment` of the state it shows, and of
    each state it is given later, such as a file opened before the load; turning
    highlighting on uses the full language once it has loaded. The swap is one
    transaction that keeps the text, the selection and the undo history. The
    swap of the state shown when the chunk arrives waits for the next render:
    the editor pane builds its next state, such as the Wrap toggle's, only when
    change detection reads it, and an upgrade emitted before would replace it
    with the older state's. When the chunk fails to load, such as offline, the
    editor keeps the basic language without a word, and the next file shown
    tries again. _(Plan's call: the highlighting is the same as before, a moment
    later, and no measure waits for the chunk.)_ Nothing outside
    `markdown-html.ts` may import `@codemirror/lang-markdown`: the bundler
    splits by module, and that module imports `lang-html` for `markdown()`, so
    it would bring the grammars back into the editor's chunk (A-8.18).
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
  `storage` event (NV-8). It also holds what the dashboard and the repository
  management page both show, since web features may not import each other
  (A-2.4): a repository's status and warnings, the line under them with what
  went wrong or the clone's progress (`RepositoryStatusDetailComponent`), "Last
  accessed", the Add a repository guide, and `followRepositoryList`, which loads
  a page's list and keeps it current from the push channel through
  `RepositoryListUpdatesService` (DS-23, DS-25, DS-26, RM-7).
- **A-8.15** `feature-repository-screen` keeps the state of the open file —
  content, undo history, save queue, browser draft, content hash of the last
  load or save — in a per-file store keyed by repository and path, not in the
  screen, so that tabs can be added later (ED-3). Changes to the open file on
  disk are found by comparing `files.changed` events with that hash (A-3.11,
  ED-24). During a merge, the conflicting file edited with its conflicts (GC-9)
  is the open file without being the route's, which keeps naming the file open
  before the merge and opens it again after it. The savers of the files open
  before the merge are held each on its own, and a conflicting one among them
  saves again only once it has been checked for the merge's change on disk, so
  that edits from before the merge never land over its markers (GC-12, ED-25).
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

## A-8: Performance marks

- **A-8.17** The web client sets **performance marks** (the User Timing API)
  where NF-2's screen targets end, in the production build too, so that
  `perf-screen.mjs` times the client's own moments rather than guesses from the
  DOM _(plan 151's call: a mark costs nothing)_. `markPerformance` in
  `shared/util` sets them, keeping only the latest mark of each name but
  `fb:tree-folder-shown`, whose folders must not clear each other (the browser
  keeps marks until they are cleared, and the preview sets one per render), and
  does nothing where the API is missing:
  - `fb:app-ready`: the root component, after the first route's page has
    rendered (NF-2.7);
  - `fb:tree-folder-shown`, with `{ folder }` (`''` for the root): the file
    tree, once the first entry of a folder just loaded or expanded is on the
    page, which with virtual scrolling can be a frame after the store has it
    (NF-2.1);
  - `fb:editor-ready`: the code editor, each time it shows another state, such
    as another file's, once CodeMirror has written it into the page and its
    content takes input (NF-2.2). The editor does not take the focus when a file
    opens, so the mark does not wait for it;
  - `fb:preview-updated`: the preview, after it writes a new render (NF-2.5).

## A-8: Preloading lazy chunks

- **A-8.18** On slow 4G every request costs a round trip of 562.5 ms, so a lazy
  chunk whose static imports are found only once it has arrived costs one round
  trip per level of imports (plan 162, NF-2.2, NF-2.7). Requests that can be
  known at the start are started at the start:
  - **The chunk map.** The production build writes esbuild's metafile
    (`statsJson`); `apps/web/scripts/chunk-map.mjs` (the `web:chunk-map` target,
    run before `precompress` and in the image's build) turns it into
    `dist/apps/web/chunk-map.json`, next to `browser/` and not served: for each
    **group**, the output chunk whose `entryPoint` is the group's source file
    plus its static imports, transitively, less the files `index.html` already
    loads. The groups are the lazy features of the routes (`auth`, `shell`,
    `dashboard`, `repositories`, `preferences`, `repository-screen`) and
    `editor`, the editor pane's `@defer` _(plan's call: only the build knows
    which file holds which lazy import; guessing from the source or the chunks'
    text would break on Angular's next naming change)_. The build fails when a
    group's source file is no output's `entryPoint`, or a listed file is
    missing. The server adds the first route's groups to `index.html` (A-7.9),
    and hands the groups the client preloads itself (`editor`) in `<script
    type="application/json" id="fb-chunk-map">`.
  - **What the editor's chunks must not hold.** The build also fails when a
    group's files hold an input that `FORBIDDEN` lists for it, naming the chunk
    and the input (plan 163). For `editor` these are the preview's Markdown
    pipeline (`render-safe-html.ts` and `hast-util-raw`), which runs in the
    preview worker (A-8.13) and which the editor never needs to take input. The
    pipeline's module builds the pipeline at its top level, so the bundler keeps
    it in every chunk that imports an entry point exporting it:
    `libs/web/markdown/src/index.ts` therefore does not export `renderSafeHtml`,
    and the worker and the specs import it by path. Leaving it out took the
    editor pane's chunk from 124 KB to 26 KB of Brotli. `@codemirror/lang-html`
    is forbidden too, and with it each package of the grammars it brings
    (`lang-css`, `lang-javascript`, `@lezer/html`, `@lezer/css`,
    `@lezer/javascript`), so that none comes back by another import: they come
    after the editor (A-8.11), which took CodeMirror's chunk from 165 KB to 117
    KB of Brotli.
  - **The editor's budget.** The build fails when the editor's own files, the
    `editor` group less the `repository-screen` group, which is loaded before
    any file can be chosen, are over `EDITOR_LIMIT_BYTES`, 230 KB gzipped
    (NF-2.2) _(plan's call: slow 4G leaves NF-2.2's 2 s, less one round trip and
    about 150 ms to render, for about 230 KB of Brotli at 180 KB/s; gzip, which
    the script can compute before `precompress`, is the larger of the two, so
    the budget has a margin)_. The script prints the size with the groups'.
  - **`ChunkPreloaderService`** (`web/core`) adds a `<link rel="modulepreload">`
    with the page's CSP nonce for each file of a group that has none yet. It
    does nothing without `#fb-chunk-map` or with one that does not parse, as
    under `ng serve`, where the chunks load as they are imported.
  - **The editor loads with its file.** The editor area asks the preloader for
    the `editor` group as soon as a Markdown file is chosen, before the file has
    arrived, and its `@defer` around `rs-editor-pane` is `when file() !== null;
    prefetch on immediate`, outside the branch that waits for the file, so the
    editor's chunks and the file load side by side; its content shows the file
    of the moment, so a file chosen while the chunk loads is the one shown.
  - **The onboarding status at start.** `provideCore()` asks
    `OnboardingStateService` for it in an environment initializer, without
    waiting, so it arrives while the first route's chunks load; the onboarding
    guard awaits the same cached answer.
  - **No idle prefetch of the editor** _(plan's call)_: the editor's chunks are
    not loaded while the repository screen is idle. On slow 4G they would
    compete with the tree's own requests, and `perf-screen.mjs` times the editor
    from a click with its chunk not loaded yet (A-8.17), as a user who opens a
    file at once would see it.
