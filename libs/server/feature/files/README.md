# server-feature-files

The files of a user's working copies (REQ-FILE-001). So far: the folder listing.

- `FilesModule`: `GET /api/v1/repositories/:id/folder?path=`, one folder of the
  working copy at a time (FB-15 to FB-20b). Relies on the global auth guard of
  `server-feature-auth`, and on the global `GitModule` and `StorageModule`.
- `OpenableRepository`: the working copy of one of the user's `ready`
  repositories, or `404 not-found` / `409 repository-not-openable` (FB-2, FB-3).
  Every files endpoint starts with it.
- `toFilesError`: the one mapping from a refused path to an API answer.
- `FolderLister`: reads one folder through a descriptor (A-7.6), with two git
  calls scoped to it. Never walks the working copy and takes no lock (A-5.3).

## Running unit tests

Run `nx test server-feature-files` to execute the unit tests via
[Vitest](https://vitest.dev/).
