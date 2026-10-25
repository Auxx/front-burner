# Front Burner — Architecture overview

> Status: **Draft**

This is the entry point to Front Burner's architecture. It builds on the
[product vision](../product/vision.md), the [requirements](../requirements/),
the [architecture decisions](decisions.md) (D-x.y) and the
[non-functional requirements](non-functional.md) (NF-x.y).

Rules are numbered **A-x.y**; each file owns one number range. Rules marked _(My
call.)_ were decided while writing and not explicitly confirmed; they can be
revisited cheaply. Parts marked **Pending spike N** depend on a spike in
[spikes.md](spikes.md) and will be updated with its findings.

## Documents

| File                                 | Range | Covers                                                                |
| ------------------------------------ | ----- | --------------------------------------------------------------------- |
| [overview.md](overview.md)           | A-1   | Context, technology stack, runtime view, configuration                |
| [modules.md](modules.md)             | A-2   | NX projects, libraries and their boundary rules                       |
| [api.md](api.md)                     | A-3   | REST API, contracts, generated client, errors, push channel           |
| [data.md](data.md)                   | A-4   | Database, tables, migrations, encryption of stored secrets            |
| [git-engine.md](git-engine.md)       | A-5   | Running git, per-working-copy queue, credentials, address restriction |
| [jobs.md](jobs.md)                   | A-6   | Job runner, job types, scheduling, retries                            |
| [security.md](security.md)           | A-7   | Trust boundaries, authentication, authorisation, file system, egress  |
| [web-client.md](web-client.md)       | A-8   | Angular structure, state, save queue, editor and preview              |
| [spikes.md](spikes.md)               | A-9   | Throwaway spikes for the risky parts                                  |
| [design-system.md](design-system.md) | A-10  | Look, design tokens, CSS architecture, `ui` components                |

## A-1: Context

```
            Browser (web client)            Native client (future)
                     │  HTTPS, one origin            │
                     ▼                               ▼
              Reverse proxy (operator's: Caddy, Traefik, nginx)
                     │  HTTP
                     ▼
 ┌──────────────── Front Burner container (rootless) ─────────────────┐
 │  NestJS process (single)                                           │
 │   ├─ serves the web client and /api/v1                             │
 │   ├─ job runner, push channel (SSE), in-memory key unlocks         │
 │   ├─ egress proxy ──────────────┐                                  │
 │   └─ spawns git + ssh ──────────┤                                  │
 │                                 │                                  │
 │  /data volume: SQLite, working copies, tmp, backups, orphans       │
 └─────────────────────────────────┼──────────────────────────────────┘
                                   ▼
        Git remotes (HTTPS/SSH) · GitHub / Bitbucket APIs · OIDC · SMTP
```

- **A-1.1** One container runs **one Node.js process** (NF-4.2). It serves the
  web client's static files and the API from the same origin, runs the job
  runner, holds the push channel connections and keeps unlocked keys in memory.
  Nothing in the design coordinates several processes. Static files whose name
  carries a content hash (the build's scripts and styles) are served with
  `Cache-Control: public, max-age=31536000, immutable`; every other static file,
  such as `index.html` and the files under `assets/` (the icon sprite, A-10.48),
  with `Cache-Control: no-cache` and an `ETag`, so that a browser revalidates it
  and picks up a new version right after an upgrade.
- **A-1.2** Git is the `git` program, run as a child process (A-5). Every git
  network connection goes through an egress proxy inside the backend process
  (A-5.7).

## A-1: Technology stack

- **A-1.3** Runtime: **Node.js 24 LTS**, TypeScript, NX workspace.
- **A-1.4** Backend: **NestJS 11**, until `nestjs-zod` supports 12 _(user's
  decision, 2026-10-25)_. Database access with **Drizzle ORM** on
  **`better-sqlite3`** (A-4).
- **A-1.5** API: REST under `/api/v1`, described by **OpenAPI** generated from
  NestJS. Request and response shapes are **Zod** schemas in a shared library
  (A-3).
- **A-1.6** API client for the web client: generated with
  **`swagger-typescript-api`** using our own template for Angular's
  `HttpClient`. It contains methods only; types come from the contracts library
  (A-3.6).
- **A-1.7** Push channel: **Server-Sent Events**, read by clients with `fetch`
  streaming so that the auth token travels in the `Authorization` header
  (A-3.10).
- **A-1.8** Web client: **Angular**. Signals for component state, RxJS in
  services for more complex state; no NgRx. **Transloco** for text, **CodeMirror
  6** for editing, **remark → Shiki → DOMPurify** for the live preview (D-7).
  Our own design system in the `ui` library, on **Angular Aria** and the
  **Angular CDK**, styled with SCSS and CSS custom properties (A-10). Storybook
  for the `ui` library.
- **A-1.9** Tests: **Vitest** for unit and integration tests, **Playwright**
  with **axe-core** for end-to-end tests (NF-12.2, NF-13.8).
- **A-1.10** _(My call.)_ Backend libraries not discussed separately:
  `nestjs-pino` (logging, NF-10), `prom-client` (metrics), `@nestjs/throttler`
  with in-memory storage (rate limits, NF-11.4), `nodemailer` (SMTP),
  `openid-client` (OIDC), `argon2` (PP-12), `ssh2` (parsing SSH keys and signing
  for the credential broker's agent, A-5.4).

## A-1: Runtime view

### Startup

- **A-1.11** The backend starts in this order; any failure stops the container
  with a log entry that names the cause:
  1. read and validate the configuration, including `…_FILE` variables (NF-8.1,
     NF-8.2);
  2. check that the data directories are writable (NF-5.6);
  3. open the database; refuse a schema newer than this version (NF-7.3);
  4. take the pre-upgrade snapshot and apply pending migrations (NF-7.1);
  5. check the encryption key against the check value, or perform a requested
     reset (NF-8.5, NF-8.6); start background re-encryption when a previous key
     is set (NF-8.4);
  6. recover: empty `tmp/`, reconcile working copies with the database, move
     orphans, clean working copies, resolve interrupted jobs (NF-6.4, NF-9.4,
     NF-9.5);
  7. start the job runner and the HTTP server; report ready (NF-9.3).

### Request path

- **A-1.12** A request passes, in order: request ID (NF-10.6) → security headers
  (NF-11.2) → rate limit (NF-11.4) → authentication guard (A-7.2) → role and
  ownership guards (A-7.3) → Zod validation (A-3.3) → controller → service →
  database and/or the working copy's git queue (A-5.3).
- **A-1.13** Any operation that can take longer than about 2 seconds becomes a
  job (NF-2.8): the request returns `202 Accepted` with the job ID, and progress
  and the result arrive over the push channel (A-3.11). _(My call.)_ Two
  exceptions:
  - **access checks** (AR-35, AR-41) stay synchronous requests, because their
    errors belong next to form fields; AR-42's 30-second limit keeps them within
    NF-2.8's 30-second cap;
  - the **push channel stream** (A-3.10) is held open by design and is not a
    request in NF-2.8's sense.

### Shutdown

- **A-1.14** On `SIGTERM`: stop accepting requests and jobs, close the push
  channel streams, wait up to 25 seconds for running git operations, kill the
  rest, close the database (NF-9.2).

## A-1: Configuration

- **A-1.15** All configuration comes from environment variables with the
  `FRONT_BURNER_` prefix, parsed and validated at startup by one Zod schema in
  `server/core/config`. Durations use LG-62's format; sizes use a number and
  `KB`, `MB` or `GB`. Variables already defined in the requirements and NF-x.y
  keep their names. New ones _(My call: names and defaults)_:

  | Variable                              | Default                      | Meaning                                                                                                                                                                          |
  | ------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `FRONT_BURNER_DATA_DIR`               | `/data`                      | Directory for all stored data. A relative path resolves against the working directory; meant for development.                                                                    |
  | `FRONT_BURNER_PORT`                   | `8080`                       | HTTP port inside the container.                                                                                                                                                  |
  | `FRONT_BURNER_TRUSTED_PROXIES`        | `loopback, private networks` | Addresses whose `X-Forwarded-*` headers are trusted.                                                                                                                             |
  | `FRONT_BURNER_CLONE_TIMEOUT`          | `30m`                        | AR-51.                                                                                                                                                                           |
  | `FRONT_BURNER_CLONE_CONCURRENCY`      | `2`                          | AR-52.                                                                                                                                                                           |
  | `FRONT_BURNER_GIT_TIMEOUT`            | `5m`                         | Timeout of other git operations (NF-11.8).                                                                                                                                       |
  | `FRONT_BURNER_KEY_UNLOCK_IDLE`        | `1h`                         | AR-31 unlock idle time.                                                                                                                                                          |
  | `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS` | `false`                      | AR-57 operator setting.                                                                                                                                                          |
  | `FRONT_BURNER_KNOWN_HOSTS_FILE`       | —                            | AR-32: a file in OpenSSH `known_hosts` format that replaces the built-in host keys; to extend them, the operator includes the built-in entries (listed in the deployment guide). |
  | `FRONT_BURNER_UPLOAD_MAX_SIZE`        | `25MB`                       | NF-1.6.                                                                                                                                                                          |
  | `FRONT_BURNER_LOW_DISK_THRESHOLD`     | `2GB`                        | NF-9.7.                                                                                                                                                                          |
  | `FRONT_BURNER_DB_SNAPSHOT_INTERVAL`   | `1d`                         | NF-6.2.                                                                                                                                                                          |
  | `FRONT_BURNER_DB_SNAPSHOT_KEEP`       | `7`                          | NF-6.2.                                                                                                                                                                          |

  The deployment guide documents them (see `docs/wiki/todo.md`).

## Consequences for the requirements

These requirement texts should be adjusted when they are next edited:

- **AR-31** says "status polling (DS-23)". Clone status arrives over the push
  channel (A-3.10); the rule still holds for push channel connections: holding a
  stream open does not keep a key unlocked.
- **DS-23** leaves the update mechanism to the builder: it is the push channel.
- **AR-52** leaves the clone limit to the builder: 2, set by
  `FRONT_BURNER_CLONE_CONCURRENCY` (A-1.15).

## Open questions

None at the moment.
