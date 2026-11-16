# web-shell

The frame around every page (A-8.14): the app header, the user menu, page titles
and Page not found. It also holds what the dashboard and the repository
management page both show:

- `RepositoryStatusComponent`: a repository's status and warning badges (RM-6,
  RM-8), each warning with the warning icon (NF-13.7); **Ready** only with
  `showReady`, as the repository management page shows it (RM-5).
- `RepositoryStatusDetailComponent`: the line under a listed repository: what
  went wrong for one in error (RM-6), and for a cloning one "Waiting for other
  clones to finish" or a progress bar with the percentage (RM-7, AR-52).
- `LastAccessedComponent`: "Last accessed" with the relative time and the exact
  time in a tooltip (DS-18, RM-5).
- `AddRepositoryGuideComponent`: the full guide or the compact strip with **How
  it works** (DS-11 to DS-14, RM-5).
- `RepositoryListUpdatesService`: keeps a page's list of repositories current
  from the push channel, patching statuses and asking for a reload after a
  reconnect or for a repository it does not list (DS-23, RM-7). Statuses that
  arrive while a request for the list runs share one reload after it ends. A
  listed clone's `job.progress` is patched in place too.
- `followRepositoryList`: what both pages do with their list: loads it at once,
  lets only the latest answer count, keeps the list on screen when a reload
  fails, offers **Try again**, and follows it with
  `RepositoryListUpdatesService` (DS-25, DS-26).

## Running unit tests

Run `nx test web-shell` to execute the unit tests.
