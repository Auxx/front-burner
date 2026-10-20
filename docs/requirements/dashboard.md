# REQ-DASH-001: Dashboard

> Status: **Accepted**

## Summary

The dashboard is the home page of the web client. Every user, administrator or
not, sees the same dashboard after they log in. It has two sections:

- **Add a repository**: a guide that explains how to add a repository, with a
  button that starts adding one. It is always shown: in full when the user has
  no repositories, and in a compact form when they have some.
- **Recent repositories**: up to 10 of the user's repositories, ordered by last
  access time, so that the user can continue where they left off. A link leads
  to the repository management page, where the user sees all their
  repositories and manages them.

The dashboard shows only the logged-in user's own repositories, including for
administrators.

## Context

- Most of the time a user logs in to continue working on something they opened
  recently. The dashboard puts their most recently used repositories first and
  opens one with a single click.
- Users of developer personas often work across many repositories. Showing
  only the 10 most recent keeps the dashboard short; the full list lives on the
  repository management page (separate requirement).
- A new user has no repositories, and Front Burner never creates them (vision).
  The user must understand that they need an existing remote and credentials
  before they start, so the dashboard explains this up front. Users who already
  have repositories still need a quick way to add another one.
- An administrator can add a repository on a user's behalf, and the user must
  then confirm it and provide their own repository credentials (vision). The
  dashboard is where such a user first notices the repository, so it must be
  clear that it needs their action.
- A repository can exist without being ready to open: it may still be cloning,
  or cloning may have failed, or its credentials may have been rejected. The
  dashboard shows this instead of sending the user into an editor that cannot
  work.
- Each user sees only their own repositories (vision). Administrators reach
  other users' repositories through administration pages, not through the
  dashboard.

## Terms

**Dashboard**
: The home page of the web client, described in this requirement. Pages that
send the user "to the home page" (for example LG-3 in
[REQ-AUTH-003](auth-login.md)) send them to the dashboard.

**Last access time**
: When a user last opened a repository in the editor. Also set when the
repository is added, so every repository has one. Stored per user (see the
[glossary](../product/glossary.md)).

**Openable repository**
: A repository that the user has confirmed (if it was added on their behalf),
whose working copy is cloned, and that has no error that stops it from being
opened in the editor.

**Repository status**
: What the dashboard says about a repository that is not openable. One of:

| Status                     | Meaning                                                                                       |
|----------------------------|-----------------------------------------------------------------------------------------------|
| **Needs your confirmation** | An administrator added it on the user's behalf; the user has not confirmed it yet.           |
| **Cloning**                 | The working copy is still being cloned.                                                      |
| **Error**                   | The repository cannot be opened because of an error, for example a failed clone or rejected credentials. |

The exact set of errors, and how the user fixes them, belong to the repository
management requirement. The dashboard only needs to know that a repository is
in an error status and a short label for the error.

## Requirements

### General

- **DS-1** The dashboard needs a login. A visitor who is not logged in is sent
  to the login page as in LG-4.
- **DS-2** After a successful login, the web client shows the dashboard,
  unless LG-4 sends the user back to the page they first asked for.
- **DS-3** Administrators and other users see the same dashboard. It shows
  only the logged-in user's own repositories, never those of other users.
- **DS-4** The backend enforces every rule in this requirement that concerns
  data: which repositories are returned, their order, their status and their
  last access time. The web client only displays what the API returns
  (vision goal 12).
- **DS-5** The dashboard is fully usable in desktop and mobile browsers.

### Last access time

- **DS-6** The backend stores a last access time for each repository of each
  user. Each user has their own working copy of every repository they add
  (vision), so the last access time and the repository status belong to that
  user's repository, never to the remote it was cloned from.
- **DS-7** The backend sets the last access time to the current time when:
  - the user adds the repository;
  - an administrator adds the repository on the user's behalf;
  - the user opens the repository in the editor.
- **DS-8** The backend records the last access time itself when a client opens
  a repository through the API. It does not trust a time sent by the client.
  _(My call: the exact API call that counts as "opening" is left to the
  builder, as long as it happens once per opening of the repository in the
  editor, not on every file request.)_
- **DS-9** Nothing else changes the last access time. In particular, showing
  the repository on the dashboard or on the repository management page,
  confirming it, synchronisation and background jobs do not change it.

### Add a repository section

- **DS-10** The section is always shown, above the recent repositories.
- **DS-11** When the user has **no** repositories (in any status), the section
  shows the **full guide**:
  - a heading, "Add your first repository";
  - a short explanation that Front Burner edits Markdown files in git
    repositories that already exist on a remote, and never creates
    repositories;
  - three steps:
    1. **Copy the remote URL** from GitHub, Bitbucket or another git server,
       either HTTPS (for example `https://github.com/org/repo.git`) or SSH
       (for example `git@github.com:org/repo.git`);
    2. **Have your credentials ready**: a username and access token for HTTPS,
       or an SSH key for SSH. Only you can see them;
    3. **Choose a clone mode**: _Full clone_ (all branches and history) or
       _Single branch_ (one branch, faster, but with a limited git workflow);
  - an **Add repository** button.
- **DS-12** When the user has **at least one** repository (in any status), the
  section shows the **compact guide**: a single strip with the text "Add
  another repository from an HTTPS or SSH URL", a **How it works** link and an
  **Add repository** button. On narrow screens the button goes below the text.
- **DS-13** **How it works** shows the explanation and steps of the full guide
  (DS-11) in place, and can hide them again. The full and compact guides use
  the same text, so there is only one version to keep up to date.
- **DS-14** **Add repository** starts the add-repository flow (separate
  requirement).

### Recent repositories section

- **DS-15** The section is shown only when the user has at least one
  repository. Its heading is "Recent repositories".
- **DS-16** It lists the user's repositories, in any status, ordered by last
  access time, most recent first, up to **10**. Repositories with the same
  last access time are ordered by name. _(My call.)_
- **DS-17** The API returns at most 10 repositories for this list, already
  ordered. The web client does not load all of the user's repositories to
  build it.
- **DS-18** Each entry shows:
  - the repository's **name**, as set when it was added (AR-13 to AR-15 in
    [REQ-REPO-001](repo-add.md));
  - the **remote**, shown as host and path without the protocol, user or
    `.git`, for example `github.com/acme/handbook` for both
    `https://github.com/acme/handbook.git` and
    `git@github.com:acme/handbook.git`;
  - the **last access time**, labelled "Last accessed" and shown as a
    relative time (for example "3 hours ago"), with the exact date and time
    available on hover or long press. _(My call.)_
  - the **repository status**, if the repository is not openable.
- **DS-19** The remote shown on the dashboard never contains credentials, even
  if the stored URL has a user name or token in it.
- **DS-20** Clicking an **openable** repository opens it in the editor (and
  updates its last access time, DS-7).
- **DS-21** Clicking a repository that **needs your confirmation** starts the
  confirmation flow for that repository (separate requirement), in which the
  user confirms it and provides their repository credentials. The status is
  highlighted so that it stands out from the other entries.
- **DS-22** A repository that is **cloning** or in an **error** status:
  - shows its status, and for an error a short label of what went wrong;
  - does **not** open the editor when clicked;
  - shows a link to that repository on the repository management page, where
    the user can follow the progress, see the error in full and fix it.
- **DS-23** While at least one listed repository is cloning, the dashboard
  updates its status without the user reloading the page, so that it becomes
  clickable as soon as it is openable. _(My call; the mechanism is left to the
  builder.)_
- **DS-24** Below the list there is an **All repositories** link to the
  repository management page. It is shown whenever the section is shown,
  whatever the number of repositories.

### Loading and errors

- **DS-25** While the list is loading, the recent repositories section shows a
  loading state. The add a repository section is shown right away. _(My call:
  until the list has loaded, it shows the compact guide if the user had
  repositories the last time the dashboard loaded in this browser, and the
  full guide otherwise.)_
- **DS-26** If the list cannot be loaded, the section shows "Your
  repositories could not be loaded" with a **Try again** button. The add a
  repository section stays usable.

## Acceptance criteria

1. After logging in without a return target, both an administrator and a
   user land on the dashboard.
2. A user with no repositories sees the full guide with its three steps and
   an **Add repository** button, and no recent repositories section.
3. A user with one or more repositories sees the compact guide above the
   recent repositories list. **How it works** shows and hides the full guide
   text in place.
4. **Add repository** starts the add-repository flow, from both the full and
   the compact guide.
5. A user with 12 repositories sees exactly 10, ordered by last access time,
   most recent first, and an **All repositories** link to the repository
   management page. A user with 3 repositories sees all 3 and the same link.
6. Opening a repository in the editor moves it to the top of the list the next
   time the dashboard is shown. Opening the dashboard or the repository
   management page does not change the order.
7. A newly added repository appears at the top of the list, with a last
   access time of when it was added, before it was ever opened.
8. Two users with working copies of the same remote each have their own last
   access time: one user opening it does not change the other user's order.
9. An administrator's dashboard lists only the administrator's own
   repositories, not those of other users. The API refuses to return another
   user's repositories for the dashboard.
10. Each entry shows the name, the remote as host and path (for example
    `github.com/acme/handbook`), and "Last accessed" with a relative time.
    An HTTPS remote stored with a user name or token in it is shown without
    them.
11. Clicking an openable repository opens it in the editor.
12. A repository added by an administrator on the user's behalf appears in the
    user's list marked **Needs your confirmation**, and clicking it starts the
    confirmation flow.
13. A repository that is cloning, or whose clone failed, shows its status, does
    not open the editor when clicked, and offers a link to that repository on
    the repository management page.
14. When a cloning repository finishes cloning while the dashboard is open,
    its entry becomes openable without a page reload.
15. When the API cannot return the list, the dashboard shows the error with
    **Try again**, and **Add repository** still works.
16. The dashboard is fully usable on a phone-sized screen: the compact guide's
    button goes below its text and nothing scrolls sideways.

## Out of scope

- The repository management page, including the full list of repositories,
  their errors and how to fix them (separate requirement).
- The add-repository flow and the confirmation flow for repositories added on a
  user's behalf (separate requirements).
- How administrators add repositories on a user's behalf and see other users'
  repositories (administration requirements).
- The navigation bar and the links to administration pages.
- The editor itself.
- Pinning, favourites, search or filtering on the dashboard.
- Showing recent files, sync status or uncommitted changes per repository.

## Open questions

None at the moment.
