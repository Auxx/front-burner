# Front Burner — Git engine

> Status: **Draft**

How the backend runs git on working copies, passes credentials, and
restricts where git may connect. Lives in `server/git` (A-2). See
[overview.md](overview.md) for the numbering conventions.

## A-5: Running git

- **A-5.1** Git is the `git` command-line program, run through our own thin
  wrapper (not `simple-git`), so that we control everything below:
  - every command is spawned with an argument array, never through a shell;
  - the environment is built from scratch: `HOME` set to an empty private
    directory, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
    `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C` (NF-11.7);
  - hardening is passed as `-c` options on every call:
    `protocol.allow=never`, `protocol.https.allow=always`,
    `protocol.ssh.allow=always` (NF-11.6), `core.hooksPath=/dev/null`,
    `core.autocrlf=false`, `submodule.recurse=false`;
  - every run has a timeout (`FRONT_BURNER_CLONE_TIMEOUT` for clones,
    `FRONT_BURNER_GIT_TIMEOUT` otherwise, NF-11.8) and a cap on the output
    it reads; on timeout or shutdown the whole process group is killed;
  - output is read in machine-readable forms only (`--porcelain=v2 -z`,
    `-z`, `--format` with explicit separators);
  - stderr is kept for the log, with credentials removed from any URL
    (NF-10.5), and mapped to error codes (A-3.8).
- **A-5.2** Submodules and Git LFS objects are not fetched (AR-50).

## A-5: One operation at a time per working copy

- **A-5.3** An in-memory **working-tree lock** per repository serialises
  everything that reads or changes the working tree or index: saves,
  uploads, renames, deletes, status, commit, merge, rebase, branch switches
  and resolutions (per-working-copy serialisation in decisions.md). It is in
  memory because there is one process (NF-4.2). _(My call.)_
  - **Network steps do not hold it.** Fetch and push only touch the object
    store and refs, so they run outside the lock (one network operation per
    repository at a time); a pull is a fetch outside the lock followed by a
    merge inside it. A save therefore waits only behind short local
    operations, never behind a slow remote, which keeps NF-2.3.
  - Listing folders and reading files go straight to the file system and do
    not wait at all, so the file tree stays fast (NF-2.1).
  - While a resolution lock is held (D-3.5) or a merge or rebase is in
    progress (D-4.4), the queue refuses saves and operations that the lock
    does not allow, with an error code.

## A-5: Credentials

The decrypted secret never leaves the backend process (AR-17, AR-31).
**Pending spike 1.**

- **A-5.4** For each git operation that needs credentials, the backend opens
  a **broker**: a Unix socket in a new `0700` directory under `/tmp`,
  accepting only requests that carry a one-time token for this operation.
  The directory is removed when the operation ends.
  - **HTTPS:** `GIT_ASKPASS` points to a tiny helper that sends git's prompt
    and the token to the broker and prints the username or password it
    gets back. The secret never appears on a command line, in a URL, in an
    environment variable or in a file.
  - **SSH:** the broker also serves the **ssh-agent protocol** on a second
    socket (`SSH_AUTH_SOCK`), implemented with the agent-server side of the
    `ssh2` library. `ssh` asks it to sign; the private key never leaves the
    backend's memory. `ssh` runs with `IdentitiesOnly=yes`,
    `IdentityAgent` set to the socket, `BatchMode=yes`.
- **A-5.5** Unlocked keys (AR-31) are held in memory per session, with their
  idle timer. A clone job takes its own copy when queued (AR-49), held in
  the job runner's in-memory map (A-6.3). Background jobs use unlocks as
  follows:
  - a **Simple-level sync cycle** uses the unlock of the session that made
    the last save to the repository, and that use counts as use by that
    session, so a user who keeps writing stays unlocked;
  - a **background fetch** uses the unlock of the session viewing the
    repository (A-3.12), but that use does **not** reset the idle timer, so
    an open tab never keeps a key unlocked on its own (D-2.7);
  - a job never borrows an unlock from the user's other sessions. Without a
    usable unlock, a sync cycle commits and reports "saved but not
    uploaded" (D-2.6), and a fetch is skipped.
- **A-5.6** **Known hosts:** the user's known hosts, plus the instance-wide
  list (the built-in GitHub and Bitbucket fingerprints, or the operator's
  `FRONT_BURNER_KNOWN_HOSTS_FILE`, AR-32), are written to a per-operation file
  and used
  with `StrictHostKeyChecking=yes`. An unknown or changed host key produces
  its own error code, which the web client shows as AR-32's dialog.

## A-5: Address restriction

**Pending spike 2.**

- **A-5.7** All git network traffic goes through an **egress proxy** inside
  the backend process, listening on a Unix socket or loopback port and
  accepting only requests with the operation's one-time token:
  - HTTPS: git's `http.proxy` points at it (HTTP `CONNECT`);
  - SSH: `ProxyCommand` runs a tiny helper that connects through it.
- **A-5.8** For each connection, the proxy resolves the host name, checks
  **every** resolved address against the AR-57 rules
  (`FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`), and connects to an address it has
  checked. DNS rebinding and redirects to another host are covered, since
  every connection is checked when it is made. Refusals return their own
  error code.
- **A-5.9** Access checks (`git ls-remote`, AR-55) use the same proxy and
  broker.

## A-5: Operations

- **A-5.10** The engine offers operations, not raw git commands: access
  check, clone (full or single branch, AR-49), status, list branches, fetch,
  commit (including the automatic commit of D-2.3), merge, rebase, continue
  and abort, push, read a conflict, resolve a file, create and switch
  branches. Features never build git command lines themselves.
- **A-5.11** Conflicts are read from the index: base, ours and theirs are
  stages 1, 2 and 3 (`git show :1:<path>` and so on), giving the one
  conflict model of vision goal 5.
- **A-5.12** Before a merge or rebase, the engine records the current commit
  in `sync_state` (D-4.6) and also as a ref under `refs/front-burner/`, so
  that git's garbage collection keeps it while it may be needed.
  _(My call.)_
- **A-5.13** Clones are made in `tmp/` and moved into place with one rename
  when they succeed (NF-5.3).
- **A-5.14** Status at 100,000 files (NF-1.4) may need git's
  `core.untrackedCache` or `core.fsmonitor`, or limiting status to the paths
  that changed. **Pending spike 4.**

## A-5: Recovery

- **A-5.15** On start, each working copy is checked and returned to a known
  state as NF-9.4 and NF-9.5 describe: stale `index.lock` files removed, an
  interrupted automatic merge aborted, an interrupted user merge reset to
  the recorded commit, a merge or rebase waiting for resolution left alone.
