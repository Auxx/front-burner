# Verification

Nx runs tasks ("targets") such as `typecheck`, `lint`, `test` and `build`
defined for each project. To see which targets a project has, get its details as
described in the `workspace` skill.

## While iterating

Run targets only for the project you are changing to get fast feedback:

```shell
npx nx run <project-name>:<target-name>
```

For example:

```shell
npx nx run ui:typecheck
npx nx run ui:test
npx nx run ui:lint
```

## Before finishing

A change can break other projects that depend on the one you edited. Before
reporting the task as done, run the checks below, which CI
(`.github/workflows/ci.yml`) also runs. CI runs `test-storybook` and `e2e` too;
they take too long to run locally, so leave them to CI.

Run the workspace checks:

```shell
npm run check:tags
npm run check:vitest
```

Run these targets for every project affected by your changes:

```shell
npx nx affected -t typecheck,lint,test,build,size-check
```

Projects without a given target are skipped, so it is safe to list them all.

If `affected` cannot determine changes (for example, there is no git history or
base branch to compare against), run the targets for all projects instead:

```shell
npx nx run-many -t typecheck,lint,test,build,size-check
```

CI runs `test` one project at a time, because timing tests can miss their limits
under load. If only such a test fails, try it one project at a time before
treating it as a real failure: `npx nx affected -t test --parallel=1`.

### API client drift

The OpenAPI document and the web client generated from it are committed, and CI
fails if regenerating them changes anything. Regenerate them, then list what
changed:

```shell
npx nx run web-api-client:generate
git status --porcelain -- apps/server/openapi.json libs/web/api-client/src/generated
```

If your change touches the API, include the regenerated files in it. Otherwise
the list must be empty.

### Dependency scan

CI also scans production dependencies in `package-lock.json` with Trivy. You do
not need to run it locally, but if you change dependencies, say in your report
that the scan will run on them. Accepted findings go in `.trivyignore`, with a
reason and a review date.

## Format the code

Run the formatter after verification passes. CI fails on unformatted files,
using `npm run format:check`. If `package.json` defines a `format` script, use
it:

```shell
npm run format
```

Otherwise, use the Nx formatter:

```shell
npx nx format:write
```

If formatting changed any files, run lint again for the affected projects, since
lint rules may depend on formatting:

```shell
npx nx affected -t lint
```
