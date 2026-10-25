# CI and Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull request 1 of the walking skeleton: tag every Nx project, enforce
the A-2.4 module boundary rules, and run CI in GitHub Actions on every pull
request and push to `master`, with Dependabot proposing updates.

**Architecture:** The boundary rules live in the root `eslint.config.mjs` as
`@nx/enforce-module-boundaries` dependency constraints keyed on `scope:*` and
`type:*` tags. Nx cannot require tags, so a new `nx-tags` command in
`tools/ai-tools` checks that every project has exactly one known scope tag and
one known type tag, and CI runs it. CI is one workflow with two jobs: `checks`
(format, tags, `nx affected` targets) and `trivy` (lockfile scan).

**Tech Stack:** Nx 23.3 (`@nx/eslint-plugin`, `@nx/devkit`), ESLint 9 flat
config, Node.js 24.22.1, GitHub Actions (`actions/checkout`,
`actions/setup-node`, `nrwl/nx-set-shas`, `aquasecurity/trivy-action`),
Dependabot, Vitest (the `ai-tools` test target).

**Spec:** `docs/superpowers/specs/2026-10-25-walking-skeleton-design.md`
(sections "Projects", "CI (GitHub Actions)", "Delivery" item 1). Rules from
`docs/architecture/modules.md` A-2.4 and A-2.5, and
`docs/architecture/non-functional.md` NF-11.9 and NF-11.10.

## Global Constraints

- Work on a branch `ci-and-boundaries` off `master`. `gh` is not installed: the
  user opens the pull request by hand; finish by giving them its title and
  description.
- Format with `dprint fmt` (no Prettier). `npx dprint check` must pass.
- Node.js **24.22.1** exactly (A-1.3): every older version has a security
  vulnerability (user, 2026-10-25). `.nvmrc` pins it and `package.json`
  `engines.node` is `>=24.22.1 <25`. CI installs with `npm ci` (NF-11.9).
- No Nx Cloud.
- Every GitHub Action is pinned to a full release tag (`vX.Y.Z`), never a moving
  major such as `v4`; look up the latest release of each when writing the
  workflow. Dependabot keeps them current. _(Plan's call.)_
- Scope tags: `scope:server`, `scope:web`, `scope:shared`, plus `scope:tools`
  for workspace tooling _(plan's call: A-2 has no tooling scope; `ai-tools`
  needs one)_. Type tags: `type:app`, `type:feature`, `type:core`,
  `type:domain`, `type:data-access`, `type:ui`, `type:contracts`, `type:util`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>`.

## Review Focus

- **A new project created without tags** must fail CI, not silently escape every
  rule → Task 2 runs the check against a throwaway untagged library.
- **Two rules on one import** (scope allows it, type forbids it, as `ui`
  importing a web `type:data-access` library) must fail lint → Task 1's
  throwaway-library check covers it.
- **A shallow checkout** makes `nx affected` compare against nothing or crash →
  Task 3 uses `fetch-depth: 0` and `nrwl/nx-set-shas`.
- **Storybook browser tests in CI** fail without Chromium and its system
  libraries → Task 3 installs them with `--with-deps`.
- **Trivy failing on a dev-only dependency** would block every PR for something
  that never ships → Task 3 scans the lockfile without dev dependencies (Trivy's
  default for `package-lock.json`) and ignores unfixed findings _(plan's call:
  nothing can be done about them)_.

---

### Task 1: Tags and module boundary rules

**Files:**

- Modify: `eslint.config.mjs` (the `depConstraints` of
  `@nx/enforce-module-boundaries`)
- Modify: `libs/ui/project.json` (`tags`)
- Modify: `tools/ai-tools/project.json` (`tags`)
- Modify: `docs/architecture/modules.md` (A-2 tree and A-2.4/A-2.5)

**Interfaces:**

- Produces: the tag vocabulary in Global Constraints, used by every project
  created in pull requests 2 and 3.

- [ ] **Step 1: Branch**

```bash
git switch -c ci-and-boundaries
```

- [ ] **Step 2: Tag the existing projects**

`libs/ui/project.json`: `"tags": ["scope:web", "type:ui"]`.
`tools/ai-tools/project.json`: `"tags": ["scope:tools", "type:util"]`.

- [ ] **Step 3: Replace the `depConstraints` in `eslint.config.mjs`**

Replace the single `sourceTag: "*"` constraint with these, in this order. Nx
applies every constraint whose source tags match, so one import can be refused
by its scope rule or its type rule.

| Source                                     | Constraint                                                                  | A-2.4 rule                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `scope:shared`                             | `onlyDependOnLibsWithTags: ["scope:shared"]`                                | shared imports only shared                       |
| `scope:server`                             | `onlyDependOnLibsWithTags: ["scope:server", "scope:shared"]`                | server and web never import each other           |
| `scope:web`                                | `onlyDependOnLibsWithTags: ["scope:web", "scope:shared"]`                   | server and web never import each other           |
| `scope:tools`                              | `onlyDependOnLibsWithTags: ["*"]`                                           | tooling may read any project                     |
| `allSourceTags: [scope:server, type:core]` | `notDependOnLibsWithTags: ["type:feature"]`                                 | server core never imports features               |
| `allSourceTags: [scope:web, type:feature]` | `notDependOnLibsWithTags: ["type:feature"]`                                 | web features never import each other             |
| `type:domain`                              | `onlyDependOnLibsWithTags: ["type:data-access", "type:ui", "scope:shared"]` | domain imports only core, ui, api-client, shared |
| `type:ui`                                  | `onlyDependOnLibsWithTags: ["type:util"]`                                   | ui imports only `shared/util`                    |
| `type:contracts`                           | `onlyDependOnLibsWithTags: ["type:contracts", "type:util"]`                 | contracts stay framework-free                    |
| `type:util`                                | `onlyDependOnLibsWithTags: ["type:util"]`                                   | util is the bottom layer                         |

No project may import a `scope:tools` project: no constraint lists it, so the
scope rows already refuse it. Server feature cycles are refused by the rule's
built-in circular dependency check. Keep `enforceBuildableLibDependency` and
`allow` as they are.

The `type:util` row also constrains `ai-tools` (`scope:tools`, `type:util`). It
imports no project today; if that changes, retag it rather than loosen the row.

- [ ] **Step 4: Verify the existing projects still lint**

Run: `npx nx run-many -t lint --skip-nx-cache` Expected: success for `ui` and
`ai-tools`.

- [ ] **Step 5: Verify the rules refuse bad imports, with throwaway libraries**

Generate two plain TypeScript libraries, which are deleted again in Step 6:

```bash
npx nx g @nx/js:lib --directory=libs/tmp-server --name=tmp-server --tags=scope:server,type:core --bundler=none --unitTestRunner=none --linter=eslint --no-interactive
npx nx g @nx/js:lib --directory=libs/tmp-data --name=tmp-data --tags=scope:web,type:data-access --bundler=none --unitTestRunner=none --linter=eslint --no-interactive
```

Add one at a time to `libs/ui/src/index.ts`, run `npx nx lint ui
--skip-nx-cache`, and remove it:

1. `import '@front-burner/tmp-server';` → lint fails with an
   `@nx/enforce-module-boundaries` error that names the `scope:web` constraint.
2. `import '@front-burner/tmp-data';` → lint fails with an error that names the
   `type:ui` constraint (scope allows it, type refuses it).

Use the import paths the generator printed if they differ.

- [ ] **Step 6: Remove the throwaway libraries**

```bash
npx nx g @nx/workspace:remove tmp-server --no-interactive
npx nx g @nx/workspace:remove tmp-data --no-interactive
git status
```

Expected: `git status` shows only the changes from Steps 2 and 3 (no leftovers
in `tsconfig.base.json`, `package.json` or `libs/`). Restore by hand anything
the generators left behind.

- [ ] **Step 7: Update `docs/architecture/modules.md`**

- A-2 tree: move `ui/` out of `libs/web/` to a top-level `libs/ui/` entry,
  keeping its description, and add `tools/ai-tools/` under a `tools/` heading
  ("command-line tools for the AI agent; not imported by any project").
- A-2.5: add that `ui` is `scope:web`, `type:ui`, and that `scope:tools` exists
  for workspace tooling (`ai-tools` is `scope:tools`, `type:util`), may import
  anything, and is imported by nothing.
- A-2.4: add one line saying that every project must have exactly one `scope:`
  and one `type:` tag, and that CI checks it (`nx-tags check`, Task 2).

Run `npx dprint fmt docs/architecture/modules.md` and `node
tools/ai-tools/src/bin/doc-ids.mjs check` (expected: no problems).

- [ ] **Step 8: Commit**

```bash
git add eslint.config.mjs libs/ui/project.json tools/ai-tools/project.json docs/architecture/modules.md
git commit -m "Tag projects and enforce module boundaries (A-2.4)"
```

---

### Task 2: `nx-tags` check in `ai-tools`

**Files:**

- Create: `tools/ai-tools/src/lib/nx-tags.mjs`
- Create: `tools/ai-tools/src/lib/nx-tags.spec.mjs`
- Create: `tools/ai-tools/src/bin/nx-tags.mjs`
- Modify: `.claude/skills/ai-tools/references/tools.md` (new `## nx-tags`
  section, same shape as the others)
- Modify: `package.json` (script `"check:tags": "node
  tools/ai-tools/src/bin/nx-tags.mjs check"`)

**Interfaces:**

- Consumes: the tag vocabulary from Task 1.
- Produces:
  - `SCOPE_TAGS: readonly string[]` and `TYPE_TAGS: readonly string[]`, the
    vocabulary from Global Constraints;
  - `findTagProblems(projects: { name: string; tags: string[] }[]): { project:
    string; problem: string }[]`;
  - CLI `node tools/ai-tools/src/bin/nx-tags.mjs check [--json]`, exit code 1
    when there is any problem; `npm run check:tags` (used by CI in Task 3).

- [ ] **Step 1: Write the failing tests in `nx-tags.spec.mjs`**

Follow the style of the other `*.spec.mjs` files. Cases:

- `findTagProblems([{ name: 'ui', tags: ['scope:web', 'type:ui'] }])` → `[]`.
- No tags → one problem for `scope` and one for `type`, each naming the project.
- `['scope:web', 'scope:server', 'type:ui']` → a problem: more than one scope
  tag.
- `['scope:web', 'type:widget']` → a problem: unknown type tag `type:widget`
  (and a missing known type).
- Tags without a `scope:`/`type:` prefix, such as `npm:public`, are ignored.
- Problems are sorted by project name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx nx test ai-tools` Expected: FAIL, `nx-tags.mjs` not found.

- [ ] **Step 3: Implement `findTagProblems` and the tag lists in `nx-tags.mjs`**

Pure function, no Nx imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx nx test ai-tools` Expected: PASS, including the existing tests.

- [ ] **Step 5: Implement the CLI in `bin/nx-tags.mjs`**

Use `main` and `print` from `../lib/cli.mjs`, like `doc-ids.mjs`. Read the
projects with `createProjectGraphAsync()` from `@nx/devkit` (each node's `name`
and `data.tags`). Text output: one line per problem, then a count; or "All N
projects are tagged." with exit code 0.

- [ ] **Step 6: Verify against the workspace and an untagged project**

Run: `npm run check:tags` Expected: "All 2 projects are tagged.", exit code 0.

Then generate an untagged throwaway library, check, and remove it:

```bash
npx nx g @nx/js:lib --directory=libs/tmp-untagged --name=tmp-untagged --bundler=none --unitTestRunner=none --linter=none --no-interactive
npm run check:tags; echo "exit $?"
npx nx g @nx/workspace:remove tmp-untagged --no-interactive
git status
```

Expected: problems for `tmp-untagged` and `exit 1`; afterwards `git status`
shows only this task's files.

- [ ] **Step 7: Document the tool**

Add a `## nx-tags` section to `.claude/skills/ai-tools/references/tools.md`
(what it checks, the vocabulary, the command, that CI runs it), and add it to
the tool list in `.claude/skills/ai-tools/SKILL.md` if that file lists tools.
Run `npx dprint fmt`.

- [ ] **Step 8: Lint, format and commit**

```bash
npx nx lint ai-tools && npx dprint check
git add tools/ai-tools .claude/skills/ai-tools package.json
git commit -m "Add nx-tags check for project tags"
```

---

### Task 3: CI workflow and Dependabot

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `.nvmrc` (contents `24.22.1`)
- Modify: `package.json` (`"engines": { "node": ">=24.22.1 <25" }`)
- Modify: `README.md` (short "CI" section)

**Interfaces:**

- Consumes: `npm run check:tags` (Task 2), `npm run format:check`.
- Produces: the `checks` job's `nx affected` target list, which pull request 2
  extends (Firefox and WebKit for `web-e2e`, the API client drift check).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

- Name `CI`. Triggers: `pull_request`, and `push` to `master`.
- `permissions: contents: read` at the top level.
- `concurrency`: group `ci-${{ github.ref }}`, `cancel-in-progress: true` for
  pull requests only (pushes to `master` always finish).
- Job **`checks`** (`ubuntu-latest`):
  1. `actions/checkout` with `fetch-depth: 0`;
  2. `actions/setup-node` with `node-version-file: .nvmrc`, `cache: npm`;
  3. `npm ci`;
  4. `nrwl/nx-set-shas` (sets `NX_BASE`/`NX_HEAD`; on `master` pushes it uses
     the last successful run);
  5. `npm run format:check`;
  6. `npm run check:tags`;
  7. `npx playwright install --with-deps chromium`;
  8. `npx nx affected -t lint test build test-storybook e2e --parallel=3`. `e2e`
     has no projects yet; Nx skips a target no affected project has.
- Job **`trivy`** (`ubuntu-latest`), independent of `checks`:
  `actions/checkout`, then `aquasecurity/trivy-action` with `scan-type: fs`,
  `scan-ref: package-lock.json`, `scanners: vuln`, `severity: HIGH,CRITICAL`,
  `ignore-unfixed: true`, `exit-code: 1`. Do not pass `--include-dev-deps`, so
  only production dependencies count (NF-11.10).

- [ ] **Step 2: Write `.github/dependabot.yml`**

Version 2, two ecosystems, both `weekly` on Monday, `open-pull-requests-limit:
10`:

- `npm` at `/`, with groups so that packages released together are updated
  together: `angular` (`@angular/*`, `@angular-devkit/*`, `@analogjs/*`), `nx`
  (`nx`, `@nx/*`), `storybook` (`storybook`, `@storybook/*`), `vitest`
  (`vitest`, `@vitest/*`), `playwright` (`playwright`, `@playwright/*`).
- `github-actions` at `/`, all in one group.

- [ ] **Step 3: Validate the YAML**

Run:

```bash
node -e "for (const f of ['.github/workflows/ci.yml','.github/dependabot.yml']) require('yaml').parse(require('fs').readFileSync(f,'utf8'))" && echo YAML_OK
```

Expected: `YAML_OK`. If the `yaml` package is not installed, use `npx --yes
actionlint` when available, or `python3 -c "import yaml,sys;
[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml
.github/dependabot.yml`.

- [ ] **Step 4: Run the `checks` job's commands locally**

```bash
npm run format:check && npm run check:tags && NX_BASE=master npx nx affected -t lint test build test-storybook e2e --parallel=3
```

Expected: every command succeeds. (Trivy runs only in CI unless `trivy` is
installed locally; if it is, run `trivy fs --scanners vuln --severity
HIGH,CRITICAL --ignore-unfixed --exit-code 1 package-lock.json`.)

- [ ] **Step 5: Add a "CI" section to `README.md`**

Two or three sentences: what runs on pull requests (the job list above), that
`npm run check:tags` and `npm run format:check` can be run locally, and that
Dependabot opens weekly update pull requests.

- [ ] **Step 6: Format and commit**

```bash
npx dprint fmt && npx dprint check
git add .github .nvmrc package.json README.md
git commit -m "Add CI workflow and Dependabot"
```

---

### Task 4: Hand over the pull request

- [ ] **Step 1: Final check of the whole branch**

```bash
npx nx run-many -t lint test build test-storybook --skip-nx-cache && npm run format:check && npm run check:tags
git log --oneline master..HEAD
```

Expected: everything passes; three commits.

- [ ] **Step 2: Push only if the user asks, then give them the PR text**

Title: `CI and module boundaries`. Description: what the three commits do (tags
and A-2.4 rules, `nx-tags` check, CI and Dependabot), how to check it locally,
and that the first CI run on the pull request is the real test of the workflow.
End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
