# Angular Template Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Angular template follows one set of rules; lint fails the build
on any mechanically checkable break, including attribute layout; an
`angular-templates` skill guides agents on the rest; existing templates conform.

**Architecture:** A new Nx project `tools/lint-rules` is a local ESLint plugin
(`front-burner`) with two custom rules (`attribute-layout`, `no-template-calls`)
and one shared flat-config module that turns on those and the chosen
`@angular-eslint/template` rules. Each Angular project opts in by spreading that
module; projects are migrated one group at a time so `master` stays green. A
test in `tools/lint-rules` fails if an Angular project does not opt in.

**Tech Stack:** ESLint 9.39 flat config, `angular-eslint` 22.6
(`@angular-eslint/template-parser`, `eslint-plugin-template`), Nx 22, Vitest
4.1, plain ES modules (`.mjs`) like `tools/ai-tools`.

**Spec:** `docs/superpowers/specs/2026-11-07-angular-template-rules-design.md`

## Global Constraints

- All template rules are **errors**, never warnings.
- No new npm dependencies. The plugin is plain `.mjs` with JSDoc, like
  `tools/ai-tools`.
- The new project is tagged `scope:tools` and `type:util`; `npm run check:tags`
  and `npm run check:vitest` pass (its `vitest.config.mjs` uses `nodeConfig`
  from `vitest.shared.mts`).
- Transloco aliases allowed by lint: exactly `t`, `e`, `root`.
- Attribute layout: one attribute on the tag's line; two or more always break,
  the first on the tag's line, the rest aligned under it; `>` right after the
  last attribute; `/>` after the last attribute with **one space** (`" />"`, as
  in all 148 existing self-closing tags; _plan's call_).
- Static multi-line attribute values are never rewritten; bound ones (`[x]`,
  `(x)`, `[(x)]`, `*x`, `@x`, `[@x]`) shift as a block.
- Spec test hosts (`*.spec.ts` inline templates, `testing/` folders): only
  `attribute-layout` and `prefer-control-flow` apply.
- No behaviour or visual change, except accessibility fixes that are tested,
  screenshotted where visible, and listed in the PR description. False positives
  get a single-line `<!-- eslint-disable-next-line … -->` with the reason.
- Storybook story templates are out of scope.
- Follow the `development-workflow` skill for every task: verify with `npx nx
  affected -t typecheck,lint,test,build,size-check`, then format.

## Review Focus

1. A `>` or `/` inside a quoted value (`[x]="a > b"`, `href="a/b"`) must not end
   the start tag early — Task 1, `quoted-gt` tests.
2. CRLF files (this is a Windows checkout): the fix uses the file's own line
   ending and never mixes `\n` into a CRLF file — Task 1, `crlf` test.
3. A tag that is not first on its line (`<span>a</span> <b class="x" id="y">`)
   aligns under its own first attribute, not the line's indent — Task 1,
   `mid-line` test.
4. `--fix` is idempotent: fixed output is itself valid — Task 1, every invalid
   case's output is also listed as valid.
5. Void and boolean attributes (`<input disabled>`, `<br>`, `title='x'`,
   `let-item`) are recognised as attributes and laid out like any other — Task
   1, `boolean-and-single-quotes` tests.

---

### Task 1: `tools/lint-rules` project and the `attribute-layout` rule

**Files:**

- Create: `tools/lint-rules/project.json`, `tools/lint-rules/README.md`,
  `tools/lint-rules/eslint.config.mjs`, `tools/lint-rules/vitest.config.mjs`
  (copy the shape of `tools/ai-tools`, without `implicitDependencies` and the
  `externalDependencies` input)
- Create: `tools/lint-rules/src/index.mjs` — the plugin
- Create: `tools/lint-rules/src/rules/attribute-layout.mjs`
- Create: `tools/lint-rules/src/lib/start-tag.mjs` — the start-tag scanner
- Test: `tools/lint-rules/src/rules/attribute-layout.spec.mjs`,
  `tools/lint-rules/src/lib/start-tag.spec.mjs`
- Test helper: `tools/lint-rules/src/testing/rule-tester.mjs`

**Interfaces:**

- Produces: `export default plugin` from `src/index.mjs`, where `plugin = {
  meta: { name: 'front-burner' }, rules: { 'attribute-layout': … } }`. Rules are
  referenced as `front-burner/<rule>`.
- Produces: `scanStartTag(text: string, offset: number) → { name: string,
  nameEnd: number, attributes: Array<{ text: string, start: number, end: number,
  bound: boolean }>, closing: '>' | '/>', closingStart: number, end: number }` —
  `offset` is where `<` is; offsets are absolute in `text`; quote-aware.
- Produces: `ruleTester` from `src/testing/rule-tester.mjs`: an ESLint
  `RuleTester` with `languageOptions.parser` =
  `@angular-eslint/template-parser`, wired to Vitest (`RuleTester.describe =
  describe; RuleTester.it = it; RuleTester.itOnly = it.only`).

- [ ] **Step 1: Scaffold the project.** Name `lint-rules`, tags `scope:tools`,
      `type:util`, targets `lint` and `test` (`vitest run`, cwd
      `tools/lint-rules`), `include: [ 'src/**/*.spec.mjs' ]`. `nx.json` already
      lists `{workspaceRoot}/tools/lint-rules/**/*` as a lint input; keep it.
      README: one paragraph on what the plugin is and how a project opts in
      (filled in by Task 3).

- [ ] **Step 2: Write failing scanner tests** in `start-tag.spec.mjs`: `<div>` →
      no attributes, closing `>`; `<br />` → closing `/>`; `<a href="a/b"
      [x]="a > b" (y)='f()' disabled #ref let-item>` → six attributes with the
      exact texts, `bound` true for `[x]` and `(y)` only; a value spanning lines
      is one attribute; `*transloco="let t"`, `@fade`, `[@fade]`, `[(z)]` are
      bound.

- [ ] **Step 3: Run** `npx nx run lint-rules:test` — Expected: FAIL (module not
      found).

- [ ] **Step 4: Implement `scanStartTag`.** Walk characters from after `<`: read
      the tag name, then tokens separated by whitespace outside quotes; a token
      ends at whitespace, `/>` or `>` outside quotes. `bound` = name starts with
      `[`, `(`, `*` or `@`.

- [ ] **Step 5: Write failing rule tests** in `attribute-layout.spec.mjs`.
      Message ids: `firstAttribute` ("The first attribute goes on the tag's
      line, one space after the tag name."), `alignAttribute` ("Each further
      attribute goes on its own line, aligned with the first."), `closing` ("The
      closing bracket follows the last attribute: `>` directly, `/>` after one
      space.").

  Valid:
  ```html
  <div></div>
  <br>
  <div class="a"></div>
  <button uiButton
          variant="ghost"
          size="small"
          class="how">x</button>
    <a href="x"
       class="y">                       <!-- indented tag -->
  <ui-icon name="a"
           size="s" />
  <ng-template #a
               let-item>
  <span>a</span> <b class="x"
                    id="y"></b>          <!-- mid-line -->
  <div [x]="a > b"
       (y)="go()"></div>                <!-- quoted-gt -->
  <input disabled
         title='x'>                     <!-- boolean-and-single-quotes -->
  <div [x]="{
         a: 1
       }"
       class="y"></div>                 <!-- multi-line bound value -->
  ```
  plus every `output` below (idempotence).

  Invalid → output:
  - the spec's bad example
    (`<button\n  uiButton\n  variant="ghost"\n  size="small"\n  class="how"\n>`)
    → the good example; errors `firstAttribute`, `closing`.
  - `<a href="x" class="y">` → `<a href="x"\n   class="y">`; `alignAttribute`.
  - `<div\n  class="a">` → `<div class="a">`; `firstAttribute`.
  - `<div  class="a">` (two spaces) → `<div class="a">`.
  - `<div a\n     b\n>` → `<div a\n     b>`; `closing`.
  - `<ui-icon name="a"/>` → `<ui-icon name="a" />`; `closing`.
  - bound multi-line value moved left by 2: continuation lines move left by 2.
  - static multi-line value whose start column changes
    (`<div\n  class="a\n    b"\n  id="c">`) → reported, `output: null`.
  - `crlf`: `<a href="x" class="y">` in a `\r\n` file → `<a
    href="x"\r\n   class="y">`.

- [ ] **Step 6: Run** `npx nx run lint-rules:test` — Expected: FAIL.

- [ ] **Step 7: Implement `attribute-layout`** (`meta.type: 'layout'`, `fixable:
      'whitespace'`, no options). Visit `Element` and `Template` nodes (check
      the node type names the installed parser emits); skip a node whose
      `startSourceSpan.start.offset` was already handled (a `*x` element yields
      both). Scan the start tag from the source text with `scanStartTag`.
      Expected layout: `<name` + `' '` + attr₀ + for each next attr `EOL + '
      '.repeat(col) + attr` + (`>` | `' />'`), where `col` is attr₀'s column on
      its line and `EOL` is `\r\n` if the source contains it, else `\n`. Report
      once per tag with the first differing message id; the fix replaces from
      the end of the name to the tag end. Shift a bound value's continuation
      lines by the column delta (if a line lacks enough leading spaces to shift
      left, give no fix); a static multi-line value whose column changes → no
      fix.

- [ ] **Step 8: Run** `npx nx run lint-rules:test` and `npx nx run
      lint-rules:lint` — Expected: PASS. Run `npm run check:tags` and `npm run
      check:vitest` — Expected: no problems.

- [ ] **Step 9: Commit** — `git commit -m "Add attribute-layout lint rule"`.

### Task 2: `no-template-calls` rule

The stock `@angular-eslint/template/no-call-expression` cannot tell signal reads
from other calls, so it is not used; this rule replaces it.

**Files:**

- Create: `tools/lint-rules/src/rules/no-template-calls.mjs`
- Modify: `tools/lint-rules/src/index.mjs` (register it)
- Test: `tools/lint-rules/src/rules/no-template-calls.spec.mjs`

**Interfaces:**

- Consumes: `ruleTester` (Task 1).
- Produces: rule `front-burner/no-template-calls`, options `[{ allowedFunctions:
  string[] }]` (default `[]`), message id `call`: "Templates call functions only
  to read signals, translate or handle events; move this into a computed()
  signal or a pipe."

- [ ] **Step 1: Write failing tests** with option `{ allowedFunctions: [ 't',
      'e', 'root' ] }`. Valid: `{{ label() }}`, `{{ viewMode.editorShown() }}`,
      `{{ t('key') }}`, `{{ e(reason()) }}`, `{{ root('a.b') }}`, `<button
      (click)="save(item)">`, `<button (click)="ref.close(); x.set(1)">`, `{{
      value | date: 'short' }}`, `@if (user(); as u) {}`, `<x [(value)]="v" />`.
      Invalid (one `call` error each): `{{ value(token, scheme) }}`, `@let x =
      error('issuer');`, `{{ list().join(' + ') }}`, `{{
      key(option.value)?.fingerprint }}`, `<a [title]="format(x)">`, `{{
      l('key') }}`, `@if (isOpen(id)) {}`, `{{ fn?.(a) }}`, `@for (i of items();
      track id(i)) {}`.

- [ ] **Step 2: Run** `npx nx run lint-rules:test` — Expected: FAIL.

- [ ] **Step 3: Implement.** Report `Call` and `SafeCall` nodes with at least
      one argument, unless an ancestor (via `parent`) is a `BoundEvent`, or the
      callee is a `PropertyRead` on an `ImplicitReceiver` whose name is in
      `allowedFunctions`. Zero-argument calls pass (signal reads; the skill
      covers zero-argument methods, which lint cannot tell apart).

- [ ] **Step 4: Run** tests and `npx nx run lint-rules:lint` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add no-template-calls lint rule"`.

### Task 3: Shared template config and the opt-in check

**Files:**

- Create: `tools/lint-rules/src/angular-templates.config.mjs`
- Test: `tools/lint-rules/src/angular-templates.config.spec.mjs`
- Modify: `tools/lint-rules/README.md` (how to opt in)

**Interfaces:**

- Consumes: the plugin (Tasks 1–2).
- Produces: `export default` a flat-config array. Angular projects opt in by
  `import angularTemplates from
  '../../tools/lint-rules/src/angular-templates.config.mjs';` (path relative to
  the project) and spreading `...angularTemplates` **after** `...baseConfig` and
  before the project's own `**/*.html` block.

- [ ] **Step 1: Write failing tests.** Lint with ESLint's `ESLint` class,
      `overrideConfigFile: true`, `overrideConfig: [
      ...nx.configs['flat/angular'], ...nx.configs['flat/angular-template'],
      ...angularTemplates ]` (`nx` from `@nx/eslint-plugin`), using
      `lintText(code, { filePath })`:
  - `x.component.html` with `{{ fmt(a) }}`, `$any(a)`, `*ngIf="a"`, `<img
    src="a">` → reports `front-burner/no-template-calls`,
    `@angular-eslint/template/no-any`, `…/prefer-control-flow`, `…/alt-text`,
    all severity 2.
  - `x.component.ts` with an inline `template:` containing `{{ fmt(a) }}` →
    reports `no-template-calls` (inline templates are covered).
  - The same `.ts` text with `filePath` `x.spec.ts`, template also holding `<a
    href="x" class="y">`, `$any(a)` and `*ngIf` → reports only
    `attribute-layout` and `prefer-control-flow`.
  - An `.html` file under `src/testing/` → same as spec hosts.
  - **Opt-in check:** every `eslint.config.mjs` in the workspace (found with
    `git ls-files`) whose text contains `flat/angular-template` also imports
    `angular-templates.config.mjs`. This test is expected to fail until Task 8;
    mark it `it.todo`/`it.skip` now with a comment pointing at Task 8, which
    turns it on.

- [ ] **Step 2: Run** `npx nx run lint-rules:test` — Expected: FAIL.

- [ ] **Step 3: Implement the config.** Block 1, `files: [ '**/*.html' ]`,
      `plugins: { 'front-burner': plugin }`, all `'error'`:
      `front-burner/attribute-layout`, `front-burner/no-template-calls` with `{
      allowedFunctions: [ 't', 'e', 'root' ] }`, and
      `@angular-eslint/template/`: `no-any`, `prefer-control-flow`,
      `banana-in-box`, `eqeqeq`, `prefer-self-closing-tags`, `alt-text`,
      `elements-content`, `label-has-associated-control`,
      `click-events-have-key-events`, `interactive-supports-focus`,
      `role-has-required-aria`, `valid-aria`, `no-autofocus`, `table-scope`,
      `no-negated-async`, `no-interpolation-in-attributes`. Block 2, `files`
      matching spec-host inline templates (the virtual file names
      angular-eslint's inline-template processor gives `*.spec.ts` files;
      confirm the pattern with the test) and `**/testing/**/*.html`: turn off
      every rule of block 1 except `attribute-layout` and `prefer-control-flow`.
      Check each rule against `docs/architecture/non-functional.md`
      (accessibility) and the `@angular-eslint/template` 22.6 rule list; if one
      must be dropped, write the reason in a comment and in the PR.

- [ ] **Step 4: Run** tests and lint — Expected: PASS (opt-in check skipped).

- [ ] **Step 5: Commit** — `git commit -m "Add shared Angular template lint
      config"`.

### Task 4: The `angular-templates` skill

**Files:**

- Create: `.claude/skills/angular-templates/SKILL.md`
- Create: `.junie/skills/angular-templates/SKILL.md` (identical copy)
- Modify: `.claude/skills/development-workflow/SKILL.md` and its `.junie` copy
  (step 4: "When you create or change a template (`.html` or inline
  `template:`), load the `angular-templates` skill."; step 5/verification: run
  `npx nx run <project>:lint --fix` on changed Angular projects)
- Modify: `CLAUDE.md` and `AGENTS.md` skill lists (one line each)

**Interfaces:**

- Consumes: rule names and the opt-in import from Tasks 1–3.

- [ ] **Step 1: Write the skill.** Frontmatter `name: angular-templates`;
      `description` says to use it whenever creating or changing an Angular
      template, `.html` or inline. Body, one short section per rule with its
      reason and a bad/good example, each marked **lint** or **judgement**:
      `@let` (narrowing and readability, not performance; only when read more
      than once or narrowed); two-way bindings (one-way by default, `model()`
      for form-like controls and own form state; good example uses
      `(selectionChanged)="updateSelection($event)"`); no calls (signals,
      `t`/`e`/`root`, event handlers only; zero-argument methods are a judgement
      call lint misses); Transloco aliases `t`/`e`/`root`; `track` by identity;
      one call per event handler; `[class.x]`/`[style.x]` over
      `ngClass`/`ngStyle`; complex conditions into `computed()`; accessibility
      basics and the false-positive comment form; attribute layout (with the
      spec's example) and "run `lint --fix`"; new Angular projects must spread
      the shared config (the opt-in check enforces it).

- [ ] **Step 2: Check it.** Dispatch a fresh subagent with only the skill and
      `libs/web/shell/src/**/app-header.component.html` (or any small template)
      and ask it to list what it would change; confirm the list matches the
      rules and contains no performance claim about signals.

- [ ] **Step 3: Commit** — `git commit -m "Add angular-templates skill"`.

### Task 5: Migrate `libs/ui`

**Files:**

- Modify: `libs/ui/eslint.config.mjs` (opt in)
- Modify: `libs/ui/src/**/*.html`, the 4 components with inline templates, spec
  hosts that fail `attribute-layout`/`prefer-control-flow`, their
  `.ts`/`.spec.ts` where logic moves into `computed()` or pipes

**Interfaces:**

- Consumes: shared config (Task 3), skill (Task 4 — load it).

- [ ] **Step 1: Baseline screenshots before any change.** `npx nx run
      ui:build-storybook`, then with the `ai-tools` `story` tool (`story list`,
      then `story shot <all ids> --theme light,dark`) save PNGs to
      `<scratchpad>/ui-before/`.

- [ ] **Step 2: Opt in** and run `npx nx run ui:lint` — Expected: errors. Note
      the count per rule.

- [ ] **Step 3: Autofix** with `npx nx run ui:lint --fix`; run `npx nx run
      ui:test` — Expected: PASS.

- [ ] **Step 4: Fix the rest by hand.** For each finding that can change
      behaviour (a call moved to `computed()`/pipe, a two-way binding replaced,
      a `track` changed, an accessibility fix), first check the component's spec
      covers it and add a failing or characterising test where it does not; then
      fix. Accessibility fixes that change behaviour (known: the field label,
      the tree) get a test of the new keyboard/focus behaviour and are listed
      for the PR. False positives get the one-line disable with the reason.

- [ ] **Step 5: Screenshots after.** Rebuild Storybook, shoot the same ids to
      `<scratchpad>/ui-after/`, compare by SHA-256; open every differing pair
      and confirm each difference is an intended accessibility change (list it)
      or fix it.

- [ ] **Step 6: Verify** with `npx nx affected -t
      typecheck,lint,test,build,size-check` — Expected: PASS. Format per
      `development-workflow`.

- [ ] **Step 7: Commit** — `git commit -m "Apply template rules to ui"`.

### Task 6: Migrate the smaller web libraries

`libs/web/feature-auth`, `feature-dashboard`, `feature-preferences`,
`feature-repositories`, `markdown`, `shell`, and `apps/web`.

**Files:**

- Modify: each project's `eslint.config.mjs` (opt in) and its templates,
  components and specs as needed

- [ ] **Step 1–4:** As Task 5 steps 2–4 for each project. These have no stories;
      where an accessibility fix is visible, take a before/after screenshot of
      the running app (the `run` skill) and list it for the PR. Rewrite the
      `@let …Error = error('…')` calls in the OIDC setup step into `computed()`
      signals.
- [ ] **Step 5: Verify** as Task 5 step 6.
- [ ] **Step 6: Commit** — one commit per project, `Apply template rules to
      <project>`.

### Task 7: Migrate `web-repository-dialogs` and `web-feature-repository-screen`

**Files:**

- Modify: `libs/web/repository-dialogs/**`,
  `libs/web/feature-repository-screen/**` (configs, templates, components,
  specs)
- Modify: `commit-author-form.component.html` (`let l`) and
  `repository-credentials.dialog.html` (`let h`): use `t`/`e`/`root` instead,
  for example `root` with full keys

- [ ] **Step 1–4:** As Task 6 for each project. Known: the `stopPropagation`
      click in `file-tree.component.html`, the `key(option.value)?.fingerprint`
      read, and the two aliases above.
- [ ] **Step 5: Verify** as Task 5 step 6.
- [ ] **Step 6: Commit** — one commit per project.

### Task 8: Turn on the opt-in check and finish

**Files:**

- Modify: `tools/lint-rules/src/angular-templates.config.spec.mjs` (enable the
  opt-in test)
- Modify: any Angular project config still missing the opt-in (`web-api-client`,
  `web-code-editor`, `web-core` have no templates but use
  `flat/angular-template`, so they opt in too)

- [ ] **Step 1: Enable the opt-in test**; run `npx nx run lint-rules:test` —
      Expected: FAIL listing the remaining projects.
- [ ] **Step 2: Opt them in**; run it again — Expected: PASS.
- [ ] **Step 3: Check generator output.** Generate a throwaway component with
      the `toolkit-nx` skill in `libs/web/shell`, run `npx nx run
      web-shell:lint`; if the generated template fails, note it for the PR (the
      generator lives in `@hexmode/toolkit-nx`), then delete the throwaway
      files.
- [ ] **Step 4: Verify the whole workspace**: `npx nx run-many -t
      typecheck,lint,test,build,size-check`, `npm run check:tags`, `npm run
      check:vitest` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Require template rules in every
      Angular project"`. The PR description lists every behaviour-changing
      accessibility fix with its screenshots, every disabled line with its
      reason, and any dropped rule.
