---
name: angular-templates
description: |
  The rules for Angular templates in this workspace, with their reasons and
  examples. Use whenever you create or change an Angular template: a
  `.html` file or an inline `template:` in a component. Covers `@let`,
  bindings, calls in templates, translation aliases, `track`, event handlers,
  class and style bindings, accessibility and attribute layout, and how to
  check a template with lint before finishing.
---

Every template in the workspace follows the same rules, so that agents copy good
examples. Rules marked **lint** are ESLint errors: a template that breaks one
cannot be merged. Rules marked **judgement** are not checked by a machine; apply
them yourself.

The lint rules come from one shared config,
`tools/lint-rules/src/angular-templates.config.mjs` (see
`tools/lint-rules/README.md`). They apply to `.html` files and to inline
templates. In the test hosts of specs (inline templates in `*.spec.ts` files and
templates under `testing/`) only attribute layout and control flow are checked.
Inline templates in Storybook stories (`*.stories.ts`) are not linted at all:
the shared config turns the rules off for them, so apply the rules yourself.

## Before you finish

Run lint with `--fix` on every Angular project whose templates you changed. It
fixes attribute layout, self-closing tags and some other rules, and reports the
rest:

```shell
npx nx run <project>:lint --fix
```

Fix what it reports by hand. Then go through the judgement rules below for the
templates you touched.

## Signals and `@let` (judgement)

Use `@let` when a signal is read more than once in a block, or when its value
needs narrowing. A signal read once stays as it is.

The reasons are type narrowing and readability. `@if (user)` narrows a `@let`
value, but not a repeated `user()` call, and a named value reads better than the
same call repeated. It is not about speed: reading a signal again is cheap, so
do not add `@let` to every signal read.

Declare the `@let` at the top of the template or of the block that uses it.

```html
<!-- Bad: no narrowing, the same call three times -->
@if (user()) {
  <p>{{ user()!.name }} ({{ user()!.email }})</p>
}

<!-- Good -->
@let currentUser = user();
@if (currentUser) {
  <p>{{ currentUser.name }} ({{ currentUser.email }})</p>
}

<!-- Good: read once, no @let needed -->
<h1>{{ title() }}</h1>
```

## Two-way bindings (judgement; lint checks the syntax)

Between components, data flows one way: an input down, an output up. Two-way
binding hides who changes a value.

The exception is `model()` with `[(…)]` for form-like controls (inputs, selects,
toggles in `libs/ui`) and for binding a component's own form state, where it is
Angular's intended pattern.

Lint (`banana-in-box`) catches only the `([x])` typo.

```html
<!-- Bad: a list component that writes back into its parent's state -->
<repo-file-list [(selection)]="selection" />

<!-- Good -->
<repo-file-list [selection]="selection()"
                (selectionChanged)="updateSelection($event)" />

<!-- Good: a form control bound to the component's own form state -->
<ui-select [options]="branches()"
           [(value)]="branch" />
```

## No calls in templates (lint, with a judgement part)

Templates do not call methods or functions to compute or format data. Compute
values in `computed()` signals in the component, and format them with pipes.
Template expressions then stay simple, and the logic can be unit-tested.

Calls are allowed only:

- to read signals (including `input()`, `model()` and `computed()`);
- to translate, with the Transloco aliases `t`, `e` and `root` (see below);
- in event bindings, such as `(click)="save()"`.

Everything else is a violation, including reading a value through a call
(`key(option.value)?.fingerprint`) and methods on data (`.join(' + ')`).

Lint (`front-burner/no-template-calls`) reports any call with arguments outside
event bindings, other than the translation aliases. It cannot tell a signal from
a method, so it lets every call without arguments through: a method that
computes something, such as `fullName()` in `{{ fullName() }}`, is still wrong.
Make it a `computed()` signal.

```html
<!-- Bad -->
<span>{{ formatDate(repository().lastAccess) }}</span>
<span>{{ names().join(', ') }}</span>

<!-- Good: a pipe, and a computed() signal in the component -->
<span>{{ repository().lastAccess | date: 'short' }}</span>
<span>{{ nameList() }}</span>
```

## Translation aliases `t`, `e` and `root` (lint)

Templates translate through `*transloco="let …"`, and the alias is always one of
three names. Lint allows calls to these names only, so any other alias is
reported as a call.

- `t` — the component's own prefix (the usual case);
- `e` — a prefix for errors;
- `root` — no prefix, with full keys.

```html
<!-- Bad -->
<ng-container *transloco="let l; prefix: 'web-shell.AppHeaderComponent'">
  {{ l('menu') }}
</ng-container>

<!-- Good -->
<ng-container *transloco="let t; prefix: 'web-shell.AppHeaderComponent'">
  {{ t('menu') }}
</ng-container>
```

## Control flow and other syntax (lint)

- Use `@if`, `@for` and `@switch`, not `*ngIf`, `*ngFor` or `*ngSwitch`
  (`prefer-control-flow`).
- No `$any()` casts (`no-any`). Fix the type in the component instead.
- Compare with `===` and `!==` (`eqeqeq`).
- Close elements without content with ` />` (`prefer-self-closing-tags`).
- Bind attributes with `[attr.x]="…"`, not `x="{{ … }}"`
  (`no-interpolation-in-attributes`).
- Do not negate an `async` pipe (`no-negated-async`).

## `track` by identity (judgement)

`@for` tracks items by a stable identity, such as `item.id` or a path, so that
Angular keeps each item's DOM and state when the list changes. `$index` is fine
only for a list that never changes.

```html
<!-- Bad -->
@for (repository of repositories(); track $index) { … }

<!-- Good -->
@for (repository of repositories(); track repository.id) { … }
```

## One call per event handler (judgement)

An event binding calls one method of the component. Several statements,
assignments and conditions belong in that method, where they can be tested.

```html
<!-- Bad -->
<button (click)="open.set(false); save()">…</button>
<button (click)="dirty = true">…</button>

<!-- Good -->
<button (click)="saveAndClose()">…</button>
```

## Class and style bindings (judgement)

Use `[class.x]` and `[style.x]` instead of `ngClass` and `ngStyle`. They are
simpler, need no import and are checked by the compiler.

```html
<!-- Bad -->
<li [ngClass]="{ active: isActive() }">…</li>

<!-- Good -->
<li [class.active]="isActive()">…</li>
```

## Simple conditions (judgement)

Keep conditions in `@if`, bindings and interpolations short. Move a condition
that combines several values into a `computed()` signal with a name that says
what it means.

```html
<!-- Bad -->
@if (status() === 'ready' && !busy() && (changes().length > 0 || amend())) { … }

<!-- Good -->
@if (canCommit()) { … }
```

## Accessibility (lint)

Templates must work with the keyboard alone and with screen readers (see NF-13
in `docs/architecture/non-functional.md`). Lint checks the basics:

- images have `alt` text (`alt-text`);
- buttons, links and headings have content (`elements-content`);
- labels are tied to a control (`label-has-associated-control`);
- an element with `(click)` also handles the keyboard and can take focus
  (`click-events-have-key-events`, `interactive-supports-focus`). Prefer a
  `<button>` to adding both to a `<div>` or `<span>`;
- ARIA roles have their required attributes, and ARIA attributes and values are
  valid (`role-has-required-aria`, `valid-aria`);
- no `autofocus` (`no-autofocus`);
- `scope` only on `<th>` (`table-scope`).

When a finding is a false positive, for example because a parent element already
handles the keyboard, disable the rule for that line only, with the reason after
`--`:

```html
<!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events -- the row handles Enter and Space -->
<span (click)="select()">…</span>
```

Never disable a rule for a whole file.

A real accessibility fix that changes behaviour or looks needs a test of the new
behaviour, before and after screenshots where it is visible, and a mention in
the PR description.

## Attribute layout (lint, fixed by `--fix`)

Every start tag lays out its attributes the same way:

- one attribute: on the same line as the tag name;
- two or more: always broken over lines, even when they would fit on one. The
  first stays on the tag's line, each other is on its own line, aligned with the
  first; the closing `>` comes right after the last attribute, and ` />` after
  it with one space.

```html
<!-- Bad -->
<button uiButton variant="ghost"
  size="small" class="how"
>

<!-- Good -->
<button uiButton
        variant="ghost"
        size="small"
        class="how">
```

"Attribute" means anything in the start tag: plain attributes, `[input]`,
`(output)`, `[(model)]`, `#ref`, `*directive` and `@animation`.

Do not lay attributes out by hand: run `lint --fix` (see "Before you finish").
The fix moves bound attributes (`[x]`, `(x)`, `*x`, …) with their multi-line
expressions. It never changes the text of a static attribute value that spans
lines, such as a long `class="…"`; it reports it instead, and you fix it by
hand. A tag that starts on the first line of an inline template is reported but
not fixed; start the template on a new line.

## New Angular projects (lint)

Every Angular project spreads the shared config in its `eslint.config.mjs`,
after `...baseConfig` and before its own `**/*.html` block, as
`tools/lint-rules/README.md` shows. A project created by a generator does not
have it: add it. A test in `lint-rules` fails when an Angular project's config
does not import it.
