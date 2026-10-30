# web-markdown

The live preview's Markdown pipeline (A-8.12). Loaded only from lazy code.

- `SAFE_HTML` (`whitelist/safe-html.ts`): the safe HTML whitelist of
  REQ-EDIT-002, defined once (SH-2). A change to it is a security change.
  `sanitizeSchema` and `purifyConfig` derive both sanitising steps from it, and
  `checkAddress` reads an address as the URL parser does (SH-15, SH-16).
- `renderSafeHtml` (`pipeline/`): Markdown to HTML, synchronously, through
  remark with the GitHub extensions and front matter, `remark-rehype`,
  `rehype-raw` and the first sanitising step, `rehypeSafeHtml`. The pipeline's
  own markup (footnotes, task lists, SH-5) is told from raw HTML by a random
  mark that its elements get before `rehype-raw`. It returns the HTML and a
  `RemovalReport` from `collectRemovals`: tags, attributes and address schemes
  removed, counted, never their content or values (SH-18). `mergeRemovals` adds
  reports up.
- `purifyHtml` (`purify/`): the second step, DOMPurify with the same whitelist,
  on the main thread only; it returns `TrustedHTML` where the browser has
  Trusted Types.
- `splitBlocks` (`blocks/`): a line scanner that splits the source into
  top-level blocks keyed by a hash of their text, the link reference definitions
  they use and their footnotes' numbers (A-8.12). It also collects every link
  reference definition and numbers footnotes across the file.
- `createBlockRenderer` (`render/`): renders one block through the pipeline
  above with every definition appended, gives headings GitHub's slugs, and
  highlights code with Shiki after sanitising (D-7.5). `shiki-classes.ts` holds
  Shiki's theme, whose colours are the `--ui-syntax-*` tokens (A-10.14), and
  turns them into `sk-<token>` classes, which the preview's stylesheet colours.
  `footnotes.ts` numbers a block's footnotes as the file does, drops its list,
  and renders the one list of every footnote as a last block.
- The worker (`worker/`): `PreviewSession` renders only the blocks the page does
  not hold yet; `preview.worker.ts` runs it off the main thread (A-8.13);
  `createPreviewWorker` starts it through the `fb-worker` Trusted Types policy.
- `PreviewRendererService` (`services/`): provided by each preview, it waits
  until typing stops (100 ms, 1 s above 256 KB), talks to the worker, and shows
  only the answer to its latest update. While its preview is not on screen, it
  neither reads the text nor renders (A-8.12).
- `MarkdownPreviewComponent` (`components/`): the one component that writes the
  sanitised HTML to the page (D-7.6). `preview-lines.ts` maps its blocks to
  lines of the file, for `topLine`, `scrollToLine` and the `scrolled` output
  that scroll syncing uses (ED-35, ED-36).
- `testing/xss-corpus.ts`: the XSS corpus that both steps are tested with
  (SH-22).

## Running unit tests

Run `nx test web-markdown` to execute the unit tests.
