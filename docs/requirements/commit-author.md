# REQ-GIT-001: Commit author

> Status: **Draft**

## Summary

Every commit that Front Burner makes for a user records that user as its
**commit author**: a name and an email address.

- Each user has a **default commit author** in their user preferences, taken
  at first from their account: the display name and the email.
- Each repository can **override** it, for example to commit with a work
  email in work repositories and a personal one elsewhere.
- Before the user's **first commit**, Front Burner asks them once to confirm
  or change the name and email, because commit history is public and hard to
  change.

The commit author is used for every commit: the user's own commits, merge
commits and the commits that finish a conflict resolution, and later the
Simple level's automatic commits. Commits are not signed.

## Context

- Git records a name and an email in every commit, and pushes them to the
  remote, where anyone who can read the repository sees them. A wrong or
  private email cannot be removed without rewriting history.
- Git hosting providers offer private "noreply" addresses (for example
  `12345+user@users.noreply.github.com`). GitHub can refuse a push whose
  commits expose an email the user marked private. Users must be able to use
  such an address.
- Developers often use a work email in work repositories and a personal one
  elsewhere, so a single identity per user is not enough.
- A repository's own git configuration comes from the remote's content or
  from earlier commands, and must not decide who the user is. Front Burner
  sets the author on every commit itself.
- Password users give a display name when they are created (AO-17 for the
  first administrator). OIDC users do not; their name comes from the
  provider's ID token.
- Signing commits would need another kind of key and its own unlock flow; it
  is not part of the MVP ([mvp.md](../product/mvp.md)).

## Terms

**Commit author**
: The name and email address recorded in a commit as who made it. Front
Burner records the same person as git's _committer_. _Avoid_: "git
identity", "signature" (which means a cryptographic signature).

**Default commit author**
: The commit author that a user's commits use in every repository that has
no override. Part of the user preferences.

**Repository override**
: A commit author set for one repository of one user, used instead of the
default commit author for that repository's commits.

## Requirements

### General

- **CA-1** Every commit that the backend makes for a user, in any of their
  repositories, records the commit author that applies to that repository
  (CA-6) as both git's author and committer. This includes commits the user
  makes, merge commits made by a pull, commits that finish a conflict
  resolution, and automatic commits (D-2.3) when the Simple level is added.
- **CA-2** The backend sets the commit author on every commit itself. It
  never uses `user.name`, `user.email` or similar settings from the working
  copy's configuration, the remote's content or the environment. _(My call:
  for example with `-c user.name=… -c user.email=…` or the `GIT_AUTHOR_…` and
  `GIT_COMMITTER_…` variables, A-5.10.)_
- **CA-3** The commit author belongs to the user. Other users, administrators
  included, can neither see nor change a user's commit author or
  repository overrides (vision goal 7).
- **CA-4** The backend enforces every rule in this requirement, including the
  checks of CA-10 (vision goal 12).
- **CA-5** Changing the commit author affects only commits made afterwards.
  Commits already made, pushed or not, are never rewritten.

### Which commit author applies

- **CA-6** A commit in a repository uses the repository override, if that
  repository has one, and the user's default commit author otherwise.
- **CA-7** The default commit author starts as:
  - **name**: the user's display name. For an OIDC user, the display name is
    taken from the ID token at account creation: the `name` claim, otherwise
    `preferred_username`, otherwise the part of the email before `@`;
    _(My call.)_
  - **email**: the user's email address (the username of a password user,
    the email from the ID token for an OIDC user).

  These are copied into the user preferences when the account is created.
  Later changes to the account's display name or email do not change the
  default commit author once it has been confirmed (CA-12) or edited.
  _(My call.)_
- **CA-8** A repository has no override until the user sets one. Removing
  the override makes the repository use the default commit author again.

### Where it is shown and changed

- **CA-9** The commit author can be seen and changed:
  - in the user preferences, on a **Preferences** page reached from the
    web client's user menu, which shows the default commit author with
    **Edit**; _(My call: the route is `/preferences`.)_
  - for a repository, on the repository management page, which shows the
    commit author in use and whether it is the default or an override, with
    **Use a different author for this repository** or **Use my default**;
  - on the commit screen (git requirement), which always shows "Committing
    as _Name &lt;email&gt;_" with **Change**. **Change** edits the override
    of that repository, or the default, as the user chooses in the same
    dialog. _(My call.)_
- **CA-10** A name and an email are both required. The backend refuses, with
  the reason shown next to the field:
  - a name that is empty after trimming spaces, longer than 255 characters,
    or that contains `<`, `>` or a line break;
  - an email that is empty, longer than 254 characters, contains `<`, `>`,
    spaces or a line break, or does not have the form `local@domain` with
    something on both sides of a single `@`.

  Any domain is allowed, including ones without a dot (internal servers) and
  providers' noreply addresses. _(My call: git accepts almost anything; these
  checks only keep out what would break the commit header.)_
- **CA-11** The email field explains what the email is for: "Shown in the
  commit history to everyone who can read the repository. To keep your email
  private, use your provider's noreply address." with a link to the
  provider's help for GitHub and Bitbucket. _(My call: the links are fixed
  at launch, like the providers in D-8.2.)_

### First commit

- **CA-12** Until the user confirms their commit author, their first commit
  in any repository first shows the commit author that would be used
  (CA-6), prefilled, with the explanation of CA-11, and two choices:
  - **Commit as _Name &lt;email&gt;_**, which confirms it and goes on with
    the commit;
  - **Change**, which lets the user edit it, as the default or as an override
    for this repository, and then commit.

  Cancelling cancels the commit. Once confirmed, the question is not asked
  again, in any repository. Editing the default commit author on the
  Preferences page also counts as confirming it. _(My call.)_
- **CA-13** The confirmation applies to the user, not to a repository or a
  device, and is stored by the backend. The backend refuses a commit, with an
  error code, while the user has not confirmed, so that every client asks
  (vision goal 12). _(My call.)_
- **CA-14** A merge commit made by a pull, or the commit that finishes a
  conflict resolution, asks as in CA-12 if it is the user's first commit.

### Signing

- **CA-15** Commits are not signed. When a push is refused because the
  remote requires signed commits, the push error says so in plain words.
  _(The error handling belongs to the git requirement; signing may come
  later.)_

## Acceptance criteria

1. A new password user's default commit author is their display name and
   email. A new OIDC user's is the `name` claim and email from the ID token;
   without a `name` claim, it is `preferred_username`, then the part of the
   email before `@`.
2. The user's first commit asks them to confirm "Commit as _Name
   &lt;email&gt;_" or **Change** it; cancelling makes no commit. The second
   commit, in any repository, does not ask.
3. A commit records the confirmed name and email as both author and
   committer, as `git log --format='%an <%ae> / %cn <%ce>'` shows.
4. A working copy whose `.git/config` sets `user.name` and `user.email` to
   other values still records the user's commit author.
5. Setting an override for repository A makes commits in A use it, while
   commits in repository B keep using the default. **Use my default** in A
   brings back the default.
6. The commit screen shows "Committing as _Name &lt;email&gt;_" for the
   author that will be used. **Change** updates it, as the default or for
   that repository.
7. `12345+user@users.noreply.github.com` and `me@nas` are accepted. A name
   with `<`, an email without `@`, and an email with a space are refused with
   a reason next to the field, by the web client and by the API.
8. Changing the default commit author does not change commits already made.
9. A merge commit made by a pull and the commit that finishes a conflict
   resolution use the same commit author as other commits in that
   repository.
10. The API refuses a commit from a user who has not confirmed their commit
    author, and the web client asks as in criterion 2.
11. No other user, administrator or not, can read or change a user's commit
    author through the API.

## Out of scope

- Signing commits (GPG or SSH signatures).
- Several saved identities to pick from, and rules that pick an identity
  from the remote's host or organisation.
- Rewriting the author of existing commits.
- Administrators setting a user's commit author, for example when adding a
  repository on their behalf.
- Showing commit authors in a commit history view.
- `Co-authored-by` and other trailers, except the automatic commit trailer
  of D-2.3.

## Open questions

None at the moment.
