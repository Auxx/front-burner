# Storybook stories

The component and page generators accept `--storybook=true`. It adds a
`<name>.<type>.stories.ts` file next to the component, with a `Primary` story
that renders the component by its selector.

`--storybook` defaults to `false`: without it, no stories file is created.

## When to use it

Use `--storybook=true` when the project already uses Storybook: it has a
`.storybook/` folder in its `root`, or a `storybook` target (see the `workspace`
skill for how to get project details), or existing artefacts in the feature have
`.stories.ts` files. Otherwise, leave it off.

## Requirements

- `storybook` and `@storybook/angular` must be listed in `dependencies` or
  `devDependencies` of the workspace `package.json`. If either is missing, the
  generator fails with `Dependency "<name>" is not installed.` and creates no
  files.

## If Storybook is missing

Do NOT install or configure Storybook on your own. Generate the artefact without
`--storybook`, or ask the user whether Storybook should be added to the
workspace.
