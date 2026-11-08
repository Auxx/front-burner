# Front Burner

This is a NX monorepo for **Front Burner** application. **Front Burner** is a
self-hosted web application that allows users to manage and edit their Markdown
file inside git repositories. It uses NestJS for backend and Angular for
frontend.

## Always-relevant context

@docs/product/glossary.md

## Knowledge base (read when relevant)

- Product vision: `docs/product/vision.md` - describes the product's purpose,
  goals, and long-term direction.
- MVP: `docs/product/mvp.md` - the scope of the first release (which points and
  acceptance criteria of each requirement are in it, limited or deferred) and
  its implementation status.
- Requirements: `docs/requirements/` - might have multiple files per area, IDs
  REQ-<AREA>-NNN, acceptance criteria AC-<AREA>-NNN.N. These are the source of
  truth for behavior.
- Architecture decisions: `docs/architecture/decisions.md` - product and
  technical decisions not yet written up as requirements (IDs D-x.y).
- Non-functional requirements: `docs/architecture/non-functional.md` - scale,
  performance, storage, backup, upgrades, secrets, resilience, observability,
  security baseline, browser support, accessibility, localisation (IDs NF-x.y).
- Architecture: `docs/architecture/overview.md` - entry point to the
  architecture documents (module map, API, data, git engine, jobs, security, web
  client, spikes, design system; IDs A-x.y).

## Editing files

Change files with the `Edit` tool (with `replace_all` for repeated text, and
parallel calls for several files), or with `Write` for new files and full
rewrites. Never use Python, `sed`, `awk` or heredoc scripts to change files:
script edits are harder to review, bypass the harness's file tracking and can
fail silently. If an `Edit` fails, fix the cause (read the file first, or add
more surrounding text to make the match unique) instead of falling back to a
script. The command-line tools from the `ai-tools` skill, such as the doc ID
renumbering tool, are the exception: they are the intended way to do those
jobs.

<!-- @hexmode/toolkit-nx:start -->

This is an Nx monorepo. Agent skills for working in it are provided by
`@hexmode/toolkit-nx`.

**Before writing or changing any code, load the `development-workflow` skill and
follow it.**

**When a change implements any part of the MVP, update the "Implementation
status" section of `docs/product/mvp.md` in the same change, as its "Keeping it
up to date" note describes.**

Available skills:

- `development-workflow` - the process for any code change: explore, scaffold,
  implement, verify, format, report.
- `workspace` - how the workspace is organised and how to explore it.
- `toolkit-nx` - code generators for new Angular artefacts.
- `angular-templates` - the rules for Angular templates (`.html` and inline),
  which lint enforces and which are judgement calls.
- `ai-tools` - command-line tools in `tools/ai-tools` for colour and contrast,
  design tokens, Storybook screenshots, icons and doc IDs. **Load it before
  writing any one-off script**, and use it to add a tool when none fits.

<!-- @hexmode/toolkit-nx:end -->
