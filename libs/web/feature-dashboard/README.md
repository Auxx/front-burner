# web-feature-dashboard

The dashboard, the home page of a logged-in user (REQ-DASH-001).

- `DashboardPage`: the Add a repository guide, shown at once, then the recent
  repositories from `GET /api/v1/repositories/recent`, with a loading state and
  **Try again** (DS-25, DS-26).
- `AddRepositoryGuideComponent`: the full guide or the compact strip with **How
  it works** (DS-11 to DS-14).
- `RecentRepositoriesComponent` and `RepositoryEntryComponent`: the list, each
  entry's status, warnings and links (DS-15 to DS-24).
- `DashboardHintService`: remembers in `localStorage` whether the user had
  repositories, so that the right guide shows before the list loads (DS-25).

## Running unit tests

Run `nx test web-feature-dashboard` to execute the unit tests.
