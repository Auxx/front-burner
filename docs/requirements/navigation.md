# REQ-APP-001: Navigation

> Status: **Draft**

## Summary

Every page of the web client that needs a login has the same **app
header**:

- **Front Burner**, which leads to the dashboard;
- **Repositories**, which leads to the repository management page;
- the **user menu**, with the user's name and email, **Preferences**, **Log
  out** and the instance's version.

On the repository screen, the app header and the repository's own header are
**one bar**: the same home link and user menu, plus the repository name (a
quick **repository switcher**), the branch, the git actions and the save
status. On phones, the links go into a **menu button**.

This requirement also lists every route of the web client, and covers page
titles, breadcrumbs, the "Page not found" page, global banners and
accessibility rules that every page shares.

## Context

- Requirements so far each describe one page, and rely on a header that no
  requirement defined: Log out on every page (LG-39), the user menu for
  Preferences (CA-9), the repository screen's header (FB-10, GA-7, ED-18).
- The repository screen needs all the space it can get, above all on a phone
  with the on-screen keyboard open (NF-12.5). A second bar would take a line
  of the editor away.
- Developers work across several repositories (vision), so switching
  between them should not need a detour through the dashboard.
- The MVP has one user, the instance's only administrator, but no
  administration pages yet ([mvp.md](../product/mvp.md)). The app header
  leaves room for an **Administration** link that comes with them.
- Pages that do not need a login (login, onboarding, password reset) are
  covered by their own requirements and have no app header.

## Terms

**App header**
: The bar at the top of every page that needs a login.

**User menu**
: The menu at the end of the app header with the user's account actions.

**Repository switcher**
: The menu opened from the repository name in the repository screen's
header, which lists recent repositories.

## Requirements

### Routes

- **NV-1** The web client has these routes:

  | Route                                   | Page                                                         | Login  |
  |-----------------------------------------|--------------------------------------------------------------|--------|
  | `/`                                     | Dashboard ([REQ-DASH-001](dashboard.md))                     | Yes    |
  | `/repositories`                         | Repository management page ([REQ-REPO-003](repo-manage.md))  | Yes    |
  | `/repositories/new`                     | Add repository page ([REQ-REPO-001](repo-add.md))            | Yes    |
  | `/repositories/<id>`                    | Repository screen ([REQ-FILE-001](file-browser.md))          | Yes    |
  | `/repositories/<id>/files/<path>`       | Repository screen with a file open (FB-1)                    | Yes    |
  | `/repositories/<id>/settings`           | Repository settings page (RM-9)                              | Yes    |
  | `/preferences`                          | Preferences page (CA-9)                                      | Yes    |
  | Login, password reset, onboarding pages | [REQ-AUTH-001](auth-onboarding.md), [REQ-AUTH-003](auth-login.md) | No |

  _(My call: the routes of the pages without a login, such as `/login`, are
  left to the builder.)_
- **NV-2** A route that needs a login sends a visitor who is not logged in to
  the login page and back afterwards (LG-4).
- **NV-3** Any other route shows a **Page not found** page, with the app
  header when the user is logged in, the text "This page doesn't exist." and
  a link to the dashboard. A repository that does not exist, or belongs to
  another user, shows the same page (FB-2, RM-1). _(My call.)_
- **NV-4** The browser's back and forward buttons move between pages as the
  user visited them. Opening files on the repository screen counts as
  visiting pages (FB-1); opening a dialog, menu or drawer does not.
  _(My call.)_

### App header

- **NV-5** Every page that needs a login has the app header. It shows, from
  start to end:
  - **Front Burner**, with the product's icon, a link to the dashboard;
  - **Repositories**, a link to the repository management page;
  - the user menu (NV-7).

  The link to the current page is marked as current, also for screen
  readers. _(My call: an **Administration** link comes with the
  administration pages.)_
- **NV-6** On narrow screens, the app header shows the product's icon (a
  link to the dashboard), a **Menu** button with the links of NV-5, and the
  user menu. _(My call: the breakpoint is left to the builder.)_
- **NV-7** The user menu opens from a button that shows the user's initials,
  taken from their display name, and has an accessible name such as "Account
  menu for _&lt;name&gt;_". It shows:
  - the user's display name and email;
  - **Preferences**, a link to the Preferences page;
  - **Log out** (LG-39);
  - the instance's version, for example "Front Burner 1.4.2". _(My call.)_
- **NV-8** Logging out from the user menu follows LG-39 and NF-3.5: browser
  drafts are deleted, and every other tab of the web client goes to the login
  page too. _(My call: tabs learn of it through the browser, for example a
  `storage` event.)_

### Repository screen header

- **NV-9** On the repository screen, the app header and the repository's
  header are one bar. From start to end it shows:
  - the product's icon, a link to the dashboard (FB-10);
  - the repository name, which opens the repository switcher (NV-10);
  - the current branch and the git status and actions of GA-7;
  - the save status of the open file (ED-18);
  - the user menu (NV-7).

  **Repositories** is in the repository switcher instead (NV-10).
- **NV-10** The repository switcher lists, in the order of the dashboard
  (DS-16), up to 10 of the user's repositories other than the current one,
  with their status; openable ones open on selection, as on the dashboard
  (DS-20 to DS-22). Below them are **All repositories** (the repository
  management page) and **Repository settings** (the current repository's
  settings page). _(My call: the list comes from the same API call as the
  dashboard's list, DS-17.)_
- **NV-11** On narrow screens the bar keeps, from start to end: the file
  tree button (FB-9), the repository name, the branch, the **to push** and
  **to pull** counts (GA-7), the save status and the user menu. The git
  actions are in a menu (GA-7). Long repository and branch names are
  shortened with an ellipsis, and the full name is shown on hover, focus or
  long press. On narrow screens the repository switcher also has
  **Dashboard**, since the product's icon is not in the bar. _(My call.)_
- **NV-12** Opening another repository from the repository switcher sends a
  save that is waiting for the open file first (ED-17).

### Page titles and breadcrumbs

- **NV-13** Every page has its own browser tab title, ending with "Front
  Burner": for example "Dashboard · Front Burner", "Repositories · Front
  Burner", "guide.md · handbook · Front Burner", and "Settings · handbook ·
  Front Burner". A file with unsaved edits adds "•" at the start of the
  title. _(My call.)_
- **NV-14** The repository settings page, the Add repository page and the
  Preferences page show breadcrumbs under the app header, for example
  "Repositories › handbook › Settings". The last item is the current page and
  is not a link.

### Banners

- **NV-15** Banners that concern the whole web client are shown directly
  below the app header, on every page that has it, one above the other:
  - "A new version of Front Burner is available." with **Reload**, from the
    version check (A-8.7, NF-7.6). It cannot be dismissed. A file with unsaved
    edits is saved before reloading (ED-17);
  - "You're offline. Changes are kept and saved when you're back online."
    while the browser is offline (NF-3.2). It goes away on its own when the
    connection returns. _(My call.)_
- **NV-16** Page-specific notices, such as the locked-key banner (RC-15) or
  the remote-change notice (GA-34), are shown by their pages below these
  banners, never in place of them.

### Accessibility

- **NV-17** Every page that needs a login has, as its first focusable
  element, a **Skip to content** link, and uses landmark regions: the app
  header as `banner`, the links as `navigation`, and the page's content as
  `main`. On the repository screen, the file tree pane, the editor and the
  preview are labelled regions too.
- **NV-18** After moving to another page, focus moves to the new page's main
  heading (or, on the repository screen, to the editor area), and screen
  readers announce the new page's title. _(My call.)_
- **NV-19** Menus (the user menu, the **Menu** button, the repository
  switcher) follow the WAI-ARIA menu button pattern: they open with the
  keyboard, `Esc` closes them and returns focus to their button, and their
  items are reachable with the arrow keys. Every control in the header meets
  NF-13.5's touch target size.

## Acceptance criteria

1. Every page that needs a login has the app header with **Front Burner**,
   **Repositories** and the user menu; the login page has no app header.
2. **Front Burner** leads to the dashboard and **Repositories** to the
   repository management page; the current page's link is marked as current.
3. The user menu shows the user's display name, email and the instance's
   version, and offers **Preferences** and **Log out**. **Log out** logs out
   every open tab and deletes browser drafts.
4. On a phone, the links are in a **Menu** button, and nothing scrolls
   sideways.
5. On the repository screen there is one bar, with the home link, the
   repository name, the branch and counts, the git actions, the save status
   and the user menu. On a phone, the git actions are in a menu and the save
   status and counts stay visible.
6. The repository name opens the repository switcher with up to 10 recent
   repositories, **All repositories** and **Repository settings**. Choosing
   another repository opens it, and an edit typed just before is saved.
7. `/no-such-page`, and a repository ID that belongs to another user, show
   "This page doesn't exist." with a link to the dashboard.
8. The browser's back button returns from a file to the previously opened
   file, and from the repository screen to the dashboard.
9. The browser tab shows "guide.md · handbook · Front Burner", with "•" in
   front while an edit is not saved.
10. The repository settings page shows "Repositories › handbook › Settings",
    and the first two items are links.
11. After a new version is deployed, every page shows "A new version of Front
    Burner is available." with **Reload**. Turning the network off shows the
    offline banner, which goes away when the network returns.
12. **Skip to content** is the first element reached with `Tab`. After
    moving to another page, focus is on its heading and a screen reader
    announces its title.
13. The menus open and close with the keyboard, and `Esc` returns focus to
    their button. axe-core reports no violations in the app header.

## Out of scope

- The administration pages and the **Administration** link.
- Search across repositories or files.
- Keyboard shortcuts for navigation, and a command palette.
- Choosing a theme or a language (the web client follows the platform's
  colour scheme, ED-14, and is in English only, NF-14.1).
- The pages without a login (REQ-AUTH-001, REQ-AUTH-003).
- Notifications history or a notification centre.

## Open questions

None at the moment.
