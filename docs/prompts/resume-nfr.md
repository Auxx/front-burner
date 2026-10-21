# Prompt: resume work on non-functional requirements

Paste the text below into a new Claude Code session to continue.

---

We are preparing to design the architecture of Front Burner. Before drafting
it, we agreed on this order:

1. ~~Answer the architecture-driving product questions~~ — done, recorded in
   `docs/architecture/decisions.md` (D-1 to D-8).
2. **Write a short non-functional requirements (NFR) / architecture-drivers
   document.** ← resume here
3. Draft the architecture: NX library module map, git engine, database, job
   runner, push channel to the client, security boundaries, plus throwaway
   spikes for the risky parts (SSRF address restriction for git in AR-57,
   in-memory SSH keys in AR-31, Shiki + remark + Angular in D-7.8).
4. Write the remaining detailed requirements (see `docs/wiki/todo.md`) against
   that architecture.

Read first: `docs/product/vision.md`, `docs/product/glossary.md`,
`docs/architecture/decisions.md`, `docs/wiki/deployment.md`, and skim
`docs/requirements/`.

Already fixed by existing documents (do not re-ask): a single rootless Docker
container serves the web client and the API from one origin over HTTPS;
per-user working copies; strict privacy between users; background clones with
a concurrency limit and a timeout; a backend-run job runner for Simple-level
auto-sync, fetches and reminder emails; encrypted saved credentials.

The NFR document still has to settle, among others:

- **Scale:** users per instance, repositories per user, largest supported
  repository (size, file count — developer repositories are code
  repositories), largest Markdown file.
- **Performance:** latency targets for opening the file tree, opening a file,
  saving, and synchronising; behaviour on slow mobile connections.
- **Storage and data layout:** where working copies, the database and secrets
  live on the container's volume(s); database choice consequences
  (SQLite vs Postgres given the single-container constraint).
- **Backup and restore:** what the operator backs up, whether a backup must be
  consistent while the instance runs, how working copies relate to backups
  (they can be re-cloned, but may hold unpushed commits).
- **Upgrades:** database migrations, compatibility of stored data across
  versions, downgrade policy.
- **Secrets:** how the instance encryption secret (AR-17) is provided and
  rotated; what happens if it is lost.
- **Availability and resilience:** restart behaviour, jobs interrupted by a
  restart, disk-full handling.
- **Observability:** backend log format, levels, what operators can monitor
  (health endpoint, metrics).
- **Security baseline:** Content Security Policy, rate limits, dependency and
  container hardening, beyond what the requirements already state.
- **Browser and device support:** which browsers and versions; minimum screen
  size.
- **Accessibility and localisation:** target level (e.g. WCAG 2.2 AA), whether
  the UI is English-only at launch.

How to work: go through these one topic at a time, asking me one question per
message, proposing concrete defaults when I'm unsure, and marking anything you
decide yourself as _(My call.)_. Also confirm with me decision D-2.5 in
`decisions.md` (Simple-level auto-sync as a separate per-repository
"auto-sync" setting), which I have not explicitly approved yet. Ask me where
the NFR document should live before writing it (suggestion:
`docs/architecture/non-functional.md`).
