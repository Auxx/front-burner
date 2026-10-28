# web-feature-repository-screen

The repository screen (REQ-FILE-001, A-2.2a) at `/repositories/<id>` and
`/repositories/<id>/files/<path>`, outside the shell layout, since its bar
replaces the app header (NV-9).

- `repositoryScreenMatcher`: one route for both URLs, so that the page stays
  when only the file changes (FB-1, FB-11).
- `RepositoryScreenPage`: opens the repository once per visit and shows Page
  not found for a missing one, the status for one that cannot be opened (FB-3),
  or the bar, the file tree pane and the editor area. It sets its own title,
  `<name> · Front Burner` (NV-13).
- `RepositorySessionService`: the open repository, provided by the page.
- `PaneMemoryService`: the tree's size and whether it is collapsed, per device
  and user (FB-8).
- `RepositoryBarComponent`: the brand link, the repository name, **Files** and
  the user menu (NV-9, FB-9, FB-10).
- `EditorAreaComponent` and `NotOpenableComponent`: the editor area's empty
  state (FB-12) and the not-openable state (FB-3, DS-22).

## Running unit tests

Run `nx test web-feature-repository-screen` to execute the unit tests.
