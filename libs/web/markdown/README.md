# web-markdown

The live preview's Markdown pipeline (A-8.12). Loaded only from lazy code.

- `SAFE_HTML` (`whitelist/safe-html.ts`): the safe HTML whitelist of
  REQ-EDIT-002, defined once (SH-2). A change to it is a security change.
  `sanitizeSchema` and `purifyConfig` derive both sanitising steps from it, and
  `checkAddress` reads an address as the URL parser does (SH-15, SH-16).

## Running unit tests

Run `nx test web-markdown` to execute the unit tests.
