# REQ-REPO-002: Repository credentials and key unlock

> Status: **Accepted**

## Summary

A repository's credentials are chosen when it is added
([REQ-REPO-001](repo-add.md)), but later git operations — fetch, pull and, above
all, push ([REQ-GIT-002](git-advanced.md)) — can still fail because of them.
This requirement covers how the user fixes that without leaving the repository
screen:

- the **Repository credentials** dialog adds credentials to a repository that
  has none, or replaces them, with the same choices as when the repository was
  added;
- when the remote refuses **saved HTTPS credentials**, for example because a
  token expired, the user can **update the token in place**, which fixes every
  repository that uses those credentials;
- a **passphrase-protected key** that is not unlocked is unlocked from a banner
  when the repository is opened, or from a dialog when the user starts a pull or
  push, which then carries on;
- when an SSH server's **host key changes**, the user can check and trust the
  new key, behind a strong warning.

## Context

- A repository can be added with read access only: as a public repository
  without credentials (AR-22), or with a token or key that can read but not
  push. The user finds out when they first push.
- Tokens expire and are revoked. Users often save one token and use it for many
  repositories (AR-19), so when it expires all of them fail at once. Updating
  the saved token fixes all of them. Managing saved credentials as a list is
  deferred ([mvp.md](../product/mvp.md)).
- A passphrase-protected key is unlocked once per session and kept only in
  memory (AR-31). After a restart, a new login or the unlock idle time, it is
  locked again, and fetch, pull and push cannot run until the user enters the
  passphrase.
- Background fetches (GA-33) must not open dialogs on their own (GA-35), but the
  user should know why remote changes are not being checked.
- Providers rotate SSH host keys from time to time. Without a way to accept a
  new key, a repository would stay unusable until known-hosts management exists;
  a changed key can also mean an attack, so accepting it must be deliberate.
- Every rule of REQ-REPO-001 about storing and protecting credentials still
  holds: encryption at rest, never returned by the API, never logged, never on a
  command line or in a URL (AR-17).

## Terms

**Repository credentials dialog**
: The dialog described in this requirement, in which the user adds or replaces a
  repository's credentials. Also used by the repository management page.

**Credential problem**
: A failed git operation whose cause is the repository's credentials: none set,
  refused, not allowed to push, a locked key, or a changed host key.

**Locked key**
: A passphrase-protected SSH key that is not unlocked in the current session
  (AR-31).

## Requirements

### General

- **RC-1** Everything in this requirement acts only on the logged-in user's
  repositories, saved credentials and known hosts, and the backend enforces it
  (AR-56, vision goal 12).
- **RC-2** The rules of REQ-REPO-001 for credentials apply unchanged: AR-17,
  AR-18, AR-20, AR-24 to AR-28, AR-29's key generation, AR-31's unlock, and
  AR-32's host keys except where RC-21 to RC-24 extend them. Every connection
  follows the address rules of AR-57.
- **RC-3** A git operation that fails because of a credential problem reports it
  with an error code saying which problem it is (RC-4), so that every client can
  offer the right fix. _(Vision goal 12.)_

### Reporting credential problems

- **RC-4** A fetch, pull or push that fails because of its credentials says, in
  the place where the operation was started (the header or a notice):

  | Problem                                                        | Message                                                         | Offers                            |
  | -------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- |
  | The repository has no credentials, and the remote needs them   | "This repository has no credentials. Add credentials to push."  | **Add credentials** (RC-7)        |
  | The remote refused the credentials (wrong, expired or revoked) | "The remote refused your credentials."                          | **Fix credentials** (RC-7, RC-12) |
  | The credentials work, but may not push                         | "Your credentials can read this repository but not push to it." | **Use other credentials** (RC-7)  |
  | The key is locked                                              | "Unlock _&lt;key name&gt;_ to continue."                        | **Unlock** (RC-16)                |
  | The server's host key changed                                  | "The server's identity has changed. This may be an attack."     | **Review the new key** (RC-21)    |

  For a public repository without credentials, fetch and pull work anonymously;
  only push asks for credentials.
- **RC-5** The backend tells "refused" from "may not push" from git's and the
  server's messages where it can, for example an HTTP 403 response or a server
  message that the key is read-only. When it cannot tell, it reports "The remote
  refused your credentials." and shows the remote's own messages as plain text
  (GA-31). _(My call: the messages recognised are left to the builder and kept
  in one place in the git engine.)_
- **RC-6** A credential problem found by a background fetch never opens a dialog
  on its own. On the repository screen it is shown in the header's quiet status
  (GA-35), with the same fix; elsewhere it is shown as a repository warning
  (RM-8).

### Repository credentials dialog

- **RC-7** The repository credentials dialog shows the repository's name and
  remote (as in DS-18), the credentials in use, if any (their name, and for an
  SSH key its type and fingerprint), and the choices for the remote's protocol,
  as on the Add repository page:
  - for HTTPS: **Use saved credentials**, **Add new credentials** and **No
    credentials (public repository)** (AR-19, AR-20);
  - for SSH: **Use a saved key**, **Paste a key** and **Generate a key** (AR-23
    to AR-30), including the passphrase field for a locked key.

  The protocol cannot be changed here; changing the remote is out of scope.
- **RC-8** On **Save**, the backend runs an access check (AR-41, step 2) with
  the chosen credentials. If it passes, the repository uses them from then on
  and new credentials are saved to the user's profile; if it fails, the dialog
  shows the error as on the Add repository page (AR-42) and nothing changes. The
  access check proves read access only, so the dialog says: "Make sure these
  credentials can also push." _(My call.)_
- **RC-9** After saving, the operation that failed (RC-4) runs again on its own.
  _(My call.)_
- **RC-10** Replacing a repository's credentials never deletes the old saved
  credentials or keys from the user's profile. Other repositories that use them
  are not affected.
- **RC-11** The dialog opens from the fixes in RC-4, and from the repository
  management page ([REQ-REPO-003](repo-manage.md)).

### Updating saved HTTPS credentials in place

- **RC-12** When the remote refused **saved HTTPS credentials**, **Fix
  credentials** opens the dialog with two choices at the top:
  - **Update the token of _&lt;credentials name&gt;_**, the default, which says
    how many of the user's repositories use those credentials, for example "Used
    by 4 of your repositories". It shows the username, which can be changed, and
    a new **Password or token** field (AR-20);
  - **Use other credentials for this repository**, which shows the choices of
    RC-7.
- **RC-13** **Update** runs an access check against this repository with the new
  username and token. When it passes, the saved credentials are replaced,
  encrypted as before (AR-17), and every repository that uses them uses the new
  token from then on. Other repositories are not checked. _(My call.)_
- **RC-14** Updating is offered only for saved HTTPS credentials. A refused SSH
  key usually means it was removed on the server, so the dialog offers the
  choices of RC-7 instead, with the hint "Check that this key is still added to
  your git server, or use another key."

### Unlocking keys

- **RC-15** When the user opens a repository whose key is locked, the repository
  screen shows a banner that does not block anything else: "_&lt;key name&gt;_
  is locked. Unlock it to fetch, pull and push." with **Unlock**. Background
  fetches for that repository do not run until the key is unlocked. The banner
  can be dismissed for the rest of the visit. _(My call.)_
- **RC-16** **Unlock**, from the banner or from RC-4, opens a dialog with the
  key's name, type and fingerprint and a masked, required **Passphrase** field.
  A correct passphrase unlocks the key for the session as in AR-31, and the
  banner goes away from every repository that uses the key.
- **RC-17** When the user starts a pull or push and the key is locked, the
  dialog opens at once; after a successful unlock, the pull or push carries on
  without being started again. Cancelling the dialog cancels the operation.
- **RC-18** A wrong passphrase shows "Wrong passphrase" on the field. The
  backend accepts at most **5** wrong passphrases per key per user per minute;
  more get "Too many attempts. Try again in a minute." _(My call, in line with
  AR-55.)_
- **RC-19** A fetch, pull or push that runs as a job (GA-3) takes its own
  in-memory copy of the decrypted key when it is queued and drops it when it
  ends, as a clone does (AR-49, A-6.3). It therefore finishes even if the unlock
  ends meanwhile. It does not extend the unlock.
- **RC-20** Unlocking is per session (AR-31): the user's other devices still
  show the banner until the key is unlocked there.

### Changed host keys

- **RC-21** **Review the new key** opens a dialog that says "The server's
  identity has changed. This may be an attack." and explains that this also
  happens when a provider replaces its keys. It shows:
  - the host and port;
  - the fingerprint that was trusted (built in or accepted, AR-32) and the new
    one, both as key type and SHA256 fingerprint;
  - for `github.com` and `bitbucket.org`, a link to the provider's published
    fingerprints.
- **RC-22** **Trust the new key** is enabled only after the user ticks "I have
  checked the new fingerprint with the server's owner." It replaces the trusted
  fingerprint for that user, host and port, and the failed operation runs again
  (RC-9). **Cancel** changes nothing.
- **RC-23** For `github.com` and `bitbucket.org`, trusting a new key applies to
  that user only; it does not change the built-in fingerprints, which only the
  operator can change (AR-32). _(My call.)_
- **RC-24** Accepting a changed host key is recorded in the backend log at
  `info` level, with the user ID, host, port and both fingerprints, and without
  any secret. _(My call: a changed key is a security event worth keeping a trace
  of.)_

### Accessibility

- **RC-25** The dialogs and the banner meet NF-13. The banner is announced once
  to screen readers when it appears; the dialogs move focus to their first field
  and return it when they close.

## Acceptance criteria

1. Pushing a public repository added without credentials says "This repository
   has no credentials. Add credentials to push." **Add credentials** opens the
   dialog with the HTTPS choices; after saving credentials that pass the access
   check, the push runs again on its own.
2. Fetching and pulling that repository work without credentials.
3. Pushing with a read-only token says "Your credentials can read this
   repository but not push to it." **Use other credentials** fixes it.
4. With an expired saved token used by four repositories, a push says "The
   remote refused your credentials." **Fix credentials** offers **Update the
   token of "GitHub work"** with "Used by 4 of your repositories". After
   updating, pushes from all four repositories use the new token.
5. An update whose access check fails shows the error and changes nothing.
6. Replacing a repository's credentials with others keeps the old saved
   credentials in the profile, and other repositories that use them keep
   working.
7. The dialog for an SSH repository offers only SSH choices; a refused key shows
   the hint to check the key on the git server.
8. After a backend restart, opening a repository with a passphrase-protected key
   shows the locked-key banner, and no background fetch runs. Unlocking from the
   banner makes fetches resume and removes the banner from every repository that
   uses the key.
9. Starting a push with a locked key opens the passphrase dialog; after
   unlocking, the push carries on without being started again. Cancelling
   cancels the push.
10. A sixth wrong passphrase within a minute gets "Too many attempts. Try again
    in a minute."
11. A push that is running finishes even if the user logs out meanwhile.
12. A changed host key shows both fingerprints and, for GitHub, a link to the
    published fingerprints. **Trust the new key** is disabled until the checkbox
    is ticked; afterwards the failed operation runs again, and the backend log
    records the change.
13. A background fetch that meets any credential problem shows it only in the
    header's quiet status and opens no dialog.
14. No API response contains a password, token, private key or passphrase, and
    none appears in the logs.
15. A key unlocked on a desktop still shows the locked-key banner on a phone
    logged in to another session, until it is unlocked there too.

## Out of scope

- Managing saved credentials and known hosts as lists: renaming, deleting,
  changing a passphrase, reviewing all known hosts (deferred).
- Changing a repository's remote URL or protocol.
- Provider tokens and pull requests (D-8).
- Unlocking keys for the Simple level's background synchronisation (D-2.6).
- Checking push access before a push (the access check proves read access only).

## Open questions

None at the moment.
