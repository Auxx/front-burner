---
name: ai-tools
description: |
  Ready-made command-line tools for jobs that would otherwise need a
  throwaway script: colour conversion and contrast, design token checks,
  Storybook screenshots and page probes, icon lookup, and checking or
  renumbering requirement and architecture IDs in the docs. Use BEFORE writing
  any one-off script (node -e, python, a heredoc in the scratchpad) to compute,
  check or rewrite something in this workspace, and when a task needs a tool
  that does not exist yet: this skill says how to add one.
---

The workspace has a project of tools written for the agent: `tools/ai-tools` (Nx
project `ai-tools`). Each tool is a small command-line program with a few
commands. They replace scripts that were otherwise written, run once and
deleted, again and again.

Every tool and command is described in
[references/tools.md](references/tools.md). Read it to find the right tool.

## Use a tool

1. Look for a tool in [references/tools.md](references/tools.md) before you
   write a script. If one does almost what you need, extend it (see "Add or
   change a tool") rather than writing a script next to it.
2. Run it from the workspace root:

   ```shell
   node tools/ai-tools/src/bin/<tool>.mjs <command> [arguments] [options]
   ```

   `--help` after a tool lists its commands; after a command it explains its
   arguments and options.
3. Read the result:
   - Output is plain text for reading. `--json` prints JSON instead, for when
     the result feeds another step.
   - Exit code 0 means success, 1 means a check failed or an error occurred (the
     message says which), and 2 means the command line was wrong (the usage is
     printed).
   - Some tools warn on stderr, for example when the build they read is older
     than the sources. Act on the warning before trusting the result.

Rules that hold for every tool:

- **Paths stay in the workspace.** Every path a tool reads or writes is resolved
  from the workspace root and refused if it, or a symbolic link on the way,
  leads outside. Write output to `tmp/` (ignored by git); tools that write files
  default to `tmp/ai-tools/`.
- **Tools that change files print the changes first.** They write only with
  `--write`. Check what they would do before you rerun them with it.
- **A tool's answer is not the check of record** when a real one exists, such as
  a story test in the browser. The tool's description says when to confirm its
  result elsewhere.

## Add or change a tool

Add a tool when you are about to write a script that you, or a later session,
would write again: anything general enough to have arguments. A truly one-off
step, such as a single edit, is still done with the normal editing tools.

The project is plain JavaScript (ES modules, `.mjs`), with no build step:

```text
tools/ai-tools/
  project.json            lint and test targets; implicit dependency on ui
  vitest.config.mjs
  src/
    bin/<tool>.mjs        entry point: commands, options, output only
    lib/<tool>.mjs        the logic, as pure functions where possible
    lib/<tool>.spec.mjs   Vitest specs of the logic
    lib/cli.mjs           runCli/main, print, table, UsageError
    lib/workspace.mjs     WORKSPACE_ROOT, resolveInWorkspace, workspacePath
```

1. **Put logic in `src/lib/`, the command line in `src/bin/`.** An entry point
   calls `main({ name, summary, commands })` from `cli.mjs`. Each command has
   `usage`, `summary`, optional `help`, `options` (a `node:util` `parseArgs`
   options object) and `run(values, positionals)`, which prints its output and
   returns the exit code. Throw `UsageError` for a wrong command line. Offer
   `--json` on every command whose output could feed another step. Extend an
   existing tool with a new command when the job belongs to it.
2. **Guard every path.** Any path that comes from an argument, a file or a
   request goes through `resolveInWorkspace()` before it is read or written,
   with `root` narrowed when the tool should stay inside a smaller folder (as
   the Storybook server does). Do not follow symbolic links when walking
   folders. Turn names into paths only after checking them against a known list,
   never by joining them as they are.
3. **Change nothing without `--write`.** A tool that edits files prints the
   changes and writes only with `--write`, and refuses changes that would clash
   (such as two IDs ending up with the same number).
4. **Read the workspace's sources; do not copy them.** Import or parse the real
   files (token SCSS, models, docs) so that the tool cannot fall behind them.
   Parsers throw on input they do not understand rather than skipping it, so a
   change of format fails loudly.
5. **Test it.** Write specs for the logic next to it, with fixtures written to a
   `mkdtempSync()` folder under `tmp/` and removed afterwards. Test the path
   guards with `..`, absolute paths and symbolic links. A spec may also check
   the workspace's real files, as `ui-contrast.spec.mjs` checks the contrast
   pairs; `ai-tools` has an implicit dependency on `ui` so that Nx runs it when
   `ui` changes. Add other implicit dependencies in `project.json` when a spec
   reads another project.
6. **Dependencies.** Prefer Node's standard library and packages the workspace
   already has. A new package is a root `devDependency`, pinned to an exact
   version.
7. **Verify and format** as the `development-workflow` skill describes: `npx nx
   run ai-tools:lint`, `npx nx run ai-tools:test`, then `npx dprint fmt` on the
   changed files.
8. **Document it.** Add or update the tool's section in
   [references/tools.md](references/tools.md), in the same change as the code.
   This file (`SKILL.md`) stays generic: change it only when the way all tools
   work changes.

## Maintain the tools

- When a tool's result looks wrong, fix the tool rather than working around it
  with a script, and add a spec for the case.
- When a source a tool reads changes format (a token file, a model, the
  structure of the docs), its parser fails with a message naming the file and
  line. Update the parser and its specs.
- When a tool is calibrated against a real check, such as the contrast margin
  against the Storybook token page, the reference describes how to recheck it.
  Recheck after changing how that real check measures.
- Remove a tool or command that is no longer needed, together with its specs and
  its section in the reference.
