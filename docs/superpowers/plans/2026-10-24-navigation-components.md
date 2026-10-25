# Navigation Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Navigation group of the `ui` library (A-10.32):
`Breadcrumbs`, `TabStrip`, `Menu` and `Tree`, with unit tests and Storybook
stories. Then use `Menu` to add the preset-size menu to `SplitPane` (A-10.33).

**Architecture:** A new library feature `navigation` in
`libs/ui/src/navigation/`, laid out like `layout`. `Breadcrumbs` is our own
code. `TabStrip`, `Menu` and `Tree` wrap Angular Aria (A-10.2, A-10.4). Where
the consumer projects the items (tabs, menu items), the Aria directive is a
**host directive** on our component, as `ActivityBar` does with `Toolbar`:
projected items find their parent through the host's injector. `Tree` renders
its own items from data, so it uses `ngTreeItem` inside its template. `Menu`
moves its host into a CDK overlay with a `DomPortal` while it is open, so that
Aria's `ngMenu` stays on the host. `Tree` does **not** use virtual scrolling:
Aria's Tree only knows the items that are rendered (decision recorded in A-10.34
by Task 4).

> **Superseded for `Tree`:** the Tree was rebuilt as our own flat tree on the
> CDK's virtual scrolling after Aria's Tree measured 1,262 ms to open a folder
> of 1,000 entries. See A-10.34 in `docs/architecture/design-system.md`.

**Tech Stack:** Angular 22.2 (signals, `hostDirectives`), `@angular/aria` 22.2.4
(`tabs`, `menu`, `tree` and their `/testing` harnesses), `@angular/cdk` 22.2.4
(`overlay`, `portal`, `bidi`, `testing`), SCSS with `--ui-*` tokens, Vitest +
jsdom unit tests (`@nx/angular:unit-test`), Storybook 10
(`@storybook/angular-vite`) with the a11y and Vitest addons.

**Spec:** `docs/architecture/design-system.md` (A-10.2–A-10.4, A-10.24–A-10.34,
A-10.37–A-10.39). Screen requirements that shape the APIs:
`docs/requirements/navigation.md` NV-7, NV-10, NV-14, NV-17, NV-19;
`docs/requirements/file-browser.md` FB-14, FB-15, FB-17, FB-18, FB-21, FB-22,
FB-24, FB-41, FB-46; `docs/requirements/git-advanced.md` GA-7, GA-10;
`docs/requirements/editor.md` ED-34; `docs/architecture/non-functional.md`
NF-2.1, NF-12.4, NF-13.3, NF-13.5–NF-13.7.

## Global Constraints

- Before any code change, follow the `development-workflow` skill. Scaffold with
  `npx nx g @hexmode/toolkit-nx:<type> --project=ui --feature=navigation
  --name=<name> --no-interactive` (dry run first). **Do not pass
  `--storybook=true`**; write each `*.stories.ts` by hand, matching
  `libs/ui/src/layout/components/activity-bar/activity-bar.component.stories.ts`
  (imports from `@storybook/angular-vite` and `storybook/test`).
- Components with a template or styles are scaffolded as components even when
  their selector is an attribute (`button[uiTab]`), as `ActivityBarItem` is;
  directives are only for markers and behaviour without styles.
- Standalone, `ChangeDetectionStrategy.OnPush`, signal `input()`/`model()`/
  `output()`, host bindings in `host` metadata, selector prefix `ui` (A-10.31).
- No Transloco in `ui`; every text and accessible name is an input, and required
  texts are `input.required` (A-10.3). Separator glyphs drawn by CSS use
  `content: '›' / ''` so they are not announced.
- Aria directives are used only inside `ui` (A-10.4): no consumer template in a
  story or test writes an `ng…` attribute.
- Every component stylesheet wraps its rules in `@layer components { … }`. No
  `::ng-deep`, no `ViewEncapsulation.None` (A-10.27).
- Selectors: host and native elements, then ARIA/native state
  (`[aria-selected='true']`, `[aria-expanded]`, `[aria-current]`,
  `[data-visible]`), then part classes (A-10.24, A-10.25).
- Components read only semantic and component tokens, never primitives (A-10.8).
  Sizes in `rem`; only borders and focus rings in `px` (A-10.17). Rows and
  controls take their height from `--ui-row-height`, `--ui-control-height` or
  `--ui-control-height-small` only (NF-13.5).
- No `style` attributes in templates; dynamic values through property bindings
  such as `[style.--ui-tree-level]` (A-10.29).
- SCSS modules are loaded with a namespace (`@use '../../../styles/mixins';` →
  `mixins.focus-ring`), never `as *`.
- Focusable elements get `mixins.focus-ring` on `:focus-visible` (A-10.30).
  Selection, current item and state are never shown by background colour alone
  (A-10.22, NF-13.7). Nothing scrolls sideways at 320 CSS px (NF-12.4).
- Unit tests of Aria-based components use the `@angular/aria/*/testing`
  harnesses (A-10.39). Where our host carries the Aria directive as a host
  directive, subclass the harness and override `hostSelector`, as
  `activity-bar.component.spec.ts` does. The Aria selectors are: `[ngTabs]`,
  `[ngTab]`, `[ngMenu], [ngMenuBar]`, `[ngMenuItem]`, `[ngTree]`,
  `[ngTreeItem]`.
- Every story passes axe (`a11y.test: 'error'` is global) in `npx nx run
  ui:test-storybook` (A-10.38).
- Inline Codicon SVGs (CC-BY-4.0) are used until the `Icon` component exists:
  paths from `node_modules/@vscode/codicons/src/icons/<name>.svg`,
  `aria-hidden="true"`, `fill="currentColor"`, sized by `--ui-icon-size`.
- Exact dependency versions only; `libs/ui/package.json` already has the peer
  ranges for `@angular/aria` and `@angular/cdk`. Add nothing else unless
  `ui:lint` asks for it.
- Format with `npm run format` (dprint) before each commit.

## Review Focus

1. **Tabbing into the file tree must land on the open file**, not on the first
   entry, when `selected` and `expanded` are restored before the first render
   (FB-14). Test in Task 4.
2. **Link items in a menu** (Preferences, All repositories, Repository settings
   in NV-7 and NV-10) must follow their link exactly once when chosen with
   `Enter` or a click, and the menu must close. Test in Task 3.
3. **The actions-menu button inside a tree row** (FB-24): clicking it must not
   select or toggle the row, `Shift+F10` must open it from the row, and after
   `Esc` the arrow keys must still move through the tree. Test in Task 4.
4. **Entries disappearing under the focus** when the tree refreshes after a
   change made elsewhere (FB-41): the tree must keep exactly one tab stop and
   not throw. Test in Task 4.
5. **A stale or missing selected tab** (a remembered view mode that no longer
   exists, ED-34): the first tab must be selected and its panel shown; never
   zero panels. Test in Task 2.

---

## File structure

```
libs/ui/src/navigation/
  components/breadcrumbs/          BreadcrumbsComponent (ui-breadcrumbs)
  directives/breadcrumb/           BreadcrumbDirective (ng-template[uiBreadcrumb])
  directives/tab-group/            TabGroupDirective ([uiTabGroup], host Tabs)
  components/tab-strip/            TabStripComponent (ui-tab-strip, host TabList)
  components/tab/                  TabComponent (button[uiTab], host Tab)
  directives/tab-panel/            TabPanelDirective ([uiTabPanel], host TabPanel)
  components/menu/                 MenuComponent (ui-menu, host Menu + overlay)
  directives/menu-trigger/         MenuTriggerDirective (button[uiMenuTrigger])
  components/menu-item/            MenuItemComponent (button/a[uiMenuItem])
  components/menu-separator/       MenuSeparatorComponent ([uiMenuSeparator])
  directives/menu-group/           MenuGroupDirective ([uiMenuGroup])
  models/tree-node.model.ts        TreeNode
  components/tree/                 TreeComponent (ui-tree, host Tree)
  directives/tree-node/            TreeNodeDirective (ng-template[uiTreeNode])
  directives/tree-item-menu/       TreeItemMenuDirective (button[uiTreeItemMenu])
libs/ui/src/layout/components/split-pane/   preset menu (Task 5)
libs/ui/src/index.ts                         public exports
libs/ui/src/design-tokens/models/contrast-pairs.model.ts
docs/architecture/design-system.md           A-10.32, A-10.34
docs/wiki/todo.md
```

Delete the generated `navigation/navigation.routes.ts`: the feature has no
pages, like `layout`.

---

### Task 1: `navigation` feature and `Breadcrumbs`

**Files:**

- Create:
  `libs/ui/src/navigation/components/breadcrumbs/breadcrumbs.component.{ts,html,scss,spec.ts,stories.ts}`
- Create: `libs/ui/src/navigation/directives/breadcrumb/breadcrumb.directive.ts`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `BreadcrumbDirective`, selector `ng-template[uiBreadcrumb]` (used as
    `*uiBreadcrumb`); public `readonly template = inject(TemplateRef)`.
  - `BreadcrumbsComponent`, selector `ui-breadcrumbs`; `label =
    input.required<string>()`; host `role="navigation"`, `[attr.aria-label]`;
    items from `contentChildren(BreadcrumbDirective)`, each rendered in an
    `<li>` of an `<ol>`; the last `<li>` has `aria-current="page"` (NV-14). The
    consumer gives the last item as text and the others as links.

- [ ] **Step 1: Scaffold.** Feature generator (`--name=navigation`), delete
      `navigation.routes.ts`, then `component --name=breadcrumbs` and `directive
      --name=breadcrumb` (selector changed to `ng-template[uiBreadcrumb]`).

- [ ] **Step 2: Write the failing tests** in `breadcrumbs.component.spec.ts`,
      host template `<ui-breadcrumbs label="Breadcrumb"><a *uiBreadcrumb
      href="/repositories">Repositories</a><a *uiBreadcrumb
      href="/repositories/1">handbook</a>@if (extra()) {<span
      *uiBreadcrumb>Settings</span>}</ui-breadcrumbs>` (use an `ng-container` if
      the `@if` needs one):

```ts
it('is a labelled navigation landmark with an ordered list', async () => {
  expect(nav.getAttribute('role')).toBe('navigation');
  expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
  expect(nav.querySelectorAll('ol > li').length).toBe(3);
});

it('marks only the last item as the current page', async () => {
  const items = [ ...nav.querySelectorAll('li') ];
  expect(items.map(li => li.getAttribute('aria-current'))).toEqual([ null, null, 'page' ]);
  expect(items[2].textContent?.trim()).toBe('Settings');
});

it('moves the current page when items change', ...);
// extra false → 2 items, the second has aria-current="page".

it('does not put separators in the text', ...);
// nav.textContent has no '›'.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/breadcrumbs.component.spec.ts'` Expected:
FAIL.

- [ ] **Step 4: Implement.** Template: `<ol>` with `@for (item of items(); track
      item; let last = $last)` and `*ngTemplateOutlet`. Styles: `ol` flex row,
      `flex-wrap: wrap`, gap `--ui-space-1`, no list style, padding 0; `li`
      `min-inline-size: 0; overflow-wrap: anywhere;` colour `--ui-text-muted`,
      `--ui-font-size-ui`; `li + li::before { content: '›' / '';
      margin-inline-end: var(--ui-space-1); color: var(--ui-text-subtle); }`;
      `li[aria-current='page']` colour `--ui-text-default`, weight medium (the
      weight and the missing link mark it, not colour alone).

- [ ] **Step 5: Export** both from `libs/ui/src/index.ts`.

- [ ] **Step 6: Stories** `Navigation/Breadcrumbs`: `Default` ("Repositories ›
      handbook › Settings", NV-14) and `LongNames` in a 20rem wrapper with a
      60-character repository name; `play` asserts the wrapper's `scrollWidth <=
      clientWidth`.

- [ ] **Step 7: Verify.** Spec → PASS; `npx nx run ui:lint` → no errors; `npx nx
      run ui:test-storybook` → all stories pass.

- [ ] **Step 8: Format and commit** (`git commit -m "Breadcrumbs navigation
      component"`).

---

### Task 2: `TabStrip`

**Files:**

- Create: `libs/ui/src/navigation/directives/tab-group/tab-group.directive.ts`
- Create:
  `libs/ui/src/navigation/components/tab-strip/tab-strip.component.{ts,html,scss,spec.ts,stories.ts}`
- Create: `libs/ui/src/navigation/components/tab/tab.component.{ts,scss}`
- Create: `libs/ui/src/navigation/directives/tab-panel/tab-panel.directive.ts`
- Modify: `libs/ui/src/index.ts`, `libs/ui/src/styles/_reset.scss`

**Interfaces:**

- Produces (all from `@angular/aria/tabs`):
  - `TabGroupDirective`, selector `[uiTabGroup]`; `hostDirectives: [Tabs]`. Put
    on any element that contains both the strip and the panels, typically
    `<ui-island uiTabGroup>` with the strip in `uiIslandHeader` (GA-10).
  - `TabStripComponent`, selector `ui-tab-strip`; `hostDirectives: [{ directive:
    TabList, inputs: ['selectedTab: selected'], outputs: ['selectedTabChange:
    selectedChange'] }]`, so consumers write `[(selected)]`; `label =
    input.required<string>()` → `aria-label`. Horizontal only; selection follows
    focus (Aria's default).
  - `TabComponent`, selector `button[uiTab]`; `hostDirectives: [{ directive:
    Tab, inputs: ['value: uiTab', 'disabled'] }]`; host `type="button"`. Its
    content is its label, such as "Changes (3)".
  - `TabPanelDirective`, selector `[uiTabPanel]`; `hostDirectives: [{ directive:
    TabPanel, inputs: ['value: uiTabPanel'] }]`; host `[hidden]` =
    `!panel.visible()`. Content is always rendered (no deferred content), so a
    panel keeps its state, such as the tree's expanded folders, when hidden.

- [ ] **Step 1: Scaffold** `directive --name=tab-group`, `component
      --name=tab-strip`, `component --name=tab` (selector `button[uiTab]`,
      inline template `<ng-content />`, delete the generated html), `directive
      --name=tab-panel`.

- [ ] **Step 2: Write the failing tests** in `tab-strip.component.spec.ts`.
      Harness subclasses: `TabsHarness` with `hostSelector = '[uiTabGroup]'`,
      `TabHarness` with `hostSelector = '[uiTab]'`. Host template:

```html
<div uiTabGroup>
  <ui-tab-strip label="Left pane" [(selected)]="selected">
    <button uiTab="files">Files</button>
    <button uiTab="changes">Changes (3)</button>
  </ui-tab-strip>
  <div uiTabPanel="files"><input aria-label="Probe" /></div>
  <div uiTabPanel="changes">No changes</div>
</div>
```

```ts
it('is a labelled tab list of buttons', ...);
// strip role 'tablist', aria-label 'Left pane'; tabs role 'tab', type 'button'.

it('shows the selected tab's panel only', async () => {
  // selected 'files'
  expect(await (await tabs.getSelectedTab())!.getTitle()).toBe('Files');
  expect(panel('files').hidden).toBe(false);
  expect(panel('changes').hidden).toBe(true);
});

it('links each tab and its panel', ...);
// tab aria-controls === panel id; panel role 'tabpanel', aria-labelledby === tab id.

it('selects on click and updates the model', ...);
// click Changes → host selected 'changes'; changes panel visible.

it('selects with the arrow keys, reversed in right-to-left', ...);
// focus Files, ArrowRight → selected 'changes'; under dir="rtl", ArrowLeft → 'changes'.

it('is one tab stop', ...);

it('keeps a hidden panel's content', ...);
// the Probe input element is the same node after files → changes → files.

it('selects the first tab when the selected value is missing or unknown', ...);
// selected undefined → 'files' panel visible; selected 'preview' (no such tab) → 'files' visible.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/tab-strip.component.spec.ts'` Expected:
FAIL.

- [ ] **Step 4: Implement.** For the last test: if Aria leaves no tab selected,
      `TabStripComponent` (injecting its `TabList` host directive) runs an
      `effect` that, when `selectedTab()` matches no enabled tab (`findTab(...)`
      is `undefined` or disabled), opens the first enabled tab. Styles:
  - strip: flex row, `min-inline-size: 0`, gap `--ui-space-1`;
  - tab: `min-block-size: var(--ui-control-height)`, padding-inline
    `--ui-space-2`, no background or border except a 2 px
    (`--ui-focus-ring-width`) block-end border that is transparent,
    `--ui-text-muted`, `--ui-font-size-ui`, `white-space: nowrap; overflow:
    hidden; text-overflow: ellipsis; min-inline-size: 0;`; `:hover` →
    `--ui-text-default`; `[aria-selected='true']` → `--ui-text-default` and
    border colour `--ui-accent` (a line, not a background: A-10.22);
    `[aria-disabled='true']` → `--ui-text-disabled`; `:focus-visible` →
    `mixins.focus-ring` with a negative offset so it stays inside the island
    header.
  - panel: a directive has no styles, and a consumer's `display: flex` would
    beat the browser's `[hidden]` rule. Add `[hidden] { display: none
    !important; }` to `libs/ui/src/styles/_reset.scss` (inside `@layer reset`:
    an important declaration in an earlier layer wins over later layers), and
    check that the `SplitPane` and `AppShell` specs and stories still pass.

- [ ] **Step 5: Export** all four from `index.ts`.

- [ ] **Step 6: Stories** `Navigation/Tab strip`:
  - `LeftPane`: an island (`ui-island uiTabGroup`, `label="Left pane"`) with
    Files and "Changes (3)" tabs in its header and two panels (GA-10). `play`:
    click Changes → its panel visible; `{ArrowLeft}` → Files selected and
    focused.
  - `EditPreview`: Edit and Preview tabs in a 20rem wrapper (ED-34, narrow
    screens).

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green.

- [ ] **Step 8: Format and commit** (`git commit -m "TabStrip navigation
      component"`).

---

### Task 3: `Menu`

**Files:**

- Create:
  `libs/ui/src/navigation/components/menu/menu.component.{ts,html,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/navigation/directives/menu-trigger/menu-trigger.directive.ts`
- Create:
  `libs/ui/src/navigation/components/menu-item/menu-item.component.{ts,scss}`
- Create:
  `libs/ui/src/navigation/components/menu-separator/menu-separator.component.{ts,scss}`
- Create: `libs/ui/src/navigation/directives/menu-group/menu-group.directive.ts`
- Modify: `libs/ui/src/index.ts`,
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`

**Interfaces:**

- Produces (Aria from `@angular/aria/menu`):
  - `MenuComponent<V = unknown>`, selector `ui-menu`, `exportAs: 'uiMenu'`;
    `hostDirectives: [{ directive: Menu, outputs: ['itemSelected'] }]`, so
    consumers write `(itemSelected)="…"` with the item's value; public `readonly
    aria = inject(Menu<V>)`, the handle a trigger takes.
  - `MenuTriggerDirective`, selector `button[uiMenuTrigger]`; `hostDirectives:
    [{ directive: MenuTrigger, inputs: ['menu: uiMenuTrigger'] }]`; host
    `type="button"`. Consumers write `<button
    [uiMenuTrigger]="actions.aria">…</button> <ui-menu
    #actions="uiMenu">…</ui-menu>`. (A host-directive input cannot be fed from
    our own input, and Aria's trigger needs its own `Menu` instance; `aria` is
    the one place where a feature touches an Aria type, and only as an opaque
    handle. Say so in the component's doc comment.)
  - `MenuItemComponent<V>`, selector `button[uiMenuItem], a[uiMenuItem]`;
    `hostDirectives: [{ directive: MenuItem, inputs: ['value: uiMenuItem',
    'disabled'] }]`; `type="button"` on buttons only. Content is the label and
    optional leading icon.
  - `MenuSeparatorComponent`, selector `[uiMenuSeparator]`; host
    `role="separator"`.
  - `MenuGroupDirective`, selector `[uiMenuGroup]`; `label =
    input.required<string>()`; host `role="group"`, `aria-label`.
- Overlay behaviour of `MenuComponent`: when Aria's `visible()` becomes true,
  attach `new DomPortal(host)` to an `OverlayRef` from
  `createOverlayRef(injector, { positionStrategy:
  createFlexibleConnectedPositionStrategy(injector, triggerElement)
  .withPositions([below-start, above-start, below-end, above-end])
  .withPush(true).withViewportMargin(8), scrollStrategy:
  createRepositionScrollStrategy(injector) })`; when it becomes false, detach
  (the host goes back to where it was declared). `triggerElement` is the
  `element` of Aria's `parent()` trigger. Dispose the overlay on destroy.

- [ ] **Step 1: Scaffold** `component --name=menu`, `directive
      --name=menu-trigger`, `component --name=menu-item`, `component
      --name=menu-separator`, `directive --name=menu-group`; fix selectors as
      above.

- [ ] **Step 2: Write the failing tests** in `menu.component.spec.ts`. Harness
      subclasses: `MenuHarness` with `hostSelector = 'ui-menu'` (load it from
      `TestbedHarnessEnvironment.documentRootLoader(fixture)`, since the open
      menu lives in the overlay container), and `MenuItemHarness` with
      `hostSelector = '[uiMenuItem]'` (`MenuItem` is a host directive, so the
      `[ngMenuItem]` attribute is not there). Host template:

```html
<button [uiMenuTrigger]="menu.aria">Git actions</button>
<ui-menu #menu="uiMenu" (itemSelected)="chosen.set($event)">
  <button uiMenuItem="fetch">Fetch</button>
  <button uiMenuItem="pull">Pull</button>
  <div uiMenuSeparator></div>
  <a uiMenuItem="settings" href="/repositories/1/settings" (click)="linkClicks = linkClicks + 1; $event.preventDefault()">Repository settings</a>
</ui-menu>
<button>Outside</button>
```

```ts
it('describes the trigger as a closed menu button', ...);
// aria-haspopup 'menu', aria-expanded 'false', type 'button'.

it('opens on click into the overlay with focus on the first item', async () => {
  trigger.click(); await fixture.whenStable();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('.cdk-overlay-container ui-menu')).not.toBeNull();
  expect(document.activeElement?.textContent?.trim()).toBe('Fetch');
});

it('opens from the keyboard', ...);
// focus trigger, keydown ArrowDown (and separately Enter) → open, focus on Fetch.

it('moves between items with the arrow keys', ...);
// ArrowDown → Pull; ArrowDown → Repository settings (separator skipped); ArrowDown wraps to Fetch.

it('closes on Escape and returns focus to the trigger', ...);
// menu no longer in the overlay container; activeElement === trigger.

it('emits the chosen value, closes and refocuses the trigger', ...);
// click Pull → chosen() 'pull', aria-expanded 'false', activeElement === trigger.

it('follows a link item once with Enter or a click', ...);
// open, focus the link, keydown Enter → linkClicks 1 and menu closed;
// reopen, click the link → linkClicks 2.

it('closes when the focus leaves it', ...);
// open, focus Outside → aria-expanded 'false'.

it('marks separators and groups for assistive technology', ...);
// [uiMenuSeparator] role 'separator'; a second host with <div uiMenuGroup label="Recent"> → role 'group', aria-label 'Recent'.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/menu.component.spec.ts'` Expected: FAIL.

- [ ] **Step 4: Implement** the five artefacts. For the link test: if Aria's
      `Enter` handling prevents the anchor's default action, `MenuItemComponent`
      on anchors calls `element.click()` from Aria's selection path, and not
      also from the native `Enter` (the test counts exactly one click). Styles:
  - menu host: `display: none` unless `[data-visible='true']`, then flex column;
    background `--ui-surface-raised`, border `--ui-border-width` solid
    `--ui-border-default`, radius `--ui-radius-popover`, shadow
    `--ui-shadow-popover`, padding `--ui-space-1`, `min-inline-size: 10rem`,
    `max-inline-size: min(20rem, 100vw - 2 * var(--ui-space-2))`;
  - item: flex row, gap `--ui-space-2`, `min-block-size:
    var(--ui-control-height)`, padding-inline `--ui-control-padding-inline`,
    full width, no border or background, `--ui-text-default`,
    `--ui-font-size-ui`, text-align start, `text-decoration: none`, radius
    `--ui-radius-control`; `:hover` and `[data-active='true']` →
    `--ui-surface-hover`; `[aria-disabled='true']` → `--ui-text-disabled`;
    `:focus-visible` → `mixins.focus-ring` with a negative offset; labels
    ellipsis on overflow;
  - separator: `block-size: var(--ui-border-width)`, margin-block
    `--ui-space-1`, background `--ui-border-subtle`.

- [ ] **Step 5: Contrast pairs.** Add `text('text-default', 'surface-raised',
      'surface-hover')` and `text('text-muted', 'surface-raised',
      'surface-hover')` (disabled text is exempt, WCAG 1.4.3). If the Contrast
      story fails, adjust the token values in `tokens/_color.scss` (A-10.23) and
      say so in the report.

- [ ] **Step 6: Export** all five from `index.ts`.

- [ ] **Step 7: Stories** `Navigation/Menu`:
  - `GitActions`: trigger "Git actions" with Fetch, Pull, Push (Push
    `disabled`), GA-7. `play`: click the trigger, `{ArrowDown}`, `{Enter}` → the
    trigger has focus and `aria-expanded="false"`.
  - `RepositorySwitcher`: a `uiMenuGroup` "Recent repositories" with three
    items, a separator, then link items **All repositories** and **Repository
    settings** (NV-10).
  - `NearTheEdge`: the trigger at the inline end of a 20rem wrapper; `play`
    opens it and asserts the menu's `getBoundingClientRect().right <=
    window.innerWidth`.

- [ ] **Step 8: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green, including `Design system/Tokens → Contrast`.

- [ ] **Step 9: Format and commit** (`git commit -m "Menu navigation
      component"`).

---

### Task 4: `Tree`

> **Superseded:** this task was carried out differently. Aria's Tree measured
> 1,262 ms to open a folder of 1,000 entries, so the Tree was rebuilt as our own
> flat tree on the CDK's virtual scrolling. See A-10.34 in
> `docs/architecture/design-system.md`; the steps below are kept as written.

**Files:**

- Create: `libs/ui/src/navigation/models/tree-node.model.ts`
- Create:
  `libs/ui/src/navigation/components/tree/tree.component.{ts,html,scss,spec.ts,stories.ts}`
- Create: `libs/ui/src/navigation/directives/tree-node/tree-node.directive.ts`
- Create:
  `libs/ui/src/navigation/directives/tree-item-menu/tree-item-menu.directive.ts`
- Modify: `libs/ui/src/index.ts`,
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`,
  `docs/architecture/design-system.md`

**Interfaces:**

- Consumes: `MenuComponent`, `MenuTriggerDirective`, `MenuItemComponent` (Task
  3), only in tests and stories.
- Produces (Aria from `@angular/aria/tree`):
  - `TreeNode` in `tree-node.model.ts`:

    ```ts
    export interface TreeNode {
      /** Unique in the tree, such as a path. */
      readonly value: string;
      /** Accessible name and typeahead text. */
      readonly label: string;
      /** Folders: can be expanded. */
      readonly expandable?: boolean;
      /** Children of an expandable node; undefined until they are loaded. */
      readonly children?: readonly TreeNode[];
      /** Defaults to !expandable. */
      readonly selectable?: boolean;
    }
    ```

  - `TreeNodeDirective`, selector `ng-template[uiTreeNode]`; public `template =
    inject(TemplateRef<{ $implicit: TreeNode; level: number; expanded: boolean
    }>)`; `static ngTemplateContextGuard` for typed `let-node`.
  - `TreeItemMenuDirective`, selector `button[uiTreeItemMenu]`; host
    `tabindex="-1"`, `(click)` → `event.stopPropagation()` (the row must not
    select or toggle). Put on the same button as `uiMenuTrigger`.
  - `TreeComponent`, selector `ui-tree`; `hostDirectives: [{ directive: Tree,
    inputs: ['value: selected'], outputs: ['valueChange: selectedChange'] }]`
    (single selection; `selected` is `string[]` of zero or one value);
    - `nodes = input.required<readonly TreeNode[]>()`;
    - `label = input.required<string>()` → `aria-label`;
    - `expanded = model<readonly string[]>([])`: values of expanded nodes, set
      by the consumer to restore (FB-14) and updated on expand/collapse;
    - `loadChildren = output<string>()`: emitted when a node whose `children` is
      `undefined` is expanded (FB-15);
    - row content from `contentChild(TreeNodeDirective)`, else `node.label`.
- Rendering: a recursive `ng-template` in the component's template. Each node is
  a `div` with `ngTreeItem` (`[parent]`, `[value]`, `[label]`, `[selectable]`,
  `[expanded]`/`(expandedChange)` bound to `expanded()`), holding `.row` (with
  `[style.--ui-tree-level]="item.level()"`, a chevron for expandable nodes, then
  the row content) and, for expandable nodes, a `div role="group"` with
  `<ng-template ngTreeItemGroup [ownedBy]="item">` that renders `node.children
  ?? []` with the same template.

- [ ] **Step 1: Scaffold** `component --name=tree`, `directive --name=tree-node`
      (selector `ng-template[uiTreeNode]`), `directive --name=tree-item-menu`
      (selector `button[uiTreeItemMenu]`); create the model file by hand.

- [ ] **Step 2: Write the failing tests** in `tree.component.spec.ts`.
      `TreeHarness` subclass with `hostSelector = 'ui-tree'`; `TreeItemHarness`
      as is. Fixture `nodes`: `docs` (expandable, children `guides` (expandable,
      children `setup.md`) and `intro.md`), `src` (expandable, `children`
      undefined), `README.md`, `CHANGELOG.md`. Host binds `[(selected)]`,
      `[(expanded)]`, `(loadChildren)`, and a `<ng-template uiTreeNode
      let-node>` with `{{ node.label }}` and a `<button uiTreeItemMenu
      [uiMenuTrigger]="menu.aria" aria-label="Actions for {{ node.label }}">`
      plus one `ui-menu` with a Rename item.

```ts
it('is a labelled tree of levelled items', ...);
// role 'tree', aria-label 'Files'; root items level 1; README.md aria-setsize 4, aria-posinset 3.

it('renders children only once a folder is expanded', ...);
// no 'intro.md' item; click docs → expanded() ['docs'], intro.md level 2.

it('asks for children it does not have', ...);
// click src → loadChildren emitted 'src' once; expanding docs emits nothing;
// host then sets src children [main.ts] → item main.ts rendered.

it('restores expanded folders and the open file', ...);
// before first render: expanded ['docs', 'docs/guides'], selected ['docs/guides/setup.md']
// → setup.md rendered at level 3 with aria-selected 'true'.

it('focuses the open file when tabbed into', ...);  // Review Focus 1
// same restore; focus the tree's tab stop → activeElement is setup.md's item.

it('opens a file with Enter and toggles a folder with Enter', ...);
// focus README.md, Enter → selected ['README.md']; focus docs, Enter → expanded ['docs'], selected unchanged.

it('expands and collapses with the arrow keys', ...);
// focus docs, ArrowRight → expanded; ArrowLeft → collapsed.

it('opens the row actions menu from the keyboard and keeps navigating', ...);  // Review Focus 3
// focus README.md, Shift+F10 → menu open; Escape → closed; ArrowDown → CHANGELOG.md focused.
// Also the ContextMenu key opens it.

it('does not select or toggle a row when its menu button is clicked', ...);
// click docs' menu button → expanded() [], selected [].

it('keeps one tab stop when the focused item disappears', ...);  // Review Focus 4
// focus CHANGELOG.md, host removes it from nodes → no throw; exactly one item has tabIndex 0.

it('indents rows by level', ...);
// setup.md's .row style --ui-tree-level is '3'.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/tree.component.spec.ts'` Expected: FAIL.

- [ ] **Step 4: Implement.**
  - `Enter` on an expandable active item toggles it (Aria only selects); handle
    on the host `keydown`, after checking the item through Aria's active item.
  - `Shift+F10` and `ContextMenu` on the host: find the active item's element,
    and `click()` its `[uiTreeItemMenu]` if it has one; `preventDefault()`.
  - Focus on the open file: if Aria does not make the selected item the tab stop
    on its own, set Aria's active item to the selected one when the tree
    receives focus from outside.
  - Lost focus: if the focused element is removed, make sure Aria's active item
    falls back to an existing item (first, or the selected one).
  - `loadChildren` is emitted from `(expandedChange)` when the new value is
    `true` and `node.children === undefined`.
  - Styles: host `display: block`, `--ui-font-size-ui`, component tokens
    `--ui-tree-indent: var(--ui-space-4)`; `.row` flex, gap `--ui-space-1`,
    `min-block-size: var(--ui-row-height)`, `padding-inline-start:
    calc((var(--ui-tree-level) - 1) * var(--ui-tree-indent) +
    var(--ui-space-1))`, `content-visibility: auto;
    contain-intrinsic-block-size: auto var(--ui-row-height);` (the cost of 5,000
    rendered rows), `cursor: pointer`; `.row:hover` → `--ui-surface-hover`;
    selected row → `--ui-selected-inactive`, and `--ui-selected-active` while
    `:host(:focus-within)` (A-10.19); under `forced-colors: active` a selected
    row also gets a 1 px `Highlight` outline; the focus ring goes on the focused
    item's `.row` (`[role='treeitem']:focus-visible { outline: none } … > .row {
    @include mixins.focus-ring }`), never around its children; the chevron is
    the Codicon `chevron-right` inline SVG in the component's template,
    `--ui-icon-muted`, rotated 90° when `[aria-expanded='true']` (mirrored in
    RTL with `:host-context([dir='rtl'])` or `scale: -1 1`), with `transition:
    rotate var(--ui-duration-fast)`; non-expandable rows keep the same space.
  - `[uiTreeItemMenu]` buttons are styled by the consumer; they must be in the
    row's content.

- [ ] **Step 5: Contrast pairs.** Add `graphic('icon-muted', 'surface-island')`,
      `graphic('icon-muted', 'selected-active')`, `graphic('icon-muted',
      'selected-inactive')`, and `graphic('border-focus', 'selected-inactive')`.
      Fix failing token values as in Task 3, Step 5.

- [ ] **Step 6: Record the decision.** In `docs/architecture/design-system.md`:
  - A-10.34: replace "and the CDK's virtual scrolling for large folders" with
    the decision: Aria's Tree navigates only rendered items, so the tree renders
    every visible row and keeps painting cheap with `content-visibility: auto`;
    a folder holds at most 5,000 entries (FB-18), and the `Navigation/Tree →
    LargeFolder` story measures that case. Virtual scrolling needs a tree of our
    own and is reconsidered only if that measurement misses NF-2.1.
  - A-10.2's table row for the CDK: drop `Scrolling` if nothing else uses it.
    A-10.32's Navigation row: "Aria Tabs, Tree, Menu; CDK Overlay".

- [ ] **Step 7: Export** `TreeComponent`, `TreeNodeDirective`,
      `TreeItemMenuDirective` and `type TreeNode` from `index.ts`.

- [ ] **Step 8: Stories** `Navigation/Tree`:
  - `FileTree`: a repository-like tree in an island (`.github`, `docs/`,
    `README.md`, `.gitignore`), with an "Actions for …" menu button on each row
    (Rename, Delete) shown with the Codicon `ellipsis`. `play`: Tab into the
    tree, `{ArrowDown}`, `{ArrowRight}` → the folder is expanded.
  - `LazyFolder`: `loadChildren` resolves after 300 ms with three children; a
    "Loading…" non-selectable child is shown meanwhile.
  - `LargeFolder`: one folder of 5,000 files (`file-0001.md` …). `play`: measure
    from clicking the folder to the 5,000th `treeitem` being in the DOM with
    `performance.now()`, log it, and expect it below 1,000 ms; then `{End}` →
    the last item has focus. If it is above 1,000 ms, do not tune around it:
    stop and report the number (it decides A-10.34).

- [ ] **Step 9: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green, including Contrast and `LargeFolder`.

- [ ] **Step 10: Format and commit** (`git commit -m "Tree navigation
      component"`), including the design-system change.

---

### Task 5: `SplitPane` preset sizes

**Files:**

- Modify:
  `libs/ui/src/layout/components/split-pane/split-pane.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`, `docs/wiki/todo.md`

**Interfaces:**

- Consumes: `MenuComponent`, `MenuTriggerDirective`, `MenuItemComponent` (Task
  3).
- Produces, in `split-pane.component.ts` and exported from `index.ts`:
  - `interface SplitPanePreset { readonly label: string; readonly size: number
    }` (size in percent);
  - `presets = input<readonly SplitPanePreset[]>([])`;
  - `presetsLabel = input<string>()`: the menu button's accessible name, such as
    "Pane sizes". The button is shown only when both are set and `show() ===
    'both'`.

- [ ] **Step 1: Write the failing tests** in `split-pane.component.spec.ts` (new
      `describe('presets')`, presets `[{ label: 'Small', size: 25 }, { label:
      'Half', size: 50 }, { label: 'Large', size: 75 }]`, `presetsLabel` 'Pane
      sizes', `min` 10, `max` 60 in one case):

```ts
it('offers a menu of preset sizes', ...);
// a button named 'Pane sizes' with aria-haspopup 'menu'; clicking it lists Small, Half, Large.

it('resizes to the chosen preset', ...);
// choose Large → size() 75; separator aria-valuenow '75'; focus back on the button.

it('clamps a preset outside min and max', ...);
// max 60, choose Large → size() 60.

it('has no menu button without presets or a label, or with one pane', ...);

it('keeps the button out of the separator', ...);
// the button is not a descendant of [role="separator"] (nested-interactive).
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx nx run ui:test --include='**/split-pane.component.spec.ts'` Expected:
the new tests FAIL, the old ones PASS.

- [ ] **Step 3: Implement.** Wrap the separator in a `.divider` element that
      takes the separator's grid track; the menu button is the separator's
      sibling inside it, centred on it (`position: absolute`), a square of
      `--ui-control-height-small` with the Codicon `ellipsis` (rotated for
      horizontal orientation, so it reads as a handle), `--ui-surface-raised`
      background and `--ui-border-default` border, `mixins.focus-ring` on
      `:focus-visible`. Dragging still starts only on the separator. The menu's
      `itemSelected` sets `size` to the clamped preset size.

- [ ] **Step 4: Run** the spec → all PASS.

- [ ] **Step 5: Stories.** Add `presets` and `presetsLabel` to `Horizontal` and
      `Vertical`; add a `play` to `Vertical` that opens the menu, chooses the 75
      % preset and expects `aria-valuenow="75"`.

- [ ] **Step 6: To-do.** Remove the `SplitPane` preset-menu item from "UI work"
      in `docs/wiki/todo.md` (leave the heading if other items follow, else
      remove it too).

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green (the existing `AppShell` stories still pass).

- [ ] **Step 8: Format and commit** (`git commit -m "SplitPane preset size
      menu"`).

---

### Task 6: Whole-library verification

- [ ] **Step 1:** `npx nx affected -t lint,test,build` → all succeed.
- [ ] **Step 2:** `npx nx run ui:test-storybook` → every story passes.
- [ ] **Step 3:** `npm run format:check` → no changes needed.
- [ ] **Step 4:** Report the `LargeFolder` timing from Task 4 and any token
      values changed for contrast.

---

## Not in this plan

- The user menu's header text (display name, email, version, NV-7): a
  `role="menu"` may only own items, groups and separators. Decide when the user
  menu is built (for example a labelled group, or a non-menu header outside the
  menu), with axe as the judge.
- Loading, empty, error and "_n_ more items not shown" rows of the file tree
  (FB-18, FB-33, FB-44): feature code, as non-selectable `TreeNode`s.
- The ignored-entry icon and its tooltip (FB-20a): needs `Tooltip` (Feedback
  group).
- Submenus and menubars: no MVP screen needs them.
- `Icon` and `IconButton`: inline Codicon SVGs until they exist.
