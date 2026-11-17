# Front Burner — Data

> Status: **Draft**

The database, its main tables, migrations and how stored secrets are encrypted.
The layout of the data volume is in NF-5. See [overview.md](overview.md) for the
numbering conventions.

## A-4: Database

- **A-4.1** **SQLite** (NF-4.1) through **Drizzle ORM** on **`better-sqlite3`**,
  at `/data/db/front-burner.sqlite`. One connection, opened at startup, with
  `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL` and
  `busy_timeout=5000`. _(My call: the pragmas.)_
- **A-4.2** `better-sqlite3` is synchronous. At the scale of NF-1 queries take
  well under a millisecond; transactions stay short and never wait on git, the
  network or the file system.
- **A-4.3** All table definitions live in `server/core/database` (A-2), so that
  `drizzle-kit` generates migrations from one place. Features import the tables
  they need. _(My call.)_

## A-4: Main tables

- **A-4.4** The tables below are indicative; the requirements that use them set
  the columns.

  | Table                                 | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `users`                               | Email (username), display name, role, login method, Argon2id hash (PP-12), disabled flag, allowed git control levels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | `user_preferences`                    | Per-user preferences, such as hiding non-Markdown files, and the default commit author and whether it is confirmed (CA-7, CA-13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | `sessions`                            | LG-30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | `login_audit`                         | LG-41                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | `invitations`, `password_reset_codes` | Hashed one-time codes with expiry (LG-52 and onboarding of invited users)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | `instance_state`                      | One row: onboarding state (AO-1), pending administrator email, encryption check value (A-4.10), last version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
  | `system_settings`                     | SMTP, OIDC, automatic registration; secrets encrypted (A-4.8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
  | `saved_credentials`                   | Owner, kind (HTTPS, SSH key, provider token), name, public parts (username, public key, provider), encrypted secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | `known_hosts`                         | Owner, host, port, key type, public host key (base64; `ssh` needs the key, not only its fingerprint), fingerprint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | `repositories`                        | Owner, repository name, remote URL (no secrets), clone mode and branch, status and error label, the error's git message (without credentials, the last 4,000 characters) and the ID of the request that started the failed clone (RM-10), credential and provider token references, confirmation state when added on behalf of a user, last access time, git control level, auto-sync, merge or rebase preference, commit author override (CA-8)                                                                                                                                                                   |
  | `sync_state`                          | Per repository: last automatic sync outcome ("not uploaded" and its cause), open conflict episode and reminder status, resolution lock lease (session, expiry), commit recorded before a merge or rebase (D-4.6) and the merge commit it belongs to (GC-26), credential problems of the last fetch or pull and of the last push (RC-4, RM-8). The MVP has `repository_id`, `fetch_problem`, the remote problems `fetch_warning` and `push_problem` (A-4.5d) and the five columns of the recorded commit (A-4.5a); the sync outcome, the conflict episode and the lease belong to the Simple level and come with it |
  | `jobs`                                | A-6.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **A-4.5** A working copy's directory name is the repository's internal ID
  (NF-5.2). The merge or rebase in progress is not duplicated in the database:
  git's own state in the working copy is the source of truth.
- **A-4.5a** The commit recorded before a merge (D-4.6) is kept, in `sync_state`
  and as a ref (A-5.12), until the merge is aborted, or until the merge commit
  is pushed or undone (GC-24 to GC-26). Only then are both removed. _(My call.)_
  Aborting puts back the record of the merge before it, if it has one, so that
  **Undo merge** of that merge comes back, and leaves alone a record that is not
  the aborted merge's (A-5.12). _(Plan 80's call.)_ A successful push forgets
  the record when the merge commit is then on a remote branch. A merge pushed
  from another device, or found on a remote branch by a fetch, is not offered
  for **Undo merge**, as its commit is on a remote branch, and its record is
  forgotten at the next push from here. _(Plan 94's call.)_ The record is five
  columns of `sync_state`: `recorded_commit` and `merge_commit` (null until the
  merge is committed), `earlier_recorded_commit` and `earlier_merge_commit`,
  which hold the record of the previous merge while a new merge is applied so
  that a merge that fails can put it back, and `merge_applying` (boolean, false
  by default), true while a merge is being applied. Committing the merge clears
  the `earlier_` columns.
- **A-4.5b** Every row that belongs to one repository references it with `ON
  DELETE CASCADE`, so that removing a repository (RM-19) deletes its
  `sync_state`, warnings and jobs in the same transaction. Saved credentials and
  known hosts belong to the user, not the repository, and are kept. _(My call.)_
- **A-4.5c** State that belongs to one device is not stored by the backend: the
  last file opened, expanded folders, pane sizes and view mode (FB-8, FB-12,
  FB-14, ED-34), and the ticked files of **Changes** (GA-17) live in the
  browser. The commit author confirmation (CA-13) and everything else that must
  hold on every device is stored here.
- **A-4.5d** The record of the operations with the remote that RM-8's warnings
  come from is two columns of `sync_state`, JSON `{ code, params }` or null:
  `fetch_warning`, the `credentials-refused` or `host-key-changed` of the last
  fetch or pull that had one, cleared when any operation with the remote
  succeeds; and `push_problem`, the `credentials-refused`, `push-not-allowed` or
  `host-key-changed` of the last push that had one, cleared only when a push
  succeeds, and `push-not-allowed` also when the repository's credentials
  change. Any other failure, such as the network or a rejected push, changes
  neither, since it proves nothing fixed. `fetch_problem` stays apart: it is the
  last fetch's own problem, whatever it was, for the quiet status of GA-35, and
  a network failure must replace it there. _(Plan 107's call.)_ Outcomes are
  stored while the operation still holds the network lock (A-5.3), so that they
  land in the order the operations ran. An operation whose repository's
  credentials changed while it ran stores no warning, as it used the old ones
  (RC-19); a change of credentials that leaves the same saved credentials in
  place clears nothing. Warnings keep their params without the remote's
  messages. _(Plan 107's review.)_

## A-4: Migrations

- **A-4.6** `drizzle-kit generate` creates SQL migration files from schema
  changes; every generated file is reviewed and committed, because SQLite table
  changes may be generated as "copy into a new table". Hand-written data
  migrations sit in the same sequence.
- **A-4.7** The startup sequence (A-1.11) applies migrations itself, after the
  pre-upgrade snapshot (NF-7.1), with Drizzle's migrator. A database that has a
  migration this version does not know is from a newer version: the backend
  refuses to start (NF-7.3). A migrations folder without a journal means there
  are no migrations yet.

  - `instance_state.last_version` holds the version that last started on the
    database, written after the migrations at every start. A newer database is
    refused with "Database is from version X; restore the pre-upgrade snapshot
    to go back", X being that version, or "a newer version" when it has none.
  - The pre-upgrade snapshot is written only when migrations are pending and the
    database is not new (it has applied migrations); a database from before
    `last_version` existed is named `unknown`. The log at `info` names both
    versions and the snapshot: `Upgrading the database from 0.1.0 to 0.2.0;
    snapshot backups/pre-upgrade-v0.1.0-….sqlite`. A snapshot that fails stops
    the start before any migration, so that an upgrade never runs without its
    way back.
  - Drizzle's migrator runs all pending migrations in one transaction: a
    migration that fails leaves the database as it was, so the previous image
    still starts (NF-7.1). _(Plan 130's calls.)_

## A-4: Encryption of stored secrets

- **A-4.8** `server/core/crypto` (its `SecretBox`) is the only code that
  encrypts and decrypts stored secrets (saved credentials, SMTP password, OIDC
  client secret):
  - the key is derived from `FRONT_BURNER_ENCRYPTION_KEY` with HKDF-SHA-256
    (empty salt, info `front-burner/secrets/v1`);
  - values are encrypted with AES-256-GCM, a random 96-bit nonce per value, and
    the owning table, record ID and user ID as associated data, joined by NUL
    characters (`<table>\0<record ID>\0<user ID or empty>`, NF-8.3);
  - a stored value is `fb1.<key ID>.<base64url(nonce ‖ ciphertext ‖ tag)>`: the
    format version and a key ID (NF-7.5). The key ID is 8 base64url characters
    of HKDF with info `front-burner/key-id`, which identifies the key without
    revealing it.
- **A-4.9** Rotation (NF-8.4): with `FRONT_BURNER_ENCRYPTION_KEY_PREVIOUS` set,
  values are decrypted with whichever key their key ID names, and a background
  job (A-6) re-encrypts every value with the current key.
- **A-4.10** The check value in `instance_state` (`encryption_check`) is a known
  plaintext encrypted with the current key, stored at the first start. If it
  does not decrypt, the backend refuses to start (NF-8.5);
  `FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm` deletes every encrypted value and
  stores a new check value (NF-8.6). A reset acts only when the check value does
  not decrypt: with the right key it is ignored with a warning, so a variable
  left in place after a reset never deletes secrets again _(plan's call)_. Every
  encrypted column is nullable and registered in `ENCRYPTED_COLUMNS`
  (`server/core/database`); a reset sets them all to `null` in one transaction.
- **A-4.11** Decrypted secrets live only in local variables for the duration of
  one use, apart from unlocked SSH keys, which follow AR-31 (A-5.5).

## A-4: Snapshots

- **A-4.12** Database snapshots (NF-6.2, NF-7.1) are written with `VACUUM INTO`
  to `/data/backups/`, named with the time and version, then pruned to
  `FRONT_BURNER_DB_SNAPSHOT_KEEP`. Pre-upgrade snapshots are not pruned with the
  daily ones.

  - Names are `<prefix>-<UTC time>-v<version>.sqlite`, the time to the second
    with `:` written as `-`, so that names sort by time: the daily ones
    `front-burner-2026-11-17T09-30-15Z-v1.4.2.sqlite`. Each prefix is its own
    series; pruning one never touches another prefix's files, nor any other file
    in `backups/`, such as the operator's own copies. _(Plan 129's call.)_
  - `DatabaseSnapshots` (`server/core/database`) writes to a `.partial` file and
    renames it into place, so that a half-written snapshot never looks like a
    good one, and fsyncs the file and then the folder, so that the rename
    survives a power cut. A failure (a full disk) removes the partial file and
    changes no other snapshot; a partial file a crash left is removed by the
    next prune. A `backups/` folder removed while the instance runs is created
    again.
  - The age of a series is read from the newest name, never the file's time,
    which a restore changes. A snapshot named with a time after now was written
    while the clock was ahead: it is older than any written since, so it never
    counts as the newest and is the first to be pruned. The `database.snapshot`
    housekeeping job (A-6) writes one when the newest daily snapshot is
    `FRONT_BURNER_DB_SNAPSHOT_INTERVAL` old, or there is none.
  - A pre-upgrade snapshot's prefix is `pre-upgrade-v<old version>`, and its
    name ends with the old version too, as it holds that version's schema:
    `pre-upgrade-v0.1.0-2026-11-17T09-30-15Z-v0.1.0.sqlite`. Nothing prunes
    them; the operator removes them. _(Plan 130's call.)_
  - `backups/` is in the data directory (`DataLayout.backupsDir`), created and
    checked for writing on start with the other folders (NF-5.1, NF-5.6), never
    in the repositories directory.
