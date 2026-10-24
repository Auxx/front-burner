---
name: workspace
description: |
  How this Nx monorepo is organised and how to explore it. Use BEFORE writing
  or changing code in this workspace: to find which project/feature owns
  something, where a new file should go, which targets a project has, or how
  projects depend on each other. Use instead of guessing paths or browsing
  directories blindly.
---

This is a monorepo workspace managed by NX. It is composed of multiple
application and library projects, each with its own set of files and
dependencies. Use this skill to navigate and explore the workspace and
understand how the projects are organised and interconnected. The overall
process for changing code is described in the `development-workflow` skill.

## Exploration workflow

1. `npx nx show projects --json` to find candidate projects. Ignore the root
   project which matches the package name specified in `package.json`.
2. `npx nx show project <project> --json` to get `root`, `sourceRoot` and the
   target executors (this also tells you whether the project is Angular).
3. List `<sourceRoot>` to see which features exist. Reuse an existing feature
   before creating a new one. In applications, `app` is also a feature, for
   app-wide artefacts only (see "The `app` feature" below).
4. Read one or two existing artefacts of the same type in that feature (and
   `<feature>.routes.ts`, and `app.routes.ts` for how features are wired in).
   Match their conventions.
5. Check dependencies with `npx nx graph --print` (and `tsconfig.base.json`
   paths for library import aliases) before importing across projects.
6. To create artefacts, use the `toolkit-nx` skill.

## List all projects

Use `npx nx show projects --json` command to list all projects in the workspace.
It returns all projects, both application and library, as a list in JSON format.

Example output:

```json
["my-app","shared-ui","@my-workspace/source"]
```

This example output indicates that there are three projects in the workspace:
`shared-ui`, `my-app`, and `@my-workspace/source`. Note that a project with a
name format `@<workspace>/source` matches the package name in `package.json` -
this is a root project, ignore it.

The list of projects will change over time depending on the requirements and
implementation details.

The list can be additionally filtered by project type using the `--type` option
which accepts `app` for applications and `lib` for libraries. For example, to
list only application projects, use the following command:

```shell
npx nx show projects --type app --json
```

It is also possible to list only projects that were affected by the code changes
using the `--affected` option. For example:

```shell
npx nx show projects --affected --json
```

## Workspace dependency graph

`npx nx graph --print` prints the project graph as JSON (`nx graph` has no
`--json` option; `--print` is its JSON output and never opens a browser). The
part that matters is `graph.dependencies`: a map from each project name to the
projects it depends on (`[{ "source": "a", "target": "b", "type": "static" }]`).
Ignore `graph.nodes`, which repeats every project's full configuration.

## Get project details

To get details about a specific project, use the `npx nx show project
<project-name> --json` command. Replace `<project-name>` with the name of the
project you want to explore. This command will display information about the
project, including its location inside the workspace, dependencies, targets, and
more.

Example output:

```json
{
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "name": "shared-ui",
  "root": "libs/shared-ui",
  "sourceRoot": "libs/shared-ui/src",
  "projectType": "library",
  "targets": {
    "lint": { ... },
    "test": { ... },
    "nx-release-publish": { ... },
    "build": { ... }
  },
  "tags": ["npm:public"]
}
```

`root` element indicates the root directory of the project within the workspace.

`sourceRoot` element indicates the root directory of the source files of the
project within the workspace.

`targets` element indicates the list of targets that can be executed for the
project. Each target is associated with a specific task or action that can be
performed on the project, such as linting, testing, building, or publishing.
There are four targets in the example output: `lint`, `test`,
`nx-release-publish`, and `build`.

Different projects will have different properties listed based on their type,
configuration, and technology used. How to run targets to verify code is
described in the `development-workflow` skill.

## Angular project structure

Some projects in this workspace are Angular projects. They can be either an
Angular application or an Angular library. To detect if a project is an Angular
project, get project details from NX.

Angular projects have `targets.build.executor` property set and it contains word
`angular`. For example, `@angular/build:application` or
`@angular-devkit/build-angular:browser` for applications, and
`@nx/angular:package` or `@nx/angular:ng-packagr-lite` for libraries. Libraries
without a `build` target (non-buildable libraries) are Angular projects if other
targets use Angular executors (for example, `@nx/angular:unit-test`) or their
code imports `@angular/core`.

Angular projects are split into features, which contain artefacts like
components and services. Features might also contain routing configuration.
Applications and libraries use the same feature layout, and the `toolkit-nx`
generators work for both. Here is the directory layout of a feature:

```text
<sourceRoot>/
├── <feature-name>/
│   ├── components/
│   │   ├── <component-name>/
│   │   │   ├── <component-name>.component.ts
│   │   │   ├── <component-name>.component.html
│   │   │   ├── <component-name>.component.scss
│   │   │   ├── <component-name>.component.stories.ts
│   │   │   └── <component-name>.component.spec.ts
│   ├── dialogs/
│   │   ├── <dialog-name>/
│   │   │   ├── <dialog-name>.dialog.ts
│   │   │   ├── <dialog-name>.dialog.html
│   │   │   ├── <dialog-name>.dialog.scss
│   │   │   ├── <dialog-name>.dialog.stories.ts
│   │   │   └── <dialog-name>.dialog.spec.ts
│   ├── directives/
│   │   ├── <directive-name>/
│   │   │   ├── <directive-name>.directive.ts
│   │   │   └── <directive-name>.directive.spec.ts
│   ├── pages/
│   │   ├── <page-name>/
│   │   │   ├── <page-name>.page.ts
│   │   │   ├── <page-name>.page.html
│   │   │   ├── <page-name>.page.scss
│   │   │   ├── <page-name>.page.stories.ts
│   │   │   └── <page-name>.page.spec.ts
│   ├── pipes/
│   │   ├── <pipe-name>/
│   │   │   ├── <pipe-name>.pipe.ts
│   │   │   └── <pipe-name>.pipe.spec.ts
│   ├── services/
│   │   ├── <service-name>/
│   │   │   ├── <service-name>.service.ts
│   │   │   └── <service-name>.service.spec.ts
│   └── <feature-name>.routes.ts
└── ...
```

Files marked `.stories.ts` exist only in projects that use Storybook.

### The `app` feature

In Angular applications, folder `<sourceRoot>/app` is a feature called `app`. It
also holds the application shell created by Angular and Nx. The shell files stay
at the top level of the folder, not in `components/` or `pages/`:

```text
<sourceRoot>/
├── app/
│   ├── components/ dialogs/ pages/ ...   # app-wide artefacts, standard layout
│   ├── app.ts                            # root component (App)
│   ├── app.html
│   ├── app.scss
│   ├── app.spec.ts
│   ├── app.config.ts                     # application providers
│   └── app.routes.ts                     # application routes (appRoutes)
├── <feature-name>/
└── main.ts
```

- Do NOT move, rename or restructure the shell files, and do not create a
  feature called `app` - it already exists.
- `app.routes.ts` plays the role of `<feature-name>.routes.ts` for the `app`
  feature. The feature generator wires every new feature into it as a
  lazy-loaded route, and pages generated with `--feature=app` are registered in
  it.
- Use the `app` feature only for app-wide artefacts that no other feature owns:
  layout and navigation components (header, menu, footer), top-level pages
  (home, not found), and app-wide services, guards and interceptors. Put domain
  functionality (orders, users, settings, ...) in its own feature.

### Features in libraries

Libraries have no `app` feature and no `app.routes.ts`. Their features sit
directly under `<sourceRoot>`, next to the library's entry point (usually
`<sourceRoot>/index.ts`, the file the `tsconfig.base.json` path alias points
to). Other projects can use only what the entry point exports, so check it when
you look for an artefact, and export new artefacts from it when other projects
need them. Applications use library features through the alias, never through
relative paths into `libs/`.

In addition to components, dialogs, directives, pages, pipes, and services,
there can also be other types of artefacts, like guards and interceptors. They
have no generator and follow the same folder structure, for example
`<feature-name>/guards/<guard-name>/<guard-name>.guard.ts` (see "Artefacts
without a generator" in the `toolkit-nx` skill). Any type of artefact can be
absent in a specific feature.
