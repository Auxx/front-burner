# Angular Template Rules — Design

> Status: **Approved**

## Intent

Agents write most of the web client's Angular templates. Their output is
usually good, but it is not consistent, and the occasional mistake (a method
call in an interpolation, a `$any()` cast, an old `*ngIf`, a list tracked by
`$index`, odd attribute layout) slips through peer review. The codebase then
drifts, and later agents copy the drift.

The goal is that **every template follows the same rules, and a template that
breaks a mechanically checkable rule cannot be merged**. Two layers do this:

1. **Lint**, which fails the build. Every rule that can be checked by a machine
   is an ESLint error, including attribute layout, through a custom rule with an
   automatic fix.
2. **A skill**, which guides agents on the judgement calls lint cannot make, and
   tells them to run lint (with `--fix`) before they finish.

Existing templates are then brought in line, so that agents copy good examples.

Success: `nx run-many -t lint` passes with all the rules below enabled as
errors; every existing template conforms; the new skill is loaded whenever an
agent touches a template; and no behaviour or visual change slipped in during
the refactoring.

## Goals, non-goals, anti-goals

**Goals**

- Template lint rules enabled as errors for every Angular project.
- A custom ESLint rule for attribute layout, with an autofix and unit tests.
- An `angular-templates` skill covering the rules
  and their reasons, referenced from `development-workflow`.
- All existing component templates (`.html` files and inline `template:` in
  components) conform.
- Tests guard the refactoring.

**Non-goals**

- Formatting anything other than attribute layout. Indentation and line
  breaks elsewhere stay as they are today.
- Replacing `dprint` or adopting Prettier for HTML.
- Templates inside Storybook stories (`*.stories.ts`); ESLint does not process
  them. _My call._
- Most rules in inline templates of test-host components in `*.spec.ts` files
  and `testing/` folders (about 59 files). _My call_: only the attribute-layout
  rule and `prefer-control-flow` apply there; `no-call-expression`, `no-any`
  and the accessibility rules are switched off for them in the shared config,
  because test markup is throwaway and sometimes deliberately wrong.
- Changing behaviour or look of any page.

**Anti-goals** (failure even if it technically works)

- A refactoring that silently changes behaviour or appearance.
- Rules that need many `eslint-disable` comments to pass. A rule that does not
  fit the codebase is configured or dropped, not suppressed everywhere.
- A formatter that breaks Angular syntax (the reason `dprint` plugins were
  rejected).
- Mechanically applying `@let` to every signal read, which adds noise without
  benefit.

## The rules

### 1. Signals in templates and `@let`

The original motivation (that each signal read in a template adds a
subscription) is **not** correct: a view's reactive consumer depends on a
signal once, and re-reading it is a cheap getter. The rule is kept for other
reasons:

- **Type narrowing**: `@let user = user();` then `@if (user) { … user.name … }`
  narrows; repeated `user()` calls do not.
- **Readability**: a named value (`isEnabled`) reads better than repeated
  calls.

So: use `@let` when a signal is read more than once in a block or needs
narrowing; a single `{{ label() }}` stays as it is. This is a skill rule, not
lint. Declare the `@let` at the top of the template or of the block that uses
it.

### 2. Two-way bindings

One-way data flow (`[value]` + `(valueChange)="…($event)"`) is the default
between components. **Exception**: `model()` with `[(…)]` is allowed for
form-like controls (inputs, selects, toggles in `libs/ui`) and for binding a
component's own form state, where it is Angular's intended pattern. Skill rule;
lint covers only the `banana-in-box` typo.

### 3. No method or function calls in templates

Templates do not call methods or functions to compute or format data: use
`computed()` signals in the component and pipes for formatting. Allowed:

- signal reads (including `input()`, `model()`, `computed()`);
- calls in event bindings;
- **Transloco translation functions** from `*transloco="let …"`, called with a
  key (`{{ t('key') }}`, `{{ e(reason()) }}`). There are about 385 of these;
  they stay as they are (decided with the product owner). The alias names are
  a **fixed set**, so lint can allow them by name and the skill requires them:
  - `t` — the component's own prefix (the usual case);
  - `e` — an errors prefix;
  - `root` — no prefix.

  _My call_: the two templates that use a second component prefix today
  (`let l` in `commit-author-form.component.html`, `let h` in
  `repository-credentials.dialog.html`) are changed to fit this set (for
  example `root` with full keys); if the builder finds that unworkable, they
  may add one more documented alias rather than a free-for-all.

Everything else is a violation, including reading a value through a call
(`key(option.value)?.fingerprint`) and methods on data (`.join(' + ')`): these
move into `computed()` or a pipe. Lint rule
`@angular-eslint/template/no-call-expression`, configured to allow signal reads
and the translation aliases (its `allowList` / `allowPrefix` options, or by the
builder's best mechanism; see [Builder's choices](#builders-choices)).

Existing violations found so far include `{{ value(token, scheme) }}` and
`@let issuerError = error('issuer')`.

### 4. Other template rules (lint, errors)

From `@angular-eslint/template` (version in `package.json`, currently 22.6):

- `no-any` — no `$any()` casts.
- `prefer-control-flow` — no `*ngIf`, `*ngFor`, `*ngSwitch`.
- `banana-in-box`, `eqeqeq`.
- `prefer-self-closing-tags`.
- Accessibility: `alt-text`, `elements-content`,
  `label-has-associated-control`, `click-events-have-key-events`,
  `interactive-supports-focus`, `role-has-required-aria`, `valid-aria`,
  `no-autofocus`, `table-scope`.
- `no-negated-async`, `no-interpolation-in-attributes`.

The builder may add other rules from the plugin that fit, and must justify
dropping any listed one (for example, if it conflicts with a documented
decision). Accessibility rules must stay consistent with
`docs/architecture/non-functional.md`.

**Accessibility findings that need a visible change** (decided with the
product owner). Some `(click)` handlers sit on non-interactive elements (for
example the label in `libs/ui`'s field component, the tree, and a
`stopPropagation` in `file-tree.component.html`). A proper fix may add a tab
stop, a focus ring or a keyboard handler. Such fixes **are allowed**, as an
explicit exception to the "no behaviour change" non-goal, provided each one:

- has a test for the new behaviour;
- has before/after screenshots where it is visible;
- is listed in the PR description.

Where the finding is a false positive (for example the keyboard is already
handled by a parent element), the rule is disabled for that line only, with a
one-line comment saying why.

### 5. Skill-only guidance

- `track` uses a stable identity (`item.id`), not `$index`, unless the list is
  static.
- Event handlers call one method; no multi-statement logic or assignments in
  templates.
- No `ngClass` / `ngStyle` where `[class.x]` / `[style.x]` bindings work.
- Keep conditions simple; move complex expressions into `computed()`.

### 6. Attribute layout (custom lint rule)

- One attribute: on the same line as the tag name.
- Several attributes: the first on the tag's line; each other on its own line,
  aligned with the first attribute's column; the closing `>` or `/>` on the
  same line as the last attribute.

```html
<button uiButton
        variant="ghost"
        size="small"
        class="how">
```

"Attribute" means anything in the start tag: plain attributes, `[input]`,
`(output)`, `[(model)]`, `#ref`, `*directive`, `@animation`. The rule:

- reports any start tag that does not match the layout;
- autofixes it (`--fix`) without changing anything else in the template;
- applies to `.html` templates and inline component templates;
- leaves the tag's content and closing tag alone;
- never produces invalid Angular syntax.

Multi-line attribute values (_my call_):

- **Bound attributes** (`[x]`, `(x)`, `[(x)]`, `*x`, `@x`): when the attribute
  moves, its continuation lines shift by the same number of columns, so the
  expression keeps its shape. Whitespace in an expression does not matter.
- **Static attributes** (`class="…"`, `aria-label="…"`): the value's text is
  never changed, because it reaches the DOM. If fixing the layout would need
  the continuation lines moved, the rule reports the problem without an
  autofix, and it is fixed by hand.

Whether all attributes may sit on one line when they fit (e.g.
`<a href="…" class="x">`) is **not** allowed: two or more attributes always
break. _My call, from the stated rule; easy to change if wanted._

The rule lives in a **new Nx project under `tools/`** for the workspace's
custom lint rules (decided with the product owner), alongside `tools/ai-tools`
and tagged like it (`scope:tools`). The project is a local ESLint plugin that
can hold further custom rules later; it has its own `lint` and `test` targets,
and the rule is registered in the shared config so every Angular project gets
it. The project's name and internal layout are the builder's call. It has unit tests using ESLint's `RuleTester` with the
Angular template parser, covering valid layouts, each kind of attribute,
self-closing tags, multi-line values, and the autofix output.

## Where the configuration lives

Each Angular project's `eslint.config.mjs` spreads
`nx.configs['flat/angular-template']` and then the root config. The new
template rules go into **one shared place** (a `**/*.html` block in the root
`eslint.config.mjs`, or a shared config the projects import) so no project
configures them separately. Inline templates are covered through the Angular
plugin's inline-template processing.

## Refactoring existing templates

There are 89 templates; about 86 have a `.spec.ts` and 33 components have
Storybook stories.

Order:

1. Add the custom attribute-layout rule with its tests.
2. Enable all rules. Fix the code **library by library**, starting with
   `libs/ui` (everything builds on it), then the web libraries, then
   `apps/web`. One commit (or PR) per library keeps reviews small.
3. Mechanical fixes (attribute layout, self-closing tags, control flow) can use
   `--fix`; the rest are done by hand.

Tests:

- **Before** changing a template whose behaviour could change (removing method
  calls, replacing two-way bindings, changing `track`, accessibility fixes that
  add elements or handlers), check that its spec covers that behaviour, and add
  tests first where it does not. Templates without a spec get one if they are
  changed beyond layout.
- **Visual**: for components with stories, take Storybook screenshots before
  and after with the existing `ai-tools` screenshot tool and compare them.
- Purely syntactic changes (layout, self-closing tags, `@let`) rely on lint,
  typecheck, the existing specs and the screenshots.
- Each library ends green on typecheck, lint, test and build, per the
  `development-workflow` skill.

## The skill

A new `angular-templates` skill in `.claude/skills/` (following the format of the existing ones):

- states each rule above with its reason and a short good/bad example;
- marks which rules lint enforces and which are judgement calls;
- tells the agent to run lint with `--fix` on changed projects before
  reporting;
- is linked from `development-workflow` (load it whenever a `.html` template
  or inline template is created or changed) and from `CLAUDE.md`'s skill list;
- is mirrored like the other skills: a copy in `.junie/skills/` and an entry in
  `AGENTS.md` (_my call_). `development-workflow` comes from the
  `@hexmode/toolkit-nx` generator and already has local edits; the new link is
  another local edit, made in both copies.

The `toolkit-nx` generators produce templates too; if their output breaks the
new rules (for example attribute layout), the builder notes it and fixes the
generated files, or raises it if the generator itself must change.

## Builder's choices

- The custom-rule project's name and internal layout.
- How `no-call-expression` is told about signals (allow-list, naming
  convention, or a custom check) — as long as plain signal reads pass and
  other calls fail.
- The skill's wording.
- Whether the work is one PR or several.
