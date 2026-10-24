# Front Burner — Spikes

> Status: **Draft**

Throwaway experiments that test the riskiest parts of the architecture before
they are built. See [overview.md](overview.md) for the numbering conventions.

## A-9: How spikes are run

- **A-9.1** Each spike lives on its own `spike/<name>` branch, outside the NX
  projects, and is **never merged**.
- **A-9.2** Each is time-boxed to 1–2 days.
- **A-9.3** Findings are written back into the architecture documents: the parts
  marked **Pending spike N** are updated or replaced, and each spike below gets
  a short "Findings" paragraph.

## A-9: Spikes

### Spike 1: SSH and credential broker

- **Tests:** A-5.4, A-5.5, A-5.6 (AR-17, AR-31).
- **Builds:** the broker with the `GIT_ASKPASS` helper and the ssh-agent
  protocol served with `ssh2`.
- **Passes when:**
  - it clones and pushes to **real GitHub and Bitbucket Cloud** remotes with
    passphrase-protected Ed25519 and RSA keys, and over HTTPS with tokens;
  - no key or token appears in any file, any other process's environment or any
    command line;
  - it runs in the hardened container of NF-11.13.
- **Findings:** passed on 2026-10-22, on branch `spike/ssh-credential-broker`.
  It cloned, pushed and deleted a branch on private GitHub and Bitbucket Cloud
  repositories with passphrase-protected Ed25519 and RSA keys and over HTTPS
  with tokens, on Fedora (git 2.56, OpenSSH 10.2). It did the same in the
  NF-11.13 container (Debian trixie slim, git 2.47, `/tmp` tmpfs `noexec`), both
  as a fixed UID and as one with no `/etc/passwd` entry. Each command took
  0.7–2.5 s, mostly network.
  - **No leaks:** git's process tree (argv and environment) was sampled
    continuously, and the files git and the broker wrote and git's output were
    scanned for the tokens, the passphrases and the decrypted keys in several
    encodings. An `strace` record of every program started (324, with full argv
    and environment) contained no secret. Deliberate leaks (token in the
    environment, token in the URL) were caught by every check.
  - **Refusals:** a wrong passphrase, an unknown or changed host key, a wrong
    token, a forged broker token, a prompt for another host, and a request to
    sign anything other than an SSH login each failed as intended.
  - **Changes to the architecture** (A-5.4 to A-5.6): our own agent protocol
    server instead of `ssh2`'s, which breaks with OpenSSH 8.9 and later; `ssh
    -F` with a per-command config, since `ssh` ignores `$HOME`; the askpass
    helper ships in the image, since `/tmp` is `noexec`; the agent signs only
    login requests; the token only guards against other processes, not against
    the same UID; decrypted keys cannot be wiped from memory, only dropped.

### Spike 2: Egress proxy

- **Tests:** A-5.7, A-5.8 (AR-57).
- **Builds:** the proxy, used by git over HTTPS (`http.proxy`) and SSH
  (`ProxyCommand`).
- **Passes when:**
  - `169.254.169.254` is blocked;
  - `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS` blocks private and loopback addresses;
  - IPv6 works;
  - a DNS rebinding test and a redirect to a blocked host are both refused;
  - the proxy adds less than 50 ms per connection (NF-2.6).
- **Findings:** passed on 2026-10-22, on branch `spike/egress-proxy`, on Fedora
  (git 2.56), in rootless podman and in Docker Desktop with the NF-11.13
  settings (Debian trixie slim, git 2.47 with GnuTLS curl).
  - **Real remotes:** clone, push and branch delete on GitHub and Bitbucket
    Cloud over HTTPS and SSH worked with git in a network namespace without
    network, so every connection went through the proxy. Bitbucket was reached
    over IPv6 for both protocols; GitHub has no IPv6 address.
  - **AR-57:** `169.254.169.254` was refused as an address, in decimal,
    IPv4-mapped and NAT64 forms, as a name resolving to it and over SSH; so were
    `fe80::1` and `0.0.0.0`. Loopback was reachable by default and refused with
    `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`, as were `10.0.0.1`, `100.64.0.1` and
    `fd00::1`. Redirects from an allowed server to the metadata address,
    directly or by name, were refused at the second hop. A name resolving to a
    public and a blocked address was refused, and a name alternating between
    them was checked on each connection, with connections made only to checked
    addresses (simulated with a test resolver, not a public rebinding service).
  - **Cost:** under 1 ms inside the proxy (resolving and checking). Per
    connection, HTTPS added 1–23 ms and SSH 33–47 ms, the upper figures under
    Docker Desktop. SSH stays close to the 50 ms limit because every round trip
    passes through the helper and the proxy; well within NF-2.6's 1 s.
  - **Changes to the architecture** (A-5.7, A-5.8): SOCKS5 on a Unix socket
    instead of HTTP `CONNECT`; settings passed through `GIT_CONFIG_*` variables;
    the SSH helper's target from the environment; `TCP_NODELAY` upstream; a
    check of the repository's config before each network command, since
    `http.<url>.proxy` and `remote.<name>.proxy` in `.git/config` route git
    around the proxy; no network namespace, since Docker's default seccomp
    profile blocks it; embedded IPv4 addresses unwrapped; more always-blocked
    and private ranges.

### Spike 3: Preview under the strict CSP

- **Tests:** A-8.11 to A-8.13 (D-7.8, NF-11.1).
- **Builds:** Angular with remark, Shiki (JavaScript regex engine, CSS classes)
  and DOMPurify, plus CodeMirror, under the exact NF-11.1 policy with a nonce
  and Trusted Types; with and without a Web Worker.
- **Passes when:**
  - there are no CSP or Trusted Types violations;
  - a 200 KB file's preview updates within 300 ms on a mid-range phone (NF-2.5),
    and typing stays within NF-2.4;
  - the initial bundle stays within 300 KB gzipped (NF-2.9).
- **Findings:** passed on 2026-10-22, on branch `spike/preview-csp` (Angular 22,
  CodeMirror 6, Shiki 4, DOMPurify 3), with one exception at 1 MB. Timings come
  from Chromium with the CPU slowed 4× on a phone-sized viewport, standing in
  for a mid-range phone; Chromium does not slow workers, so worker times are
  desktop speed.
  - **CSP and Trusted Types:** no violations in Chromium 156, Firefox 157 or
    WebKit 27.2 (all enforce Trusted Types), with the pipeline on the main
    thread or in a worker, for a 200 KB document and for a document of XSS
    payloads, which rendered without any script, handler, style or dangerous
    URL. It took four changes: `base-uri 'self'` (NF-11.1), no critical CSS
    inlining, a Trusted Types policy for the worker URL (A-8.13), and stripping
    hostile markup before DOMPurify, since Chrome reports what DOMPurify's inert
    document meets (A-8.12).
  - **Bugs found:** Shiki 4's `transformerStyleToClass` leaves token colours
    inline (replaced, D-7.5); the Angular builder resolves workers with the
    `browser` condition, which loads DOM code into the worker (fixed with the
    `worker` condition, A-8.13).
  - **NF-2.5:** re-rendering the whole 200 KB file took 0.8–0.9 s, so the
    preview renders incrementally, by block (A-8.12). It then updated 120–130 ms
    after the last keystroke, debounce included. The first render of the file
    took about 3 s on the main thread and about 1 s in the worker.
  - **NF-2.4:** with previews updating, typing in the 200 KB file stayed at or
    below 40–48 ms. In the 1 MB file the editor alone took 40–56 ms, at the
    limit; with the preview visible, 10–17 of 48 keystrokes went over 50 ms
    (worst 88 ms), hence no visible preview while typing on phones. This needs
    checking on a real mid-range phone.
  - **NF-2.9:** the initial JavaScript was 65.5 KB gzipped. The editor's lazy
    chunk was 224 KB and the worker 164 KB (A-8.11, A-8.13).

### Spike 4: Git at 100,000 files

- **Tests:** A-5.14 (NF-1.4, NF-2.10).
- **Builds:** timings of `git status`, `git diff` and an automatic commit on a
  Linux kernel clone, on the reference host, with and without
  `core.untrackedCache`, `core.fsmonitor` and path-limited status.
- **Passes when:** saves, automatic commits and status checks are fast enough
  for NF-2.3 and NF-2.6, and the findings say which settings are needed.
- **Findings:** _pending._
