# Verification

Nx runs tasks ("targets") such as `lint`, `test` and `build` defined for each
project. To see which targets a project has, get its details as described in the
`workspace` skill.

## While iterating

Run targets only for the project you are changing to get fast feedback:

```shell
npx nx run <project-name>:<target-name>
```

For example:

```shell
npx nx run shared-ui:test
npx nx run shared-ui:lint
```

## Before finishing

A change can break other projects that depend on the one you edited. Before
reporting the task as done, run lint, test and build for every project affected
by your changes:

```shell
npx nx affected -t lint,test,build
```

Projects without a given target are skipped, so it is safe to list all three.

If `affected` cannot determine changes (for example, there is no git history or
base branch to compare against), run the targets for all projects instead:

```shell
npx nx run-many -t lint,test,build
```

## Format the code

Run the formatter after verification passes. If `package.json` defines a
`format` script, use it:

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
