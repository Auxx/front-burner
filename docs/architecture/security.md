# Front Burner — Security boundaries

> Status: **Draft**

Where the trust boundaries are and what enforces each one. These rules sit
on top of the security rules in the requirements and NF-11. See
[overview.md](overview.md) for the numbering conventions.

## A-7: Trust boundaries

- **A-7.1** The boundaries, from the outside in:

  | Boundary                              | Enforced by                                                              |
  |---------------------------------------|--------------------------------------------------------------------------|
  | Internet → backend                    | Authentication (A-7.2), rate limits (NF-11.4), validation (A-3.3)         |
  | One user → another user's data        | Ownership guards (A-7.3)                                                 |
  | Administrator → a user's content      | No bypass of ownership (A-7.4)                                           |
  | Client path → server file system      | Path resolution (A-7.6)                                                  |
  | Stored data → secrets                 | Encryption module (A-4.8), response schemas (A-3.5)                     |
  | Backend → other hosts                 | Egress proxy for git (A-5.7), shared HTTP client for the rest (A-7.8)    |
  | Repository content → browser          | Sanitised preview (D-7.6), CSP (NF-11.1), sandboxed raw files (NF-11.3) |

## A-7: Authentication

- **A-7.2** A global NestJS guard authenticates every request as LG-34
  describes; only routes marked `@Public()` skip it (login, refresh,
  onboarding, health). Active sessions are cached in memory, which one
  process allows (NF-4.2). Revoking a session (LG-37) removes it from the
  cache, closes its push channel streams (A-3.10) and drops its key unlocks
  (AR-31).

## A-7: Authorisation

- **A-7.3** **Ownership.** A route that names a repository or saved
  credential gets it from a guard that looks it up by **ID and current
  user**; anything else gets `404`, as if it did not exist (AR-56).
  Services receive the resolved object, never a bare ID.
- **A-7.4** **Role.** Administrator routes are marked `@AdminOnly()` and live
  under `/api/v1/admin/`. Administrators reach other users' repositories
  through administration pages (REQ-DASH-001), so admin routes may read and
  manage **repository metadata** (which fields is for the administration
  requirements), through an admin variant of the ownership guard. They never
  reach another user's files, working copies or credentials. Adding a
  repository on a user's behalf creates a pending repository owned by that
  user.
- **A-7.5** An API test goes through every non-admin route that takes an ID
  and checks that another user's IDs get `404`, and through every admin
  route to check that a non-administrator gets `403`.

## A-7: File system

- **A-7.6** Every path that comes from a client goes through one function in
  `server/storage`, which:
  - resolves it inside the repository's working copy;
  - rejects `..` segments, absolute paths and NUL characters;
  - rejects anything inside `.git`;
  - **never follows symbolic links**: a symbolic link appears in the file tree
    but cannot be opened, edited, renamed onto, or served. Without this rule a
    malicious remote could make the backend read files outside the working
    copy.

## A-7: Outbound connections

- **A-7.7** Git connects only through the egress proxy (A-5.7).
- **A-7.8** Every other outbound HTTP call (provider APIs, OIDC discovery and
  token exchange) uses one shared HTTP client in `server/security` that
  applies the same address rules as AR-57. SMTP connections are checked the
  same way. Provider hosts are fixed at launch (D-8.2).

## A-7: Browser

- **A-7.9** The backend serves `index.html` itself, adding a fresh CSP nonce
  per request (NF-11.1) and the version header (NF-7.6).
- **A-7.10** HTML from Markdown is sanitised by `rehype-sanitize` and then
  DOMPurify, both configured from the safe HTML whitelist (REQ-EDIT-002),
  and passed to Angular in one shared preview component (D-7.6). Raw
  repository files are served from a separate endpoint with sandboxing
  headers (NF-11.3).
- **A-7.11** Cross-site request forgery: the API authenticates with a bearer
  header, which browsers do not send on their own; the refresh-token cookie
  is protected by LG-33.
- **A-7.11a** The image loader of the preview is the only code that sets an
  image's address (IM-24): repository images become `blob:` URLs, and remote
  `https:` images are set only after **Show remote images**. No address
  from a file reaches the page on its own.

## A-7: Accepted limits

- **A-7.12** Git and `ssh` run as the same UID as the backend. A rootless
  container cannot switch users, so there is no sandbox around git beyond
  NF-11.6 to NF-11.8 and A-5.1.
- **A-7.13** The Content Security Policy allows `https:` images (NF-11.1,
  IM-23), so that remote images can be shown on request. If the sanitising
  steps were ever bypassed, injected markup could make the browser load an
  image from any `https:` host, for example to leak that a file was viewed;
  it still could not run script. A-7.11a keeps this from happening while
  the sanitisers work.
