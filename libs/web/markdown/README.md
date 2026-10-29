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
- `testing/xss-corpus.ts`: the XSS corpus that both steps are tested with
  (SH-22).

## Running unit tests

Run `nx test web-markdown` to execute the unit tests.
