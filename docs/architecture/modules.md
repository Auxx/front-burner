# Front Burner — Module map

> Status: **Draft**

How the NX workspace is split into projects, and which projects may import
which. See [overview.md](overview.md) for the numbering conventions.

## A-2: Projects

```
apps/
  server/                 NestJS application: bootstrap, startup sequence (A-1.11),
                          serves the web client and index.html with the CSP nonce
  server-e2e/             API tests against a running backend (incl. A-7.5)
  web/                    Angular application: shell, routes, app config
  web-e2e/                Playwright end-to-end tests (NF-12.2, NF-13.8)

libs/
  shared/
    contracts/            Zod schemas (named), error codes, push channel event types
    util/                 framework-free helpers (durations, sizes, …)

  server/
    core/                 infrastructure, no knowledge of features
      config/             configuration schema and loading (A-1.15)
      database/           Drizzle client, all table definitions, migrations,
                          snapshots (A-4)
      crypto/             encryption of stored secrets, key rotation (A-4.8)
      jobs/               job runner (A-6)
      events/             push channel hub (A-3.10)
      git/                git engine (A-5), egress proxy, credential broker
      storage/            data layout, path resolution, disk monitor (NF-5, A-7.6)
      mail/               SMTP sending and templates
      observability/      logging, request IDs, metrics, health (NF-10)
      security/           headers, CSP nonce, rate limits, shared HTTP client (A-7.8)
    feature/              one NestJS module per area
      auth/               login, sessions, refresh, OIDC, onboarding,
                          password reset, login audit log
      users/              user management by administrators
      settings/           system settings
      credentials/        saved credentials, known hosts, key unlocks
      repositories/       add, clone, list, status, level and auto-sync,
                          adding on behalf of a user
      files/              file tree, read, save, upload, rename, delete, raw serving
      sync/               commit, fetch, pull, push, Simple-level sync,
                          conflicts, resolution lock, conflict episodes
      providers/          provider abstraction, GitHub, Bitbucket Cloud,
                          provider tokens, pull requests

  web/
    feature-auth/         login, onboarding, password reset
    feature-dashboard/
    feature-repositories/ add-repository flow, repository management
    feature-credentials/  saved credentials, known hosts
    feature-editor/       file tree, editor screen
    feature-sync/         git panels at each level, conflict resolution screens
    feature-admin/        users, system settings
    markdown/             remark → Shiki → DOMPurify pipeline and the one
                          preview component (D-7.6)
    code-editor/          CodeMirror 6 wrapper
    core/                 auth tokens and refresh, interceptors, push channel
                          client, error-code texts, Transloco, save queue and drafts
    api-client/           generated API methods (A-3.6)
    ui/                   buttons, inputs, layouts; no business logic; Storybook
```

- **A-2.1** Server feature libraries contain their controllers, services and
  queries together; they are not split further into data-access libraries.
  _(My call.)_
- **A-2.2** Web feature libraries are each loaded lazily from a route of
  `apps/web` (NF-2.9).
- **A-2.3** The generated `api-client` is an Angular library, since its
  template targets `HttpClient`. A future Angular-based native client can
  reuse it; a non-Angular client generates its own from the OpenAPI
  document.

## A-2: Boundary rules

- **A-2.4** Every project has two NX tags, `scope:<server|web|shared>` and
  `type:<app|feature|core|domain|data-access|ui|contracts|util>`, and
  `@nx/enforce-module-boundaries` enforces these rules:

  | Rule                                                                                                   | Why                                                                |
  |--------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|
  | `scope:shared` imports only `scope:shared`; server and web never import each other                     | Contracts stay framework-free; no server code reaches the bundle.  |
  | Server `type:core` never imports `type:feature`                                                        | Infrastructure stays reusable and testable alone.                 |
  | Server features may import other server features, without cycles                                      | For example `sync` needs `credentials` (key unlock) and `repositories`. |
  | Web `type:feature` never imports another `type:feature`                                                | Lazy chunks stay independent.                                      |
  | Web `type:domain` (`markdown`, `code-editor`) imports only `core`, `ui`, `api-client` and `scope:shared` | Shared by several features.                                       |
  | `ui` imports only `shared/util`                                                                         | No business logic, contracts or API calls in generic components.   |
  | Every other library may import `shared/contracts` and `shared/util`                                    | One source of types.                                               |

- **A-2.5** Web tags: `markdown` and `code-editor` are `type:domain`; `core`
  and `api-client` are `type:data-access`. _(My call.)_
