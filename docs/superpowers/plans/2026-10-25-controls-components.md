# Controls Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Controls group of the `ui` library (A-10.32): `Button`,
`IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` and
`SegmentedControl`, plus the `Field` wrapper that gives a control its label,
hint and error, with unit tests and Storybook stories.

**Architecture:** A new library feature `controls` in `libs/ui/src/controls/`,
laid out like `navigation`. Every control except `Select` and `SegmentedControl`
is an **attribute component on a native element** (A-10.26): the element keeps
its semantics, keyboard handling and form behaviour, and the component only adds
styles and a few ARIA bindings. `Select` is built on Aria's Combobox and Listbox
(A-10.2) with its popup in a CDK connected overlay, and renders its options from
data (as `Tree` does), so that Aria's `ngOption` sits in our own template under
`ngListbox`. `SegmentedControl` renders native radio buttons from data. Both
follow Angular Signal Forms' `FormValueControl` contract **structurally**
(`value` model, `disabled` input, `touch` output), so a feature can bind them
with `[formField]` or `[(value)]`; `ui` does not import `@angular/forms` outside
tests. `Field` finds its control through an abstract `FieldControl` class that
`Input`, `Textarea` and `Select` provide.

**Tech Stack:** Angular 22.2 (signals, `hostDirectives`), `@angular/aria` 22.2.4
(`combobox`, `listbox` and their `/testing` harnesses), `@angular/cdk` 22.2.4
(`overlay`, `bidi`, `testing`), `@angular/forms` 22.2.3 (`/signals`, in tests
and one story only), SCSS with `--ui-*` tokens, Vitest + jsdom unit tests
(`@nx/angular:unit-test`), Storybook 10 (`@storybook/angular-vite`) with the
a11y and Vitest addons.

**Spec:** `docs/architecture/design-system.md` (A-10.2–A-10.4, A-10.8, A-10.11,
A-10.17–A-10.22, A-10.24–A-10.32, A-10.35, A-10.37–A-10.39). Screen requirements
that shape the APIs: `docs/requirements/repo-add.md` AR-4–AR-7, AR-19, AR-20,
AR-24–AR-26, AR-29, AR-33–AR-38; `docs/requirements/git-advanced.md` GA-7, GA-9,
GA-17, GA-18, GA-22, GA-23; `docs/requirements/auth-login.md` LG login form;
`docs/requirements/git-conflicts.md` GC-11; `docs/architecture/web-client.md`
A-8.3; `docs/architecture/non-functional.md` NF-12.4, NF-13.3, NF-13.5, NF-13.7.

## Global Constraints

- Before any code change, follow the `development-workflow` skill. Scaffold with
  `npx nx g @hexmode/toolkit-nx:<type> --project=ui --feature=controls
  --name=<name> --no-interactive` (dry run first). **Do not pass
  `--storybook=true`**; write each `*.stories.ts` by hand, matching
  `libs/ui/src/navigation/components/breadcrumbs/breadcrumbs.component.stories.ts`
  (imports from `@storybook/angular-vite` and `storybook/test`).
- Components with a template or styles are scaffolded as components even when
  their selector is an attribute (`button[uiButton]`); directives are only for
  markers and behaviour without styles.
- Standalone, `ChangeDetectionStrategy.OnPush`, signal `input()`/`model()`/
  `output()`, host bindings in `host` metadata, selector prefix `ui` (A-10.31).
- No Transloco in `ui`; every text and accessible name is an input or projected
  content, and required texts are `input.required` (A-10.3).
- Aria directives are used only inside `ui` (A-10.4): no consumer template in a
  story or test writes an `ng…` attribute.
- Every component stylesheet wraps its rules in `@layer components { … }`. No
  `::ng-deep`, no `ViewEncapsulation.None` (A-10.27). A component's styles reach
  only its host and its own template; projected content is styled by its own
  component.
- Selectors: host and native elements, then ARIA/native state (`:checked`,
  `:indeterminate`, `:disabled`, `[aria-invalid='true']`, `[aria-pressed]`,
  `[aria-expanded]`, `[aria-selected]`), then `data-*` attributes for variants
  (`[data-variant='primary']`, as `SplitPane` uses `data-orientation`), then
  part classes (A-10.24, A-10.25).
- Components read only semantic and component tokens, never primitives (A-10.8).
  Sizes in `rem`; only borders and focus rings in `px` (A-10.17). Control
  heights come from `--ui-control-height` or `--ui-control-height-small` only;
  text fields use `--ui-font-size-input` (16 px on touch, A-10.20). Disabled
  controls use `--ui-text-disabled`, `--ui-icon-disabled` and
  `--ui-border-subtle`, never `opacity` (A-10.18).
- No `style` attributes in templates, no `data:` URLs in CSS (A-10.29).
- SCSS modules are loaded with a namespace (`@use '../../../styles/mixins';` →
  `mixins.focus-ring`), never `as *`.
- Focusable elements get `mixins.focus-ring` on `:focus-visible` (A-10.30).
  Checked, selected, pressed and invalid states are never shown by colour alone
  (a mark, an icon, a border or a weight as well), including under
  `forced-colors: active` (A-10.22, NF-13.7). Nothing scrolls sideways at 320
  CSS px (NF-12.4).
- Inline Codicon SVGs (CC-BY-4.0) until `Icon` exists: paths from
  `node_modules/@vscode/codicons/src/icons/<name>.svg`, `viewBox="0 0 16 16"`,
  `aria-hidden="true"`, `fill="currentColor"`, sized by `--ui-icon-size`.
- Unit tests of Aria-based components use the `@angular/aria/*/testing`
  harnesses (A-10.39); the others are tested through the DOM.
- Form integration tests import `form`, `FormField` (selector `[formField]`)
  from `@angular/forms/signals`; production files in `libs/ui/src` never import
  `@angular/forms`.
- Every story passes axe (`a11y.test: 'error'` is global) in `npx nx run
  ui:test-storybook` (A-10.38).
- Exact dependency versions only; add nothing to `libs/ui/package.json` unless
  `ui:lint` asks for it.
- Format with `npm run format` (dprint) before each commit.

## Review Focus

1. **A Cancel button inside a form submits it.** A native `<button>` defaults to
   `type="submit"`, so **Cancel** on the Add repository form (AR-5) and the
   password reveal button (AR-20) would submit. `uiButton`, `uiIconButton` and
   `uiPasswordReveal` default to `type="button"`; only an explicit
   `type="submit"` submits, and Enter in a text field submits exactly once. Test
   in Task 1 and Task 2.
2. **A Select whose value is not among its options**, or whose options arrive
   after its value (the branch list filled from an access check, AR-35; a saved
   credential removed elsewhere, AR-19): the trigger shows the placeholder, does
   not throw and does not change the value; once the option arrives its label is
   shown. Test in Task 5.
3. **Errors on custom controls never appear** because the control is never
   "touched" (AR-6: errors show once the user has left the field). `Select` and
   `SegmentedControl` emit `touch` when the focus leaves them, so `[formField]`
   marks them touched. Test in Task 4 and Task 5.
4. **Long labels at 320 px**: an SSH key option with a SHA256 fingerprint
   (AR-24) in a `Select`, and the three credentials choices of AR-19 in a
   `SegmentedControl`, must neither scroll sideways nor hide their text: the
   trigger truncates with an ellipsis and the popup stays inside the viewport;
   segments wrap their text. Story `play` tests in Task 4 and Task 5.
5. **The "tick all" checkbox in a mixed state** (GA-17): it shows a dash, is
   announced as mixed, and a click ticks it and clears the mixed state. Test in
   Task 3.

---

## File structure

```
libs/ui/src/controls/
  components/button/               ButtonComponent (button[uiButton], a[uiButton])
  components/icon-button/          IconButtonComponent (button[uiIconButton])
  models/field-control.model.ts    FieldControl (abstract class, DI token)
  components/field/                FieldComponent (ui-field)
  components/input/                InputComponent (input[uiInput])
  components/textarea/             TextareaComponent (textarea[uiTextarea])
  directives/password-reveal/      PasswordRevealDirective (button[uiPasswordReveal])
  components/checkbox/             CheckboxComponent (input[type=checkbox][uiCheckbox])
  components/switch/               SwitchComponent (input[type=checkbox][uiSwitch])
  components/choice/               ChoiceComponent (label[uiChoice])
  models/choice-option.model.ts    ChoiceOption<V>
  components/segmented-control/    SegmentedControlComponent<V> (ui-segmented-control)
  components/select/               SelectComponent<V> (ui-select)
  directives/select-option/        SelectOptionDirective (ng-template[uiSelectOption])
  controls.stories.ts              Controls/Form story (Task 6)
libs/ui/src/index.ts                         public exports
libs/ui/src/design-tokens/models/contrast-pairs.model.ts
docs/architecture/design-system.md           A-10.32, A-10.39, new A-10.42
```

Delete the generated `controls/controls.routes.ts`: the feature has no pages.

---

### Task 1: `controls` feature, `Button` and `IconButton`

**Files:**

- Create:
  `libs/ui/src/controls/components/button/button.component.{ts,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/controls/components/icon-button/icon-button.component.{ts,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`,
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`

**Interfaces:**

- Produces:
  - `type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'`, `type
    ButtonSize = 'default' | 'small'`, `type ButtonType = 'button' | 'submit' |
    'reset'`, exported from `button.component.ts`.
  - `ButtonComponent`, selector `button[uiButton], a[uiButton]`, inline template
    `<ng-content select="svg" /><span class="label"><ng-content /></span>`;
    `variant = input<ButtonVariant>('secondary')` → `[attr.data-variant]`;
    `size = input<ButtonSize>('default')` → `[attr.data-size]`; `type =
    input<ButtonType>('button')` → `[attr.type]`, `null` on anchors.
  - `IconButtonComponent`, selector `button[uiIconButton]`, inline template
    `<ng-content />` (one `svg`); `label = input.required<string>()` →
    `aria-label` and `title`; `variant = input<'ghost' | 'secondary'>('ghost')`;
    `size = input<ButtonSize>('default')`; `type = input<ButtonType>('button')`;
    `pressed = input<boolean | undefined>(undefined)` → `[attr.aria-pressed]`
    (absent when `undefined`, for toggle buttons such as **Show remote
    images**).

- [ ] **Step 1: Scaffold.** Feature generator (`--name=controls`), delete
      `controls.routes.ts`, then `component --name=button` and `component
      --name=icon-button`; fix the selectors, use inline templates, delete the
      generated html files.

- [ ] **Step 2: Write the failing tests** in `button.component.spec.ts`. Host
      template:

```html
<form (submit)="submits = submits + 1; $event.preventDefault()">
  <input aria-label="Name" />
  <button uiButton>Cancel</button>
  <button uiButton variant="primary" type="submit">Add repository</button>
  <button uiButton variant="danger" size="small" [disabled]="true">Remove</button>
</form>
<a uiButton href="/repositories/new">Add repository</a>
```

```ts
it('is a plain button unless asked to submit', ...);
// Cancel: type 'button'; Add repository: type 'submit'; the anchor has no type attribute.

it('does not submit the form from a plain button', ...);  // Review Focus 1
// click Cancel → submits 0; click Add repository → submits 1.

it('has one submit button, so Enter in a field submits through it', ...);  // Review Focus 1
// the buttons of the form whose .type is 'submit' are exactly [Add repository].

it('exposes variant and size for styling', ...);
// Add repository data-variant 'primary', data-size 'default'; Remove 'danger' / 'small'; Cancel 'secondary'.

it('keeps the native disabled state', ...);
// Remove.disabled true; click → no submit.
```

      And in `icon-button.component.spec.ts`, host `<button uiIconButton
      label="Fetch"><svg aria-hidden="true"></svg></button><button uiIconButton
      label="Show remote images" [pressed]="pressed()"><svg
      aria-hidden="true"></svg></button>`:

```ts
it('is named by its label', ...);
// aria-label 'Fetch', title 'Fetch', type 'button'.

it('is a toggle only when pressed is set', ...);
// Fetch has no aria-pressed; the other has 'false', then 'true' after pressed.set(true).
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/controls/components/*button/*.spec.ts'`
Expected: FAIL.

- [ ] **Step 4: Implement.** Styles, `ButtonComponent`:
  - host `display: inline-flex; align-items: center; justify-content: center;
    gap: var(--ui-space-1-5)`, `box-sizing: border-box`, `min-block-size:
    var(--ui-control-height)`, `max-inline-size: 100%`, padding-inline
    `--ui-control-padding-inline`, `--ui-font-size-ui`, weight medium,
    `text-decoration: none`, border `--ui-border-width` solid, radius
    `--ui-radius-control`, `cursor: pointer`; `.label` ellipsis on overflow;
    `svg` sized `--ui-icon-size`;
  - `secondary`: background `--ui-surface-raised`, text `--ui-text-default`,
    border `--ui-border-default`; `:hover` adds `--ui-surface-hover` as a
    `background-image: linear-gradient(var(--ui-surface-hover),
    var(--ui-surface-hover))` layer, `:active` the same with
    `--ui-surface-pressed`;
  - `primary`: background `--ui-accent`, `:hover` `--ui-accent-hover`, `:active`
    `--ui-accent-pressed`, text `--ui-text-on-accent`, border transparent;
  - `danger`: as secondary with text `--ui-danger-text` and border
    `--ui-danger-border`;
  - `ghost`: background and border transparent, text `--ui-text-default`, hover
    and pressed overlays as secondary;
  - `[data-size='small']`: `min-block-size: var(--ui-control-height-small)`,
    padding-inline `--ui-space-2`, `--ui-font-size-ui-small`;
  - `:disabled` (and `[aria-disabled='true']`): every variant gets background
    `--ui-surface-sunken`, border `--ui-border-subtle`, text
    `--ui-text-disabled`, `cursor: default`, no hover;
  - `:focus-visible` → `mixins.focus-ring`;
  - `forced-colors: active`: `primary` keeps `ButtonText` text on `ButtonFace`
    with a 2 px `ButtonText` border so it still stands out.

  `IconButtonComponent`: the same rules for `ghost` and `secondary`, a square of
  `--ui-control-height` (`--ui-control-height-small` when small), `padding: 0`,
  icon colour `--ui-icon-default` (`--ui-icon-disabled` when disabled);
  `[aria-pressed='true']` → background `--ui-selected-inactive` and border
  `--ui-border-strong` (a border, not colour alone).

- [ ] **Step 5: Contrast pairs.** Add `text('text-default', 'surface-raised',
      'surface-pressed')`, `text('danger-text', 'surface-raised')`,
      `text('danger-text', 'surface-raised', 'surface-hover')`,
      `graphic('icon-default', 'surface-island', 'surface-hover')`,
      `graphic('icon-default', 'selected-inactive')` and
      `graphic('border-strong', 'selected-inactive')`. If the Contrast story
      fails, adjust token values in `tokens/_color.scss` (A-10.23) and say so in
      the report.

- [ ] **Step 6: Export** `ButtonComponent`, `IconButtonComponent` and `type
      ButtonVariant`, `type ButtonSize`, `type ButtonType` from `index.ts`.

- [ ] **Step 7: Stories.**
  - `Controls/Button`: `Variants` (Add repository primary, Cancel, Remove
    repository danger, Try again ghost, each also disabled), `WithIcon` (Codicon
    `repo-pull` + "Pull"), `Small` (**Accept mine**, **Accept theirs**, **Accept
    both**, GC-11), `Link` (`a uiButton`), `LongLabel` in a 20rem wrapper;
    `play` asserts the wrapper's `scrollWidth <= clientWidth`.
  - `Controls/Icon button`: `GitActions` (Fetch `repo-fetch`, Pull `repo-pull`,
    Push `repo-push`, GA-7), `Toggle` (`pressed`, toggled on click; `play`
    clicks it and expects `aria-pressed="true"`).

- [ ] **Step 8: Verify.** Specs → PASS; `npx nx run ui:lint` → no errors; `npx
      nx run ui:test-storybook` → all stories pass, including `Design
      system/Tokens → Contrast`.

- [ ] **Step 9: Format and commit** (`git commit -m "Button and IconButton
      controls"`).

---

### Task 2: `Field`, `Input`, `Textarea` and password reveal

**Files:**

- Create: `libs/ui/src/controls/models/field-control.model.ts`
- Create:
  `libs/ui/src/controls/components/field/field.component.{ts,html,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/controls/components/input/input.component.{ts,scss,spec.ts}`
- Create:
  `libs/ui/src/controls/components/textarea/textarea.component.{ts,scss,spec.ts}`
- Create:
  `libs/ui/src/controls/directives/password-reveal/password-reveal.directive.{ts,spec.ts}`
- Modify: `libs/ui/src/index.ts`,
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`

**Interfaces:**

- Consumes: `IconButtonComponent` (Task 1), in tests and stories.
- Produces:
  - `FieldControl` in `field-control.model.ts`:

    ```ts
    /** A control that a `ui-field` labels and describes. */
    export abstract class FieldControl {
      /** The id of the element that gets the focus. */
      abstract readonly id: Signal<string>;
      /** Whether a `<label for>` labels it natively. */
      abstract readonly labelable: boolean;
      abstract focus(): void;
      /** Set by `ui-field`. */
      readonly labelledBy = signal<string | null>(null);
      readonly describedBy = signal<string | null>(null);
      readonly invalid = signal(false);
    }
    ```

  - `InputComponent`, selector `input[uiInput]`, template `''`; `id =
    input<string>(<generated 'ui-input-N'>)`; `code = input(false, { transform:
    booleanAttribute })` → `[attr.data-code]`; `readonly element:
    HTMLInputElement`; extends `FieldControl` (`labelable = true`, `focus()` →
    `element.focus()`); `providers: [{ provide: FieldControl, useExisting:
    forwardRef(() => InputComponent) }]`; host `[id]`, `[attr.aria-labelledby]`,
    `[attr.aria-describedby]`, `[attr.aria-invalid]` (`'true'` or `null`).
  - `TextareaComponent`, selector `textarea[uiTextarea]`: the same as `Input`
    for an `HTMLTextAreaElement` (`code` for keys, AR-26 and AR-29).
  - `FieldComponent`, selector `ui-field`; `label = input.required<string>()`,
    `hint = input<string>()`, `error = input<string>()`; `control =
    contentChild.required(FieldControl, { descendants: true })`. Renders `<label
    [id]="labelId" [attr.for]>`, the projected content in a `.control` row, then
    the hint and the error (not a live region; a Codicon `error` icon before the
    text). An `effect` sets the control's `labelledBy` (always), `describedBy`
    (`hintId` and `errorId` of the parts that are shown, space-separated, or
    `null`) and `invalid` (`!!error()`). The label's `for` is the control's id
    when `labelable`, else `null` with `(click)` → `control.focus()`.
  - `PasswordRevealDirective`, selector `button[uiPasswordReveal]`, used
    together with `uiIconButton`; `target = input.required<InputComponent>({
    alias: 'uiPasswordReveal' })`; host `[attr.aria-pressed]`,
    `[attr.aria-controls]` = the target's id, `(click)` toggles
    `target().element.type` between `'password'` and `'text'`. It keeps the
    value, the caret and the focus on the button. Consumers write `<input
    uiInput #secret type="password" /> <button uiIconButton
    [uiPasswordReveal]="secret" label="Show password"><svg …eye…/></button>`, so
    the name stays the same and `aria-pressed` carries the state (the
    toggle-button pattern).

- [ ] **Step 1: Scaffold** `component --name=field`, `component --name=input`,
      `component --name=textarea`, `directive --name=password-reveal`; fix
      selectors, use template `''` for `Input` and `Textarea` and delete their
      html files; create the model file by hand.

- [ ] **Step 2: Write the failing tests.** `field.component.spec.ts`, host
      template:

```html
<form (submit)="submits = submits + 1; $event.preventDefault()">
  <ui-field label="Remote URL" hint="HTTPS or SSH" [error]="error()">
    <input uiInput [formField]="model.url" />
  </ui-field>
  <ui-field label="Password or token">
    <input uiInput #secret type="password" value="s3cret" />
    <button uiIconButton [uiPasswordReveal]="secret" label="Show password"><svg aria-hidden="true"></svg></button>
  </ui-field>
  <ui-field label="Private key">
    <textarea uiTextarea code rows="6"></textarea>
  </ui-field>
</form>
```

      with `model = form(signal({ url: '' }))` from `@angular/forms/signals` and
      `error = signal<string | undefined>(undefined)`.

```ts
it('labels its control', ...);
// the Remote URL label's for === input id; input aria-labelledby === label id; clicking the label focuses the input.

it('describes its control with the hint, then the error', ...);
// aria-describedby === hint id; error 'Use an HTTPS or SSH URL' →
// aria-describedby 'hintId errorId', aria-invalid 'true', the error text is shown;
// error undefined → aria-invalid absent, describedby the hint only.

it('keeps a consumer id', ...);
// <input uiInput id="remote-url"> → label for 'remote-url'.

it('binds to a Signal Forms field', ...);
// type 'https://github.com/a/b' → model.url().value() === 'https://github.com/a/b'.

it('reveals and hides a password without losing it', ...);  // Review Focus 1
// click Show password → input type 'text', aria-pressed 'true', value 's3cret', submits 0;
// click again → 'password', 'false'; aria-controls === the input id.

it('marks code fields', ...);
// textarea data-code 'true'; the Remote URL input has no data-code.
```

      `input.component.spec.ts` and `textarea.component.spec.ts` only cover what
      the field spec does not: a generated id is unique per instance, and
      `focus()` focuses the element.

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/controls/**/*.spec.ts'` Expected: the new
tests FAIL.

- [ ] **Step 4: Implement.** Styles:
  - `Input`, `Textarea`: `box-sizing: border-box`, `inline-size: 100%`,
    `min-inline-size: 0`, `min-block-size: var(--ui-control-height)`,
    padding-inline `--ui-space-2`, background `--ui-surface-sunken`, border
    `--ui-border-width` solid `--ui-border-strong`, radius
    `--ui-radius-control`, `--ui-font-size-input`, `color:
    var(--ui-text-default)`; `::placeholder` `--ui-text-subtle`;
    `[data-code='true']` `--ui-font-family-mono`; `:focus-visible` →
    `mixins.focus-ring` with `outline-offset: 0` (the ring sits on the border);
    `[aria-invalid='true']` → border colour `--ui-danger-icon` and a 1 px inset
    `box-shadow` of the same colour (the border gets thicker, not only redder);
    `:disabled` → background `--ui-surface-canvas`, border `--ui-border-subtle`,
    text `--ui-text-disabled`; `:read-only` → background `--ui-surface-island`,
    border `--ui-border-default` (the public key of AR-29);
  - `Textarea` only: padding-block `--ui-space-1`, `resize: vertical`,
    `line-height: var(--ui-line-height-code)` when code, `--ui-line-height-ui`
    otherwise; `overflow-wrap: anywhere` when code (a key has no spaces);
  - `Field`: host `display: flex; flex-direction: column; gap:
    var(--ui-space-1); min-inline-size: 0`; label `--ui-font-size-ui`, weight
    medium, `--ui-text-default`; `.control` flex row, gap `--ui-space-1`,
    `align-items: start`, `min-inline-size: 0`; hint `--ui-font-size-ui-small`,
    `--ui-text-muted`; error flex row, gap `--ui-space-1`, `--ui-danger-text`,
    icon `--ui-danger-icon`; label, hint and error `overflow-wrap: anywhere`.

- [ ] **Step 5: Contrast pairs.** Add `graphic('danger-icon', 'surface-sunken')`
      and `graphic('border-strong', 'surface-raised')`.

- [ ] **Step 6: Export** `FieldComponent`, `InputComponent`,
      `TextareaComponent`, `PasswordRevealDirective` and `FieldControl` (as a
      class: features may build their own controls on it) from `index.ts`.

- [ ] **Step 7: Stories** `Controls/Field`:
  - `RemoteUrl`: label, hint, and the error "Use an HTTPS or SSH URL" toggled by
    an arg (AR-9).
  - `Password`: "Password or token" with the reveal button (Codicon `eye`) and
    the hint about access tokens (AR-20). `play`: click the button → the input's
    `type` is `text`.
  - `PrivateKey`: a `code` textarea with 6 rows (AR-26), and a read-only `code`
    textarea holding a 100-character public key in a 20rem wrapper (AR-29);
    `play` asserts the wrapper's `scrollWidth <= clientWidth`.
  - `CommitMessage`: a 4-row textarea "Message" (GA-18).
  - `Disabled`: a disabled input with a value.

- [ ] **Step 8: Verify.** Specs → PASS; `ui:lint` clean; `ui:test-storybook`
      green, including Contrast.

- [ ] **Step 9: Format and commit** (`git commit -m "Field, Input and Textarea
      controls"`).

---

### Task 3: `Checkbox`, `Switch` and `Choice`

**Files:**

- Create:
  `libs/ui/src/controls/components/checkbox/checkbox.component.{ts,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/controls/components/switch/switch.component.{ts,scss,spec.ts,stories.ts}`
- Create: `libs/ui/src/controls/components/choice/choice.component.{ts,scss}`
- Modify: `libs/ui/src/index.ts`,
  `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`

**Interfaces:**

- Produces:
  - `CheckboxComponent`, selector `input[type=checkbox][uiCheckbox]`, template
    `''`; `indeterminate = input(false, { transform: booleanAttribute })` → host
    `[indeterminate]` property.
  - `SwitchComponent`, selector `input[type=checkbox][uiSwitch]`, template `''`;
    host `role="switch"`. For settings that apply at once, such as the commit
    author override (CA, repo-manage AC 9).
  - `ChoiceComponent`, selector `label[uiChoice]`, template `<ng-content />`:
    lays out one checkbox or switch and its text. Consumers write `<label
    uiChoice><input type="checkbox" uiCheckbox [formField]="f.understood" /> I
    understand</label>`. A checkbox without visible text (a row of the Changes
    list) takes an `aria-label` and no `uiChoice`.

- [ ] **Step 1: Scaffold** `component --name=checkbox`, `component
      --name=switch`, `component --name=choice`; fix selectors, use template
      `''` (`<ng-content />` for `Choice`), delete the html files.

- [ ] **Step 2: Write the failing tests** in `checkbox.component.spec.ts`. Host
      template:

```html
<label uiChoice><input type="checkbox" uiCheckbox [indeterminate]="mixed()" (change)="tickAll($event)" /> All files</label>
<label uiChoice><input type="checkbox" uiCheckbox required [formField]="model.understood" /> I understand</label>
<label uiChoice><input type="checkbox" uiCheckbox disabled /> Amend last commit</label>
```

      with `model = form(signal({ understood: false }))`, `mixed =
      signal(true)`, and `tickAll` setting `mixed` to `false`.

```ts
it('is a native checkbox named by its label', ...);
// type 'checkbox'; the label text 'I understand' is its accessible name (label.control === input).

it('shows the mixed state', ...);  // Review Focus 5
// All files .indeterminate true and matches ':indeterminate'.

it('ticks and leaves the mixed state on click', ...);  // Review Focus 5
// click All files → checked true, indeterminate false, mixed() false.

it('binds to a Signal Forms field', ...);
// click I understand → model.understood().value() true; its required attribute stays.

it('toggles from its label text', ...);
// click the label element → checked.
```

      In `switch.component.spec.ts`, host `<label uiChoice><input
      type="checkbox" uiSwitch [checked]="on()" (change)="on.set($any($event.target).checked)" />
      Use the default author</label>`:

```ts
it('is a switch', ...);
// role 'switch', type 'checkbox'.

it('toggles with Space', ...);
// click the input (jsdom does not activate on Space) → checked true, on() true.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test
--include='**/controls/components/{checkbox,switch}/*.spec.ts'` Expected: FAIL.

- [ ] **Step 4: Implement.** Styles (all with `appearance: none; margin: 0;
      flex: none; cursor: pointer;` and the mark drawn by `::before`, since
      `data:` URLs are not allowed):
  - Checkbox: component token `--ui-checkbox-size: var(--ui-icon-size)`; a
    square with border `--ui-border-width` solid `--ui-border-strong`,
    background `--ui-surface-sunken`, radius `calc(var(--ui-radius-control)
    / 2)`, `display: inline-grid; place-content: center`; `:checked` and
    `:indeterminate` → background and border `--ui-accent`; `::before` is the
    tick (a rotated L of two borders, `--ui-icon-on-accent`) when `:checked`, a
    dash (`block-size: var(--ui-border-width) * 2`, inline 50 %) when
    `:indeterminate`, nothing otherwise; `:disabled` → border
    `--ui-border-subtle`, background `--ui-surface-canvas`, mark
    `--ui-icon-disabled`; `:focus-visible` → `mixins.focus-ring`. Under
    `forced-colors: active` the mark uses `CanvasText`/`HighlightText` and the
    box keeps its border, so a ticked box is not only a fill.
  - Switch: component tokens `--ui-switch-block-size: var(--ui-icon-size)`,
    `--ui-switch-inline-size: calc(var(--ui-switch-block-size) * 1.75)`; a pill
    (`--ui-radius-pill`) with border `--ui-border-strong` and background
    `--ui-surface-sunken`; `::before` is the thumb, a circle of the block size
    minus 4 px, `--ui-icon-muted`, at the inline start; `:checked` → track
    `--ui-accent`, thumb `--ui-icon-on-accent` at the inline end (use
    `inset-inline-start` so it flips in right-to-left), `transition:
    inset-inline-start var(--ui-duration-fast) var(--ui-easing-standard)`;
    disabled and focus as the checkbox.
  - Choice: host only — `display: inline-flex; align-items: center; gap:
    var(--ui-space-2); min-block-size: var(--ui-control-height);
    max-inline-size: 100%; overflow-wrap: anywhere; cursor: pointer`;
    `:host(:has(:disabled))` → `--ui-text-disabled`, `cursor: default`.

- [ ] **Step 5: Contrast pairs.** Add `graphic('icon-on-accent', 'accent')`,
      `graphic('icon-muted', 'surface-sunken')` and `graphic('accent',
      'surface-raised')`.

- [ ] **Step 6: Export** `CheckboxComponent`, `SwitchComponent`,
      `ChoiceComponent` from `index.ts`.

- [ ] **Step 7: Stories.**
  - `Controls/Checkbox`: `States` (unchecked, checked, mixed, disabled, disabled
    checked), `ChangesList` (an "All files" checkbox above three file rows with
    `aria-label`ed checkboxes, ticked by default; the header is mixed when some
    are ticked, GA-17; `play`: untick one → the header matches `:indeterminate`;
    click the header → all ticked), `Understood` ("I have added this key to my
    git server", AR-29, in a 20rem wrapper; `play` asserts no sideways scroll).
  - `Controls/Switch`: `States` (off, on, disabled), `RightToLeft` (`dir="rtl"`
    wrapper; `play`: turn it on → the thumb's `getBoundingClientRect().left` is
    less than the track's centre).

- [ ] **Step 8: Verify.** Specs → PASS; `ui:lint` clean; `ui:test-storybook`
      green, including Contrast.

- [ ] **Step 9: Format and commit** (`git commit -m "Checkbox and Switch
      controls"`).

---

### Task 4: `SegmentedControl`

**Files:**

- Create: `libs/ui/src/controls/models/choice-option.model.ts`
- Create:
  `libs/ui/src/controls/components/segmented-control/segmented-control.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces:
  - `ChoiceOption<V>` in `choice-option.model.ts`:

    ```ts
    export interface ChoiceOption<V> {
      /** Compared with `===`; use primitives. */
      readonly value: V;
      /** Visible text, accessible name and typeahead text. */
      readonly label: string;
      /** A second, muted line; shown by `ui-select` only. */
      readonly description?: string;
      readonly disabled?: boolean;
    }
    ```

  - `SegmentedControlComponent<V>`, selector `ui-segmented-control`; `options =
    input.required<readonly ChoiceOption<V>[]>()`; `value = model<V |
    undefined>(undefined)`; `label = input.required<string>()`; `disabled =
    input(false, { transform: booleanAttribute })`; `touch = output<void>()`,
    emitted on `focusout` when the new focus target is outside the host. Host
    `role="radiogroup"`, `[attr.aria-label]`, `[attr.aria-disabled]`. This is
    Signal Forms' `FormValueControl<V | undefined>` shape, so `[formField]`
    binds it.
- Rendering: for each option, `<label class="segment"><input type="radio"
  [name]="name" [checked]="option.value === value()" [disabled]="disabled() ||
  option.disabled" (change)="value.set(option.value)" /><span>{{ option.label
  }}</span></label>`, with `name` generated per instance (`ui-segmented-N`).
  Arrow keys, one tab stop and right-to-left come from the native radios.

- [ ] **Step 1: Scaffold** `component --name=segmented-control`; create the
      model file by hand.

- [ ] **Step 2: Write the failing tests** in
      `segmented-control.component.spec.ts`. Options: `saved` "Use saved
      credentials", `new` "Add new credentials", `none` "No credentials (public
      repository)". Host binds `[formField]="model.credentials"` with `model =
      form(signal({ credentials: 'saved' }))`, `label="Credentials"`, and a
      `<button>Next</button>` after it.

```ts
it('is a labelled radio group of its options', ...);
// role 'radiogroup', aria-label 'Credentials'; three input[type=radio] with one shared name; each named by its label text.

it('checks the option with the current value', ...);
// 'saved' radio checked, others not.

it('updates the value on change', ...);
// click 'Add new credentials' → model.credentials().value() === 'new'.

it('checks nothing for a value that is not an option', ...);
// set the field to 'other' → no radio checked, no error thrown.

it('reports touch when the focus leaves it', ...);  // Review Focus 3
// focus the 'saved' radio, then focus Next → model.credentials().touched() true;
// moving the focus between two radios does not emit (spy on touch: 0 calls).

it('disables every option or one', ...);
// disabled via the field (disabled(f.credentials) in the schema) → all radios disabled;
// an option with disabled: true → only that radio disabled.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/segmented-control.component.spec.ts'`
Expected: FAIL.

- [ ] **Step 4: Implement.** Styles: host `display: inline-grid; grid-auto-flow:
      column; grid-auto-columns: minmax(0, 1fr); max-inline-size: 100%; padding:
      var(--ui-space-0-5)`, background `--ui-surface-sunken`, border
      `--ui-border-width` solid `--ui-border-default`, radius
      `--ui-radius-control`. Radios get `mixins.visually-hidden`. `.segment`:
      `display: grid; place-items: center; min-block-size:
      calc(var(--ui-control-height) - 2 * var(--ui-space-0-5))`, padding-inline
      `--ui-space-2`, `--ui-font-size-ui`, `--ui-text-muted`, `text-align:
      center; overflow-wrap: anywhere` (labels wrap rather than truncate, Review
      Focus 4), border `--ui-border-width` solid transparent, radius
      `calc(var(--ui-radius-control) - var(--ui-space-0-5))`, `cursor: pointer`;
      `:hover` → `--ui-text-default`; `:has(:checked)` → background
      `--ui-surface-raised`, border `--ui-border-strong`, `--ui-text-default`,
      weight medium (border and weight, not colour alone);
      `:has(:focus-visible)` → `mixins.focus-ring`; `:has(:disabled)` →
      `--ui-text-disabled`, `cursor: default`.

- [ ] **Step 5: Export** `SegmentedControlComponent` and `type ChoiceOption`
      from `index.ts`.

- [ ] **Step 6: Stories** `Controls/Segmented control`:
  - `Credentials`: the three AR-19 options. `play`: click "Add new credentials",
    `{ArrowRight}` → "No credentials (public repository)" is checked.
  - `Narrow`: the same in a 20rem wrapper (320 px). `play`: the wrapper's
    `scrollWidth <= clientWidth`, and every `.segment` has `scrollWidth <=
    clientWidth` (no text clipped).
  - `CloneMode`: Full clone / Single branch (AR-33), with the description of the
    chosen mode written below by the story, as a feature would.
  - `Disabled`.

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green.

- [ ] **Step 8: Format and commit** (`git commit -m "SegmentedControl
      control"`).

---

### Task 5: `Select`

**Files:**

- Create:
  `libs/ui/src/controls/components/select/select.component.{ts,html,scss,spec.ts,stories.ts}`
- Create:
  `libs/ui/src/controls/directives/select-option/select-option.directive.ts`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Consumes: `FieldControl` (Task 2), `ChoiceOption<V>` (Task 4),
  `FieldComponent` (Task 2) in tests and stories.
- Produces (Aria from `@angular/aria/combobox` and `@angular/aria/listbox`):
  - `SelectOptionDirective<V>`, selector `ng-template[uiSelectOption]`; public
    `readonly template = inject(TemplateRef<{ $implicit: ChoiceOption<V> }>)`;
    `static ngTemplateContextGuard` for a typed `let-option`. Replaces the label
    and description of each option row (an SSH key's type, fingerprint and lock,
    AR-24); the label stays the accessible name.
  - `SelectComponent<V>`, selector `ui-select`, extends `FieldControl`
    (`labelable = false`; `focus()` focuses the trigger; `providers: [{ provide:
    FieldControl, useExisting: forwardRef(() => SelectComponent) }]`);
    - `options = input.required<readonly ChoiceOption<V>[]>()`;
    - `value = model<V | undefined>(undefined)`;
    - `placeholder = input<string>('')`: shown in the trigger when no option has
      the value (also a loading or empty text such as "This repository has no
      branches", AR-35, AR-37, with `disabled`);
    - `disabled = input(false, { transform: booleanAttribute })`;
    - `id = input<string>(<generated 'ui-select-N'>)`: the trigger's id;
    - `touch = output<void>()`: emitted on the trigger's `blur` while the popup
      is closed (Signal Forms' `FormValueControl` shape, Review Focus 3);
    - `option = contentChild(SelectOptionDirective)`.
- Rendering:
  - trigger: `<div ngCombobox readonly #combobox="ngCombobox"
    [(expanded)]="expanded" [disabled]="disabled()" [id]="id()"
    [attr.aria-labelledby]="labelledBy()"
    [attr.aria-describedby]="describedBy()" [attr.aria-invalid]="invalid() ||
    null" (blur)="…">` holding `.value` (the selected option's label, or the
    placeholder with `[data-placeholder]`) and the Codicon `chevron-down`;
  - popup: `<ng-template ngComboboxPopup [combobox]="combobox"><ng-template
    cdkConnectedOverlay [cdkConnectedOverlayOpen]="true"
    [cdkConnectedOverlayOrigin]="trigger"
    [cdkConnectedOverlayMinWidth]="<trigger width>"
    [cdkConnectedOverlayPositions]="[below-start, above-start]"
    [cdkConnectedOverlayViewportMargin]="8" [cdkConnectedOverlayPush]="true">`
    holding `<div ngComboboxWidget ngListbox #listbox="ngListbox"
    [value]="selectedValues()" (valueChange)="choose($event)"
    [activeDescendant]="listbox.activeDescendant()">` with one `<div ngOption
    [value] [label] [disabled]>` per option: a Codicon `check` (visible only on
    the selected option, so selection is not colour alone), then the custom
    template or `.label` and `.description`. `choose` sets `value` to the one
    chosen value and closes the popup. If Aria's API differs from this outline
    (inputs, readonly mode, how the popup closes), follow Aria's own select
    example for 22.2 and keep the public interface above.

- [ ] **Step 1: Scaffold** `component --name=select`, `directive
      --name=select-option` (selector `ng-template[uiSelectOption]`).

- [ ] **Step 2: Write the failing tests** in `select.component.spec.ts`, with
      `ComboboxHarness` and `ListboxHarness`/`OptionHarness` from
      `@angular/aria/*/testing` as they are (the Aria attributes are in our
      template, so no subclass is needed; the popup is in the overlay container,
      so the harnesses reach it through the combobox's `getPopupWidget`).
      Options: levels `simple` "Simple", `guided` "Guided" (`disabled: true`),
      `advanced` "Advanced", each with a description. Host:

```html
<ui-field label="Git control level" [error]="error()">
  <ui-select [options]="options()" [formField]="model.level" placeholder="Choose a level" />
</ui-field>
<button>Next</button>
```

      with `model = form(signal({ level: 'advanced' as string | undefined }))`.

```ts
it('is a labelled, collapsed combobox showing the selected label', ...);
// role 'combobox', aria-expanded 'false', aria-labelledby → the label 'Git control level';
// harness getValue() / trigger text 'Advanced'.

it('opens a listbox of the options with the selected one marked', ...);
// open → role 'listbox' in the overlay container; 3 options; Advanced aria-selected 'true'
// and its check icon visible; Guided aria-disabled 'true'; descriptions rendered.

it('chooses with the keyboard and closes', ...);
// focus, ArrowDown opens; Home → Simple active; Enter → model.level().value() 'simple',
// aria-expanded 'false', focus on the trigger.

it('chooses with a click', ...);

it('skips disabled options', ...);
// from Simple, ArrowDown → Advanced active (Guided skipped).

it('closes on Escape without changing the value', ...);

it('shows the placeholder for a value that is not an option', ...);  // Review Focus 2
// value 'expert' → trigger text 'Choose a level', [data-placeholder]; value unchanged; no throw.

it('shows the label once the option arrives', ...);  // Review Focus 2
// options [] with value 'advanced' → placeholder; set options → 'Advanced'.

it('reports touch when the focus leaves it', ...);  // Review Focus 3
// focus the trigger, focus Next → model.level().touched() true; opening the popup does not emit.

it('is described and marked invalid by its field', ...);
// error 'Choose a level' → aria-invalid 'true', aria-describedby → the error element.

it('can be disabled', ...);
// disabled(f.level) → harness isDisabled() true; click does not open.

it('renders a custom option template', ...);
// second host with <ng-template uiSelectOption let-option><code>{{ option.value }}</code></ng-template>
// → options contain <code>; accessible name is still the label.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx nx run ui:test --include='**/select.component.spec.ts'` Expected:
FAIL.

- [ ] **Step 4: Implement.** Styles:
  - host `display: block; min-inline-size: 0`;
  - trigger as `Input` (Task 2): background `--ui-surface-sunken`, border
    `--ui-border-strong`, radius, `min-block-size: var(--ui-control-height)`,
    `--ui-font-size-input`, plus `display: flex; align-items: center; gap:
    var(--ui-space-1); cursor: pointer`; `.value` `flex: 1; min-inline-size: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis`;
    `[data-placeholder]` `--ui-text-subtle`; chevron `--ui-icon-muted`, rotated
    180° when `[aria-expanded='true']`; `:focus-visible` ring as `Input`;
    invalid and disabled as `Input`;
  - popup (the listbox, styled from this component since it is in its template):
    as `ui-menu`: `--ui-surface-raised`, border `--ui-border-default`, radius
    `--ui-radius-popover`, `--ui-shadow-popover`, padding `--ui-space-1`,
    `max-inline-size: calc(100vw - 2 * var(--ui-space-2))`, `max-block-size:
    min(20rem, 60vh)`, `overflow-y: auto`;
  - option: grid of `auto 1fr` (check, text), gap `--ui-space-2`,
    `min-block-size: var(--ui-control-height)`, padding-inline
    `--ui-control-padding-inline`, radius `--ui-radius-control`, `cursor:
    pointer`; `.label` `--ui-text-default`, `overflow-wrap: anywhere`;
    `.description` `--ui-font-size-ui-small`, `--ui-text-muted`; the active
    option (`[data-active='true']`, or Aria's active marker) and `:hover` →
    `--ui-surface-hover`, and a 2 px inset `--ui-border-focus` outline on the
    active option while the trigger has the focus (the focus stays on the
    trigger with `aria-activedescendant`, so the active option needs its own
    indicator); the check is `visibility: hidden` unless
    `[aria-selected='true']`; `[aria-disabled='true']` → `--ui-text-disabled`.

- [ ] **Step 5: Export** `SelectComponent` and `SelectOptionDirective` from
      `index.ts`.

- [ ] **Step 6: Stories** `Controls/Select`:
  - `GitControlLevel`: Simple, Guided, Advanced with their descriptions (AR-38),
    in a `ui-field`. `play`: click the trigger, `{ArrowUp}`, `{Enter}` → the
    trigger shows "Guided".
  - `SavedKeys`: three SSH keys with a `uiSelectOption` template showing the
    name, `ED25519` and a 50-character `SHA256:…` fingerprint, one with a lock
    (Codicon `lock`) and "Passphrase" (AR-24), in a 20rem wrapper. `play`: open
    it; the wrapper's `scrollWidth <= clientWidth`; the listbox's
    `getBoundingClientRect().right <= window.innerWidth` (Review Focus 4).
  - `Branches`: a placeholder "Loading branches…" and `disabled` for 300 ms,
    then 40 branches with `main` selected (AR-35).
  - `Invalid` and `Disabled`.

- [ ] **Step 7: Verify.** Spec → PASS; `ui:lint` clean; `ui:test-storybook`
      green.

- [ ] **Step 8: Format and commit** (`git commit -m "Select control"`).

---

### Task 6: Form story, design-system record and whole-library verification

**Files:**

- Create: `libs/ui/src/controls/controls.stories.ts`
- Modify: `docs/architecture/design-system.md`

**Interfaces:**

- Consumes: every control above.

- [ ] **Step 1: Story** `Controls/Form → AddRepository`: the Add repository form
      of AR-5 with Signal Forms (`form`, `FormField`, `required`, `pattern`):
      Remote URL, Repository name, a `SegmentedControl` for the AR-19 options
      with "Use saved credentials" showing a `Select` of saved credentials and
      "Add new credentials" showing name, username and a password with reveal, a
      `Select` for the git control level, a `Checkbox` "I understand", and **Add
      repository** (primary, `type="submit"`, disabled while the form is
      invalid) and **Cancel** buttons. Errors show once a field is touched
      (AR-6). Rendered once at full width and once in a 20rem wrapper. `play`:
      focus Remote URL, Tab away → its error is shown; type
      `https://github.com/acme/handbook.git` → the error is gone; the 20rem
      wrapper's `scrollWidth <= clientWidth`. This story is the one
      production-like use of `@angular/forms` in `ui`; it lives in a
      `*.stories.ts` file, which the library build does not include.

- [ ] **Step 2: Record the decisions** in `docs/architecture/design-system.md`:
  - A-10.32, Controls row: `Button`, `IconButton`, `Field`, `Input`, `Textarea`,
    `Select`, `Checkbox`, `Switch`, `SegmentedControl`; built on "Native
    elements; Aria Combobox and Listbox; CDK Overlay".
  - New **A-10.42** under "A-10: Components": "Controls follow Angular Signal
    Forms' control contracts without importing `@angular/forms`: native-element
    controls (`uiInput`, `uiTextarea`, `uiCheckbox`, `uiSwitch`) are bound with
    `[formField]` directly; `Select` and `SegmentedControl` have the
    `FormValueControl` shape (`value`, `disabled`, `touch`). `ui-field` gives a
    control its label, hint and error and sets `aria-describedby` and
    `aria-invalid`; when an error is shown is the feature's decision (AR-6).
    Buttons default to `type="button"`."
  - A-10.39: add "`Select` is tested with the Combobox and Listbox harnesses as
    they are, since its Aria directives are in its own template."

- [ ] **Step 3:** `npx nx affected -t lint,test,build` → all succeed.
- [ ] **Step 4:** `npx nx run ui:test-storybook` → every story passes.
- [ ] **Step 5:** `npm run format:check` → no changes needed.
- [ ] **Step 6: Commit** (`git commit -m "Controls form story and design-system
      record"`).
- [ ] **Step 7: Report** any token values changed for contrast, and any place
      where Aria's Combobox needed a different structure from Task 5's outline.

---

## Not in this plan

- **Busy buttons** (GA-9: a fetch, pull or push button shows progress): needs
  `Spinner` (Feedback group). Add a `busy` input to `Button` and `IconButton`
  then.
- **Tooltips** on icon buttons: `title` until `Tooltip` exists.
- **Errors on a checkbox** (the required "I understand", AR-34): AR-7 disables
  submit until it is ticked, so no message is needed; a `ui-field` around a
  checkbox is not supported.
- **Autocomplete and filterable lists** (the branch list filter, GA-36): an
  editable Combobox, built when the branch list is.
- **Radio groups with descriptions** for each option: AR-33's descriptions are
  shown for the chosen mode only (see the `CloneMode` story); a radio-card
  control is added if a screen needs every description at once.
- **Copy buttons** (AR-29): feature code, a `uiIconButton` with the Clipboard
  API.
- `Icon`: inline Codicon SVGs until it exists.
