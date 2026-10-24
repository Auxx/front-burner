# Layout Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Layout group of the `ui` library (A-10.32): `Island`,
`SplitPane`, `ActivityBar`, `StatusBar` and `AppShell`, with unit tests and
Storybook stories.

**Architecture:** A new library feature `layout` in `libs/ui/src/layout/`. The
components are standalone, `OnPush`, use signal inputs and models, and take
every visible or announced text through inputs (A-10.3). `ActivityBar` wraps
Angular Aria's `Toolbar` (A-10.4). `AppShell` composes `SplitPane` for its side
panel and switches to a narrow layout from one viewport query, which it exposes
as a `narrow` signal (the consumer binds `ActivityBar`'s orientation to it). Islands react to their own width with container queries (A-10.7).

**Tech Stack:** Angular 22.2 (signals, `hostDirectives`), `@angular/aria/toolbar`
22.2.4, `@angular/cdk` 22.2.4 (`layout`, `bidi`, `testing`), SCSS with `--ui-*`
tokens, Vitest + jsdom unit tests (`@nx/angular:unit-test`), Storybook 10
(`@storybook/angular-vite`) with the a11y and Vitest addons.

**Spec:** `docs/architecture/design-system.md` (A-10.5–A-10.7, A-10.24–A-10.33,
A-10.37–A-10.39). Screen requirements that shape the APIs:
`docs/requirements/file-browser.md` FB-7–FB-9, `docs/requirements/navigation.md`
NV-17, `docs/requirements/git-advanced.md` GA-10,
`docs/architecture/non-functional.md` NF-12.4, NF-13.3, NF-13.5, NF-13.6.

## Global Constraints

- Before any code change, follow the `development-workflow` skill. Components
  and directives are scaffolded with `npx nx g @hexmode/toolkit-nx:<type>
  --project=ui --feature=layout --name=<name> --no-interactive` (dry run first).
  **Do not pass `--storybook=true`**: it fails because `@storybook/angular` is
  not installed (we use `@storybook/angular-vite`). Write each
  `<name>.component.stories.ts` by hand, matching
  `libs/ui/src/design-tokens/components/token-overview/token-overview.component.stories.ts`
  (imports from `@storybook/angular-vite` and `storybook/test`).
- Standalone, `ChangeDetectionStrategy.OnPush`, signal `input()`/`model()`,
  host bindings in `host` metadata, selector prefix `ui` (A-10.31).
- No Transloco in `ui`; every text and accessible name is an input, and
  required texts are `input.required` (A-10.3).
- Every component stylesheet wraps its rules in `@layer components { … }`. No
  `::ng-deep`, no `ViewEncapsulation.None` (A-10.27).
- Selectors: host and native elements, then ARIA/native state, then part
  classes. No utility or look-describing classes (A-10.24, A-10.25).
- Components read only semantic and component tokens (`--ui-<component>-…`),
  never primitives (A-10.8, A-10.16). Sizes in `rem`; only borders and focus
  rings in `px` (A-10.17).
- No `style` attributes in templates; dynamic values through property bindings
  such as `[style.--ui-split-pane-size]` (A-10.29).
- SCSS modules are loaded with a namespace (`@use '../../../styles/mixins';` →
  `mixins.focus-ring`), never `as *`.
- Focusable elements get the `focus-ring()` mixin on `:focus-visible` (A-10.30).
  Nothing scrolls sideways at 320 CSS px (NF-12.4). Targets are ≥ 24 px compact
  and ≥ 44 px touch, taken from density tokens (`--ui-control-height*`,
  `--ui-row-height`) only (NF-13.5).
- Unit tests of Aria-based components use `@angular/aria/toolbar/testing`
  harnesses through `TestbedHarnessEnvironment` (A-10.39).
- Every story passes axe (`a11y.test: 'error'` is global) in
  `npx nx run ui:test-storybook` (A-10.38).
- Exact dependency versions only; `libs/ui/package.json` gets
  `peerDependencies` ranges only when `ui:lint` (`@nx/dependency-checks`) asks
  for them: `"@angular/aria": "^22.2.0"`, `"@angular/cdk": "^22.2.0"`,
  `"rxjs": "^7.8.0"`.
- Format with `npm run format` (dprint) before each commit.

## Review Focus

1. **Stale or invalid stored pane sizes.** FB-8 makes the feature restore pane
   sizes from the browser; a value of `NaN`, `-5` or `150` must render a usable
   split clamped to `[min, max]`, never a zero-width or overflowing pane. Test
   in Task 2.
2. **Right-to-left documents.** Under `dir="rtl"` the start pane is on the
   right, so `ArrowLeft` on a horizontal separator must grow it, and dragging
   must measure from the right edge. Test in Task 2.
3. **Drawer focus on narrow screens.** Opening the side panel as a drawer must
   move focus into it, `Esc` must close it, and focus must return to the
   element that opened it, or to `main` if that element is gone (NF-13.3, FB-9).
   Test in Task 5.
4. **Crossing the breakpoint while the drawer is open** (rotating a phone,
   resizing a window): the layout must switch without leaving `main` hidden
   on a wide screen or both panes hidden. Test in Task 5.
5. **Clicking the selected activity bar item** must close the side panel (VS
   Code behaviour) and leave no item pressed, rather than doing nothing. Test
   in Task 3.

---

## File structure

```
libs/ui/src/layout/
  models/viewport.model.ts                     NARROW_VIEWPORT query string
  utils/narrow-viewport/narrow-viewport.util.ts(+.spec.ts)   injectNarrowViewport()
  components/island/                           Island
  components/split-pane/                       SplitPane, SplitPaneShow
  components/activity-bar/                     ActivityBar
  directives/activity-bar-item/                ActivityBarItem (button[uiActivityBarItem])
  components/status-bar/                       StatusBar
  components/app-shell/                        AppShell
  directives/app-shell-side/                   AppShellSide ([uiAppShellSide] marker)
libs/ui/src/index.ts                           public exports
libs/ui/src/styles/tokens/_shape.scss          narrow island gap and radius
libs/ui/src/design-tokens/models/contrast-pairs.model.ts   icon pairs on canvas
docs/wiki/todo.md                              done item and deferred preset menu
```

The feature generator creates `layout/layout.routes.ts`; the `layout` feature
has no pages, so delete that file, as `design-tokens` has none.

Narrow layout = viewport below `breakpoint.$medium` (37.5em, 600 px), the
`below($medium)` mixin of `styles/mixins/_breakpoints.scss`.

---

### Task 1: `layout` feature and `Island`

**Files:**
- Create: `libs/ui/src/layout/components/island/island.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`, `libs/ui/src/styles/tokens/_shape.scss`

**Interfaces:**
- Produces: `IslandComponent`, selector `ui-island`, exported from
  `libs/ui/src/index.ts`.
  - `heading = input<string>()`: visible title, rendered as `<h2 class="title">`.
  - `label = input<string>()`: accessible name when there is no heading.
  - Content slots: `[uiIslandHeader]` (toolbar, tabs; in the header after the
    title) and default content (the scrolling body).
  - Host: `role="region"` only when `heading()` or `label()` is set;
    `aria-labelledby` = the title's generated id when `heading()` is set,
    otherwise `aria-label` = `label()`.

- [ ] **Step 1: Scaffold.** Run the feature generator (`--name=layout`), delete
  `libs/ui/src/layout/layout.routes.ts`, then the component generator
  (`--name=island`). Dry run first; expect only `CREATE` lines.

- [ ] **Step 2: Write the failing tests** in `island.component.spec.ts`:

```ts
it('is a region labelled by its heading', async () => {
  fixture.componentRef.setInput('heading', 'Files');
  await fixture.whenStable();
  const host: HTMLElement = fixture.nativeElement;
  const title = host.querySelector('h2')!;
  expect(host.getAttribute('role')).toBe('region');
  expect(host.getAttribute('aria-labelledby')).toBe(title.id);
  expect(title.textContent?.trim()).toBe('Files');
});

it('uses its label when it has no heading', async () => {
  fixture.componentRef.setInput('label', 'Preview');
  await fixture.whenStable();
  expect(fixture.nativeElement.getAttribute('aria-label')).toBe('Preview');
  expect(fixture.nativeElement.querySelector('h2')).toBeNull();
});

it('is not a region without a name', async () => {
  await fixture.whenStable();
  expect(fixture.nativeElement.hasAttribute('role')).toBe(false);
});

it('gives two islands different title ids', ...); // two fixtures, ids differ
```

Plus a host-component test that projects `<button uiIslandHeader>` and body
text and asserts they land in `.header` and `.body` respectively.

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/island.component.spec.ts'`
Expected: FAIL (no `h2`, no `role`).

- [ ] **Step 4: Implement `IslandComponent`.** Title id from a module-level
  counter (`ui-island-title-<n>`). Template: `.header` (title `@if`, then
  `<ng-content select="[uiIslandHeader]" />`) and `.body` (`<ng-content />`).
  Styles:
  - host: `display: flex; flex-direction: column; min-inline-size: 0;
    min-block-size: 0; container: ui-island / inline-size;` background
    `--ui-surface-island`, radius `--ui-radius-island`, `overflow: hidden`;
  - `.header`: `min-block-size: var(--ui-island-header-height)`, padding-inline
    `var(--ui-island-padding)`, flex row, gap `--ui-space-2`; hidden with
    `.header:not(:has(> *))` when empty;
  - `.title`: `--ui-font-size-ui`, semibold, ellipsis on overflow;
  - `.body`: `flex: 1; min-block-size: 0; overflow: auto;`.
  - Component tokens on `:host`: `--ui-island-padding: var(--ui-space-3)`,
    `--ui-island-header-height: var(--ui-control-height)`.

- [ ] **Step 5: Narrow islands (A-10.6).** In `_shape.scss`, inside
  `@layer tokens`, add a `mixins.breakpoint-below(mixins.$breakpoint-medium)`
  block (load `@use '../mixins';`) on `:root` setting
  `--ui-island-gap: var(--ui-space-1)` and
  `--ui-radius-island: var(--ui-radius-popover)`. Check the forwarded variable
  name compiles (`@forward 'breakpoints' as breakpoint-*` prefixes variables
  too).

- [ ] **Step 6: Export** `IslandComponent` from `libs/ui/src/index.ts`.

- [ ] **Step 7: Stories** `island.component.stories.ts`, title `Layout/Island`,
  `layout: 'fullscreen'`, on a canvas wrapper: `WithHeading` (heading + an
  `uiIslandHeader` button + long body text that scrolls), `LabelOnly`, and
  `Narrow` (island in a 20rem-wide wrapper, to see the container query width).

- [ ] **Step 8: Verify.** `npx nx run ui:test --include='**/island.component.spec.ts'`
  → PASS; `npx nx run ui:lint` → no errors; `npx nx run ui:test-storybook` →
  all stories pass (including the existing token stories).

- [ ] **Step 9: Format and commit**

```bash
npm run format
git add libs/ui/src/layout libs/ui/src/index.ts libs/ui/src/styles/tokens/_shape.scss
git commit -m "Island layout component"
```

---

### Task 2: `SplitPane`

**Files:**
- Create: `libs/ui/src/layout/components/split-pane/split-pane.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`, `libs/ui/package.json` (if lint asks)

**Interfaces:**
- Produces: `SplitPaneComponent`, selector `ui-split-pane`, and
  `type SplitPaneShow = 'both' | 'start' | 'end'`, both exported from
  `split-pane.component.ts` and `index.ts`.
  - `orientation = input<'horizontal' | 'vertical'>('horizontal')`
    (horizontal: panes side by side).
  - `size = model<number>(50)`: start pane share, percent.
  - `min = input(10)`, `max = input(90)`, `step = input(5)`: percent.
  - `show = input<SplitPaneShow>('both')`: which panes are on screen.
  - `separatorLabel = input.required<string>()`.
  - Slots: `[uiSplitPaneStart]`, `[uiSplitPaneEnd]`.
  - Protected `clampedSize = computed(...)`: `size()` clamped to
    `[min(), max()]`; a non-finite `size()` gives `50` clamped.

- [ ] **Step 1: Scaffold** with the component generator (`--name=split-pane`).

- [ ] **Step 2: Write the failing tests** (host component projecting two
  panes; `separator = () => host.querySelector('[role="separator"]')`):

```ts
it('describes the separator for assistive technology', async () => {
  // size 30, horizontal, separatorLabel 'Resize file tree'
  expect(sep.getAttribute('aria-orientation')).toBe('vertical');
  expect(sep.getAttribute('aria-valuenow')).toBe('30');
  expect(sep.getAttribute('aria-valuemin')).toBe('10');
  expect(sep.getAttribute('aria-valuemax')).toBe('90');
  expect(sep.getAttribute('aria-label')).toBe('Resize file tree');
  expect(sep.getAttribute('aria-controls')).toBe(startPane.id);
  expect(sep.tabIndex).toBe(0);
});

it('resizes with the arrow keys, Home and End', ...);
// ArrowRight → size 35; ArrowLeft twice → 25; Home → 10; End → 90.
// vertical orientation: ArrowDown +step, ArrowUp −step; ArrowLeft ignored.

it('reverses horizontal arrows in right-to-left', ...);
// host wrapped in dir="rtl" (Dir directive from @angular/cdk/bidi): ArrowLeft → 35.

it('clamps stored sizes', ...);
// size 150 → aria-valuenow 90; size -5 → 10; size NaN → 50.
// host style property --ui-split-pane-size matches the clamped value ('90%').

it('shows one pane and no separator unless both are shown', ...);
// show 'end' → start pane has `hidden`, separator absent; 'start' → end hidden.

it('resizes by dragging the separator', ...);
// stub host getBoundingClientRect {left: 0, width: 1000, top: 0, height: 500};
// stub setPointerCapture/releasePointerCapture (jsdom lacks them);
// pointerdown, pointermove clientX 400, pointerup → size() 40;
// a further pointermove after pointerup changes nothing.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/split-pane.component.spec.ts'`
Expected: FAIL.

- [ ] **Step 4: Implement `SplitPaneComponent`.**
  - Host: `'[style.--ui-split-pane-size]': 'clampedSize() + "%"'`,
    `'[attr.data-orientation]': 'orientation()'`.
  - Template: `.pane.start` (generated id, `[hidden]="show() === 'end'"`),
    separator `@if (show() === 'both')`, `.pane.end`
    (`[hidden]="show() === 'start'"`). Separator `aria-valuenow` is
    `Math.round(clampedSize())`.
  - Keys: `keydown` on the separator; handled keys call `preventDefault()`.
    RTL from `inject(Directionality)`.
  - Drag: `pointerdown` captures the pointer; `pointermove` while captured sets
    `size` from the host rect (`(clientX - left) / width`, from `right` in RTL;
    `clientY`/`height` when vertical), clamped; `pointerup` and
    `lostpointercapture` end the drag. `touch-action: none` on the separator.
  - Styles: host `display: grid`, horizontal
    `grid-template-columns: minmax(0, var(--ui-split-pane-size)) var(--ui-split-pane-gap) minmax(0, 1fr)`
    (rows for vertical); when only one pane is shown the visible pane spans
    all tracks (`.pane:only-of-type`-style rule on non-hidden pane, or
    `grid-column: 1 / -1`). Panes `min-inline-size: 0; min-block-size: 0;
    display: flex` so a child `ui-island` fills them. Component tokens
    `--ui-split-pane-gap: var(--ui-island-gap)`. The separator's hit area
    extends to `--ui-control-height-small` across its axis with a `::before`
    (≥ 24 px, NF-13.5); it shows an `--ui-accent` line on hover, while
    dragging and on `:focus-visible`, plus the focus ring; cursor
    `col-resize`/`row-resize`.

- [ ] **Step 5: Export** from `index.ts`; add peer dependencies if lint asks.

- [ ] **Step 6: Stories** `Layout/Split pane`: `Horizontal` (two islands),
  `Vertical`, `Nested` (tree | editor | preview: an outer pane whose end slot
  holds an inner split). `Horizontal` has a `play` that focuses the separator,
  presses `ArrowRight` and expects `aria-valuenow` to rise by 5.

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
  green.

- [ ] **Step 8: Format and commit** (`git commit -m "SplitPane layout component"`).

---

### Task 3: `ActivityBar` and its items

**Files:**
- Create: `libs/ui/src/layout/components/activity-bar/activity-bar.component.{ts,html,scss,spec.ts,stories.ts}`
- Create: `libs/ui/src/layout/directives/activity-bar-item/activity-bar-item.directive.{ts,spec.ts}`
- Modify: `libs/ui/src/index.ts`, `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`

**Interfaces:**
- Produces:
  - `ActivityBarComponent`, selector `ui-activity-bar`;
    `hostDirectives: [{ directive: Toolbar, inputs: ['orientation'] }]` from
    `@angular/aria/toolbar`. The Toolbar must be on the host: projected items
    resolve `ngToolbar` through the host's injector, not through elements
    inside the component's template. The consumer binds `[orientation]`:
    `'vertical'`, or `'horizontal'` when `AppShell.narrow()` (A-10.6);
    `label = input.required<string>()` → host `aria-label`;
    `selected = model<string | null>(null)`; public `toggle(value: string): void`.
  - `ActivityBarItemDirective`, selector `button[uiActivityBarItem]`;
    `hostDirectives: [ToolbarWidget]`; `value = input.required<string>({ alias: 'uiActivityBarItem' })`;
    `label = input.required<string>()` → `aria-label` and `title`; host
    `type="button"`, `[attr.aria-pressed]` = parent `selected() === value()`,
    `(click)` → parent `toggle(value())`. The icon is projected by the consumer.
- Consumes: nothing from Tasks 1–2.

- [ ] **Step 1: Scaffold** the component (`--name=activity-bar`) and the
  directive (`directive --name=activity-bar-item`). Check the generated
  directive selector and change it to `button[uiActivityBarItem]`.

- [ ] **Step 2: Write the failing tests.** `activity-bar.component.spec.ts`
  uses a host with three items (`files`, `changes`, `search`), `[(selected)]`
  and `[orientation]`:

```ts
it('is a vertical toolbar with an accessible name', async () => {
  const toolbar = await loader.getHarness(ToolbarHarness);
  expect(await toolbar.getOrientation()).toBe('vertical');
  expect(hostElement.getAttribute('aria-label')).toBe('Side panel');
});

it('is horizontal when the consumer says so', ...); // orientation 'horizontal'

it('selects an item on click and marks it pressed', async () => {
  const [ files ] = await toolbar.getWidgets();
  await files.click();
  expect(host.selected).toBe('files');
  expect(button('files').getAttribute('aria-pressed')).toBe('true');
  expect(button('changes').getAttribute('aria-pressed')).toBe('false');
});

it('unselects the selected item when it is clicked again', ...); // selected null, none pressed

it('names icon-only items', ...); // aria-label and title from `label`
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/activity-bar*.spec.ts'`
Expected: FAIL.

- [ ] **Step 4: Implement** the component and directive. The Toolbar's
  default orientation is horizontal, so the host defaults it: check whether a
  host-directive input can be given a default; if not, document that
  consumers must bind it and make the story bind it.
  Styles (background is the canvas, A-10.5):
  - host: flex column, or row under `:host([aria-orientation='horizontal'])`, gap `--ui-space-1`, padding `--ui-space-1`;
  - items: square `--ui-activity-bar-item-size: var(--ui-control-height)`,
    no background, `color: var(--ui-icon-muted)`, radius `--ui-radius-control`;
    `:hover` → `--ui-icon-default` and `--ui-surface-hover`;
    `[aria-pressed='true']` → `--ui-icon-default` and a 2 px `--ui-accent`
    indicator drawn as a border on the inline-start edge (block-end when
    horizontal), so the state is not shown by background alone (A-10.22);
    `:focus-visible` → `mixins.focus-ring`.

- [ ] **Step 5: Contrast pairs.** Add to `CONTRAST_PAIRS`:
  `graphic('icon-default', bg)` and `graphic('icon-muted', bg)` for
  `['surface-canvas']` and `['surface-canvas', 'surface-hover']`. If the
  `Design system/Tokens → Contrast` story then fails, adjust the failing icon
  token values in `tokens/_color.scss` (allowed by A-10.23) and say so in the
  task report.

- [ ] **Step 6: Export** `ActivityBarComponent` and `ActivityBarItemDirective`
  from `index.ts`.

- [ ] **Step 7: Stories** `Layout/Activity bar`: `Default` with Files and
  Changes items whose content is an inline Codicon SVG (`files`,
  `source-control` paths from `node_modules/@vscode/codicons/src/icons/`,
  `aria-hidden="true"`, `fill: currentColor`), bound to `selected`. `play`:
  click Files → `aria-pressed="true"`; press `ArrowDown` → focus on Changes.

- [ ] **Step 8: Verify.** Specs → PASS; `ui:lint` clean; `ui:test-storybook`
  green, including `Design system/Tokens → Contrast`.

- [ ] **Step 9: Format and commit** (`git commit -m "ActivityBar layout component"`).

---

### Task 4: `StatusBar`

**Files:**
- Create: `libs/ui/src/layout/components/status-bar/status-bar.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**
- Produces: `StatusBarComponent`, selector `ui-status-bar`;
  `label = input.required<string>()`; host `role="group"`, `aria-label`;
  slots: default content (start) and `[uiStatusBarEnd]`.

- [ ] **Step 1: Scaffold** (`--name=status-bar`).
- [ ] **Step 2: Write the failing tests:** host has `role="group"` and
  `aria-label="Status"`; default content lands in `.start`, `[uiStatusBarEnd]`
  content in `.end`.
- [ ] **Step 3: Run** `npx nx run ui:test --include='**/status-bar.component.spec.ts'`
  → FAIL.
- [ ] **Step 4: Implement.** Host flex row, `justify-content: space-between`,
  `min-block-size: var(--ui-status-bar-height)` (component token =
  `var(--ui-control-height-small)`), padding-inline `--ui-space-3`,
  `--ui-font-size-ui-small`, `--ui-text-muted` on the canvas. `.start` and
  `.end` are flex rows with gap `--ui-space-3` and `min-inline-size: 0`; their
  direct children get `white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis` so a long branch name never scrolls the page
  sideways (NF-12.4).
- [ ] **Step 5: Export** from `index.ts`.
- [ ] **Step 6: Stories** `Layout/Status bar`: `Default` (branch, sync state,
  save state at the end) and `LongText` in a 20rem (320 px) wrapper with a
  long branch name; `play` asserts the wrapper's `scrollWidth <= clientWidth`.
- [ ] **Step 7: Verify** (spec, lint, `test-storybook`).
- [ ] **Step 8: Format and commit** (`git commit -m "StatusBar layout component"`).

---

### Task 5: `AppShell`

**Files:**
- Create: `libs/ui/src/layout/components/app-shell/app-shell.component.{ts,html,scss,spec.ts,stories.ts}`
- Create: `libs/ui/src/layout/directives/app-shell-side/app-shell-side.directive.{ts,spec.ts}`
- Create: `libs/ui/src/layout/models/viewport.model.ts`
- Create: `libs/ui/src/layout/utils/narrow-viewport/narrow-viewport.util.{ts,spec.ts}` (no generator: utility)
- Modify: `libs/ui/src/index.ts`

**Interfaces:**
- Consumes: `SplitPaneComponent`, `SplitPaneShow` (Task 2). `ui-activity-bar`
  and `ui-status-bar` (Tasks 3–4) are only projected.
- Produces:
  - `NARROW_VIEWPORT = '(max-width: calc(37.5em - 0.02px))'`, with a comment
    that it must match `below(breakpoint.$medium)` in `_breakpoints.scss`. Not
    exported from `index.ts`.
  - `injectNarrowViewport(): Signal<boolean>`: called in an injection context;
    `toSignal` over `BreakpointObserver.observe(NARROW_VIEWPORT)` mapped to
    `matches`, `initialValue` from `BreakpointObserver.isMatched(NARROW_VIEWPORT)`.
  - `AppShellSideDirective`, selector `[uiAppShellSide]`;
    `resizeLabel = input.required<string>()` (the side separator's name, so it
    is required exactly when there is a side panel); host `tabindex="-1"`;
    public `element: HTMLElement`.
  - `AppShellComponent`, selector `ui-app-shell`:
    - `skipLinkLabel = input.required<string>()` (NV-17);
    - `sideOpen = model<boolean>(true)`;
    - `sideSize = model<number>(20)` (percent, two-way with the inner split);
    - `readonly narrow: Signal<boolean>` (public, for features that close the
      drawer when a file is opened, FB-9);
    - protected `show = computed<SplitPaneShow>()`: no side content → `'end'`;
      wide → `sideOpen() ? 'both' : 'end'`; narrow →
      `sideOpen() ? 'start' : 'end'`;
    - slots: `[uiAppShellHeader]` inside `<header>` (banner landmark),
      `ui-activity-bar`, `[uiAppShellSide]` into the split's start pane,
      default content into `<main tabindex="-1">` in the split's end pane,
      `ui-status-bar`.

- [ ] **Step 1: Scaffold** the component (`--name=app-shell`) and directive
  (`directive --name=app-shell-side`).

- [ ] **Step 2: Write the failing tests.** `narrow-viewport.util.spec.ts`
  provides a fake `BreakpointObserver` (`isMatched` plus `observe` over a
  `BehaviorSubject<BreakpointState>`) and asserts the signal follows it.
  `app-shell.component.spec.ts` uses a host template with every slot, the
  same fake and `wide()`/`narrow()`
  helpers that emit on it:

```ts
it('has banner and main landmarks and a skip link to main', async () => {
  const skip = el.querySelector('a.skip-link') as HTMLAnchorElement;
  expect(skip.textContent?.trim()).toBe('Skip to content');
  expect(el.querySelector('ui-app-shell')!.firstElementChild).toBe(skip);
  skip.click();
  expect(document.activeElement).toBe(el.querySelector('main'));
});

it('shows side and main side by side on wide screens', ...);
// split separator present, aria-label 'Resize side panel'; neither pane hidden.

it('collapses the side panel on wide screens', ...);
// sideOpen false → side pane hidden, main visible, no separator.

it('shows only main when there is no side content', ...);

it('shows the side panel instead of main on narrow screens', ...);
// narrow + sideOpen true → main pane hidden; sideOpen false → side hidden.

it('moves focus into the drawer and back', ...);
// narrow, focus a host button, set sideOpen true → activeElement is the side element;
// keydown Escape inside it → sideOpen false and activeElement is the button again.

it('focuses main when the opener is gone', ...);
// remove the opener before closing → activeElement is main.

it('switches layout when the viewport crosses the breakpoint', ...);
// narrow + sideOpen true, then wide() → both panes visible, separator present.

it('keeps the side size in sync with the split', ...);
// ArrowRight on the separator → host sideSize 25.
```

- [ ] **Step 3: Run** `npx nx run ui:test --include='**/app-shell*.spec.ts' --include='**/narrow-viewport.util.spec.ts'`
  → FAIL.

- [ ] **Step 4: Implement.**
  - Side detection: `contentChild(AppShellSideDirective)`.
  - Skip link: `<a class="skip-link" href="#">` whose click handler calls
    `preventDefault()` and focuses `main` (a fragment `href` would go through
    the router's base href). Visually hidden until focused
    (`mixins.visually-hidden` on `:not(:focus)`).
  - Drawer focus: an `effect` that tracks `narrow() && sideOpen() && hasSide`;
    on becoming true it stores `document.activeElement` and focuses the side
    element; on becoming false it restores the stored element when it is still
    `isConnected`, otherwise focuses `main`. Only `Escape` keydowns inside the
    side element while narrow close it. Nothing happens on wide screens.
  - Layout: host `display: grid; block-size: 100dvh;` background canvas; wide
    `grid-template: 'header header' auto 'activity body' 1fr 'status status' auto / auto 1fr`;
    narrow (`mixins.breakpoint-below(mixins.$breakpoint-medium)`)
    `'header' auto 'body' 1fr 'status' auto 'activity' auto / 1fr`. The body
    has padding `--ui-island-gap` (none at the activity-bar edge), and the
    inner `ui-split-pane` fills it. Each `ng-content` sits in a part element
    (`.header`, `.activity`, `.body`, `.status`) that gets its `grid-area`;
    empty `.activity` and `.status` parts take no space.

- [ ] **Step 5: Export** both from `index.ts`.

- [ ] **Step 6: Stories** `Layout/App shell`, `layout: 'fullscreen'`:
  - `RepositoryScreen`: header text, activity bar (Files, Changes) bound to
    `sideOpen` (`selected !== null`) and with
    `[orientation]="shell.narrow() ? 'horizontal' : 'vertical'"`, side island "Files", main with a nested
    `ui-split-pane` of "Editor" and "Preview" islands, status bar. `play`:
    Tab to the skip link, activate it, expect focus on `main`.
  - `Dashboard`: header, no side panel, one island in main.
  - `Narrow`: as `RepositoryScreen` with
    `globals: { viewport: { value: 'mobile1' } }`; if Storybook 10's viewport
    global does not drive `matchMedia` in the Vitest run, drop the story and
    note it in the report (the unit tests cover narrow behaviour).

- [ ] **Step 7: Verify.** Specs → PASS; `ui:lint` clean; `ui:test-storybook`
  green.

- [ ] **Step 8: Format and commit** (`git commit -m "AppShell layout component"`).

---

### Task 6: Whole-library verification and to-do

**Files:**
- Modify: `docs/wiki/todo.md`

- [ ] **Step 1:** In `docs/wiki/todo.md`, replace "Layout components." under
  "UI work" with: "`SplitPane`: a menu with preset sizes on the separator
  (A-10.33), once the `Menu` component exists. Until then the keyboard is the
  only alternative to dragging, which does not meet WCAG 2.5.7 for pointer
  users (NF-13.6)."
- [ ] **Step 2:** Run `npx nx affected -t lint,test,build` → all succeed.
- [ ] **Step 3:** Run `npx nx run ui:test-storybook` → every story passes.
- [ ] **Step 4:** Run `npm run format:check` → no changes needed.
- [ ] **Step 5: Commit** (`git commit -m "Update todo after layout components"`).

---

## Not in this plan

- The preset-size menu of A-10.33 (needs `Menu`, Navigation group); recorded in
  the to-do by Task 6.
- `Icon` and `IconButton` (Content/Controls groups): stories use inline Codicon
  SVGs (`node_modules/@vscode/codicons/src/icons/*.svg`) until they exist.
- Persisting pane sizes and the collapsed state per device (FB-8, A-4.5c) and
  closing the drawer on file open (FB-9): feature code in the web client, using
  the models and `narrow` signal exposed here.
