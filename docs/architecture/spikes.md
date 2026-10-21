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
- **Findings:** _pending._

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
