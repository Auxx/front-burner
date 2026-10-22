# Front Burner — Spikes

> Status: **Draft**

Throwaway experiments that test the riskiest parts of the architecture
before they are built. See [overview.md](overview.md) for the numbering
conventions.

## A-9: How spikes are run

- **A-9.1** Each spike lives on its own `spike/<name>` branch, outside the NX
  projects, and is **never merged**.
- **A-9.2** Each is time-boxed to 1–2 days.
- **A-9.3** Findings are written back into the architecture documents: the
  parts marked **Pending spike N** are updated or replaced, and each spike
  below gets a short "Findings" paragraph.

## A-9: Spikes

### Spike 1: SSH and credential broker

- **Tests:** A-5.4, A-5.5, A-5.6 (AR-17, AR-31).
- **Builds:** the broker with the `GIT_ASKPASS` helper and the ssh-agent
  protocol served with `ssh2`.
- **Passes when:**
  - it clones and pushes to **real GitHub and Bitbucket Cloud** remotes with
    passphrase-protected Ed25519 and RSA keys, and over HTTPS with tokens;
  - no key or token appears in any file, any other process's environment or
    any command line;
  - it runs in the hardened container of NF-11.13.
- **Findings:** passed on 2026-10-22, on branch
  `spike/ssh-credential-broker`. It cloned, pushed and deleted a branch on
  private GitHub and Bitbucket Cloud repositories with passphrase-protected
  Ed25519 and RSA keys and over HTTPS with tokens, on Fedora (git 2.56,
  OpenSSH 10.2). It did the same in the NF-11.13 container (Debian trixie
  slim, git 2.47, `/tmp` tmpfs `noexec`), both as a fixed UID and as one with
  no `/etc/passwd` entry. Each command took 0.7–2.5 s, mostly network.
  - **No leaks:** git's process tree (argv and environment) was sampled
    continuously, and the files git and the broker wrote and git's output
    were scanned for the tokens, the passphrases and the decrypted keys in
    several encodings. An `strace` record of every program started (324,
    with full argv and environment) contained no secret. Deliberate leaks
    (token in the environment, token in the URL) were caught by every check.
  - **Refusals:** a wrong passphrase, an unknown or changed host key, a wrong
    token, a forged broker token, a prompt for another host, and a request
    to sign anything other than an SSH login each failed as intended.
  - **Changes to the architecture** (A-5.4 to A-5.6): our own agent protocol
    server instead of `ssh2`'s, which breaks with OpenSSH 8.9 and later;
    `ssh -F` with a per-command config, since `ssh` ignores `$HOME`; the
    askpass helper ships in the image, since `/tmp` is `noexec`; the agent
    signs only login requests; the token only guards against other
    processes, not against the same UID; decrypted keys cannot be wiped
    from memory, only dropped.

### Spike 2: Egress proxy

- **Tests:** A-5.7, A-5.8 (AR-57).
- **Builds:** the proxy, used by git over HTTPS (`http.proxy`) and SSH
  (`ProxyCommand`).
- **Passes when:**
  - `169.254.169.254` is blocked;
  - `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS` blocks private and loopback
    addresses;
  - IPv6 works;
  - a DNS rebinding test and a redirect to a blocked host are both refused;
  - the proxy adds less than 50 ms per connection (NF-2.6).
- **Findings:** _pending._

### Spike 3: Preview under the strict CSP

- **Tests:** A-8.11 to A-8.13 (D-7.8, NF-11.1).
- **Builds:** Angular with remark, Shiki (JavaScript regex engine, CSS
  classes) and DOMPurify, plus CodeMirror, under the exact NF-11.1 policy
  with a nonce and Trusted Types; with and without a Web Worker.
- **Passes when:**
  - there are no CSP or Trusted Types violations;
  - a 200 KB file's preview updates within 300 ms on a mid-range phone
    (NF-2.5), and typing stays within NF-2.4;
  - the initial bundle stays within 300 KB gzipped (NF-2.9).
- **Findings:** _pending._

### Spike 4: Git at 100,000 files

- **Tests:** A-5.14 (NF-1.4, NF-2.10).
- **Builds:** timings of `git status`, `git diff` and an automatic commit on a
  Linux kernel clone, on the reference host, with and without
  `core.untrackedCache`, `core.fsmonitor` and path-limited status.
- **Passes when:** saves, automatic commits and status checks are fast enough
  for NF-2.3 and NF-2.6, and the findings say which settings are needed.
- **Findings:** _pending._
