# Feedback Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Feedback group of the `ui` library (A-10.32): `Spinner`,
`ProgressBar`, `Badge`, `InlineBanner`, `Tooltip`, `Popover`, `Dialog` and
`Toast`, plus a `busy` state on `Button` and `IconButton` (GA-9), with unit
tests and Storybook stories.

**Architecture:** A new library feature `feedback` in `libs/ui/src/feedback/`,
laid out like `controls`. `Spinner`, `ProgressBar` and `InlineBanner` are
element components; `Badge` is an attribute component on `<span>` (A-10.26).
`Tooltip` and `Popover` live in CDK overlays created with `createOverlayRef`, as
`ui-menu` does. `Dialog` wraps the CDK `Dialog` service behind our own
`DialogService`, `DialogRef` and `DIALOG_DATA`, so that features never import
`@angular/cdk/dialog` (A-10.4); `ui-dialog` is the frame a dialog component puts
in its template. `Toast` is a root `ToastService` holding a signal of toasts and
a `ui-toast-outlet` that the web client places once; announcements go through
the CDK `LiveAnnouncer`. `IconButton` replaces its native `title` with the
tooltip.

**Tech Stack:** Angular 22.2 (signals), `@angular/cdk` 22.2.4 (`overlay`,
`portal`, `dialog`, `a11y`), SCSS with `--ui-*` tokens, Vitest + jsdom unit
tests (`@nx/angular:unit-test`, fake timers for delays), Storybook 10
(`@storybook/angular-vite`) with the a11y and Vitest addons.

**Spec:** `docs/architecture/design-system.md` (A-10.2–A-10.4, A-10.8,
A-10.17–A-10.22, A-10.24–A-10.32, A-10.35, A-10.37–A-10.38). Screen requirements
that shape the APIs: `docs/requirements/navigation.md` NV-15, NV-16;
`docs/requirements/editor.md` ED-18, ED-21, ED-24, ED-25, ED-38;
`docs/requirements/git-advanced.md` GA-8, GA-9, GA-26, GA-28, GA-30, GA-32,
GA-34, GA-35; `docs/requirements/git-conflicts.md` GC-22, GC-25, GC-26;
`docs/requirements/repo-credentials.md` RC-15, RC-16, RC-21, RC-22, RC-25;
`docs/requirements/repo-manage.md` RM-7, RM-17, RM-18;
`docs/requirements/dashboard.md` DS-22, DS-25;
`docs/requirements/file-browser.md` FB-20a, FB-38, FB-43, FB-45;
`docs/requirements/preview-html.md` SH-17–SH-20;
`docs/architecture/non-functional.md` NF-12.4, NF-13.3, NF-13.5, NF-13.7.

## Global Constraints

Everything in the Global Constraints of
`docs/superpowers/plans/2026-10-25-controls-components.md` applies unchanged
(scaffolding with `@hexmode/toolkit-nx` and `--feature=feedback`, hand-written
stories, OnPush and signal APIs, no Transloco, `@layer components`, selector
order, semantic tokens only, `rem` sizes, no `style` attributes, namespaced
`@use`, focus rings, colour never the only signal, inline Codicon SVGs until
`Icon` exists, axe in every story, exact versions, `npm run format`). In
addition:

- Every text, including accessible names ("Close", "Dismiss", a region's label),
  is an input or an option field; required texts are required (A-10.3).
- Features use only our API: `DialogService`, `DialogRef`, `DIALOG_DATA`,
  `ToastService`. No story or test outside `libs/ui/src/feedback` imports from
  `@angular/cdk/dialog`, and no consumer template writes a `cdk…` attribute.
- Overlays (tooltip, popover, dialog) are created with the CDK's functional
  overlay API (`createOverlayRef`, `createFlexibleConnectedPositionStrategy`,
  `createRepositionScrollStrategy`) and a `DomPortal` or `ComponentPortal`, as
  `libs/ui/src/navigation/components/menu/menu.component.ts` does.
- Delays and durations that are behaviour (tooltip show/hide delays, toast
  lifetime) are exported `const`s in milliseconds, not CSS tokens; visual motion
  uses `--ui-duration-*`, which is already zero under reduced motion (A-10.12).
- Nothing takes the focus on its own except a dialog when it opens and a popover
  when the user opens it. Whatever closes returns the focus to where it was
  (NF-13.3).
- Status hues and icons (Codicons, `aria-hidden`): info `info`, success `pass`,
  warning `warning`, danger `error`. A status is always also said in text.

## Review Focus

1. **A busy or unavailable button loses the focus or runs twice.** A native
   `disabled` drops the focus to `<body>` and hides any tooltip, so GA-9's busy
   Pull and GA-8's unavailable Push (whose reason must show on hover, focus or
   tap) use `aria-disabled="true"` instead: they keep the focus, their clicks
   are swallowed before any consumer handler, and the tooltip still shows. Tests
   in Task 1 and Task 4.
2. **The focus is lost when something closes.** Closing a dialog (Escape,
   Cancel, the close button, or `close()` from code) returns the focus to the
   element that opened it; Escape in a popover returns it to the trigger; when a
   toast that holds the focus goes away (its action ran, or it was dismissed),
   the focus returns to the element that had it before it entered the toast
   region. Tests in Task 5, Task 6 and Task 7.
3. **Repeated notices pile up.** "This file was updated." (ED-24) after every
   pull, and remote-change notices from fetches every 2 minutes (GA-33): a toast
   shown with the `key` of a toast still on screen replaces it and restarts its
   timer, and at most 3 toasts are shown at once. Test in Task 7.
4. **A toast with an action vanishes before a keyboard or screen reader user
   reaches it** (WCAG 2.2.1), such as GC-22's **Push** and **Undo merge**: a
   toast with actions stays until it is dismissed or an action runs; a toast
   without actions lasts `TOAST_DURATION_MS`, paused while it is hovered or
   holds the focus. Test in Task 7.
5. **Long content at 320 px**: RC-21's dialog with two 50-character SHA256
   fingerprints, RC-15's banner with a long key name and its **Unlock** action,
   and a long tooltip on the edge of the screen must not scroll sideways or
   leave the viewport; a tall dialog scrolls its body while its heading and
   footer stay visible. Story `play` tests in Task 3, Task 4 and Task 6.

---

## File structure

```
libs/ui/src/feedback/
  models/status.model.ts               Status = 'info' | 'success' | 'warning' | 'danger'
  components/status-icon/              StatusIconComponent (ui-status-icon), internal
  components/spinner/                  SpinnerComponent (ui-spinner)
  components/progress-bar/             ProgressBarComponent (ui-progress-bar)
  components/badge/                    BadgeComponent (span[uiBadge])
  components/inline-banner/            InlineBannerComponent (ui-inline-banner)
  directives/banner-actions/           BannerActionsDirective ([uiBannerActions]), marker
  utils/tooltip/tooltip.util.ts        attachTooltip(), TOOLTIP_* delays
  components/tooltip/                  TooltipComponent (ui-tooltip), internal panel
  directives/tooltip/                  TooltipDirective ([uiTooltip])
  components/popover/                  PopoverComponent (ui-popover)
  directives/popover-trigger/          PopoverTriggerDirective (button[uiPopoverTrigger])
  services/dialog/                     DialogService, DialogRef, DIALOG_DATA, DialogOptions
  components/dialog/                   DialogComponent (ui-dialog)
  directives/dialog-footer/            DialogFooterDirective ([uiDialogFooter]), marker
  components/confirm-dialog/           ConfirmDialogComponent, internal
  services/toast/                      ToastService, ToastOptions, ToastAction, TOAST_DURATION_MS
  components/toast-outlet/             ToastOutletComponent (ui-toast-outlet)
libs/ui/src/styles/_overlays.scss      dialog backdrop (outside any component)
libs/ui/src/controls/components/{button,icon-button}/   busy state, tooltip
libs/ui/src/index.ts
libs/ui/src/design-tokens/models/contrast-pairs.model.ts
libs/ui/.storybook/main.ts             optimizeDeps: '@angular/cdk/dialog'
docs/architecture/design-system.md     A-10.32, new A-10.43–A-10.46
```

Delete the generated `feedback/feedback.routes.ts`: the feature has no pages.

---

### Task 1: `feedback` feature, `Spinner`, busy buttons

**Files:**

- Create: `libs/ui/src/feedback/models/status.model.ts`
- Create:
  `libs/ui/src/feedback/components/spinner/spinner.component.{ts,scss,spec.ts,stories.ts}`
- Modify:
  `libs/ui/src/controls/components/button/button.component.{ts,scss,spec.ts,stories.ts}`,
  `libs/ui/src/controls/components/icon-button/icon-button.component.{ts,scss,spec.ts,stories.ts}`,
  `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `type Status = 'info' | 'success' | 'warning' | 'danger'` in
    `status.model.ts`.
  - `SpinnerComponent`, selector `ui-spinner`, template `''`; `label =
    input<string>()`. With a label: host `role="progressbar"`, `aria-label`, no
    value attributes (indeterminate). Without: `aria-hidden="true"`, no role.
  - `ButtonComponent` and `IconButtonComponent` gain `busy = input(false, {
    transform: booleanAttribute })` → `[attr.aria-disabled]` `'true'` while busy
    (otherwise left to the consumer), `[attr.data-busy]`. While busy a
    `<ui-spinner />` (no label) replaces the leading icon of `uiButton` and the
    icon of `uiIconButton`: the projected content sits in `<span class="icon"
    [hidden]="busy()">`, because projected `svg` cannot be styled from the
    component. The accessible name does not change.
  - Both components swallow clicks while `aria-disabled="true"`, whether `busy`
    set it or the consumer did: a `click` listener added with `{ capture: true
    }` on the host calls `preventDefault()` and `stopImmediatePropagation()`.

- [ ] **Step 1: Scaffold** the feature (`--name=feedback`), delete
      `feedback.routes.ts`, then `component --name=spinner` (template `''`,
      delete the html file). Create `status.model.ts` by hand.

- [ ] **Step 2: Write the failing tests.** `spinner.component.spec.ts`:

```ts
it('is a labelled, indeterminate progress bar when it has a label', ...);
// <ui-spinner label="Loading repositories" /> → role 'progressbar', aria-label 'Loading repositories',
// no aria-valuenow, no aria-hidden.

it('is hidden from assistive technology without a label', ...);
// <ui-spinner /> → aria-hidden 'true', no role.
```

      Add to `button.component.spec.ts`, host `<button uiButton [busy]="busy()"
      (click)="clicks = clicks + 1"><svg aria-hidden="true"></svg>Pull</button>`
      and `<button uiButton aria-disabled="true" (click)="clicks = clicks + 1">Push</button>`:

```ts
it('shows a spinner and keeps its name while busy', ...);
// busy true → ui-spinner present, .icon hidden, aria-disabled 'true', data-busy 'true',
// textContent still 'Pull'; busy false → no spinner, aria-disabled absent.

it('keeps the focus when it becomes busy', ...);  // Review Focus 1
// focus Pull, busy.set(true), detectChanges → document.activeElement is still Pull.

it('swallows clicks while aria-disabled', ...);  // Review Focus 1
// click Pull while busy → clicks 0; click Push → clicks 0; busy false, click Pull → clicks 1.
```

      Add the same three tests to `icon-button.component.spec.ts` (label
      "Fetch").

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test
--include='**/{spinner,button,icon-button}.component.spec.ts'` Expected: the new
tests FAIL.

- [ ] **Step 4: Implement.** Spinner styles: component tokens
      `--ui-spinner-size: var(--ui-icon-size)` and `--ui-spinner-duration: 0.8s`
      (deliberately not a motion token, which is zero under reduced motion);
      host `display: inline-block; flex: none`, a circle of the size with a
      `0.125rem` border in `color-mix(in oklch, currentColor 25%, transparent)`
      and `border-block-start-color: currentColor`, so it works on every button
      variant and surface; `animation: spin var(--ui-spinner-duration) linear
      infinite`. Under `prefers-reduced-motion: reduce`: no rotation, a 2 s
      `opacity` pulse between 1 and 0.4, so activity stays visible (NF-13.7).
      Under `forced-colors: active`: arc `CanvasText`.
      `:host([data-busy='true'])` on both buttons: `cursor: progress`, and the
      disabled colours do **not** apply (it is busy, not unavailable).
      `uiIconButton` gets the `[aria-disabled='true']` disabled styles that
      `uiButton` already has.

- [ ] **Step 5: Export** `SpinnerComponent` and `type Status` from `index.ts`.

- [ ] **Step 6: Stories.** `Feedback/Spinner`: `Default`, `Labelled` ("Loading
      repositories", DS-25), `InText` (inside an `ui-island` next to "Loading…",
      FB-43). Add `Busy` to `Controls/Button` ("Pull", toggled by a click that
      sets `busy` for 1 s; `play`: click → `aria-disabled="true"` and focus
      stays on it) and `Busy` to `Controls/Icon button` (Fetch, Pull, Push with
      Pull busy, GA-9).

- [ ] **Step 7: Verify.** Specs → PASS; `npx nx run ui:lint` clean; `npx nx run
      ui:test-storybook` green.

- [ ] **Step 8: Format and commit** (`git commit -m "Spinner and busy
      buttons"`).

---

### Task 2: `ProgressBar` and `Badge`

**Files:**

- Create:
  `libs/ui/src/feedback/components/progress-bar/progress-bar.component.{ts,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/feedback/components/badge/badge.component.{ts,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`,
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`

**Interfaces:**

- Consumes: `Status` (Task 1).
- Produces:
  - `ProgressBarComponent`, selector `ui-progress-bar`, template: one `.fill`
    div; `label = input.required<string>()` → `aria-label`; `value =
    input<number | null>(null)`; `max = input(100)`; `valueText =
    input<string>()` → `aria-valuetext` (for "Receiving objects: 45 %", RM-7).
    Host `role="progressbar"`, `aria-valuemin="0"`, `[attr.aria-valuemax]`,
    `[attr.aria-valuenow]`. `null` is indeterminate: no `aria-valuenow`,
    `data-indeterminate`. A number is clamped to `[0, max]`; `NaN` is treated as
    `null`; a `max` ≤ 0 counts as 100. The fill's width is set with
    `[style.--ui-progress-value]` (a fraction 0–1), never a `style` attribute.
  - `type BadgeStatus = Status | 'neutral'`; `BadgeComponent`, selector
    `span[uiBadge]`, template `<ng-content select="svg" /><ng-content />`;
    `status = input<BadgeStatus>('neutral')` → `[attr.data-status]`. Not
    interactive and not a live region. For repository statuses ("Cloning",
    "Clone failed", DS-22, RM-6) and warnings (RM-8).

- [ ] **Step 1: Scaffold** `component --name=progress-bar`, `component
      --name=badge` (selector `span[uiBadge]`, inline template, delete the html
      file).

- [ ] **Step 2: Write the failing tests.** `progress-bar.component.spec.ts`:

```ts
it('is a labelled progress bar with its value', ...);
// label 'Cloning handbook', value 45 → role 'progressbar', aria-label, aria-valuemin '0',
// aria-valuemax '100', aria-valuenow '45', --ui-progress-value '0.45'.

it('says its value in words when given', ...);
// valueText 'Receiving objects: 45 %' → aria-valuetext.

it('is indeterminate without a value', ...);
// value null → no aria-valuenow, data-indeterminate 'true'.

it('keeps out-of-range values inside the bar', ...);
// value 150 → aria-valuenow '100', fraction 1; value -5 → '0'; value NaN → indeterminate;
// max 0 → aria-valuemax '100'.
```

      `badge.component.spec.ts`:

```ts
it('shows its text with a status for styling', ...);
// <span uiBadge status="danger">Clone failed</span> → data-status 'danger', text 'Clone failed';
// default data-status 'neutral'; no role, no aria-live.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test
--include='**/feedback/components/{progress-bar,badge}/*.spec.ts'` Expected:
FAIL.

- [ ] **Step 4: Implement.** Styles:
  - ProgressBar: component token `--ui-progress-bar-height: var(--ui-space-1)`;
    host `display: block; inline-size: 100%`, background `--ui-surface-sunken`,
    border `--ui-border-width` solid `--ui-border-strong`, radius
    `--ui-radius-pill`, `overflow: hidden`; `.fill` background `--ui-accent`,
    `inline-size: calc(var(--ui-progress-value, 0) * 100%)`, `transition:
    inline-size var(--ui-duration-base) var(--ui-easing-standard)`;
    indeterminate: a 40 % fill sliding from start to end in 1.5 s (not a motion
    token, as the spinner), and under reduced motion a full-width fill pulsing
    in `opacity`. Forced colours: fill `Highlight`, border `CanvasText`.
  - Badge: `display: inline-flex; align-items: center; gap: var(--ui-space-1);
    max-inline-size: 100%`, padding-inline `--ui-space-1-5`, `min-block-size:
    calc(var(--ui-icon-size) + var(--ui-space-1))`, `--ui-font-size-ui-small`,
    weight medium, radius `--ui-radius-pill`, border `--ui-border-width` solid;
    `overflow-wrap: anywhere`. Neutral: background `--ui-surface-sunken`, border
    `--ui-border-default`, text `--ui-text-muted`. Each status: background
    `--ui-<status>-background`, border `--ui-<status>-border`, `color:
    var(--ui-<status>-text)`. A projected icon inherits `currentColor`
    (projected `svg` cannot be styled from the component).

- [ ] **Step 5: Contrast pairs.** Add `graphic('accent', 'surface-sunken')` (the
      progress fill on its track). Badge text is already covered by the status
      pairs and by `text-muted` on every surface.

- [ ] **Step 6: Export** `ProgressBarComponent`, `BadgeComponent`, `type
      BadgeStatus` from `index.ts`.

- [ ] **Step 7: Stories.** `Feedback/Progress bar`: `Clone` (45 % with
      `valueText`, RM-7, animating 0 → 100 % over 3 s), `Indeterminate`
      ("Waiting for other clones to finish", AR-52), `Narrow` (20rem wrapper).
      `Feedback/Badge`: `Statuses` (Cloning, neutral, with the `sync` Codicon;
      Clone failed, danger; Credentials refused, warning; Up to date, success;
      Needs your confirmation, info), `Long` ("Working copy is missing or
      damaged" in a 12rem wrapper; `play`: the wrapper's `scrollWidth <=
      clientWidth`).

- [ ] **Step 8: Verify.** Specs → PASS; `ui:lint` clean; `ui:test-storybook`
      green, including `Design system/Tokens → Contrast`.

- [ ] **Step 9: Format and commit** (`git commit -m "ProgressBar and Badge"`).

---

### Task 3: `InlineBanner`

**Files:**

- Create: `libs/ui/src/feedback/components/status-icon/status-icon.component.ts`
- Create:
  `libs/ui/src/feedback/components/inline-banner/inline-banner.component.{ts,html,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/feedback/directives/banner-actions/banner-actions.directive.ts`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Consumes: `Status` (Task 1), `IconButtonComponent`, `ButtonComponent`.
- Produces:
  - `StatusIconComponent` (internal, not exported), selector `ui-status-icon`;
    `status = input.required<Status>()`; renders the status's inline Codicon
    SVG, `aria-hidden="true"`, coloured `--ui-<status>-icon`. Used by the banner
    and the toast.
  - `BannerActionsDirective`, selector `[uiBannerActions]`, a marker for the
    projected actions.
  - `InlineBannerComponent`, selector `ui-inline-banner`; `status =
    input<Status>('info')` → `[attr.data-status]`; `quiet = input(false, {
    transform: booleanAttribute })` → `[attr.data-quiet]` (SH-17's single quiet
    line); `dismissLabel = input<string>()`: when set, a `uiIconButton` with
    that label and the `close` Codicon is shown; `dismissed = output<void>()`.
    The banner does not hide itself: the feature removes it, since what
    "dismissed" means differs (for the visit, RC-15; until more commits arrive,
    GA-34; never, NV-15). `announce = input(false, { transform: booleanAttribute
    })`: when true, the message's text is announced once, politely, through
    `LiveAnnouncer` after the first render (RC-25), and never again while the
    component lives; when false nothing is announced (SH-20). No `role` and no
    `aria-live` on the host, so it is not re-announced as its content changes.
  - Template: `ui-status-icon`, `<div class="message"><ng-content /></div>`,
    `<div class="actions"><ng-content select="[uiBannerActions]" /></div>`, then
    the dismiss button.

- [ ] **Step 1: Scaffold** `component --name=inline-banner`, `component
      --name=status-icon` (inline template), `directive --name=banner-actions`.

- [ ] **Step 2: Write the failing tests** in `inline-banner.component.spec.ts`.
      Host:

```html
@if (shown()) {
  <ui-inline-banner status="warning" dismissLabel="Dismiss" announce (dismissed)="shown.set(false)">
    <strong>work-laptop</strong> is locked. Unlock it to fetch, pull and push.
    <div uiBannerActions><button uiButton size="small">Unlock</button></div>
  </ui-inline-banner>
}
<ui-inline-banner quiet>Some HTML isn't shown in the preview.</ui-inline-banner>
```

      with `LiveAnnouncer` replaced by a spy.

```ts
it('shows its message, its actions and its status', ...);
// data-status 'warning'; .message text contains 'is locked'; Unlock inside .actions; status icon aria-hidden.

it('offers a dismiss button that reports and leaves removal to its owner', ...);
// dismiss button aria-label 'Dismiss', type 'button'; click → shown() false, the banner is gone.

it('has no dismiss button without a label', ...);
// the quiet banner has no button.

it('announces its message once when asked to', ...);  // RC-25
// announce called once with 'work-laptop is locked. Unlock it to fetch, pull and push.' and 'polite';
// a later detectChanges does not call it again.

it('stays silent by default', ...);  // SH-20
// no announce call for the quiet banner; neither banner has role or aria-live.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/inline-banner.component.spec.ts'`
Expected: FAIL.

- [ ] **Step 4: Implement.** Styles: host `display: grid; grid-template-columns:
      auto 1fr auto; grid-template-areas: 'icon message dismiss' '. actions
      actions'; gap: var(--ui-space-1) var(--ui-space-2); align-items: start;
      container-type: inline-size`, padding `--ui-space-2` `--ui-space-3`,
      background `--ui-<status>-background`, border `--ui-border-width` solid
      `--ui-<status>-border`, radius component token `--ui-inline-banner-radius:
      var(--ui-radius-control)` (a global banner below the header sets it to 0),
      text `--ui-text-default`, `--ui-font-size-ui`; `.message`
      `min-inline-size: 0; overflow-wrap: anywhere`; `.actions` `display: flex;
      flex-wrap: wrap; gap: var(--ui-space-2)`, hidden when empty. `@container
      (min-width: 36rem)`: one row, `'icon message actions dismiss'`. Quiet: no
      background or border, `--ui-text-muted`, `--ui-font-size-ui-small`,
      padding `--ui-space-1` `--ui-space-2`. Forced colours: keep the border so
      the banner is still a box.

- [ ] **Step 5: Export** `InlineBannerComponent`, `BannerActionsDirective` from
      `index.ts`.

- [ ] **Step 6: Stories** `Feedback/Inline banner`:
  - `Statuses`: one per status with plain text.
  - `NewVersion`: "A new version of Front Burner is available." with **Reload**,
    no dismiss, `--ui-inline-banner-radius: 0` set from the story's own
    stylesheet (NV-15); `Offline` ("You're offline. Changes are kept and saved
    when you're back online.", warning, NV-15).
  - `LockedKey`: RC-15 with a 60-character key name, **Unlock** and dismiss, in
    a 20rem wrapper; `play`: the wrapper's `scrollWidth <= clientWidth`, and
    clicking dismiss removes it (Review Focus 5).
  - `FileChanged`: ED-24's "This file changed while you were editing." with
    **Reload** and **Keep mine**.
  - `RemovedHtml`: SH-17's quiet line with **Details** and **Hide** buttons.

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green.

- [ ] **Step 8: Format and commit** (`git commit -m "InlineBanner"`).

---

### Task 4: `Tooltip`, and tooltips on icon buttons

**Files:**

- Create: `libs/ui/src/feedback/utils/tooltip/tooltip.util.{ts,spec.ts}`
- Create: `libs/ui/src/feedback/components/tooltip/tooltip.component.{ts,scss}`
- Create:
  `libs/ui/src/feedback/directives/tooltip/tooltip.directive.{ts,spec.ts,stories.ts}`
- Modify:
  `libs/ui/src/controls/components/icon-button/icon-button.component.{ts,spec.ts}`,
  `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - In `tooltip.util.ts`: `TOOLTIP_SHOW_DELAY_MS = 500`,
    `TOOLTIP_HIDE_DELAY_MS = 100`, and

    ```ts
    /**
     * Shows `text` next to `host` on hover (after a delay), on keyboard focus
     * (at once) and, when `showOnClick` or the host is aria-disabled, on click
     * or tap. Must be called in an injection context; cleans up on destroy.
     */
    export function attachTooltip(
      host: HTMLElement,
      text: Signal<string>,
      options: { describes: boolean; showOnClick: Signal<boolean> }
    ): void;
    ```

    - `describes: true` makes `text` the host's accessible description
      (`aria-describedby`) **at all times**, not only while shown: a root
      service keeps one hidden container in `<body>` with one `<span id>` per
      described host, so the description is there on the first focus. `false` is
      for hosts whose accessible name already is the text (`uiIconButton`).
    - The visible panel is `TooltipComponent` (`ui-tooltip`, internal),
      `aria-hidden="true"`, attached in a connected overlay above the host
      (fallback below, then the sides), `withPush(true)`,
      `withViewportMargin(8)`; created on first show and disposed on destroy.
    - WCAG 1.4.13: moving the pointer from the host onto the panel keeps it
      shown (the hide waits `TOOLTIP_HIDE_DELAY_MS` and is cancelled by
      `pointerenter` on the panel); Escape hides it without moving the focus and
      without closing anything else (the event's propagation is stopped only
      when a tooltip was shown); it stays until the pointer leaves, the focus
      leaves, or Escape. A click-shown tooltip hides on the next click outside
      or on blur. An empty `text` never shows.
  - `TooltipDirective`, selector `[uiTooltip]`; `text = input.required<string>({
    alias: 'uiTooltip' })`; `showOnClick = input(false, { alias:
    'uiTooltipShowOnClick', transform: booleanAttribute })`; calls
    `attachTooltip(host, text, { describes: true, showOnClick })`. The host must
    be focusable; the directive does not add a `tabindex`.
  - `IconButtonComponent`: drops `[attr.title]` and calls `attachTooltip(host,
    label, { describes: false, showOnClick: signal(false) })`.

- [ ] **Step 1: Scaffold** `directive --name=tooltip`, `component
      --name=tooltip` (inline template `{{ text() }}`); create the util file by
      hand.

- [ ] **Step 2: Write the failing tests** with `vi.useFakeTimers()`.
      `tooltip.directive.spec.ts`, host:

```html
<button uiButton aria-disabled="true" uiTooltip="Nothing to push">Push</button>
<button uiIconButton label="Ignored" uiTooltip="Ignored by .gitignore. Git won't commit this file." uiTooltipShowOnClick>
  <svg aria-hidden="true"></svg>
</button>
<button>Elsewhere</button>
```

```ts
it('describes its host before it is ever shown', ...);
// Push aria-describedby → an element in the document whose text is 'Nothing to push'.

it('shows after a hover delay and hides when the pointer leaves', ...);
// pointerenter Push → no ui-tooltip; advance 499 ms → none; 1 ms more → 'Nothing to push' shown;
// pointerleave, advance TOOLTIP_HIDE_DELAY_MS → gone.

it('stays shown while the pointer moves onto it', ...);
// shown; pointerleave host, pointerenter panel, advance 1 s → still shown.

it('shows at once on keyboard focus and hides on blur', ...);
// focus Push → shown with no delay; focus Elsewhere → gone.

it('hides on Escape without moving the focus', ...);
// focus Push, keydown Escape → gone; document.activeElement is Push.

it('shows on click for an unavailable button', ...);  // Review Focus 1, GA-8
// click Push → shown; click Elsewhere → gone.

it('shows on tap when asked to', ...);  // FB-20a
// click the Ignored button → its text is shown.
```

      Update `icon-button.component.spec.ts`: `'is named by its label'` now
      expects no `title` attribute and no `aria-describedby`; add `it('shows
      its label as a tooltip on focus', ...)` (focus → a `ui-tooltip` with text
      'Fetch').

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test
--include='**/{tooltip.directive,icon-button.component}.spec.ts'` Expected:
FAIL.

- [ ] **Step 4: Implement.** Panel styles: `display: block; max-inline-size:
      min(20rem, calc(100vw - 2 * var(--ui-space-2)))`, padding `--ui-space-1`
      `--ui-space-2`, background `--ui-text-default`, text `--ui-text-inverse`
      (the same inverted pair `text('text-inverse', 'text-default')` already
      checked), `--ui-font-size-ui-small`, radius `--ui-radius-control`,
      `--ui-shadow-popover`, `overflow-wrap: anywhere`; fades in over
      `--ui-duration-fast`. Forced colours: `Canvas` / `CanvasText` with a 1 px
      `CanvasText` border.

- [ ] **Step 5: Export** `TooltipDirective` from `index.ts` (the util and the
      panel stay internal).

- [ ] **Step 6: Stories** `Feedback/Tooltip`:
  - `IconButtons`: Fetch, Pull, Push (GA-7). `play`: tab to Fetch → a tooltip
    "Fetch" is visible.
  - `Unavailable`: Push with `aria-disabled="true"` and "Nothing to push"
    (GA-8). `play`: click it → the tooltip is visible and the focus is on Push.
  - `Ignored`: a file-tree-like row with the ignored icon button and FB-20a's
    text, `uiTooltipShowOnClick`.
  - `Edge`: a host at the right edge with a 200-character text, viewport 320 px.
    `play`: hover, wait `TOOLTIP_SHOW_DELAY_MS`, the panel's
    `getBoundingClientRect()` is inside `window.innerWidth` (Review Focus 5).

- [ ] **Step 7: Verify.** Specs → PASS (including every existing `icon-button`
      story and spec); `ui:lint` clean; `ui:test-storybook` green.

- [ ] **Step 8: Format and commit** (`git commit -m "Tooltip"`).

---

### Task 5: `Popover`

**Files:**

- Create:
  `libs/ui/src/feedback/components/popover/popover.component.{ts,html,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/feedback/directives/popover-trigger/popover-trigger.directive.ts`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `PopoverComponent`, selector `ui-popover`, `exportAs: 'uiPopover'`; `label =
    input.required<string>()` → `aria-label`; `open = model(false)`; host
    `role="dialog"` (non-modal), `tabindex="-1"`, `[id]` generated
    (`ui-popover-N`), `hidden` while closed. While open its host is moved into a
    connected overlay below the trigger (fallbacks: above, then end-aligned),
    `withPush(true)`, `withViewportMargin(8)`, exactly as `MenuComponent` moves
    itself with a `DomPortal`.
    - Opening moves the focus to the first focusable element inside, or to the
      host when there is none (the GA-35 reason text).
    - Escape closes it and returns the focus to the trigger.
    - A pointer-down outside both the popover and its trigger, or the focus
      moving outside both, closes it without moving the focus.
  - `PopoverTriggerDirective`, selector `button[uiPopoverTrigger]`; `popover =
    input.required<PopoverComponent>({ alias: 'uiPopoverTrigger' })`; host
    `type="button"`, `aria-haspopup="dialog"`, `[attr.aria-expanded]`,
    `[attr.aria-controls]`, `(click)` toggles. Registers itself as the popover's
    origin.

- [ ] **Step 1: Scaffold** `component --name=popover`, `directive
      --name=popover-trigger`.

- [ ] **Step 2: Write the failing tests** in `popover.component.spec.ts`, host:

```html
<button uiButton [uiPopoverTrigger]="info">Couldn't check for remote changes</button>
<ui-popover #info="uiPopover" label="Remote check failed">
  <p>The server did not answer.</p>
  <button uiButton size="small">Try again</button>
</ui-popover>
<button uiButton [uiPopoverTrigger]="plain">Details</button>
<ui-popover #plain="uiPopover" label="Details"><p>Only text.</p></ui-popover>
<button>Elsewhere</button>
```

```ts
it('is a closed, labelled non-modal dialog controlled by its trigger', ...);
// trigger aria-haspopup 'dialog', aria-expanded 'false', aria-controls === popover id;
// popover role 'dialog', aria-label 'Remote check failed', hidden.

it('opens on click and moves the focus inside', ...);
// click → aria-expanded 'true', popover in the overlay container, focus on Try again.

it('focuses itself when it holds nothing focusable', ...);
// open Details → document.activeElement is the plain popover.

it('closes on Escape and returns the focus to its trigger', ...);  // Review Focus 2

it('closes when the focus or a click goes elsewhere', ...);
// open, focus Elsewhere → closed, focus stays on Elsewhere; open, pointerdown on body → closed.

it('toggles from its trigger', ...);
// click trigger twice → closed, open() false.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/popover.component.spec.ts'` Expected:
FAIL.

- [ ] **Step 4: Implement.** Styles as `ui-menu`'s panel: `display: block`,
      background `--ui-surface-raised`, border `--ui-border-width` solid
      `--ui-border-default`, radius `--ui-radius-popover`,
      `--ui-shadow-popover`, padding `--ui-space-2` `--ui-space-3`,
      `max-inline-size: min(24rem, calc(100vw - 2 * var(--ui-space-2)))`,
      `max-block-size: min(28rem, 70vh)`, `overflow: auto`, `overflow-wrap:
      anywhere`; `:focus-visible` on the host → `mixins.focus-ring`.

- [ ] **Step 5: Export** `PopoverComponent`, `PopoverTriggerDirective` from
      `index.ts`.

- [ ] **Step 6: Stories** `Feedback/Popover`: `RemoteCheckFailed` (GA-35: the
      reason and **Try again**; `play`: open, Escape → focus is on the trigger),
      `Narrow` (a trigger at the right edge of a 20rem wrapper with long text;
      `play`: open → the popover's right edge `<= window.innerWidth`).

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green.

- [ ] **Step 8: Format and commit** (`git commit -m "Popover"`).

---

### Task 6: `Dialog` and confirmation

**Files:**

- Create: `libs/ui/src/feedback/services/dialog/dialog.service.{ts,spec.ts}`
  (with `DialogRef`, `DIALOG_DATA`, `DialogOptions`, `ConfirmOptions` in the
  same folder: `dialog-ref.ts`, `dialog.model.ts`)
- Create:
  `libs/ui/src/feedback/components/dialog/dialog.component.{ts,html,scss,stories.ts}`
- Create:
  `libs/ui/src/feedback/directives/dialog-footer/dialog-footer.directive.ts`
- Create:
  `libs/ui/src/feedback/components/confirm-dialog/confirm-dialog.component.{ts,html}`
- Create: `libs/ui/src/styles/_overlays.scss`
- Modify: `libs/ui/src/styles/index.scss`, `libs/ui/.storybook/main.ts`,
  `libs/ui/src/index.ts`

**Interfaces:**

- Consumes: `ButtonComponent`, `IconButtonComponent`.
- Produces (`@angular/cdk/dialog` is imported only by `dialog.service.ts`):
  - `DialogOptions<D>`: `{ data?: D; size?: 'small' | 'medium' | 'large' }`
    (default `'medium'`; `max-inline-size` 24rem, 32rem, 48rem).
  - `DIALOG_DATA = new InjectionToken<unknown>('DIALOG_DATA')`.
  - `DialogRef<R>`: `close(result?: R): void`; `closed: Observable<R |
    undefined>` (emits once, then completes); `dismissible = signal(true)`
    (writable: a dialog sets it to false while its request runs, FB-45, so
    Escape and the close button do nothing).
  - `DialogService.open<C, D = unknown, R = unknown>(component: Type<C>,
    options?: DialogOptions<D>): DialogRef<R>`. Calls the CDK `Dialog` with
    `hasBackdrop: true`, `backdropClass: 'ui-dialog-backdrop'`, `disableClose:
    true` (Escape is handled by us, honouring `dismissible`; a backdrop click
    never closes, so typed input is not lost), `ariaLabelledBy` = a generated
    heading id, `ariaModal: true`, `restoreFocus: true`, `closeOnNavigation:
    true`, and `autoFocus` = a selector that finds, inside `.body`, the first
    element with `[autofocus]`, else the first enabled field (`input`,
    `textarea`, `[role=combobox]`); with no match the CDK focuses the dialog
    itself. It provides `DialogRef`, `DIALOG_DATA` and the heading id (an
    internal token) to the component.
  - `DialogService.confirm(options: ConfirmOptions): Promise<boolean>`;
    `ConfirmOptions`: `{ heading: string; message: string; confirmLabel: string;
    cancelLabel: string; variant?: 'primary' | 'danger' }`. Opens the internal
    `ConfirmDialogComponent` (size small): the message, then **Cancel** (marked
    `autofocus`, the safe choice) and the confirm button (`danger` variant when
    asked). Resolves `true` only on the confirm button; Escape and Cancel
    resolve `false`. For RM-17, FB-38, GC-26, GA discard.
  - `DialogComponent`, selector `ui-dialog`: the frame a dialog component puts
    at the root of its template. `heading = input.required<string>()`;
    `closeLabel = input<string>()`: when set, a `uiIconButton` with the `close`
    Codicon in the header closes the dialog with no result (disabled while not
    dismissible). Template: `<header><h2 [id]="headingId">…</h2>[close
    button]</header><div class="body"><ng-content /></div><footer><ng-content
    select="[uiDialogFooter]" /></footer>`.
  - `DialogFooterDirective`, selector `[uiDialogFooter]`, a marker.

- [ ] **Step 1: Scaffold** `service --name=dialog`, `component --name=dialog`,
      `component --name=confirm-dialog`, `directive --name=dialog-footer`. Add
      `'@angular/cdk/dialog'` to `optimizeDeps.include` in
      `libs/ui/.storybook/main.ts`. Create `_overlays.scss` (`@layer components
      { .ui-dialog-backdrop { background: var(--ui-surface-scrim); } }`, with a
      comment saying why it is global: the backdrop is outside every component)
      and `@use` it at the end of `index.scss`.

- [ ] **Step 2: Write the failing tests** in `dialog.service.spec.ts`. A test
      dialog component:

```html
<ui-dialog heading="Unlock work-laptop" closeLabel="Close">
  <label>Passphrase <input type="password" /></label>
  <div uiDialogFooter>
    <button uiButton (click)="ref.close()">Cancel</button>
    <button uiButton variant="primary" (click)="ref.close(data.answer)">Unlock</button>
  </div>
</ui-dialog>
```

      with `ref = inject(DialogRef)`, `data = inject(DIALOG_DATA) as { answer:
      string }`, opened from a host with a `<button>Open</button>` that has the
      focus.

```ts
it('is a modal dialog named by its heading', ...);
// role 'dialog', aria-modal 'true', aria-labelledby → the h2 'Unlock work-laptop'.

it('passes data in and a result out', ...);
// open with data { answer: 'ok' }; click Unlock → closed emits 'ok' and completes.

it('focuses its first field', ...);  // RC-25
// document.activeElement is the passphrase input.

it('closes on Escape and the close button with no result, and returns the focus', ...);  // Review Focus 2
// Escape → closed emits undefined; activeElement is Open. Again with the close button.

it('does not close from the backdrop', ...);
// click .ui-dialog-backdrop → still open.

it('cannot be dismissed while not dismissible', ...);  // FB-45
// ref.dismissible.set(false) → Escape does nothing; close button disabled; ref.close('x') still closes.

it('asks for confirmation', ...);
// confirm({ heading: 'Remove handbook?', message: 'This deletes its working copy on Front Burner. The remote is not changed.',
//   confirmLabel: 'Remove', cancelLabel: 'Cancel', variant: 'danger' })
// → focus on Cancel; Remove data-variant 'danger'; click Remove → resolves true; a second call, Escape → false.

it('focuses the dialog when it holds no field', ...);
// a dialog with text and a footer only → activeElement is the dialog container.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/dialog.service.spec.ts'` Expected: FAIL.

- [ ] **Step 4: Implement.** Styles of `ui-dialog`: host `display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto; inline-size: calc(100vw -
      2 * var(--ui-space-2)); max-inline-size: var(--ui-dialog-max-inline-size);
      max-block-size: calc(100dvh - 2 * var(--ui-space-2))`, background
      `--ui-surface-raised`, border `--ui-border-width` solid
      `--ui-border-default`, radius `--ui-radius-island`, `--ui-shadow-dialog`;
      the size is set by the service as a `data-size` attribute on the host (via
      the internal token), mapping to `--ui-dialog-max-inline-size`; header flex
      row, padding `--ui-space-3` `--ui-space-4`, `h2` `margin: 0`,
      `--ui-font-size-title`, `--ui-line-height-tight`, weight semibold,
      `overflow-wrap: anywhere`; `.body` `overflow: auto`, padding-inline
      `--ui-space-4`, `overflow-wrap: anywhere`; footer `display: flex;
      flex-wrap: wrap; justify-content: flex-end; gap: var(--ui-space-2)`,
      padding `--ui-space-3` `--ui-space-4`. Opening fades and scales from 0.98
      over `--ui-duration-base`.

- [ ] **Step 5: Export** `DialogService`, `DialogRef`, `DIALOG_DATA`, `type
      DialogOptions`, `type ConfirmOptions`, `DialogComponent`,
      `DialogFooterDirective` from `index.ts`.

- [ ] **Step 6: Stories** `Feedback/Dialog` (a button in each story opens the
      dialog; `play` clicks it):
  - `UnlockKey`: RC-16 with key name, type, fingerprint and a passphrase
    `ui-field`; **Unlock** sets `dismissible` false and `busy` for 1 s, then
    shows "Wrong passphrase" on the field (RC-18). `play`: the focus is in the
    passphrase input.
  - `ChangedHostKey`: RC-21/RC-22 with both 50-character fingerprints, the "I
    have checked…" checkbox enabling **Trust the new key**, at 320 px. `play`:
    the dialog's `getBoundingClientRect()` fits the viewport and
    `document.documentElement.scrollWidth <= innerWidth` (Review Focus 5).
  - `TallContent`: a body of 60 lines at a 480 px tall viewport. `play`: the
    footer's bottom `<= innerHeight` and `.body` scrolls.
  - `ConfirmRemove`: `confirm()` for RM-17 with `variant: 'danger'`. `play`: the
    focus is on Cancel; Escape → the focus returns to the opening button.

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green.

- [ ] **Step 8: Format and commit** (`git commit -m "Dialog"`).

---

### Task 7: `Toast`

**Files:**

- Create: `libs/ui/src/feedback/services/toast/toast.service.{ts,spec.ts}`
  (`ToastOptions`, `ToastAction`, `ToastItem` in `toast.model.ts` next to it)
- Create:
  `libs/ui/src/feedback/components/toast-outlet/toast-outlet.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Consumes: `Status`, `StatusIconComponent` (Task 3), `ButtonComponent`,
  `IconButtonComponent`.
- Produces:
  - `ToastAction`: `{ label: string; run: () => void }`.
  - `ToastOptions`: `{ message: string; dismissLabel: string; status?: Status
    (default 'info'); actions?: readonly ToastAction[] (at most 2); key?: string
    }`.
  - `TOAST_DURATION_MS = 6000`; `TOAST_LIMIT = 3`.
  - `ToastService` (root): `show(options: ToastOptions): { dismiss(): void }`;
    `readonly toasts: Signal<readonly ToastItem[]>` (`ToastItem` = the options
    plus a generated `id`); `dismiss(id: string)`; `pause(id)` / `resume(id)`
    used by the outlet.
    - A toast without actions is removed after `TOAST_DURATION_MS`; the timer
      pauses while it is paused and starts over on resume. A toast with actions
      stays until dismissed or until an action runs (running an action dismisses
      it).
    - Showing a toast whose `key` matches one on screen replaces that toast in
      place and restarts its timer; with more than `TOAST_LIMIT`, the oldest is
      removed.
    - Every shown toast's message is announced through `LiveAnnouncer`:
      `'assertive'` for `danger`, `'polite'` otherwise (ED-38).
  - `ToastOutletComponent`, selector `ui-toast-outlet`; `label =
    input.required<string>()`. The web client places it once (in the app shell).
    Host `role="region"`, `aria-label`. Renders `toasts()` as an `<ol>`: per
    toast the status icon, the message, the actions as small ghost `uiButton`s
    and a `uiIconButton` dismiss with `dismissLabel`. It never takes the focus.
    `pointerenter`/`focusin` on a toast pause it, `pointerleave`/`focusout` (to
    outside it) resume it. It remembers the element that had the focus before
    the focus entered the region (`focusin` with a `relatedTarget` outside), and
    when the toast holding the focus is removed it moves the focus back there if
    it is still connected, else to the next toast's dismiss button, else leaves
    it.

- [ ] **Step 1: Scaffold** `service --name=toast`, `component
      --name=toast-outlet`.

- [ ] **Step 2: Write the failing tests** with `vi.useFakeTimers()` and a
      `LiveAnnouncer` spy. `toast.service.spec.ts`:

```ts
it('announces each toast politely, and danger assertively', ...);
// show 'Pushed 2 commits to origin/main' (success) → announce(msg, 'polite');
// show 'Push failed' (danger) → 'assertive'.

it('removes a toast without actions after its duration', ...);
// advance TOAST_DURATION_MS - 1 → present; +1 → gone.

it('pauses while paused', ...);  // Review Focus 4
// pause, advance 2 × duration → present; resume, advance duration → gone.

it('keeps a toast with actions until dismissed or acted on', ...);  // Review Focus 4
// GC-22 'Merge committed. Push to publish it.' with Push and Undo merge; advance 1 min → present;
// run Push → its run called once, toast gone.

it('replaces a toast with the same key', ...);  // Review Focus 3
// show key 'file-updated' twice 3 s apart → one toast; advance duration - 1 from the second → present.

it('shows at most three', ...);  // Review Focus 3
// show 4 → the first is gone, toasts().length 3.

it('dismisses through the returned handle', ...);
```

      `toast-outlet.component.spec.ts`, host `<button>Pull</button><ui-toast-outlet
      label="Notifications" />`:

```ts
it('is a labelled region listing the toasts', ...);
// role 'region', aria-label 'Notifications'; show one → one li with message, status icon,
// dismiss button aria-label 'Dismiss'.

it('never takes the focus', ...);
// focus Pull, show a toast with actions → activeElement still Pull.

it('pauses on hover and focus', ...);
// pointerenter the toast, advance 2 × duration → present; pointerleave, advance duration → gone.

it('returns the focus when the toast holding it goes away', ...);  // Review Focus 2
// focus Pull, then focus the toast's action (relatedTarget Pull), click it → toast gone,
// activeElement is Pull. Same with the dismiss button.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test
--include='**/{toast.service,toast-outlet.component}.spec.ts'` Expected: FAIL.

- [ ] **Step 4: Implement.** Outlet styles: host `position: fixed;
      inset-block-end: var(--ui-toast-offset-block-end, var(--ui-space-4));
      inset-inline-end: var(--ui-space-4); inline-size: min(24rem, calc(100vw -
      2 * var(--ui-space-2)))` (the app shell sets the offset above its status
      bar); the list `display: flex; flex-direction: column-reverse; gap:
      var(--ui-space-2)`, no bullets. `mixins.below(mixins.$medium)` (a viewport
      query: the outlet is page layout, A-10.7): `inset-inline:
      var(--ui-space-2)`, `inline-size: auto`. Toast: grid `auto 1fr auto`
      (icon, message and actions, dismiss), background `--ui-surface-raised`,
      border `--ui-border-width` solid `--ui-border-default` with a 3 px
      inline-start border in `--ui-<status>-icon` (the icon and text carry the
      status too), radius `--ui-radius-popover`, `--ui-shadow-popover`, padding
      `--ui-space-2` `--ui-space-3`, `overflow-wrap: anywhere`; enters by
      sliding up `--ui-space-2` and fading over `--ui-duration-base`.

- [ ] **Step 5: Contrast pairs.** Add, for each status,
      `graphic('<status>-icon', 'surface-raised')`.

- [ ] **Step 6: Export** `ToastService`, `ToastOutletComponent`, `type
      ToastOptions`, `type ToastAction`, `TOAST_DURATION_MS` from `index.ts`.

- [ ] **Step 7: Stories** `Feedback/Toast` (buttons that call `show`, with the
      outlet in the story):
  - `GitResults`: "Already up to date", "Pulled 3 commits", "Pushed 2 commits to
    origin/main" (success, GA-28, GA-32), "The remote has new commits. Pull
    first." with **Pull** (warning, GA-30).
  - `MergeCommitted`: GC-22 with **Push** and **Undo merge**. `play`: show it,
    wait `TOAST_DURATION_MS + 500` → still visible.
  - `FileUpdated`: "This file was updated." shown three times with `key`.
    `play`: exactly one toast.
  - `Phone`: viewport 320 px, two toasts with long messages. `play`:
    `document.documentElement.scrollWidth <= innerWidth`.

- [ ] **Step 8: Verify.** Specs → PASS; `ui:lint` clean; `ui:test-storybook`
      green, including Contrast.

- [ ] **Step 9: Format and commit** (`git commit -m "Toast"`).

---

### Task 8: Design-system record and whole-library verification

**Files:**

- Modify: `docs/architecture/design-system.md`

- [ ] **Step 1: Record the decisions** in `design-system.md`, under "A-10:
      Components":
  - A-10.32, Feedback row: `Dialog`, `Popover`, `Tooltip`, `Toast`,
    `InlineBanner`, `Badge`, `Spinner`, `ProgressBar`; built on "CDK Overlay,
    Dialog and LiveAnnouncer".
  - **A-10.43** Dialogs are opened with `DialogService` (or `confirm()` for a
    yes/no question) and framed by `ui-dialog`; features never use the CDK
    dialog directly. A dialog focuses its first field (or an `[autofocus]`
    element, or itself), returns the focus when it closes, closes on Escape
    unless a request is running, and never on a backdrop click. A confirmation
    focuses Cancel.
  - **A-10.44** Notices: a **toast** for the short result of something the user
    did (GA-28, GA-32, ED-24's "This file was updated.", GC-22); an **inline
    banner** for a state that lasts, shown where it applies (NV-15, RC-15,
    GA-34, ED-24's question, SH-17). Toasts with actions stay until dismissed;
    others last 6 s, paused on hover and focus. Toasts are announced; a banner
    is announced only when it asks to be (`announce`). Neither takes the focus.
  - **A-10.45** Tooltips show on hover, on keyboard focus and, for an
    unavailable button or an information icon, on tap; they can be hovered and
    dismissed with Escape (WCAG 1.4.13). `uiIconButton` shows its label as a
    tooltip instead of a native `title`.
  - **A-10.46** A busy or unavailable button is `aria-disabled`, not `disabled`,
    so that it keeps the focus and can explain itself; `uiButton` and
    `uiIconButton` swallow its clicks. Use `disabled` only where no reason needs
    to be shown.
  - Run `node tools/ai-tools/src/bin/doc-ids.mjs check` → exit 0 (no duplicate
    or undefined IDs).

- [ ] **Step 2:** `npx nx affected -t lint,test,build` → all succeed.
- [ ] **Step 3:** `npx nx run ui:test-storybook` → every story passes.
- [ ] **Step 4:** `npm run format:check` → no changes needed.
- [ ] **Step 5: Commit** (`git commit -m "Feedback design-system record"`).
- [ ] **Step 6: Report** any token values changed for contrast, and any place
      where the CDK needed a different approach from this plan (in particular
      the dialog's `autoFocus` selector and the click-swallowing listener
      order).

---

## Not in this plan

- **Type-to-confirm** (RM-18: list what would be lost and type the repository
  name): a feature dialog built on `ui-dialog`, `ui-field` and `uiInput`, not an
  option of `confirm()`.
- **Unsaved-changes confirmation on Cancel** (AR, FB): the feature calls
  `confirm()` when its form is dirty.
- **A count badge** (GA-10's "Changes (3)"): plain text in the tab label, as the
  requirement says.
- **Browser `beforeunload` prompts** (ED-22): not a component.
- **Toasts across tabs or devices**: each tab shows its own.
- `Icon`: inline Codicon SVGs until it exists.
