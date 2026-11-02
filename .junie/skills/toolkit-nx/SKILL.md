---
name: toolkit-nx
description: |
  Required workflow for adding ANY new Angular artefact (feature, page, component,
  dialog, service, pipe, directive) to an Angular application or library in
  this Nx workspace, using the @hexmode/toolkit-nx generators. Use whenever you
  are about to create a new .ts/.html/.scss Angular file, whether the user asked
  for it directly ("add a component", "create a service") or it is a step in a
  larger task ("build a settings screen", "add an orders feature"). Use instead
  of `nx g @nx/angular:*`, `ng generate`, or hand-writing these files. Also
  covers how to write artefacts that have no generator (guards, resolvers,
  interceptors, models).
---

`@hexmode/toolkit-nx` contains a set of code generators, which help scaffold new
components, features, pages, dialogs, pipes, directives, and services. They
ensure consistency across the codebase and reduce boilerplate work. These code
generators SHOULD be used every time a new Angular artefact needs to be created.

Do NOT use `nx g @nx/angular:*` or `ng generate`.

# Using @hexmode/toolkit-nx generators

## Commands

| Artefact  | Command                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| feature   | `npx nx g @hexmode/toolkit-nx:feature --project=<project> --name=<feature>`                                  |
| page      | `npx nx g @hexmode/toolkit-nx:page --project=<project> --feature=<feature> --name=<name>`                    |
| component | `npx nx g @hexmode/toolkit-nx:component --project=<project> --feature=<feature> --name=<name>`               |
| dialog    | `npx nx g @hexmode/toolkit-nx:component --project=<project> --feature=<feature> --name=<name> --type=dialog` |
| service   | `npx nx g @hexmode/toolkit-nx:service --project=<project> --feature=<feature> --name=<name>`                 |
| pipe      | `npx nx g @hexmode/toolkit-nx:pipe --project=<project> --feature=<feature> --name=<name>`                    |
| directive | `npx nx g @hexmode/toolkit-nx:directive --project=<project> --feature=<feature> --name=<name>`               |

Optional arguments for pages, components and dialogs: `--translations=true` (see
[Translations](#translations)) and `--storybook=true` (see
[Storybook](#storybook)).

## Arguments

- `--project`: the exact project name from `npx nx show projects --json`. Pass
  it unchanged, do NOT convert it to kebab-case: names such as `myApp` or
  `@org/shop` are valid.
- `--feature` and `--name`: kebab-case, for example `user-profile`. The
  generators convert names to kebab-case for folders and files anyway, but
  kebab-case input keeps the names in your report and in the output identical.
- The feature must exist before you create a page, component, dialog, service,
  pipe or directive in it. If it does not, create it with the feature generator
  first and read [create-feature.md](references/create-feature.md) - it explains
  how the feature is wired into the routes.
- Resolve the project and feature from the request and the workspace (see the
  `workspace` skill). Ask the user only if they cannot be determined.

## Steps

1. Run the command with `--no-interactive --dry-run` appended.
   `--no-interactive` prevents prompts that would hang execution.
2. Check the output as described in [Dry run](#dry-run).
3. Run the same command again with `--no-interactive` only.

## Pages

Use the page generator for pages, never `component --type=page`: it creates the
page files but does not register a route.

The page generator registers a route for the page in `<feature>.routes.ts` (or
in `app.routes.ts` for the `app` feature), before the wildcard route (`path:
'**'`) if there is one - there is no need to add it manually. The page is
reachable at `/<feature>/<name>`.

## Translations

Components, dialogs and pages can include Transloco boilerplate with
`--translations=true`. It requires `@jsverse/transloco` to be installed and
configured; read [translations.md](references/translations.md) before using it.

## Storybook

Components, dialogs and pages get a `.stories.ts` file only with
`--storybook=true`. It requires `storybook` and `@storybook/angular` to be
installed; read [storybook.md](references/storybook.md) before using it.

## Applications and libraries

All generators work the same way in Angular applications and Angular libraries:
pass the project name as `--project`, whatever its type. The differences are in
how the result is used, not in how it is generated:

- Libraries have no `app` feature, so a new feature is not wired into any routes
  automatically. Expose it through the library's public API instead - see
  [create-feature.md](references/create-feature.md#features-in-libraries).
- Artefacts that other projects use must be exported from the library's entry
  point (usually `<sourceRoot>/index.ts`).
- Selectors use the project's `prefix` from `project.json` (`app` by default,
  often `lib` in libraries).

## Dry run

Always run a generator with `--dry-run` first. A dry run does everything a real
run does - validates the arguments, checks that the feature and dependencies
exist, computes every file - but writes nothing. It prints the planned changes
and ends with `NOTE: The "dryRun" flag means no changes were made.` Run the
generator for real only when the dry-run output is what you expect; the real run
prints the same lines.

Read the output line by line:

- `CREATE <path>` - a new file. Check that the path follows the feature layout
  from the "Angular project structure" section of the `workspace` skill:
  `<sourceRoot>/<feature>/<type-folder>/<name>/<name>.<type>.<ext>`, with
  kebab-case names.
- `UPDATE <path>` - an existing file will be changed. This is expected only for
  routes files: `<feature>.routes.ts` (page generator) and `app/app.routes.ts`
  (feature generator, or page generator in the `app` feature). An `UPDATE` on
  any other file is unexpected: stop and tell the user instead of running the
  generator.
- `NX <message>` and exit code 1 - the generator failed and nothing was
  generated. Look the message up in [Errors](#errors).

Expected output for each generator (`[]` marks optional files):

| Generator                      | Expected lines                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `feature`                      | `CREATE <feature>/<feature>.routes.ts`, `UPDATE app/app.routes.ts` (applications only)                                                  |
| `page`                         | `CREATE` `.page.ts`, `.page.html`, `.page.scss`, `.page.spec.ts`, [`.page.stories.ts`] in `pages/<name>/`, `UPDATE <feature>.routes.ts` |
| `component`                    | `CREATE` `.component.ts`, `.html`, `.scss`, `.spec.ts`, [`.stories.ts`] in `components/<name>/`                                         |
| `component --type=dialog`      | `CREATE` `.dialog.ts`, `.html`, `.scss`, `.spec.ts`, [`.stories.ts`] in `dialogs/<name>/`                                               |
| `service`, `pipe`, `directive` | `CREATE` `.<type>.ts` and `.<type>.spec.ts` in `services/`, `pipes/` or `directives/<name>/`                                            |

## Errors

When a generator fails, it prints `NX <message>`, exits with code 1 and writes
nothing - Nx discards all changes of a failed run, so there is nothing to clean
up. Fix the cause and run the dry run again.

| Message                                                                                  | Meaning and what to do                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find configuration for '<project>'`                                              | No project with this name. Get the exact name from `npx nx show projects --json` and pass it unchanged as `--project`.                                                                                                                                                                                                                                    |
| `No source folder for "<project>"`                                                       | The project has no `sourceRoot` in its configuration, so the generators cannot place files. Tell the user; do not edit the project configuration on your own.                                                                                                                                                                                             |
| `Feature "<feature>" does not exist.`                                                    | Run the feature generator first. Check the spelling too: names are converted to kebab-case, so `--feature=userProfile` means folder `user-profile`.                                                                                                                                                                                                       |
| `<Type> "<name>" already exists in feature "<feature>" (<path>).`                        | An artefact of this type and name is already in the feature (`<Type>` is `Component`, `Page`, `Dialog`, `Service`, `Pipe` or `Directive`). Generators never overwrite existing artefacts. Edit the existing one, or pick another name if you really need a second artefact. Names are compared in kebab-case, so `userList` and `user-list` are the same. |
| `Feature "<feature>" already exists.`                                                    | The feature is already there (`app` always exists in applications). Skip the feature generator and use the existing feature.                                                                                                                                                                                                                              |
| `Dependency "<package>" is not installed. It is required for ...`                        | An option needs a package the workspace does not have. See [translations.md](references/translations.md) or [storybook.md](references/storybook.md). Do not install it on your own.                                                                                                                                                                       |
| `No routes array of type Route[] or Routes found in "<path>". Page ... was not created.` | The page generator cannot find the routes array in the routes file. Restore an exported `Route[]` or `Routes` array in that file, or ask the user, then run again.                                                                                                                                                                                        |
| `Required property '<option>' is missing`                                                | A required option is missing. Pass it explicitly; with `--no-interactive` the generator never prompts.                                                                                                                                                                                                                                                    |
| `Property '<option>' does not match the schema. ...`                                     | Invalid option value. For example, `--type` accepts only `component`, `page` and `dialog`; for other artefact types see [Artefacts without a generator](#artefacts-without-a-generator).                                                                                                                                                                  |
| `Malformed block: ...`                                                                   | Only from the `skills` generator: the toolkit block markers in `AGENTS.md` or `CLAUDE.md` are broken. Tell the user.                                                                                                                                                                                                                                      |

The feature generator can also print a warning and still succeed (exit code 0):
`"<path>" does not exist. Add the routes of feature ... manually.` or `No routes
array ... Add the routes of feature ... manually.` The feature was created but
not wired into any routes - see
[create-feature.md](references/create-feature.md).

## Artefacts without a generator

The generators cover features, pages, components, dialogs, services, pipes and
directives only. For anything else, write the code manually. Examples: guards,
resolvers, interceptors, validators, models and interfaces, constants, utility
functions, and edits to existing files such as `<feature>.routes.ts` or
`app.config.ts`.

When writing an artefact manually:

- Do NOT disguise it as a generated artefact (for example, a guard generated as
  a service and then rewritten), and do NOT fall back to `nx g @nx/angular:*` or
  `ng generate`.
- Find an existing artefact of the same type in the workspace and match its
  location, naming and style (for example, functional `CanActivateFn` guards
  versus class-based ones).
- If there is none, follow the feature layout from the `workspace` skill: put it
  in the feature that owns it, in a plural type folder, with kebab-case names
  and the type as suffix, for example `<feature>/guards/<name>/<name>.guard.ts`.
  Shared models that do not belong to one artefact go in
  `<feature>/models/<name>.model.ts`.
- Add a `.spec.ts` next to it, as the generators do.
- Wire it in yourself (routes, providers, imports) - nothing does it for you.
- In your report, say which files you wrote manually and why no generator was
  used.

## After generating

Generated code is only a starting point. Continue with the
`development-workflow` skill to implement the requested functionality, verify,
and format the code.
