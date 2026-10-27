# Front Burner — Git engine

> Status: **Draft**

How the backend runs git on working copies, passes credentials, and restricts
where git may connect. Lives in `server/git` (A-2). See
[overview.md](overview.md) for the numbering conventions.

## A-5: Running git

- **A-5.1** Git is the `git` command-line program, run through our own thin
  wrapper (not `simple-git`), so that we control everything below:
  - every command is spawned with an argument array, never through a shell;
  - the environment is built from scratch: `HOME` set to an empty private
    directory, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
    `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C` (NF-11.7); from the backend's own
    environment only `GIT_SSL_CAINFO`, `SSL_CERT_FILE` and `SSL_CERT_DIR` are
    passed through when set, so that an operator with a private certificate
    authority can point git at it (AR-43); _(my call)_
  - hardening is passed as `-c` options on every call: `protocol.allow=never`,
    `protocol.https.allow=always`, `protocol.ssh.allow=always` (NF-11.6),
    `core.hooksPath=/dev/null`, `core.autocrlf=false`,
    `submodule.recurse=false`;
  - every run has a timeout (`FRONT_BURNER_CLONE_TIMEOUT` for clones,
    `FRONT_BURNER_GIT_TIMEOUT` otherwise, NF-11.8) and a cap on the output it
    reads; on timeout or shutdown the whole process group is killed;
  - output is read in machine-readable forms only (`--porcelain=v2 -z`, `-z`,
    `--format` with explicit separators);
  - stderr is kept for the log, with credentials removed from any URL (NF-10.5),
    and mapped to error codes (A-3.8).
- **A-5.2** Submodules and Git LFS objects are not fetched (AR-50).

## A-5: One operation at a time per working copy

- **A-5.3** An in-memory **working-tree lock** per repository serialises
  everything that reads or changes the working tree or index: saves, uploads,
  renames, deletes, status, commit, merge, rebase, branch switches and
  resolutions (per-working-copy serialisation in decisions.md). It is in memory
  because there is one process (NF-4.2). _(My call.)_
  - **Network steps do not hold it.** Fetch and push only touch the object store
    and refs, so they run outside the lock (one network operation per repository
    at a time); a pull is a fetch outside the lock followed by a merge inside
    it. A save therefore waits only behind short local operations, never behind
    a slow remote, which keeps NF-2.3.
  - Listing folders and reading files go straight to the file system and do not
    wait at all, so the file tree stays fast (NF-2.1).
  - While a resolution lock is held (D-3.5) or a merge or rebase is in progress
    (D-4.4), the queue refuses saves and operations that the lock does not
    allow, with an error code.

## A-5: Credentials

The decrypted secret never leaves the backend process (AR-17, AR-31). Confirmed
by spike 1 (spikes.md).

- **A-5.4** For each git command that needs credentials (clone, fetch, push,
  access check), the backend opens a **broker**: a new `0700` directory under
  `/tmp` holding its sockets and per-command files. The directory is removed
  when the command ends.
  - **HTTPS:** `GIT_ASKPASS` points to a tiny helper that sends git's prompt and
    the command's **one-time token** to the broker's socket and prints the
    username or password it gets back. The broker answers only prompts for the
    expected host and username, at most a few times per command. The secret
    never appears on a command line, in a URL, in an environment variable or in
    a file.
    - The helper ships in the image. It cannot be written to `/tmp`, which is
      mounted `noexec` (NF-11.13).
    - The token is a capability for this command, not the secret. It sits in
      git's environment, which any process with the same UID can read, so it
      does not protect against such processes. The container and its single UID
      are the boundary.
    - Usernames: `x-access-token` for GitHub tokens and `x-token-auth` for
      Bitbucket repository access tokens.
  - **SSH:** the broker serves the **ssh-agent protocol** on a second socket.
    `ssh` asks it to sign; the private key never leaves the backend's memory.
    - The protocol server is our own small implementation (requests identities,
      sign, and failure for anything else, including
      `session-bind@openssh.com`), using `ssh2` only to parse keys and sign.
      _(My call: `ssh2`'s agent server does not skip the body of messages it
      does not know, so OpenSSH 8.9 and later, which sends `session-bind` before
      every login, gets out of sync and fails. The spike worked around it with a
      framing filter.)_
    - The agent signs only SSH login requests (`publickey` or
      `publickey-hostbound-v00@openssh.com`) for the user `git` with the
      operation's key, at most a few per command, so the socket is not a general
      signing service. The ssh-agent protocol has no room for a token; the
      `0700` directory and this rule protect the socket.
    - git runs `ssh` through `GIT_SSH_COMMAND=ssh -F <per-command config>`. `-F`
      is required: `ssh` reads `~/.ssh` from the home directory in
      `/etc/passwd`, not `$HOME`, and `-F` skips both the user's and the
      system's configuration. The paths are ours, so the shell git uses for
      `GIT_SSH_COMMAND` sees no user input.
    - The config sets `IdentityAgent` to the socket, `IdentitiesOnly yes` with
      `IdentityFile` pointing at the public key (written to the broker
      directory; ssh needs it to pick the agent's key), `BatchMode yes`,
      `StrictHostKeyChecking yes`, `GlobalKnownHostsFile /dev/null`,
      `UpdateHostKeys no`, `PreferredAuthentications publickey`, and turns off
      forwarding, `ControlMaster` and `PermitLocalCommand`.
    - `ssh` needs no `/etc/passwd` entry for the container UID.
- **A-5.5** Unlocked keys (AR-31) are held in memory per session, with their
  idle timer. A clone job takes its own copy when queued (AR-49), held in the
  job runner's in-memory map (A-6.3). Background jobs use unlocks as follows:
  - a **Simple-level sync cycle** uses the unlock of the session that made the
    last save to the repository, and that use counts as use by that session, so
    a user who keeps writing stays unlocked;
  - a **background fetch** uses the unlock of the session viewing the repository
    (A-3.12), but that use does **not** reset the idle timer, so an open tab
    never keeps a key unlocked on its own (D-2.7);
  - a job never borrows an unlock from the user's other sessions. Without a
    usable unlock, a sync cycle commits and reports "saved but not uploaded"
    (D-2.6), and a fetch is skipped.
  - Checking a passphrase runs the key's bcrypt KDF synchronously, and the round
    count is chosen by whoever made the key. Keys with more than 100 rounds are
    refused before the KDF runs (`kdf-rounds-too-high` on the private key;
    `ssh-keygen` uses 16 by default), and unlock attempts are in their own
    rate-limit group. _(Plan 10's call.)_
  - "Removed from memory" means the backend drops its last reference to the key.
    JavaScript cannot wipe strings, and `ssh2` keeps the decrypted key as a PEM
    string until garbage collection. _(My call: accepted. Anyone who can read
    the backend's memory can also use an unlocked key directly, and the only
    other processes in the container are the git and `ssh` processes the backend
    starts.)_
- **A-5.6** **Known hosts:** the user's known hosts, plus the instance-wide list
  (the built-in GitHub and Bitbucket keys, or the operator's
  `FRONT_BURNER_KNOWN_HOSTS_FILE`, AR-32), are written to a per-command file in
  the broker directory and used with `StrictHostKeyChecking=yes`.
  - The built-in list holds the full host keys (Ed25519, ECDSA and RSA) for
    `github.com` and `bitbucket.org`, taken from GitHub's `/meta` API and
    Bitbucket's published list, not only fingerprints.
  - `ssh`'s messages map to two error codes, checked in this order: "REMOTE HOST
    IDENTIFICATION HAS CHANGED" to a changed host key, then "No … host key is
    known" or "Host key verification failed" (which `ssh` prints in both cases)
    to an unknown one. The web client shows either as AR-32's dialog.
  - On an unknown host key, the engine **probes** the host for the key `ssh`
    would see: it resolves the host and connects only to addresses the AR-57
    rules allow (A-5.8), runs an SSH handshake with OpenSSH's default host key
    algorithm order (`ssh-ed25519` first) and stops at the host key, so no login
    is attempted. The error carries the key's type, fingerprint and key, which
    is stored when the user chooses **Trust**. _(Plan 8's call.)_
  - Host keys on a port other than 22 are written and stored as `[host]:port`,
    so trusting such a port does not trust port 22 or any other port. Like
    `ssh`, the engine looks a port other than 22 up only under `[host]:port`
    when it tells a changed key from an unknown one.
  - **Trust** stores a key only for a host and port that neither the user's
    known hosts nor the instance-wide list cover, in the sense above; any other
    key is refused as changed, so the endpoint cannot replace a known key or add
    a second one next to it. Trusting a key that is already known is accepted
    again. _(Plan 10's call.)_

## A-5: Address restriction

Confirmed by spike 2 (spikes.md).

- **A-5.7** All git network traffic goes through an **egress proxy** inside the
  backend process: a **SOCKS5** server on a Unix socket in the command's broker
  directory (A-5.4). It requires username/password authentication with the
  command's one-time token as the password, and accepts only `CONNECT`.
  - **HTTPS:** git's `http.proxy` is `socks5h://fb:<token>@localhost<socket
    path>` (git 2.47 or later). The `h` makes the proxy, not git, resolve host
    names. It is passed through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/
    `GIT_CONFIG_VALUE_n`, so the token stays off command lines. _(My call: SOCKS
    on a Unix socket rather than HTTP `CONNECT` on a loopback port, since curl
    cannot reach an HTTP proxy over a Unix socket, and a loopback port is open
    to every process in the container.)_
  - **SSH:** the per-command `ssh_config` sets `ProxyCommand` to a tiny helper
    shipped in the image, which opens the tunnel and joins it to stdin and
    stdout. Its target host and port come from the environment, set from the
    parsed remote URL, not from `%h`/`%p`, so a host name never passes through
    the shell that runs `ProxyCommand`.
  - The proxy turns off Nagle's algorithm (`TCP_NODELAY`) on its outgoing
    connections. Without it, an SSH session took 78 ms longer.
  - **The repository's own config can route git around the proxy:**
    `http.<url>.proxy` and `remote.<name>.proxy` beat `http.proxy` wherever it
    is set, and `""` means no proxy. Users cannot write `.git/config` (A-7.6)
    and the engine never writes these keys, so before each network command the
    engine reads the repository's config (with includes) and refuses the command
    if it holds any of `http.*proxy`, `http.*curloptResolve`, `remote.*.proxy`,
    `core.gitProxy`, `core.sshCommand`, `url.*.insteadOf`,
    `url.*.pushInsteadOf`, `include.*` or `includeIf.*`. _(My call: defence in
    depth against a bug elsewhere.)_
  - Running git in an unprivileged network namespace without network (`unshare
    -Un`) would make bypassing the proxy impossible. It works in rootless podman
    with the NF-11.13 settings, but Docker's default seccomp profile blocks
    `unshare`, so it cannot be relied on. _(My call: not used. Doing it only
    where the runtime allows would make behaviour depend on the host.)_
- **A-5.8** For each connection, the proxy resolves the host name, checks
  **every** resolved address against the AR-57 rules
  (`FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`), and connects only to the addresses it
  checked (with Happy Eyeballs across them). DNS rebinding and redirects to
  another host are covered, since every connection is checked when it is made.
  Refusals return their own error code; AR-57 shows them to the user like an
  unreachable host.
  - Addresses are checked after unwrapping embedded IPv4 addresses: IPv4-mapped
    (`::ffff:a.b.c.d`, which Docker Desktop's DNS returns for ordinary hosts),
    NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`). Numeric host forms such as
    `2852039166` resolve to the address they encode and are checked like any
    other.
  - Besides AR-57's link-local ranges, these are always blocked: `0.0.0.0/8` (on
    Linux, `0.0.0.0` reaches loopback services), `::/128`, multicast
    (`224.0.0.0/4`, `ff00::/8`) and `240.0.0.0/4`. With
    `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`, carrier-grade NAT (`100.64.0.0/10`,
    used by Tailscale and similar) and the old site-local `fec0::/10` are
    blocked too. _(My call; AR-57 may want to list them.)_
  - Host names must be valid DNS names or IP addresses; anything else is refused
    before resolving.
- **A-5.9** Access checks (`git ls-remote`, AR-55) use the same proxy and
  broker.

## A-5: Operations

- **A-5.10** The engine offers operations, not raw git commands: access check,
  clone (full or single branch, AR-49), status, list branches, fetch, commit
  (including the automatic commit of D-2.3), merge, rebase, continue and abort,
  push, read a conflict, resolve a file, create and switch branches. Features
  never build git command lines themselves.
  - The access check (`git ls-remote --symref`) returns the remote's branch
    names, sorted, and its default branch: the branch its `HEAD` points to, if
    that branch exists. An empty remote has no branches and no default branch
    (AR-37). Failures are reported as error codes (`host-unreachable`,
    `timeout`, `tls-untrusted`, `auth-failed`, `repository-not-found`,
    `branch-not-found`, `unsafe-repository-config`, `failed`, and with SSH
    `host-key-unknown` and `host-key-changed`); an egress refusal is
    `host-unreachable` (AR-57). _(My call.)_
  - The MVP requirements add: which entries of a folder are ignored (`git
    check-ignore`, FB-16); the diff of one file against the last commit (GA-14
    to GA-16); discarding selected files (GA-23); committing exactly a list of
    paths, and amending (GA-19, GA-22); whether a commit is on any remote branch
    (GA-22, GC-25, RM-18); creating a local branch that tracks a remote branch
    (GA-37); adding a pushed branch to a single-branch clone's fetch refspec
    (GA-41); starting a conflicting file over (`git checkout -m`, GC-18);
    undoing a merge by resetting to the recorded commit (GC-26); and recognising
    credential problems in git's and the server's messages (RC-5).
  - Every operation that writes a commit sets the commit author itself (CA-2),
    and every merge sets `merge.conflictStyle=merge` (GC-5), so the working
    copy's own configuration decides neither.
- **A-5.11** Conflicts are read from the index: base, ours and theirs are stages
  1, 2 and 3 (`git show :1:<path>` and so on), giving the one conflict model of
  vision goal 5.
- **A-5.12** Before a merge or rebase, the engine records the current commit in
  `sync_state` (D-4.6) and also as a ref under `refs/front-burner/`, so that
  git's garbage collection keeps it while it may be needed. _(My call.)_
- **A-5.13** Clones are made in `tmp/` and moved into place with one rename when
  they succeed (NF-5.3).
- **A-5.14** Status at 100,000 files (NF-1.4) may need git's
  `core.untrackedCache` or `core.fsmonitor`, or limiting status to the paths
  that changed. It also sets how often **Changes** can refresh after saves
  (GA-12). **Pending spike 4.**

## A-5: Recovery

- **A-5.15** On start, each working copy is checked and returned to a known
  state as NF-9.4 and NF-9.5 describe: stale `index.lock` files removed, an
  interrupted automatic merge aborted, an interrupted user merge reset to the
  recorded commit, a merge or rebase waiting for resolution left alone.
