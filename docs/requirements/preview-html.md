# REQ-EDIT-002: Safe HTML in the live preview

> Status: **Accepted**

## Summary

Markdown files may contain raw HTML, for example a centred logo in a README or a
`<details>` block. The live preview ([REQ-EDIT-001](editor.md)) renders the HTML
tags and attributes on the **safe HTML whitelist** defined here, and removes
everything else:

- the whitelist is **GitHub-compatible**: a file whose HTML renders on GitHub
  renders the same way in Front Burner, as far as this list allows;
- a tag that is not on the whitelist is **dropped, but the text inside it is
  kept**. A few tags, such as `<script>` and `<style>`, are removed together
  with their content;
- an attribute that is not allowed, such as `style` or `onclick`, is removed
  from the tag, which itself stays;
- when anything is removed, a small **notice** at the top of the preview says so
  and can list what was removed.

The editor always shows the file's source as it is: nothing is removed from the
file, only from the preview.

## Context

- Repository content is untrusted. A remote may contain files written to attack
  whoever previews them, and the preview runs in the instance's origin, with the
  user's auth token in `localStorage` (LG-40). Script in the preview would give
  an attacker the user's session.
- Defence in depth is already decided: the HTML is sanitised twice, by
  `rehype-sanitize` on the syntax tree and by DOMPurify before it reaches the
  page (A-8.12, D-7.6), under a strict Content Security Policy with Trusted
  Types (NF-11.1). This requirement decides _what_ both steps allow.
- `style` attributes are never allowed, so that neither the sanitisers nor the
  Content Security Policy has to allow inline styles (D-7.5).
- Developer and documentation repositories are written for GitHub, and their
  authors check how files look there. A GitHub-compatible whitelist keeps
  surprises to a minimum.
- Files can also attack the page without script: by restyling or covering Front
  Burner's own UI with its class names, or by giving elements IDs that clash
  with the page's (DOM clobbering). The whitelist rules out both.
- Without a notice, a user whose `<iframe>` embed silently vanishes cannot tell
  whether Front Burner is broken.
- How images are loaded, and which image addresses are shown, is a separate
  requirement ([REQ-EDIT-003](preview-images.md)). This requirement only decides
  which image tags and attributes survive sanitising.

## Terms

**Safe HTML whitelist**
: The list of HTML tags and attributes, with the allowed values of some
  attributes, that the live preview renders. _Short form_: the whitelist.

**Raw HTML**
: HTML written directly in a Markdown file, as opposed to HTML that the
  preview's pipeline produces from Markdown syntax.

**Removed HTML**
: Tags and attributes, in raw HTML or produced from Markdown syntax, that the
  preview does not render because they are not on the whitelist.

**Removal notice**
: The notice at the top of the preview that says some HTML was removed (SH-17).

## Requirements

### General

- **SH-1** The whitelist applies to everything the live preview renders: raw
  HTML, and the HTML that the pipeline produces from Markdown syntax (for
  example, a Markdown link whose address uses a forbidden protocol is removed
  too).
- **SH-2** The whitelist is defined **once**, in one place in the code, and both
  sanitising steps (A-8.12) are configured from it. Neither step allows anything
  the whitelist does not. _(My call: a change to the whitelist counts as a
  security change and is reviewed as one.)_
- **SH-3** Everything that renders Markdown as HTML uses the same whitelist,
  including the conflict resolution views that will render Markdown later (for
  example **Choose per change**).
- **SH-4** Sanitising never changes the file. The editor shows the source as it
  is, including removed HTML.
- **SH-5** The pipeline's own markup is not raw HTML: the classes that syntax
  highlighting adds (D-7.5), the IDs of headings (ED-31), the markup of
  footnotes and task lists, and the way links open (ED-31). It is allowed only
  in the forms that the pipeline produces. Nothing written in the file can pass
  for it. _(My call: how the second sanitising step tells the two apart is left
  to the architecture.)_

### Allowed tags

- **SH-6** These tags are allowed (GitHub-compatible):

  | Group             | Tags                                                                                                     |
  | ----------------- | -------------------------------------------------------------------------------------------------------- |
  | Headings          | `h1` `h2` `h3` `h4` `h5` `h6`                                                                            |
  | Blocks            | `p` `div` `blockquote` `pre` `hr` `figure` `figcaption` `details` `summary` `section`                    |
  | Lists             | `ul` `ol` `li` `dl` `dt` `dd`                                                                            |
  | Tables            | `table` `caption` `thead` `tbody` `tfoot` `tr` `th` `td`                                                 |
  | Inline formatting | `b` `strong` `i` `em` `s` `strike` `del` `ins` `mark` `small` `sub` `sup` `q` `cite` `dfn` `abbr` `time` |
  | Code and keys     | `code` `kbd` `samp` `var` `tt`                                                                           |
  | Text direction    | `bdo` `span` `br` `wbr` `ruby` `rt` `rp`                                                                 |
  | Links and images  | `a` `img` `picture` `source`                                                                             |
  | Task lists        | `input`, only as in SH-12                                                                                |

- **SH-7** Every other tag is removed. Among others, these are never allowed:
  `script`, `noscript`, `style`, `link`, `meta`, `base`, `title`, `iframe`,
  `frame`, `frameset`, `object`, `embed`, `applet`, `form`, `button`, `select`,
  `option`, `textarea`, `template`, `slot`, `dialog`, `svg`, `math`, `canvas`,
  `video` and `audio`, and custom elements (including MDX components, ED-29).
  _(Video and audio may come later, with uploads.)_

### Removing tags

- **SH-8** A tag that is not allowed is dropped and its content is kept: its
  text and any allowed tags inside it are rendered as if the tag were not there.
  For example `<center>Hello</center>` renders "Hello".
- **SH-9** These tags are removed **together with their content**, since their
  content is not meant to be read as text: `script`, `noscript`, `style`,
  `template`, `textarea`, `title`, `iframe`, `object`, `embed`, `svg` and
  `math`. _(My call.)_
- **SH-10** HTML comments are removed and are not counted as removed HTML.
  Malformed HTML is parsed as a browser would parse it, and never breaks the
  preview of the rest of the file.

### Allowed attributes

- **SH-11** On every allowed tag: `dir`, `lang` and `title`, plus `id` and
  `name` as in SH-14. Also:

  | Tags                                       | Attributes                                              |
  | ------------------------------------------ | ------------------------------------------------------- |
  | `a`                                        | `href` (SH-15)                                          |
  | `img`                                      | `src` (SH-15), `alt`, `width`, `height`, `align`        |
  | `source` (inside `picture` only)           | `srcset` (SH-15), `media`, `type`, `width`, `height`    |
  | `p` `div` `h1`–`h6` `table` `td` `th` `tr` | `align`                                                 |
  | `table` `td` `th`                          | `width`                                                 |
  | `td` `th`                                  | `colspan`, `rowspan`, `valign`, `headers`, `scope`      |
  | `ol`                                       | `start`, `reversed`, `type`                             |
  | `li`                                       | `value`                                                 |
  | `details`                                  | `open`                                                  |
  | `blockquote` `q` `del` `ins`               | `cite` (SH-15)                                          |
  | `del` `ins` `time`                         | `datetime`                                              |
  | `code`                                     | `class`, only with values of the form `language-<name>` |

- **SH-12** `input` is allowed only with `type="checkbox"`, and is always
  rendered disabled, with `checked` kept if present. Any other `input` is
  removed. Task list checkboxes cannot be ticked (ED-32).
- **SH-13** Every other attribute is removed, among them: `style`, `class`
  (except SH-11), every event handler (`on…`), `target`, `rel`, `tabindex`,
  `accesskey`, `role`, `autofocus`, `form…` attributes, `data-…` and `aria-…`
  attributes written in the file, and `srcset` on `img`. Attribute values are
  kept only within their limits: `width` and `height` are a whole number or a
  percentage; `align` and `valign` are one of their HTML keywords; `dir` is
  `ltr`, `rtl` or `auto`.
- **SH-14** `id` and `name` attributes written in the file are kept with the
  prefix `user-content-`, as on GitHub, so that they cannot clash with the
  page's own IDs. Links to `#name` within the file follow the prefix, so in-page
  links keep working (ED-31).

### Addresses

- **SH-15** Attributes that hold an address keep it only when it is:
  - for `href`: `http:`, `https:` or `mailto:`, a relative path, or a fragment
    (`#…`);
  - for `src`, `srcset` and `cite`: `http:`, `https:` or a relative path.

  Any other address — `javascript:`, `data:`, `vbscript:`, `file:` and so on,
  including obfuscated forms such as mixed case, entities or embedded whitespace
  — removes the attribute. An `a` without its `href` renders as plain text.
  Whether and how an allowed image address is loaded is decided by REQ-EDIT-003;
  how links open by ED-31.
- **SH-16** Protocol-relative addresses (`//host/…`) are treated as `https:`
  addresses. _(My call.)_

### Removal notice

- **SH-17** When the preview of the open file has removed HTML, the preview
  shows a single, quiet line at its top: "Some HTML isn't shown in the preview."
  with **Details**. HTML comments (SH-10) do not count.
- **SH-18** **Details** expands a list of what was removed, grouped and counted,
  for example:
  - `<iframe>` × 2;
  - `style` attribute × 5;
  - `onclick` attribute × 1;
  - link with a `javascript:` address × 1.

  The list names tags, attributes and address kinds only. It never shows removed
  content or attribute values, so that it cannot itself be used to display
  hostile text. _(My call.)_
- **SH-19** The notice updates with the preview as the user types, and goes away
  when nothing is removed any more. **Hide** hides it for the open file until
  the file is opened again. _(My call.)_
- **SH-20** The notice is not announced to screen readers while the user types;
  it can be reached and read like the rest of the preview (NF-13).

### Security

- **SH-21** Whatever a file contains, previewing it never runs script, never
  applies a style or class written in the file to the page, and never loads
  anything from an address that SH-15 removes. Script, styles and event handlers
  are removed before the browser meets them, so they never trigger a Content
  Security Policy violation report. _(Spike 3 confirmed the approach with an XSS
  corpus; A-8.12. Which kept image addresses are loaded is decided by
  [REQ-EDIT-003](preview-images.md), IM-24.)_
- **SH-22** The pipeline's tests run a corpus of known XSS and HTML injection
  payloads through the whitelist (for example the OWASP XSS filter evasion
  examples and DOMPurify's own test cases) and check the output, and an
  end-to-end test renders them in the web client under the real Content Security
  Policy with no violation reported. Both run in CI. _(My call.)_
- **SH-23** The sanitiser libraries are kept up to date (NF-11.9, NF-11.10); a
  security release of either is applied without waiting for the next planned
  upgrade.

## Acceptance criteria

- **AC-EDIT-002.1** `<p align="center"><img src="logo.png" width="120"
  alt="Logo"></p>` renders a centred image 120 px wide with its alt text.
- **AC-EDIT-002.2** `<details><summary>More</summary>Hidden text</details>`
  renders a collapsed block that opens on click; with `open` it starts open.
- **AC-EDIT-002.3** `<kbd>Ctrl</kbd>`, `<sub>`, `<sup>`, `<mark>` and `<abbr
  title="…">` render as on GitHub.
- **AC-EDIT-002.4** A raw HTML table with `colspan`, `rowspan` and `align`
  renders with them.
- **AC-EDIT-002.5** `<picture><source media="(prefers-color-scheme: dark)"
  srcset="dark.png"> <img src="light.png"></picture>` keeps both images'
  addresses and their `media` rule.
- **AC-EDIT-002.6** `<center>Hello</center>` and `<my-widget>Hello</my-widget>`
  render "Hello" without the tags.
- **AC-EDIT-002.7** `<script>alert(1)</script>`,
  `<style>body{display:none}</style>` and `<iframe
  src="https://example.com"></iframe>` render nothing, run nothing and load
  nothing.
- **AC-EDIT-002.8** `<img src=x onerror="alert(1)">`, `<a
  href="javascript:alert(1)">x</a>`, `<a href="JaVaScRiPt&colon;alert(1)">x</a>`
  and `[x](javascript:alert(1))` run nothing; the links render as plain text.
- **AC-EDIT-002.9** `<div style="position:fixed;inset:0">` and `<div
  class="app-header">` have their `style` and `class` removed; the page layout
  is unchanged.
- **AC-EDIT-002.10** `<a name="install"></a>` becomes
  `name="user-content-install"`, and a link to `#install` in the same file still
  scrolls to it. An element with `id="app"` does not clash with the page.
- **AC-EDIT-002.11** `<input type="checkbox" checked>` renders a ticked,
  disabled checkbox; `<input type="text">` is removed.
- **AC-EDIT-002.12** A code block's `language-ts` class is kept and highlighted;
  `<code class="evil">` loses its class.
- **AC-EDIT-002.13** A file with removed HTML shows "Some HTML isn't shown in
  the preview." **Details** lists for example "`<iframe>` × 2" and "`style`
  attribute × 5", and never shows removed content or values. Deleting the HTML
  in the editor removes the notice. A file with only HTML comments shows no
  notice.
- **AC-EDIT-002.14** **Hide** hides the notice until the file is opened again.
- **AC-EDIT-002.15** The editor still shows every removed tag in the source, and
  saving leaves the file unchanged.
- **AC-EDIT-002.16** The XSS corpus test and the end-to-end Content Security
  Policy test pass in CI; previewing the corpus reports no Content Security
  Policy violation for script, styles or event handlers.
- **AC-EDIT-002.17** `<img src="//cdn.example.com/a.png">` is kept as an
  `https:` address (SH-16), and `<a href="//example.com">` opens
  `https://example.com` in a new tab.

## Out of scope

- How images are resolved and loaded, including remote images (REQ-EDIT-003).
- `<video>`, `<audio>` and other embedded media (possible later, with uploads).
- Inline SVG and MathML, Mermaid and math (ED-26).
- Per-repository or per-instance changes to the whitelist.
- Rendering MDX components (ED-29).

## Open questions

None at the moment.
