# Front Burner — Design system

> Status: **Draft**

How the web client looks and how the `ui` library (A-2) builds its components.
The decisions behind it are D-9 in [decisions.md](decisions.md); see
[overview.md](overview.md) for the numbering conventions.

## A-10: Foundation

- **A-10.1** Front Burner has its own design system, built in the `ui` library.
  No general-purpose component library (Angular Material, PrimeNG, Taiga UI,
  Spartan and the like) is used, and no utility-class CSS framework such as
  Tailwind (D-9.1, D-9.3).
- **A-10.2** Behaviour comes from two first-party, headless packages; the look
  is entirely our own:

  | Package             | Used for                                                                                                                      |
  | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | **`@angular/aria`** | Widgets with complex keyboard and ARIA behaviour: Tree, Tabs, Menu and Menubar, Listbox, Combobox, Grid, Toolbar, Accordion   |
  | **`@angular/cdk`**  | Infrastructure: `Overlay`, `Dialog`, `a11y` (`FocusTrap`, `FocusMonitor`, `LiveAnnouncer`), `BreakpointObserver`, `Scrolling` |
  - Both are versioned with Angular (`@angular/aria` 22.2 has no
    developer-preview APIs and needs the exact `@angular/cdk` version), so they
    move with every Angular upgrade (NF-12.1).
  - The CDK's own `Menu` and `Listbox` are not used; Angular Aria replaces them.
  - Select and autocomplete fields are built on Aria's Combobox and Listbox;
    there is no separate select primitive.

- **A-10.3** `ui` holds no business logic and imports only `shared/util` (A-2).
  It does not use Transloco: every visible or announced text, including
  accessible names such as a close button's "Close", comes in through inputs or
  content projection. Required texts are required inputs.
- **A-10.4** Every Aria or CDK directive is used through a `ui` component or
  directive, never directly in feature libraries. Features depend on our API
  only, so a change in Aria or the CDK is absorbed in one place.

## A-10: Look

- **A-10.5** The look follows JetBrains' **Islands** theme and **VS Code**
  (D-9.2), so that it feels familiar to software developers:
  - a darker **canvas** behind the whole page;
  - content sits on **islands**: panels with rounded corners, separated by a
    small gap, each with an optional header and toolbar;
  - a compact density on desktop, close to an IDE's;
  - an **activity bar** (VS Code's column of icons) to switch the side panel,
    and a **status bar** at the bottom (save state, sync state, branch).
- **A-10.6** On narrow screens the same parts rearrange rather than being
  replaced: islands take the full width with smaller gaps and radii, one side
  panel is shown at a time, and the activity bar moves to the bottom of the
  screen. Nothing scrolls sideways at 320 CSS pixels (NF-12.4).
- **A-10.7** Islands react to their **own** width with container queries, not to
  the viewport's, because the repository screen's panes can be any width.
  Viewport breakpoints are used only for the page layout.

## A-10: Design tokens

- **A-10.8** Every colour, size, radius, font, shadow and duration is a CSS
  custom property, prefixed `--ui-`, in three tiers:

  | Tier      | Example                                       | Used by                          |
  | --------- | --------------------------------------------- | -------------------------------- |
  | Primitive | `--ui-gray-800`, `--ui-space-2`               | Semantic tokens only             |
  | Semantic  | `--ui-surface-island`, `--ui-text-muted`      | Components and feature libraries |
  | Component | `--ui-button-height`, `--ui-tree-row-padding` | One component                    |

  Components read only semantic and component tokens. Feature libraries read
  only semantic tokens, and adjust a component only through its component
  tokens.

- **A-10.9** **Colour scheme.** Semantic colour tokens are declared once for
  each scheme: the light values on `:root`, the dark values under the media
  query `(prefers-color-scheme: dark)`, so the web client follows the platform's
  colour scheme with no theme service (ED-14). Each block also sets
  `color-scheme`, for native controls and scrollbars.
  - A `data-theme` attribute (`light` or `dark`) overrides the platform's scheme
    for the element it is on and everything inside it. On the root, Storybook
    uses it, and a user preference can use it later; on any other element, it
    shows part of the page in the other scheme.
  - `light-dark()` is not used: it needs Chrome 123 and Safari 17.5, and the
    browsers of NF-12.1 start at Chrome 119 and Safari 17.
- **A-10.10** **Contrast.** Every semantic text colour meets 4.5:1 against every
  surface it is used on, and every border of a control, icon and focus ring
  meets 3:1, in both schemes (NF-13.1). Each such pair is listed in
  `contrast-pairs.model.ts`; the Storybook token page measures every pair in
  both schemes in a real browser, and its story fails in CI when one is below
  its minimum (A-10.38).
- **A-10.11** **Density.** Two token sets:
  - **compact** (default), with controls about 24–28 px high as in an IDE, and
    never less than the 24 px of NF-13.5;
  - **touch**, with targets of at least 44 px, chosen by the media query
    `(pointer: coarse)` (NF-13.5).

  A `data-density` attribute (`compact` or `touch`) on the root overrides the
  media query, for Storybook and tests. Components size themselves from the
  density tokens only and have no separate mobile variants.

- **A-10.12** **Motion.** Durations are tokens, and the media query
  `(prefers-reduced-motion: reduce)` sets them to zero (NF-13.7).
- **A-10.13** **Breakpoints** are SCSS variables, not custom properties, because
  custom properties cannot be used in media queries.
- **A-10.14** **Syntax colours** are a fourth group of semantic tokens
  (`--ui-syntax-keyword`, `--ui-syntax-string`, …), shared by the CodeMirror
  theme (A-8.11), the Shiki classes of the live preview (A-8.12) and diffs, so
  that the editor, the preview and the rest of the UI match in both schemes.

- **A-10.15** **Source.** Tokens are written by hand as custom properties in
  SCSS partials; there is no token build step. Group and token names follow the
  W3C Design Tokens (DTCG) format, so that a JSON source can be generated from
  them later, for example for a native client, without renaming anything.

  ```
  libs/ui/src/styles/
    index.scss          the global stylesheet; loaded by apps/web and Storybook
    _layers.scss        layer order (A-10.27), emitted first
    _fonts.scss         self-hosted fonts (A-10.36)
    tokens/             _primitives, _color, _syntax, _typography, _space,
                        _shape, _density, _motion; _functions holds the helpers
                        that emit both schemes and both densities
    _reset.scss  _base.scss
    mixins/             _focus-ring, _visually-hidden, _breakpoints
  ```

- **A-10.16** **Names.** Primitives are `--ui-<hue>-<step>` (`--ui-neutral-90`,
  `--ui-blue-60`), with steps that rise with lightness. Semantic tokens are
  named by role, not by look: `--ui-<role>-<variant>[-<state>]`, for example
  `--ui-text-muted`, `--ui-surface-raised`, `--ui-accent-hover`,
  `--ui-border-focus`. Component tokens are
  `--ui-<component>-<property>[-<state>]`.
- **A-10.17** **Units.**
  - Colours are written in **OKLCH**, so that steps of a ramp look evenly spaced
    and contrast between them is predictable. Translucent overlays, such as
    hover, are `color-mix(in oklch, <primitive> <amount>, transparent)`.
    Relative colour syntax (`oklch(from …)`) is not used: Safari 17 lacks it
    (NF-12.1).
  - Sizes, spacing and type are in **`rem`**, so the UI follows the browser's
    font size setting (WCAG 1.4.4); the root font size is never changed. Only
    borders and focus rings are in `px`.
- **A-10.18** **Colours.**
  - Neutrals are **slightly cool** greys, as in JetBrains' Islands theme.
  - The accent is **JetBrains blue** (around `#3574F0`).
  - Status colours: blue (info), green (success), amber (warning), red (danger).
    Git and file status colours (added, modified, deleted, renamed, untracked,
    ignored, conflicted) come from the same hues, each always shown with a
    letter or an icon as well (NF-13.7).
  - Disabled controls use their own tokens, never `opacity`, so that their
    contrast does not depend on what is behind them.
- **A-10.19** **Semantic groups.** Besides syntax colours (A-10.14):

  | Group     | Tokens                                                                                                            |
  | --------- | ----------------------------------------------------------------------------------------------------------------- |
  | Surface   | `canvas`, `island`, `raised` (menus, popovers), `sunken` (inputs), `scrim`; `hover`, `pressed` overlays           |
  | Selection | `selected-active` and `selected-inactive`: a list shows its selection differently when it does not have the focus |
  | Text      | `default`, `muted`, `subtle`, `disabled`, `inverse`, `link`, `on-accent`                                          |
  | Icon      | as text                                                                                                           |
  | Border    | `default`, `subtle`, `strong`, `focus`                                                                            |
  | Accent    | `accent`, `accent-hover`, `accent-pressed`                                                                        |
  | Status    | `info`, `success`, `warning`, `danger`, each with background, border, text and icon                               |
  | Git       | `added`, `modified`, `deleted`, `renamed`, `untracked`, `ignored`, `conflicted`                                   |
  | Diff      | inserted and deleted line and word backgrounds, gutter                                                            |
  | Conflict  | mine, theirs and base block backgrounds, marker line                                                              |
  | Editor    | background, gutter, line number, active line, selection, cursor, match highlight                                  |
  | Elevation | two shadows (popover, dialog); raised surfaces are also lighter and bordered, since shadows barely show in dark   |
  | Shape     | radii for controls, islands, popovers and pills; the gap between islands                                          |
  | Motion    | `fast`, `base` and `slow` durations; two easings                                                                  |
  | Focus     | ring width, offset and colour                                                                                     |

- **A-10.20** **Type.** Inter for the UI, JetBrains Mono for code (A-10.36).

  | Context      | Compact | Touch | Why                                                                                      |
  | ------------ | ------- | ----- | ---------------------------------------------------------------------------------------- |
  | UI chrome    | 13 px   | 15 px | The JetBrains and VS Code default                                                        |
  | Form inputs  | 13 px   | 16 px | iOS zooms into any input under 16 px when it is focused                                  |
  | Editor       | 14 px   | 16 px | The same iOS zoom applies to CodeMirror's content                                        |
  | Live preview | 16 px   | 16 px | Reading text, like GitHub's Markdown; its own **prose** tokens with a longer line height |

  Weights are 400, 500 and 600.

- **A-10.21** **Space** is a 4 px based scale (2, 4, 6, 8, 12, 16, 20, 24, 32,
  48 px, written in `rem`). Icons are 16 px in compact density and 20 px in
  touch density, since Codicons are drawn on a 16 px grid; the touch target is
  made up with padding, not by scaling the icon further.
- **A-10.22** **Forced colours.** Under `(forced-colors: active)` the semantic
  colour tokens map to system colours (`Canvas`, `CanvasText`, `Highlight`,
  `ButtonText`, …), and selection, focus and state are never shown by background
  colour alone, so that Windows' contrast themes work.
- **A-10.23** _(My call.)_ Starting values for every token are agreed on the
  Storybook token page (A-10.40) before components use them. Until then, the
  values in the token files may change freely.

## A-10: CSS architecture

- **A-10.24** Styling is **semantic**: selectors describe what an element is and
  what state it is in. There are no utility classes, and no class names that
  describe a look (`.mt-2`, `.text-red`).
- **A-10.25** Selectors, in order of preference:
  1. the component's host element and the native elements inside it;
  2. **ARIA and native state**: `[aria-selected="true"]`, `[aria-expanded]`,
     `[aria-current]`, `[aria-invalid="true"]`, `:disabled`, `:focus-visible`,
     instead of classes such as `.is-active`. A style cannot then disagree with
     what assistive technology announces;
  3. a component's own part classes (`.header`, `.label`) where neither of the
     above is enough.
- **A-10.26** Simple controls are **attribute components on native elements**:
  `<button uiButton variant="primary">`, `<input uiInput>`, `<a uiLink>`. The
  native element keeps its semantics, form behaviour and keyboard handling.
  Element selectors (`<ui-island>`) are used only for components that have no
  native equivalent.
- **A-10.27** **Cascade layers.** The global stylesheet declares the layer order
  `reset`, `tokens`, `base`, `layout`, `components`, `overrides`. Components'
  styles keep Angular's emulated encapsulation; `::ng-deep` and
  `ViewEncapsulation.None` are not used. A component's stylesheet wraps its
  rules in `@layer components { … }`: unlayered styles would win over every
  layer, including `overrides`.
- **A-10.28** SCSS is a build-time helper only: mixins such as `focus-ring()`
  and `visually-hidden()`, and breakpoints (A-10.13). Anything that can change
  at run time is a custom property.
- **A-10.29** **CSP** (NF-11.1): templates contain no `style` attributes.
  Dynamic values, such as a pane's size, are set with property bindings
  (`[style.--ui-pane-size]`), which Angular applies through the CSSOM and which
  `style-src` does not restrict. Dependencies that write `style` attributes as
  HTML are not used.
- **A-10.30** **Focus.** Every focusable element shows a 2 px focus ring from
  the `focus-ring()` mixin on `:focus-visible`, offset from the element and
  meeting 3:1 against both the island and the canvas (NF-13.3).

## A-10: Components

- **A-10.31** Components follow the rest of the web client: standalone, signal
  inputs and outputs (A-8.2), `OnPush`, host bindings in the `host` metadata,
  selector prefix `ui`.
- **A-10.32** The `ui` library builds only what the MVP's screens need. Before
  release it holds:

  | Group      | Components                                                                                      | Built on                    |
  | ---------- | ----------------------------------------------------------------------------------------------- | --------------------------- |
  | Layout     | `AppShell`, `Island`, `SplitPane`, `ActivityBar`, `StatusBar`                                   | Own code, CDK `Breakpoints` |
  | Navigation | `TabStrip`, `Tree`, `Menu`, `Breadcrumbs`                                                       | Aria Tabs, Tree, Menu       |
  | Controls   | `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `SegmentedControl` | Native elements, Aria       |
  | Feedback   | `Dialog`, `Popover`, `Tooltip`, `Toast`, `InlineBanner`, `Badge`, `Spinner`, `ProgressBar`      | CDK Overlay and Dialog      |
  | Content    | `Icon`, `EmptyState`, `KeyValueList`                                                            | Own code                    |

  _(My call.)_ The list grows when a requirement needs a new component, not
  ahead of it.

- **A-10.33** `SplitPane` can be resized with the keyboard (arrow keys on its
  separator, `role="separator"` with `aria-valuenow`) and through a menu with
  preset sizes, so that dragging is never the only way (NF-13.6).
- **A-10.34** `Tree` is the base of the file tree (REQ-FILE-001): Aria's Tree
  with deferred loading of a folder's children, and the CDK's virtual scrolling
  for large folders.

## A-10: Icons and fonts

- **A-10.35** Icons are **Codicons**, VS Code's icon set (CC-BY-4.0; the
  attribution goes in the web client's licence notices). They are served as one
  self-hosted SVG sprite (`img-src 'self'`) and drawn by the `Icon` component
  with `fill: currentColor`. Icons that only decorate are `aria-hidden`; an
  icon-only button takes a required accessible name.
- **A-10.36** Fonts are **Inter** for the UI and **JetBrains Mono** for code,
  both under the SIL Open Font License, from the `@fontsource-variable` packages
  and served from the web client's own origin (`font-src 'self'`) with
  `font-display: swap`. They are variable fonts: one `woff2` file per script
  covers every weight, and the browser downloads only the scripts a page uses.

## A-10: Workflow and testing

- **A-10.37** Every component has Storybook stories. A global toolbar in
  Storybook switches `data-theme` and `data-density` (A-10.9, A-10.11), so each
  story can be checked in light and dark and at both densities.
- **A-10.38** `@storybook/addon-a11y` runs axe on every story with its `test`
  parameter set to `'error'`. Storybook's Vitest addon runs every story as a
  test in a real browser (Chromium through Playwright): the `test-storybook`
  target in CI, and the test panel of the running Storybook. An accessibility
  violation or a failing `play` function in a component therefore fails the
  build before it reaches the end-to-end tests (NF-13.8). Storybook uses the
  Vite-based `@storybook/angular-vite` framework, which the Vitest addon needs.
- **A-10.39** Unit tests of components that wrap Aria use its testing harnesses
  (`@angular/aria/*/testing`) rather than querying the DOM.
- **A-10.40** The first step is the tokens: a Storybook page (**Design
  system/Tokens**) that shows the colours, type scale, spacing and both
  densities in both schemes, with contrast ratios. It lists every `--ui-*` token
  it finds in the loaded stylesheets, so it cannot fall out of date. The look is
  agreed there before components are built.
- **A-10.41** _(My call.)_ Visual regression testing is not part of the MVP; it
  can be added on the Storybook stories later.

## Open questions

None at the moment.
