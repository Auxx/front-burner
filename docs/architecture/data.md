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

  | Table                                 | Holds                                                                                                                                                                                                                                                                                                                                        |
  | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `users`                               | Email (username), display name, role, login method, Argon2id hash (PP-12), disabled flag, allowed git control levels                                                                                                                                                                                                                         |
  | `user_preferences`                    | Per-user preferences, such as hiding non-Markdown files, and the default commit author and whether it is confirmed (CA-7, CA-13)                                                                                                                                                                                                             |
  | `sessions`                            | LG-30                                                                                                                                                                                                                                                                                                                                        |
  | `login_audit`                         | LG-41                                                                                                                                                                                                                                                                                                                                        |
  | `invitations`, `password_reset_codes` | Hashed one-time codes with expiry (LG-52 and onboarding of invited users)                                                                                                                                                                                                                                                                    |
  | `instance_state`                      | One row: onboarding state (AO-1), pending administrator email, encryption check value (A-4.10), last version                                                                                                                                                                                                                                 |
  | `system_settings`                     | SMTP, OIDC, automatic registration; secrets encrypted (A-4.8)                                                                                                                                                                                                                                                                                |
  | `saved_credentials`                   | Owner, kind (HTTPS, SSH key, provider token), name, public parts (username, public key, provider), encrypted secret                                                                                                                                                                                                                          |
  | `known_hosts`                         | Owner, host, port, key type, fingerprint                                                                                                                                                                                                                                                                                                     |
  | `repositories`                        | Owner, repository name, remote URL (no secrets), clone mode and branch, status and error label, credential and provider token references, confirmation state when added on behalf of a user, last access time, git control level, auto-sync, merge or rebase preference, commit author override (CA-8)                                       |
  | `sync_state`                          | Per repository: last automatic sync outcome ("not uploaded" and its cause), open conflict episode and reminder status, resolution lock lease (session, expiry), commit recorded before a merge or rebase (D-4.6) and the merge commit it belongs to (GC-26), credential problems of the last fetch or pull and of the last push (RC-4, RM-8) |
  | `jobs`                                | A-6.2                                                                                                                                                                                                                                                                                                                                        |

- **A-4.5** A working copy's directory name is the repository's internal ID
  (NF-5.2). The merge or rebase in progress is not duplicated in the database:
  git's own state in the working copy is the source of truth.
- **A-4.5a** The commit recorded before a merge (D-4.6) is kept, in `sync_state`
  and as a ref (A-5.12), until the merge is aborted, or until the merge commit
  is pushed or undone (GC-24 to GC-26). Only then are both removed. _(My call.)_
- **A-4.5b** Every row that belongs to one repository references it with `ON
  DELETE CASCADE`, so that removing a repository (RM-19) deletes its
  `sync_state`, warnings and jobs in the same transaction. Saved credentials and
  known hosts belong to the user, not the repository, and are kept. _(My call.)_
- **A-4.5c** State that belongs to one device is not stored by the backend: the
  last file opened, expanded folders, pane sizes and view mode (FB-8, FB-12,
  FB-14, ED-34), and the ticked files of **Changes** (GA-17) live in the
  browser. The commit author confirmation (CA-13) and everything else that must
  hold on every device is stored here.

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

## A-4: Encryption of stored secrets

- **A-4.8** `server/crypto` is the only code that encrypts and decrypts stored
  secrets (saved credentials, SMTP password, OIDC client secret):
  - the key is derived from `FRONT_BURNER_ENCRYPTION_KEY` with HKDF-SHA-256;
  - values are encrypted with AES-256-GCM, a random 96-bit nonce per value, and
    the owning table, record ID and user ID as associated data (NF-8.3);
  - every stored value starts with a format version and a key ID (NF-7.5).
- **A-4.9** Rotation (NF-8.4): with `FRONT_BURNER_ENCRYPTION_KEY_PREVIOUS` set,
  values are decrypted with whichever key their key ID names, and a background
  job (A-6) re-encrypts every value with the current key.
- **A-4.10** The check value in `instance_state` is a known plaintext encrypted
  with the current key. If it does not decrypt, the backend refuses to start
  (NF-8.5); `FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm` deletes every encrypted
  value and stores a new check value (NF-8.6).
- **A-4.11** Decrypted secrets live only in local variables for the duration of
  one use, apart from unlocked SSH keys, which follow AR-31 (A-5.5).

## A-4: Snapshots

- **A-4.12** Database snapshots (NF-6.2, NF-7.1) are written with `VACUUM INTO`
  to `/data/backups/`, named with the time and version, then pruned to
  `FRONT_BURNER_DB_SNAPSHOT_KEEP`. Pre-upgrade snapshots are not pruned with the
  daily ones.
