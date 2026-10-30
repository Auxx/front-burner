# Islands Design Pass (desktop, dark) — Design

> Status: **Approved**

## Intent

The first two MVP steps are built, but the web client does not look like the
product was meant to look. `docs/architecture/design-system.md` (A-10.5) says
Front Burner follows JetBrains' **Islands** theme, so that it feels familiar to
software developers. Today most pages are text and forms on a very dark,
featureless background: islands are missing or drawn ad hoc, the surface colours
are inverted, headings are big and web-like, and the repository screen does not
read as an IDE.

This pass was worked out page by page with the product owner, looking at the
running web client on a desktop in dark mode next to WebStorm. It does two
things:

1. **Fixes the look** of every implemented page (Onboarding, Login, Dashboard,
   Add repository, the repository screen, Page not found) so that it resembles
   Islands / WebStorm / VS Code.
2. **Refactors the styles** so that pages stop duplicating layout and
   typography: shared layout components, global heading styles, and tokens for
   every surface used.

Success: on a desktop in dark mode, each page looks like the agreed mockups
(see [Mockups](#mockups)), and no page styles its own page layout or title.

## Goals, non-goals, anti-goals

**Goals**

- Every item in [Global changes](#global-changes) and
  [Per page](#per-page).
- Shared layout components that replace the duplicated page scaffolding (see
  [Shared layouts](#shared-layouts)).
- Requirement and architecture docs updated in the same change (see
  [Documentation](#documentation)).
- Two bug fixes found along the way (logged-out banner, page stuck to the
  bottom) and one rendering bug (cropped icon).

**Non-goals (later passes)**

- Tuning **light mode**. Its surface colours stay as they are: in light mode
  islands are already lighter than the canvas, which matches Islands Light.
- Tuning **narrow screens / mobile**.
- The repository management page and other unbuilt pages.
- **User Preferences.** The soft-wrap preference is only written into the
  requirements; it is not stored anywhere yet.
- A product logo (to be added by the product owner later).

**Anti-goals (a failure even if it technically works)**

- Breaking light mode or narrow screens. Both must still work and stay
  usable at 320 CSS px (NF-12.4); they just are not polished in this pass.
- Hard-coded colours or sizes in components or pages: everything goes through
  semantic or component tokens (A-10 token tiers). New surfaces get new tokens
  with light and dark values.
- Pulling in a third-party editor theme or a GitHub stylesheet wholesale. Colours
  come from our tokens; syntax colours stay CSS classes on `--ui-syntax-*`
  tokens (web-client.md, A-10.14).
- Layout shifts: links that change width when they become active, a find panel
  that pushes the text down, banner buttons that jump.
- Losing accessibility that exists today: route focus on the `h1`, landmarks,
  `aria-current`, contrast (NF-13), forced-colours support.

## Constraints

- Follow the `development-workflow` skill; new Angular artefacts via the
  `toolkit-nx` generators; one-off computations (contrast, token checks) via
  `ai-tools`.
- Cascade layers (A-10.27): global heading styles go in `libs/ui`'s `base`
  layer, page layout in `layout`, components in `components`.
- Islands react to their own width with container queries (A-10.7).
- Contrast: every new or changed colour pair meets NF-13 against the surface it
  sits on (use the `ai-tools` contrast tool and the token contrast pairs in
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`).
- The editor chunk size budget (web-client.md, NF-2.2) must not grow
  noticeably: line numbers and the soft-wrap marker use CodeMirror's own
  `@codemirror/view` gutters, no new dependency.

## Global changes

### G1. Surface colours (dark mode)

- Swap the dark values of `surface-canvas` and `surface-island` in
  `libs/ui/src/styles/tokens/_color.scss`. Target values measured from WebStorm:
  **canvas ≈ `#26282c`**, **island ≈ `#191a1c`**. The current primitives
  (`neutral-23` and `neutral-18`, slightly cool) are close; use the nearest
  primitives or add steps if they are visibly off.
- Re-check every surface that sits on an island or the canvas after the swap:
  `sunken` (inputs), `raised` (menus, popovers, user menu button), `hover`,
  `pressed`, selection, `editor-background`, borders. An input on an island must
  still read as an input.
- Add a semantic token for **a surface on an island** (used by the Dashboard
  repository tiles, code blocks in the preview, and the find panel), lighter
  than the island in dark mode. Mockup values: tiles `#222326`, find panel
  `#2b2d30`. Whether these are one token or two (`raised` may serve the find
  panel) is the builder's call.

### G2. Global heading styles

- Define `h1`–`h6` once in `libs/ui`'s `base` layer: margin 0, semibold, tight
  line height, IDE-sized. `h2` ≈ 14 px and `h3` ≈ 13 px; the rest follow. Exact
  values are the builder's call, close to these.
- The `h1` normally appears only in the page title bar (G4), styled there.
- Remove the per-page `.heading` font-size/weight/line-height copies (login,
  onboarding, dashboard, add repository, page not found, dashboard
  components). `libs/ui` components that set their own title sizes (dialog,
  empty state) keep their own styles.

### G3. Field spacing

`ui-field` (`libs/ui/src/controls/components/field/field.component.scss`):
the gap between the **label and the control** becomes `--ui-space-2` (8 px).
The hint and error stay `--ui-space-1` (4 px) below the control. Do not change
the gap for all parts.

### G4. Page title bar (breadcrumbs as the title)

On every page inside the app shell, the top of the main island is a one-line
title bar:

- a `<nav aria-label="Breadcrumb">` with only the ancestor links, separated by
  `›`, muted;
- the page's `h1` directly after it on the same line, styled like a breadcrumb
  item (breadcrumb font size) but semibold and in the default text colour.

Top-level pages (Dashboard) show only the `h1`. The `h1` keeps `tabindex="-1"`
and still gets route focus. The separate `ui-breadcrumbs` row and the large
heading go away. It belongs to the shared full-island layout (see
[Shared layouts](#shared-layouts)), so no page styles its own title. Whether it
reuses `ui-breadcrumbs` internally is the builder's call; the semantics above are
not (the `h1` must not be inside the `nav`).

Examples: Dashboard → "**Dashboard**"; Add repository → "Repositories ›
**Add repository**"; repository settings (later) → "Repositories › handbook ›
**Settings**".

### G5. App header

Applies to `shell-app-header` and, where it repeats the same parts, to
`rs-repository-bar`.

- Padding: **8 px top, 16 px inline**, no bottom padding (the body's 8 px top
  padding separates it from the island). The left of the first link and the
  right of the user menu line up with the island edges.
- Gap between nav items: **32 px** (today `--ui-space-4`).
- `shell-brand-link` reads **"Dashboard"**, with **no flame icon** (also in its
  compact form, which then needs another accessible form; builder's call).
- The **active** link is **bold**, no link is underlined. Reserve the bold width
  (e.g. a hidden bold copy of the label) so that nothing shifts when the active
  link changes. `aria-current="page"` stays.

### G6. Inline banner actions

`ui-inline-banner` (`libs/ui/src/feedback/components/inline-banner/`): in the
wide layout (`@container (min-width: 36rem)`), actions and the dismiss button
are aligned to the **top** (the first line of the message), not centred. Then a
banner whose message grows, such as the preview's removed-HTML notice when
**Details** is expanded, does not move its buttons.

### G7. Cropped icon bug

`ui-icon` is 16×16 by design, but the `files` icon in the repository bar's
button renders at about 19×24 and is cropped. Find the cause (likely a button or
flex rule overriding the icon's size) and fix it in `libs/ui`, so that no icon
in a button is affected. Approach: `superpowers:systematic-debugging`.

## Shared layouts

Today each page writes its own `main`/`.content` grid, padding and heading, and
the repository screen builds `ui-app-shell` four times with the header copied.
Replace this with shared layout pieces. Names, the library they live in
(`libs/ui` for product-agnostic pieces, `libs/web/shell` for ones that know the
app header) and their exact API are the builder's call. What they must do:

1. **Centred island page** (Onboarding, Login, Page not found): no app header;
   one `ui-island` centred horizontally and vertically, with padding and rounded
   corners, max width as today (Onboarding 28rem, Login 24rem, or one shared
   value); a slot **below** the island for banners, stacked with a small gap.
   Page not found shows inside the app shell (it has the header), so it uses the
   centred island inside `<main>` rather than full screen.
2. **Full-island page** (Dashboard, Add repository, later the repository
   management, settings and preferences pages): the page is one `ui-island`
   filling `<main>` below the header, with the title bar (G4) at its top and
   the page content below; scrolls inside the island. An option to centre the
   content column (Add repository: 40rem) is needed.
3. **App shell body**: padding around the islands **8 px top, 16 px inline,
   16 px bottom** (today `0 var(--ui-island-gap) var(--ui-island-gap)`). The
   gap **between** neighbouring islands (file tree / editor) is **8 px**.
   Introduce tokens for both; keep the narrow-screen values working.
4. **Pages fill `<main>`.** Bug today: `<main>` in `ui-app-shell` is a grid with
   one `1fr` row; `<router-outlet>` takes that row and the routed page lands in
   an implicit row below, so pages stick to the bottom. Fix it once (e.g. in
   `shell-layout` or the app shell) so every routed page fills `<main>`.
5. **Repository screen**: one `ui-app-shell` with the state-dependent content
   inside, instead of four copies with the header repeated.

Delete the per-page layout SCSS these replace.

## Per page

### Onboarding (`/onboarding`)

- Centred island page. The heading, steps and form are inside the island.
- Failure banners go below the island.
- Field spacing per G3.

### Login (`/login`)

- Centred island page, as Onboarding.
- **All banners below the island**: logged-out / session-expired /
  password-changed notices, the HTTPS warning, OIDC errors and the login failure
  ("Wrong username or password"). The island holds only the heading and the
  form.
- **OIDC** stays inside the island, below the form, separated by a horizontal
  divider with the word **"or"** in the middle. The divider is also shown above
  the "OIDC login is not available right now" note. With OIDC not set up,
  neither is shown. A small shared divider-with-label element is needed (check
  `libs/ui` first).
- **Bug:** the logged-out notice (and the other "why you are here" notices:
  session expired, password changed) disappears on the first login attempt and
  is not shown again until the user logs out again. Today it stays and
  contradicts the failure banner. Fix with a test.

### Dashboard (`/`)

- Full-island page; title bar shows "Dashboard".
- The add-repository guide (both the full and the compact strip form) is a
  **section** of the island, not an island: remove its own border, background,
  radius and padding.
- **Recent repositories as tiles** in a responsive grid (mockup:
  `repeat(auto-fill, minmax(16rem, 1fr))`, 8 px gap). Each tile: the "surface on
  an island" token (G1), rounded corners, no border, padding ≈ 12×14 px. Tile
  content (name/link, status and warning badges, remote, error, last accessed,
  Settings) unchanged. The "All repositories" link stays below.
- Spinner and load-failure banner stay inside the island.

### Add repository (`/repositories/new`)

- Full-island page; title bar "Repositories › **Add repository**".
- The form column (40rem max) is **centred horizontally** in the island; the
  title bar and the Add / Cancel actions are in the same column.
- Form sections themselves are unchanged.

### Page not found

- Centred island inside the app shell (see Shared layouts 1), with its heading
  and the Dashboard link inside the island.

### Repository screen (`/repositories/:id/files/...`)

Layout:

- **Activity bar** on the left, on the canvas background, using the existing
  `ui-activity-bar` / `ui-activity-bar-item` and the `ui-app-shell` slot. It
  holds the **Files** toggle, with the **`folder`** icon (already in the sprite),
  replacing the "Files" button in `rs-repository-bar`. On narrow screens the
  activity bar moves per A-10.6; it must still toggle the files drawer.
- **File tree** in its own island; **editor area** in another island; 8 px gap.
- `rs-repository-bar` follows G5 (padding, no flame icon, "Dashboard" link).
- The repository screen has **no G4 title bar**: its `h1` stays in the
  repository switcher, as today.

States other than "ready" _(my call)_:

- **loading**: the spinner, centred, as today (no shell).
- **missing** and **failed**: the app shell with `shell-app-header`, no
  activity bar; the content (Page not found, or the failure banner with
  **Try again**) in a centred island, as on Page not found.
- **not-openable**: the app shell with `rs-repository-bar` without files, no
  activity bar; `rs-not-openable` in a centred island.

So the full-island layout always has a title bar, and the centred island
layout works both with and without the app shell.

Editor toolbar (in the editor island, wide and narrow layouts):

- **Find on the left**; **Wrap toggle and the view modes (Split / Edit /
  Preview) on the right** (today the other way round).
- A **2 px divider** under the toolbar, in the canvas colour, full width of the
  island, meeting the editor/preview separator.

Editor / preview split:

- The separator between editor and preview is a **straight 2 px line in the
  canvas colour**, no rounded ends. It stays draggable (keyboard and pointer as
  today; the hit area can be wider than the visible line).

Find panel (`@codemirror/search`, today `search({ top: true })`):

- An **overlay** over the top-right of the editor, not a panel that pushes the
  text down. It stays within the editor's bounds and never covers the preview.
- A short **slide-in** from the top (≈ 150–200 ms, the motion tokens), off with
  `prefers-reduced-motion`.
- A **brighter surface** than the editor (G1) with a shadow, so it stands out.
- A **compact custom panel**, as in VS Code and WebStorm, replacing CodeMirror's
  default panel (built with `@codemirror/search`'s commands and a custom
  `createPanel`):
  - **find row**: a chevron toggle, the find field, match case / whole word /
    regex toggles, a match counter ("1 of 3"), previous / next, close;
  - **replace row**, shown when the chevron is expanded: the replace field,
    **Replace** and **Replace all**.
  - `Ctrl+F` / `Cmd+F` opens it with the find row; the platform's replace
    shortcut (`Ctrl+H` / `Cmd+Alt+F`) opens it expanded _(my call)_. `Esc`
    closes it and returns focus to the editor. Enter / Shift+Enter go to the
    next / previous match.
  - All labels translated; every control has an accessible name, toggles
    expose their pressed state, the counter is announced politely.
  - Exact layout and icons are the builder's call, close to VS Code's find
    widget.

Editor content:

- **Line numbers** in a gutter (new requirement, see Documentation).
- **Soft wrap**: on by default; a **Wrap** toggle button in the toolbar turns it
  on and off for the open editor; a **marker in the gutter** shows which lines
  are soft-wrapped (mockup: `↪` on continuation rows, in a narrow column after
  the line numbers; exact form is the builder's call, close to WebStorm's). The
  toggle lasts until the page is reloaded _(my call)_; it is not remembered yet.
  It is **one screen-level setting** that carries over when another file is
  opened, not part of each file's editor state _(my call)_, so that the later
  per-user preference can replace it directly.
- **Darcula colours**: set the dark values of the `--ui-syntax-*` tokens (and
  the editor tokens: gutter, line number, active line, selection, cursor, match
  highlight) from IntelliJ's Darcula scheme. Do **not** add a theme package.
  The editor background stays the island colour. Map Darcula's colours to our
  token names (heading, emphasis, link, url, code, quote, list marker, HTML tag
  and attribute, meta/front matter, keyword, string, number, function, type,
  comment, punctuation) as closely as Darcula does for Markdown; where Darcula
  has no Markdown-specific colour, use its general one. Check contrast against
  the island. Light mode syntax colours are unchanged. The preview's code
  blocks share these tokens, so they change too.

Preview (`libs/web/markdown`, `markdown-preview.component.scss`):

- **GitHub-style** Markdown body: GitHub's spacing, sizes and structure
  (paragraph / list / blockquote / table / pre margins of 16 px, `h1`/`h2` with a
  bottom border and `0.3em` padding, heading sizes 2em / 1.5em / 1.25em / 1em /
  0.875em / 0.85em, inline code with a tinted background and 6 px radius, code
  blocks on a surface with 16 px padding, blockquotes with a left border, tables
  with borders and striped rows, `hr`, images max-width 100%, task lists).
- **Our colours, not GitHub's**: text, muted, borders, link, and the code
  surfaces come from tokens. Write the rules ourselves; do not import
  `github-markdown-css`.
- These preview headings are content, not UI, so they are scoped to the preview
  and not affected by G2.
- The removed-HTML notice inherits G6.

## Documentation

Update in the same change:

- `docs/architecture/design-system.md`
  - A-10.5: islands sit on a **lighter canvas**; islands are darker in dark
    mode (today it says "a darker canvas").
  - Record the page title bar (breadcrumbs as the title), the shared layouts,
    the "surface on an island" token, the bold active header link, and the
    Darcula-based dark syntax colours.
  - Add the new layout components to the component table (A-10).
- `docs/requirements/navigation.md`
  - NV-14: keep breadcrumbs on the same pages; add that the breadcrumb trail
    and the page's `h1` form one line at the top of the page, and that pages
    without ancestors show only the `h1` there.
  - The header's brand link: "Dashboard", no icon (wherever the link is
    described).
  - Active header link: bold (NV wording "marked as current" stays).
- `docs/requirements/editor.md`
  - **New requirement: line numbers** are shown in a gutter. Next free ED id.
  - **ED-10 rewritten**: long lines wrap softly **by default**; a **Wrap**
    toggle turns soft wrap on or off; a gutter marker shows wrapped lines;
    wrapping never changes the file. The choice is a **user preference**, one
    setting per user (not per repository) _(my call)_, remembered once User
    Preferences exist; until then it lasts until the page is reloaded.
  - Find and replace (ED-11): a compact panel overlays the editor; replace is
    behind a chevron.
- User preferences: add the soft-wrap preference wherever user preferences are
  listed in the requirements, marked as not yet implemented.
- `docs/product/mvp.md` "Implementation status": update per its "Keeping it up
  to date" note, if any changed requirement is in the MVP.
- Check IDs with the `ai-tools` doc ID tool.

## Mockups

Throwaway HTML mockups agreed with the product owner, in
`.superpowers/brainstorm/81844-1793383165/content/` (git-ignored; open in a
browser):

| Page                         | File                                    |
| ---------------------------- | --------------------------------------- |
| Onboarding, surfaces         | `onboarding-surfaces.html` (right side) |
| Field spacing                | `field-gap.html` ("Label only")         |
| Login, banners               | `login-banners.html` (option B)         |
| Login, OIDC                  | `login-oidc.html` (option B)            |
| Dashboard, empty             | `dashboard-empty-v2.html`               |
| Dashboard, with repositories | `dashboard-repos.html` (option C)       |
| Title bar                    | `page-titlebar.html`                    |
| Repository screen            | `repo-screen-v2.html`                   |

Values in the mockups are approximations; tokens and this document win where
they differ.

## Left to the builder

- Names, location and API of the shared layout components and the divider.
- Exact heading sizes (close to G2), token names, whether new primitives are
  needed for the measured colours.
- How the bold width is reserved; how the compact brand link is labelled.
- The soft-wrap marker's exact form; Wrap button icon or text.
- The order of work and how to split it into reviewable steps (suggestion:
  tokens and global styles → shared layouts and pages → header → repository
  screen layout → editor → preview → docs, with docs updated alongside each).
- Test coverage per the development workflow; the logged-out banner fix and
  the router-outlet fix get regression tests.
