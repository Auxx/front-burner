---
name: development-workflow
description: |
  Required process for ANY task that writes or changes code in this NX
  workspace: new features, bug fixes, refactors, or edits to existing files.
  Use before making the first edit. Covers exploring the workspace,
  scaffolding new artefacts with generators, implementing the change,
  verifying it with lint/test/build, formatting, and reporting back.
---

Follow these steps for every code change in this workspace. Each step points to
the skill that holds the details; do not skip a step because the change looks
small.

## 1. Understand the task

Work out which project and feature the change belongs to. Ask the user only if
it cannot be determined from the request or the workspace.

## 2. Explore

Use the `workspace` skill to find the project and feature that own the code, and
how projects depend on each other. Read one or two existing artefacts next to
the place you are changing and match their conventions.

## 3. Scaffold new artefacts

If the change needs a new Angular artefact (feature, page, component, dialog,
service, pipe, directive), create it with the `toolkit-nx` skill. Do NOT
hand-write the boilerplate, and do NOT use `nx g @nx/angular:*` or `ng
generate`.

If there is no generator for the artefact (for example, a guard, resolver,
interceptor, model or utility function), write the code manually, following the
rules in the `toolkit-nx` skill ("Artefacts without a generator").

## 4. Implement

Modify generated or existing code to deliver the requested functionality:

- Keep changes inside the feature that owns them.
- Before importing from another project, check the dependency graph (see the
  `workspace` skill) and use the library import alias from `tsconfig.base.json`,
  not a relative path.
- Integrate with existing code patterns rather than introducing new ones.
- Update or add unit tests (`.spec.ts`) for the behaviour you changed.

## 5. Verify

Verify that the code works. Changes can break projects that depend on the one
you edited, so verifying only the artefact you touched is not enough. Read
[verification.md](references/verification.md) for the commands and when to use
each.

## 6. Format

Once the code is verified, format it as described in
[verification.md](references/verification.md#format-the-code).

## 7. Fix or escalate

If verification fails with manageable issues (a few lint errors, minor type
issues, a failing test caused by your change), fix them and verify again. If
issues are extensive, attempt obvious fixes first, then escalate to the user
with details about what was changed, what is failing, and what you have
attempted.

## 8. Report

Summarise for the user:

- What was created or changed, and where.
- Which checks were run and their results.
- Anything left unfinished or needing a decision.
