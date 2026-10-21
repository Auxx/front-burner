# Front Burner — Web client

> Status: **Draft**

How the Angular web client is structured. See [modules.md](modules.md) for
its libraries and [overview.md](overview.md) for the numbering conventions.

## A-8: Structure and state

- **A-8.1** `apps/web` holds the shell and routes; each feature library is
  loaded lazily from a route (A-2.2). The initial JavaScript stays within
  300 KB gzipped (NF-2.9).
- **A-8.2** Component state uses **signals**. Services that hold more complex
  or shared state (current repository, file tree, sync state) use **RxJS**
  and expose signals to components where that is simpler. No NgRx.
- **A-8.3** API calls go through `web/api-client` (A-3.6). Forms validate with
  the same Zod schemas as the backend (A-3.3).

## A-8: Core services (`web/core`)

- **A-8.4** **Auth:** follows LG-40: keeps the auth token and token expiry
  times in `localStorage`, refreshes through the cookie (LG-31, LG-32), and
  runs at most one refresh at a time across tabs with the Web Locks API.
- **A-8.5** **Push channel client:** opens `GET /api/v1/events` with `fetch`
  streaming and the auth token (A-3.10); reconnects with backoff, after a
  token refresh, and when the page becomes visible again; after every
  reconnect it asks the affected services to fetch current state (A-3.11).
- **A-8.6** **Errors:** maps error codes to text with Transloco (A-3.8) and
  shows the request ID reference (NF-10.6).
- **A-8.7** **Version check:** when a response's version header differs from
  the loaded version, asks the user to reload (NF-7.6).
- **A-8.8** **Transloco:** English at launch, translation files loaded on
  demand, language switched without reloading, ICU messages through
  `@jsverse/transloco-messageformat` (NF-14).

## A-8: Saving

- **A-8.9** **Save queue** (D-1, NF-3):
  - a save is sent after the user stops typing for **1.5 seconds**
    _(My call, within D-1.1's 1–2 seconds)_;
  - saves for one file are sent one at a time; when a save is in flight,
    only the newest content waits behind it;
  - a failed save is kept and retried with backoff; the status shows
    "Saved", "Saving…" or "Not saved — offline, retrying" (NF-3.1, NF-3.2).
- **A-8.10** **Drafts:** unsaved content is written to IndexedDB, keyed by
  user, repository and file, and deleted when the save is confirmed; drafts
  are offered back, never applied automatically, and deleted on logout
  (NF-3.3 to NF-3.5).

## A-8: Editor and preview

- **A-8.11** `web/code-editor` wraps **CodeMirror 6**, with Markdown and YAML
  front matter highlighting, `EditorView.cspNonce` set (NF-11.1), and the
  accessibility behaviour of NF-13.3. The editor, the conflict-marker view
  and the three-way merge editor all use it.
- **A-8.12** `web/markdown` holds the preview pipeline (D-7.3 to D-7.5) and
  the one component that passes sanitised HTML to Angular (D-7.6). It is
  loaded lazily with the editor. **Pending spike 3.**
- **A-8.13** _(My call.)_ The spike tries running remark, Shiki and DOMPurify
  in a **Web Worker**, so that rendering a large file never delays typing
  (NF-2.4, NF-2.5). The main thread then only passes the sanitised HTML
  through a Trusted Types policy. If the worker adds nothing measurable, the
  pipeline runs on the main thread.
