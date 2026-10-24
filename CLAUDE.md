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
- MVP: `docs/product/mvp.md` - the scope of the first release: what is in, what
  is deferred, and which requirements are still to be written.
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
  client, spikes; IDs A-x.y).

<!-- @hexmode/toolkit-nx:start -->

This is an Nx monorepo. Agent skills for working in it are provided by
`@hexmode/toolkit-nx`.

**Before writing or changing any code, load the `development-workflow` skill and
follow it.**

Available skills:

- `development-workflow` - the process for any code change: explore, scaffold,
  implement, verify, format, report.
- `workspace` - how the workspace is organised and how to explore it.
- `toolkit-nx` - code generators for new Angular artefacts.

<!-- @hexmode/toolkit-nx:end -->
