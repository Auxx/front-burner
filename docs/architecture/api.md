# Front Burner — API and push channel

> Status: **Draft**

How clients talk to the backend. See [overview.md](overview.md) for the
numbering conventions.

## A-3: REST API

- **A-3.1** The API is REST under `/api/v1` (NF-7.6), JSON in and out except
  for file uploads and raw file downloads. It must not assume the web client
  is its only consumer (vision goal 12).
- **A-3.2** Long operations return `202 Accepted` with a job ID (A-1.13).

## A-3: Contracts

- **A-3.3** Every request body, query, path parameter and response body is a
  **Zod schema** in `shared/contracts`. The backend validates requests with
  them in a global validation pipe _(My call: `nestjs-zod`)_, and the OpenAPI
  document is generated from them.
- **A-3.4** Every schema used by an endpoint is **named** with Zod 4 metadata
  (`.meta({ id })`), so that it appears as a named component in the OpenAPI
  document and the client template can map it back to its export.
- **A-3.5** Response schemas never contain secret fields (passwords, tokens,
  private keys); a secret cannot leak through a response by accident
  (AR-17, D-8.5).

## A-3: Generated API client

- **A-3.6** `web/api-client` is generated from the OpenAPI document with
  `swagger-typescript-api` and our own template:
  - it contains **methods only**, built on Angular's `HttpClient`;
  - every type is imported from `shared/contracts` (`z.infer` types), never
    generated; type-only imports add no Zod code to the bundle.
- **A-3.7** CI regenerates the OpenAPI document and the client and fails if
  either differs from what is committed.

## A-3: Errors

- **A-3.8** Every error response has a stable **error code**, its
  parameters, the request ID, and an English fallback message (NF-14.3,
  NF-10.6). Error codes are part of `shared/contracts`. Clients turn codes
  into text; the web client does it with Transloco.
- **A-3.9** Validation errors list each failing field with its own code, so
  that forms can show errors next to fields.

## A-3: Push channel

- **A-3.10** The backend pushes updates over **Server-Sent Events** at
  `GET /api/v1/events`:
  - clients read the stream with `fetch` (not `EventSource`), sending the
    auth token in the `Authorization` header like any other request;
  - one stream per client tab, carrying events for the logged-in user only;
  - the backend closes the stream when the auth token expires or the session
    is revoked; the client reconnects with a fresh token;
  - the response sets `X-Accel-Buffering: no` and `Cache-Control: no-cache`,
    and the backend sends a comment line every 30 seconds to keep proxies
    from closing an idle stream. _(My call: 30 seconds.)_
- **A-3.11** **Events are notifications, not state.** Each says what changed,
  with a small payload, for example `repository.status` (repository ID, new
  status), `job.progress` (job ID, percentage), `job.finished` (job ID,
  outcome), `remote.changed` (repository ID, changed paths for D-4.2),
  `sync.state` (repository ID: "not uploaded", conflict episode),
  `resolution.lock` (repository ID, taken over). After connecting or
  reconnecting, the client fetches current state over REST; events are never
  replayed.
- **A-3.12** The client tells the backend which repository it is viewing by
  opening the stream with `?repository=<id>` and reopening it when that
  changes. The backend uses this to schedule background fetches (A-6, job types).
  _(My call.)_
- **A-3.13** Over HTTP/1.1, browsers allow 6 connections per origin. Reverse
  proxies normally serve HTTP/2, where this does not apply. If it becomes a
  problem, one tab can share its stream with the others through
  `BroadcastChannel`; this is not built at launch.
