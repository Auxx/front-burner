# web-shell

The frame around every page (A-8.14): the app header, the user menu, page titles
and Page not found. It also holds what the dashboard and the repository
management page both show:

- `RepositoryStatusComponent`: a repository's status and warning badges (RM-6,
  RM-8); **Ready** only with `showReady`, as the repository management page
  shows it (RM-5).
- `LastAccessedComponent`: "Last accessed" with the relative time and the exact
  time in a tooltip (DS-18, RM-5).
- `AddRepositoryGuideComponent`: the full guide or the compact strip with **How
  it works** (DS-11 to DS-14, RM-5).
- `RepositoryListUpdatesService`: keeps a page's list of repositories current
  from the push channel, patching statuses and asking for a reload after a
  reconnect or for a repository it does not list (DS-23, RM-7). Statuses that
  arrive while a request for the list runs share one reload after it ends.

## Running unit tests

Run `nx test web-shell` to execute the unit tests.
