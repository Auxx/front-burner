# Content Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Content group of the `ui` library (A-10.32): `Icon`,
`EmptyState` and `KeyValueList`, and replace every inline Codicon SVG in `ui`
with `ui-icon`, with unit tests and Storybook stories.

**Architecture:** A new library feature `content` in `libs/ui/src/content/`,
laid out like `feedback`. `ui-icon` draws one symbol of the Codicons sprite
(`@vscode/codicons/dist/codicon.svg`) with `<svg><use href="…#name">`; the
sprite's URL comes from an injection token, so the web client and Storybook can
each serve the file from their own origin (A-10.35). Icon names are a generated
`as const` list checked against the sprite by a unit test. `ui-empty-state` is
an element component with an optional icon and heading, projected message and a
`[uiEmptyStateActions]` row. `KeyValueList` is two attribute components on
native elements, `dl[uiKeyValueList]` and `div[uiKeyValue]`, so the `<dl>`
semantics and grouping stay valid HTML.

**Tech Stack:** Angular 22.2 (signals), SCSS with `--ui-*` tokens, container
queries, CSS subgrid, Vitest + jsdom unit tests (`@nx/angular:unit-test`),
Storybook 10 (`@storybook/angular-vite`) with the a11y and Vitest addons,
`@vscode/codicons` 0.0.46-24 (already a dependency).

**Spec:** `docs/architecture/design-system.md` (A-10.3, A-10.7, A-10.8, A-10.17,
A-10.21, A-10.22, A-10.24–A-10.27, A-10.32, A-10.35, A-10.37, A-10.38). Screen
requirements that shape the APIs: `docs/requirements/file-browser.md` FB-12,
FB-39; `docs/requirements/dashboard.md` DS-11;
`docs/requirements/git-advanced.md` GA-13; `docs/requirements/repo-manage.md`
RM-9, RM-14, RM-16; `docs/requirements/repo-credentials.md` RC-21;
`docs/architecture/non-functional.md` NF-12.4, NF-13.7.

## Global Constraints

Everything in the Global Constraints of
`docs/superpowers/plans/2026-10-25-controls-components.md` applies unchanged,
with `--feature=content` for scaffolding, **except** the rule on inline Codicon
SVGs, which this plan retires. In addition:

- Every icon in `ui` is drawn by `ui-icon`. After Task 2, no template or
  component file in `libs/ui/src` (outside specs) contains `<path d=`.
- An icon is decorative (`aria-hidden="true"`) unless it is given a `label`; the
  text next to it says what it means (A-10.35). An icon-only button's name stays
  on the button (`uiIconButton`'s `label`), never on its icon.
- Icon names are checked with `node tools/ai-tools/src/bin/icons.mjs find
  <word>` before use, and typed as `IconName`.
- The Codicons sprite is served from our own origin (`img-src 'self'`), never
  inlined as a `data:` URL and never fetched from a CDN.
- Long values (SHA256 fingerprints, remote URLs, repository names) wrap with
  `overflow-wrap: anywhere`; nothing scrolls sideways at 320 CSS px (NF-12.4).
- Status icons: info `info`, success `pass`, warning `warning`, danger `error`
  (unchanged from the Feedback plan).

## Review Focus

1. **Long values at 320 px.** RC-21's two 50-character fingerprints in a
   `KeyValueList`, a long remote URL in DS-11's empty state
   (`https://github.com/org/repo.git` and longer), and a long repository name
   must wrap inside the island; neither component makes the page scroll
   sideways. Story `play` tests in Task 3 and Task 4.
2. **Invalid definition-list markup.** A `<dl>` may hold only `dt`, `dd` and
   `div` groups; an element selector (`<ui-key-value>`) inside it fails axe's
   `definition-list` and `dlitem` rules and confuses screen readers. Items are
   `div[uiKeyValue]` and the axe run on every `KeyValueList` story passes.
   Task 4.
3. **An icon that changes.** A status icon switching from warning to danger, or
   a toggle whose icon depends on state, must update its `href` when `name`
   changes, and a labelled icon must update its accessible name. Unit test in
   Task 1.
4. **Directional icons in right-to-left text.** Moving the tree's chevron into
   `ui-icon` must keep its RTL flip and its expanded rotation: selectors that
   targeted `svg` now target `ui-icon`, since a parent's styles cannot reach
   into `ui-icon`'s template. Story `play` test in Task 2.
5. **The wrong heading level.** FB-12's empty editor area has no heading, while
   DS-11's guide sits under the dashboard's section heading: `EmptyState`
   renders no heading element without `heading`, and the level the consumer asks
   for when it has one. Unit test in Task 3.

---

## File structure

```
libs/ui/src/content/
  models/icon-name.model.ts              ICON_NAMES (generated), IconName
  models/icon-name.model.spec.ts         ICON_NAMES matches the sprite
  tokens/icon-sprite-url.token.ts        ICON_SPRITE_URL
  components/icon/                       IconComponent (ui-icon)
  components/empty-state/                EmptyStateComponent (ui-empty-state)
  components/empty-state-actions/        EmptyStateActionsComponent ([uiEmptyStateActions])
  components/key-value-list/             KeyValueListComponent (dl[uiKeyValueList])
  components/key-value/                  KeyValueComponent (div[uiKeyValue])
tools/ai-tools/src/{lib,bin}/icons.mjs   new `names` command
.claude/skills/ai-tools/references/tools.md
libs/ui/.storybook/main.ts               staticDirs: the sprite at /icons
libs/ui/src/{controls,feedback,layout,navigation}/…   inline SVGs → ui-icon
libs/ui/src/index.ts
docs/architecture/design-system.md       A-10.32 row, new A-10.48–A-10.50
```

Delete the generated `content/content.routes.ts`: the feature has no pages.

---

### Task 1: `content` feature and `Icon`

**Files:**

- Modify: `tools/ai-tools/src/lib/icons.mjs`,
  `tools/ai-tools/src/lib/icons.spec.mjs`, `tools/ai-tools/src/bin/icons.mjs`,
  `.claude/skills/ai-tools/references/tools.md`
- Create: `libs/ui/src/content/models/icon-name.model.ts`,
  `libs/ui/src/content/models/icon-name.model.spec.ts`,
  `libs/ui/src/content/tokens/icon-sprite-url.token.ts`
- Create:
  `libs/ui/src/content/components/icon/icon.component.{ts,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/.storybook/main.ts`, `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `icons.mjs names` prints the `id` of every `<symbol>` in
    `node_modules/@vscode/codicons/dist/codicon.svg`, sorted, one per line;
    `names --ts` prints the whole `icon-name.model.ts`. The ids come from the
    **sprite**, not `metadata.json`: the metadata lacks 80 sprite icons,
    including `warning` and `ellipsis`. If `find` reads only the metadata, make
    it also match sprite ids by name.
  - `export const ICON_NAMES = [ 'account', … ] as const;` and `export type
    IconName = (typeof ICON_NAMES)[number];` in `icon-name.model.ts`, with a
    header comment saying it is generated by `icons.mjs names --ts`.
  - `export const ICON_SPRITE_URL = new
    InjectionToken<string>('ICON_SPRITE_URL', { providedIn: 'root', factory: ()
    => 'icons/codicon.svg' })`. Relative, so it follows the document's base URL.
  - ``IconComponent``, selector ``ui-icon``; ``name =
    input.required<IconName>()``, ``label = input<string>()``. Template ``<svg
    viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use
    [attr.href]="href()" /></svg>``, ``href = computed(() =>
    \``${spriteUrl}#${this.name()}\`)``. Host: with a
    label, ``role="img"``and``aria-label``; without, ``aria-hidden="true"` and
    no role.
  - Styles: host `display: inline-flex; flex: none; inline-size:
    var(--ui-icon-size); block-size: var(--ui-icon-size)`; `svg` fills the host.
    A parent resizes an icon by setting `--ui-icon-size` on it.

- [ ] **Step 1: Add `names`** to `icons.mjs` (load the `ai-tools` skill first).
      Test in `icons.spec.mjs`: the names include `close`, `warning`, `ellipsis`
      and `chevron-right`, are sorted and unique; `--ts` output contains `export
      type IconName = (typeof ICON_NAMES)[number];`. Document the command in
      `tools.md`. Run `npx nx test ai-tools` → PASS.

- [ ] **Step 2: Scaffold** the feature (`--name=content`), delete
      `content.routes.ts`, then `component --name=icon` (inline template, delete
      the html file). Generate the model: `node tools/ai-tools/src/bin/icons.mjs
      names --ts > libs/ui/src/content/models/icon-name.model.ts`. Create the
      token file by hand.

- [ ] **Step 3: Write the failing tests.** `icon-name.model.spec.ts`:

```ts
it('lists exactly the symbols of the Codicons sprite', ...);
// readFileSync of node_modules/@vscode/codicons/dist/codicon.svg (path from the workspace root),
// ids from /<symbol[^>]* id="([^"]+)"/g, sorted → toEqual([...ICON_NAMES]).
// Fails after a Codicons upgrade until the model is generated again.
```

      `icon.component.spec.ts`, host `<ui-icon [name]="name()" [label]="label()" />`:

```ts
it('draws the named symbol of the sprite', ...);
// name 'close' → use[href] 'icons/codicon.svg#close'.

it('uses the sprite URL that is provided', ...);
// providers: [{ provide: ICON_SPRITE_URL, useValue: '/static/codicon.svg' }] → '/static/codicon.svg#close'.

it('is hidden from assistive technology without a label', ...);
// host aria-hidden 'true', no role, no aria-label.

it('is a labelled image with a label', ...);
// label 'Ignored by git' → role 'img', aria-label 'Ignored by git', no aria-hidden.

it('follows changes to its name and label', ...);  // Review Focus 3
// name 'warning' → 'error', label 'Warning' → 'Error' → href '…#error', aria-label 'Error'.
```

- [ ] **Step 4:** `npx nx test ui` → the new tests FAIL (component not
      implemented).

- [ ] **Step 5: Implement** `IconComponent` and export `IconComponent`,
      `ICON_NAMES`, `type IconName` and `ICON_SPRITE_URL` from `index.ts`. In
      `.storybook/main.ts` add `staticDirs: [ { from: join(workspaceRoot,
      'node_modules/@vscode/codicons/dist'), to: '/icons' } ]`.

- [ ] **Step 6: Stories** `Content/Icon`: `Default` (`close`), `Labelled`,
      `Sizes` (16 px and 20 px through `--ui-icon-size` on a parent element in
      the story's own styles), and `Gallery`: every name in `ICON_NAMES` with
      its name below it, in a wrapping grid, for finding icons. Check that the
      icons are visible with `node tools/ai-tools/src/bin/story.mjs` (the sprite
      must load from `/icons/codicon.svg`), in Storybook and in
      `ui:test-storybook`.

- [ ] **Step 7:** `npx nx run-many -t lint,test -p ui,ai-tools` and `npx nx run
      ui:test-storybook` → PASS.

- [ ] **Step 8: Commit** after `npm run format` (`git commit -m "Icon
      component"`).

---

### Task 2: Replace inline Codicons with `ui-icon`

**Files:**

- Modify:
  `libs/ui/src/feedback/components/status-icon/status-icon.component.{ts,scss}`
- Modify:
  `libs/ui/src/feedback/components/{dialog,inline-banner,toast-outlet}/*.{ts,html,scss}`
- Modify:
  `libs/ui/src/navigation/components/tree/tree.component.{html,scss,stories.ts}`
- Modify: `libs/ui/src/controls/components/select/select.component.{html,scss}`,
  `libs/ui/src/controls/components/field/field.component.{html,scss}`
- Modify:
  `libs/ui/src/layout/components/split-pane/split-pane.component.{html,scss}`
- Modify: every `*.stories.ts` in `libs/ui/src` that inlines a Codicon `<svg>`
  (`grep -rln '<path d=' libs/ui/src --include=*.stories.ts`)
- Modify: doc comments of `ButtonComponent`, `IconButtonComponent`,
  `MenuItemComponent`, `BadgeComponent`, `ActivityBarItemComponent`

**Interfaces:**

- Consumes: `IconComponent` (`ui-icon`, `name`, `label`), `IconName` (Task 1).
- Produces: no new API. `StatusIconComponent` keeps its selector and `status`
  input and renders `<ui-icon [name]="icon()" />` with the Global Constraints'
  status → name map. Button, icon button, menu item, badge and activity bar item
  doc comments say their icon is a projected `<ui-icon>`.

Replacements: `close` (dialog, inline banner, toast), `chevron-right` (tree),
`chevron-down` and `check` (select), `error` (field error), `ellipsis` (split
pane presets). Where a component's stylesheet sized or transformed the `svg`
(`.chevron > svg`, `.check`, `.chevron`, `.error svg`, …), it now targets the
`ui-icon` element, and sizes it by setting `--ui-icon-size` rather than
`inline-size`/`block-size`.

- [ ] **Step 1: Write the failing test.** Add to the tree's stories a
      `RightToLeft` story (`dir="rtl"` on a wrapper, one expanded and one
      collapsed folder) whose `play` asserts (Review Focus 4):

```ts
// collapsed folder's .chevron > ui-icon: getComputedStyle(icon).scale === '-1 1'
// expanded folder's: rotate === '-90deg'
```

      Run `npx nx run ui:test-storybook` → the new story FAILS (the icon is
      still an `svg`).

- [ ] **Step 2: Replace** each inline SVG and its `paths`/`close` constant with
      `<ui-icon name="…" />`, retarget the selectors, and update the stories and
      doc comments.

- [ ] **Step 3: Verify** none are left: `grep -rn '<path d=' libs/ui/src
      --include=*.ts --include=*.html | grep -v '\.spec\.ts'` → no output.

- [ ] **Step 4:** `npx nx run-many -t lint,test -p ui` and `npx nx run
      ui:test-storybook` → PASS. Compare the changed components' stories before
      and after with `story.mjs` screenshots: icon sizes, colours, the tree's
      chevron rotation and the select's check are unchanged.

- [ ] **Step 5: Commit** after `npm run format` (`git commit -m "Use ui-icon for
      every icon"`).

---

### Task 3: `EmptyState`

**Files:**

- Create:
  `libs/ui/src/content/components/empty-state/empty-state.component.{ts,html,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/content/components/empty-state-actions/empty-state-actions.component.{ts,scss}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Consumes: `IconComponent`, `IconName` (Task 1).
- Produces:
  - `EmptyStateComponent`, selector `ui-empty-state`; `icon =
    input<IconName>()`, `heading = input<string>()`, `headingLevel = input<2 | 3
    | 4>(2)`. Template, in order: the icon (decorative), the heading as `h2`,
    `h3` or `h4` (an `@switch`) only when `heading` is set, `<div
    class="message"><ng-content /></div>`, `<ng-content
    select="[uiEmptyStateActions]" />`.
  - `EmptyStateActionsComponent`, selector `[uiEmptyStateActions]`, `template:
    '<ng-content />'`, a row of actions that wraps and is centred, like
    `BannerActionsComponent`.
  - Styles: host is a centred column (`display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center`) that
    fills the block size it is given, with `padding: var(--ui-space-6)` and
    `gap: var(--ui-space-3)`, `overflow-wrap: anywhere`; `.message` has
    `max-inline-size: 36rem` and `color: var(--ui-text-muted)`; heading
    `--ui-font-size-title`, `--ui-font-weight-semibold`, margin 0; the icon is
    `--ui-icon-muted` at the component token `--ui-empty-state-icon-size: 2rem`.
    No live region: an empty state is not announced.

- [ ] **Step 1: Scaffold** `component --name=empty-state` and `component
      --name=empty-state-actions` (inline template, delete its html file).

- [ ] **Step 2: Write the failing tests.** `empty-state.component.spec.ts`:

```ts
it('shows its message and actions without a heading', ...);  // FB-12, Review Focus 5
// <ui-empty-state>Choose a file from the tree, or create one
//   <div uiEmptyStateActions><button uiButton>New file</button></div></ui-empty-state>
// → no h2/h3/h4, no ui-icon, .message text 'Choose a file from the tree, or create one',
//   the button is inside [uiEmptyStateActions].

it('renders the heading at the level it is given', ...);  // DS-11, Review Focus 5
// heading 'Add your first repository', headingLevel 3 → one h3 with that text, no h2.
// headingLevel 2 (default) → h2.

it('shows a decorative icon', ...);
// icon 'repo' → ui-icon with use href ending '#repo', aria-hidden 'true'.
```

- [ ] **Step 3:** `npx nx test ui` → the new tests FAIL.

- [ ] **Step 4: Implement** both components and export them from `index.ts`.

- [ ] **Step 5: Stories** `Content/EmptyState`, each inside a `ui-island` with a
      fixed block size:
  - `NoFileOpen`: FB-12's text and a **New file** button, no heading.
  - `NoChanges`: GA-13's "No changes since the last commit." with icon `check`.
  - `FirstRepository`: DS-11's full guide, heading level 3 with icon `repo`, the
    explanation, an `<ol>` of the three steps (styled by the story) and an **Add
    repository** primary button.
  - `Narrow` (Review Focus 1): `FirstRepository` with the remote URL
    `https://github.com/an-organisation-with-a-long-name/a-repository-with-an-even-longer-name.git`
    in a 320 px wide island; `play` asserts the island's and the document's
    `scrollWidth <= clientWidth`.

- [ ] **Step 6:** `npx nx run-many -t lint,test -p ui` and `npx nx run
      ui:test-storybook` → PASS.

- [ ] **Step 7: Commit** after `npm run format` (`git commit -m "EmptyState
      component"`).

---

### Task 4: `KeyValueList`

**Files:**

- Create:
  `libs/ui/src/content/components/key-value-list/key-value-list.component.{ts,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/content/components/key-value/key-value.component.{ts,scss}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `KeyValueListComponent`, selector `dl[uiKeyValueList]`, `template:
    '<ng-content />'`. Styles: `display: grid; grid-template-columns:
    fit-content(40%) minmax(0, 1fr); column-gap: var(--ui-space-4); row-gap:
    var(--ui-space-2); container: key-value-list / inline-size; margin: 0`.
  - `KeyValueComponent`, selector `div[uiKeyValue]`; `label =
    input.required<string>()`, `mono = input(false, { transform:
    booleanAttribute })` → host `[attr.data-mono]`. Template `<dt>{{ label()
    }}</dt><dd><ng-content /></dd>`. Styles: host `display: grid; grid-column: 1
    / -1; grid-template-columns: subgrid`; `dt` `--ui-text-muted`; `dd` `margin:
    0; min-inline-size: 0; overflow-wrap: anywhere`, in `--ui-font-family-mono`
    when `data-mono`. Under `@container key-value-list (inline-size < 22rem)`
    the host is `display: block` and the value sits under its label (A-10.7).
  - Items must be `div[uiKeyValue]` directly inside the `dl`: the only grouping
    element HTML allows there (Review Focus 2).

- [ ] **Step 1: Scaffold** `component --name=key-value-list` and `component
      --name=key-value` (inline templates, delete the html files).

- [ ] **Step 2: Write the failing tests.** `key-value-list.component.spec.ts`,
      host:

```html
<dl uiKeyValueList>
  <div uiKeyValue label="Clone mode">Single branch: main</div>
  <div uiKeyValue label="Fingerprint" mono>SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8</div>
</dl>
```

```ts
it('groups each label and value in a div of the dl', ...);  // Review Focus 2
// dl's element children are 2 DIVs; each has exactly [DT, DD] as children;
// first dt 'Clone mode', first dd 'Single branch: main'.

it('marks monospace values', ...);
// second div data-mono present; first div no data-mono.
```

- [ ] **Step 3:** `npx nx test ui` → the new tests FAIL.

- [ ] **Step 4: Implement** both components and export them from `index.ts`.

- [ ] **Step 5: Stories** `Content/KeyValueList`, inside a `ui-island`:
  - `CloneDetails` (RM-16): Clone mode "Single branch: main", Git control level
    "Advanced" with its description on a second line, Added "25 October 2026".
  - `SshCredentials` (RM-14): Name, Kind "SSH key", Key type "ED25519",
    Fingerprint (mono), Passphrase "Protected".
  - `ChangedHostKey` (RC-21): Host `github.com`, Trusted key and New key, each
    "ED25519 SHA256:…" (mono, 50 characters).
  - `Narrow` (Review Focus 1): `ChangedHostKey` in a 320 px wide island; `play`
    asserts the document's and the island's `scrollWidth <= clientWidth`, and
    that each `dd` starts below its `dt` (`dd.getBoundingClientRect().top >=
    dt.getBoundingClientRect().bottom`).

    axe runs on every story; its `definition-list` and `dlitem` rules must pass.

- [ ] **Step 6:** `npx nx run-many -t lint,test -p ui` and `npx nx run
      ui:test-storybook` → PASS.

- [ ] **Step 7: Commit** after `npm run format` (`git commit -m "KeyValueList
      component"`).

---

### Task 5: Design-system record and whole-library verification

**Files:**

- Modify: `docs/architecture/design-system.md`

- [ ] **Step 1: Record the decisions** in `design-system.md`, under "A-10:
      Components" and "A-10: Icons and fonts":
  - A-10.32, Content row: unchanged names; built on "Own code; the Codicons
    sprite".
  - **A-10.48** `ui-icon` draws a symbol of the Codicons sprite
    (`@vscode/codicons/dist/codicon.svg`) with `<use>`. The web client serves
    the file at `icons/codicon.svg` (the default of `ICON_SPRITE_URL`) and
    Storybook at `/icons/`. Names are typed as `IconName`, generated from the
    sprite by `icons.mjs names --ts`; a unit test fails when the two differ
    after a Codicons upgrade. An icon is decorative unless it has a `label`.
  - **A-10.49** An **empty state** says why a place is empty and what to do
    next, with at most one heading at the level its place needs and the actions
    that fill it (FB-12, DS-11, GA-13). It is not announced.
  - **A-10.50** Read-only details (RM-14, RM-16, RC-21) are a `KeyValueList`: a
    `<dl>` of labelled values that puts each value under its label when the list
    is narrow. Fingerprints and other machine values are `mono`.
  - Run `node tools/ai-tools/src/bin/doc-ids.mjs check` → exit 0.

- [ ] **Step 2:** `npx nx affected -t lint,test,build` → all succeed.
- [ ] **Step 3:** `npx nx run ui:test-storybook` → every story passes.
- [ ] **Step 4:** `npm run format:check` → no changes needed.
- [ ] **Step 5: Commit** (`git commit -m "Content design-system record"`).
- [ ] **Step 6: Report** whether the Vitest addon served the sprite from
      `staticDirs` (or what was needed instead), any icon whose size or position
      changed in Task 2, and any token values changed for contrast.

---

## Not in this plan

- **Serving the sprite in the web client:** the web client application does not
  exist yet. When it does, its build copies
  `node_modules/@vscode/codicons/dist/codicon.svg` to `icons/`, and its licence
  notices carry the Codicons CC-BY-4.0 attribution (A-10.35).
- **A subset sprite** with only the icons in use: the full sprite (444 kB, about
  a fifth of that compressed) is downloaded once and cached; revisit if NF
  performance budgets ask for it.
- **File-type icons in the tree** (Markdown, ignored, empty folder): the
  feature's choice of `IconName`, drawn with `ui-icon` and a `label` where the
  icon carries meaning (FB).
- **The empty-folder note in the tree** (FB-33): a tree row, not an empty state.
- **Editable key-value pairs**: forms use `ui-field`.
