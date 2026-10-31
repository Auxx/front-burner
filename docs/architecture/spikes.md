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
  - **NF-2.4 on a real phone:** the spike's branch was lost, so the check uses
    the `typing-test` page of `tools/ai-tools`, the editor alone as A-8.11 plans
    it (steps in `docs/wiki/typing-test.md`). Round 1, on 2026-10-28, on a Pixel
    6 with Android 16, Chrome 156 and Gboard, by the page's own meter (median /
    maximum, keystrokes over 50 ms) and the browser's Event Timing (maximum,
    events, not keystrokes, over 50 ms): 200 KB in the middle 13 / 49 ms, 0 of
    67; 72 ms, 4 of 133 events. 1 MB at the start 13 / 34 ms, 0 of 86; 56 ms, 6
    of 172. 1 MB in the middle 17 / 43 ms, 0 of 60; 72 ms, 28 of 120. 1 MB at
    the end with Enter 18 / 54 ms, 4 of 62; 80 ms, 32 of 144. Typing felt smooth
    throughout. Inconclusive: the page's own meter stops before the frame is on
    screen and reads low, Event Timing was counted per event rather than per
    keystroke, and there was no baseline.
  - **Round 2**, the same day and phone, with Event Timing per keystroke and a 2
    KB baseline. Per run: the page's own meter (median / maximum, keystrokes
    over 50 ms), then Event Timing (maximum, share of keystrokes over 50 ms):

    | Run                     | Own meter            | Event Timing         |
    | ----------------------- | -------------------- | -------------------- |
    | 2 KB, middle (baseline) | 12 / 28 ms, 0 of 132 | 56 ms, 2 of 132, 2%  |
    | 200 KB, middle          | 13 / 40 ms, 0 of 143 | 72 ms, 8 of 143, 6%  |
    | 1 MB, start             | 14 / 37 ms, 0 of 68  | 64 ms, 4 of 68, 6%   |
    | 1 MB, middle            | 14 / 49 ms, 0 of 67  | 72 ms, 10 of 67, 15% |
    | 1 MB, end with Enter    | 17 / 62 ms, 3 of 85  | 88 ms, 14 of 85, 16% |
    | 1 MB, after scrolling   | 14 / 55 ms, 2 of 59  | 80 ms, 7 of 59, 12%  |

    Every keystroke took at least 16 ms by Event Timing, even in the baseline,
    so the per-keystroke counts match the keystrokes typed. **Result: the 1 MB
    file fails NF-2.4** on this phone: up to 16% of keystrokes over 50 ms
    against 2% in the baseline, the page's own meter over 50 ms at the end and
    after scrolling, and the further into the file, the slower. 200 KB is
    borderline (6% against 2%, with counts too small to tell from noise). A
    Pixel 6 is at the fast end of today's mid-range, so a slower phone would do
    worse. Next: find which editor extension costs the time, then choose a
    design change (`docs/wiki/typing-test.md`, "What happens next").
  - **Round 3**, the same day and phone, switching off one part of the setup at
    a time (`docs/wiki/typing-test.md`, "Round 3"). The 1 MB runs typed at the
    end with Enter. The viewport was 760×856 CSS pixels, against 411×463 in
    round 2, so compare these runs with each other, not with round 2:

    | Run                          | Own meter           | Event Timing          |
    | ---------------------------- | ------------------- | --------------------- |
    | 2 KB, middle (baseline)      | 13 / 28 ms, 0 of 62 | 56 ms, 1 of 62, 2%    |
    | 1 MB, everything on          | 18 / 62 ms, 2 of 62 | 80 ms, 11 of 62, 18%  |
    | 1 MB, without front matter   | 18 / 75 ms, 5 of 63 | 105 ms, 14 of 62, 23% |
    | 1 MB, without highlighting   | 14 / 31 ms, 0 of 62 | 56 ms, 2 of 62, 3%    |
    | 1 MB, without soft wrap      | 22 / 78 ms, 4 of 62 | 104 ms, 15 of 62, 24% |
    | 1 MB, without spell check    | 18 / 50 ms, 0 of 64 | 72 ms, 13 of 64, 20%  |
    | 1 MB, without text direction | 23 / 69 ms, 4 of 62 | 96 ms, 18 of 62, 29%  |
    | 1 MB, all four off           | 15 / 39 ms, 0 of 62 | 50 ms, 2 of 62, 3%    |

    **Result: Markdown highlighting costs the time.** Without it, the 1 MB file
    is at the baseline (3% against 2%); switching off front matter highlighting,
    soft wrap, spell check or text direction changes nothing beyond noise, and
    all four off is no better than highlighting off alone. Emulation had pointed
    at front matter highlighting (a median of 31 ms falling to 21 ms); the phone
    did not confirm it. That the cost grows towards the end of the file points
    at the parser's work after each edit rather than at styling, but the test
    does not separate the two.
  - **Round 4**, the same day and phone, everything on, to set ED-9a's size
    limit (`docs/wiki/typing-test.md`, "Round 4"). Typed at the end with Enter
    except the baseline; the viewport was again 760×856, not portrait as asked:

    | Run                     | Speed     | Own meter           | Event Timing         |
    | ----------------------- | --------- | ------------------- | -------------------- |
    | 2 KB, middle (baseline) | 1.6 key/s | 17 / 44 ms, 0 of 60 | 72 ms, 8 of 60, 13%  |
    | 100 KB                  | 2.4 key/s | 15 / 47 ms, 0 of 67 | 64 ms, 13 of 67, 19% |
    | 200 KB                  | 2.2 key/s | 16 / 38 ms, 0 of 62 | 56 ms, 9 of 62, 15%  |
    | 500 KB                  | 2.2 key/s | 17 / 55 ms, 3 of 65 | 80 ms, 6 of 65, 9%   |

    **Result: inconclusive for the limit.** The baseline's share over 50 ms rose
    from 2% in rounds 2 and 3 to 13%, and the shares do not follow the file size
    (500 KB lowest), so at about 60 keystrokes a run Event Timing cannot tell
    these sizes apart. The page's own meter, which measures only the main
    thread's work and is steadier, has no keystroke over 50 ms up to 200 KB in
    rounds 2 and 4, and fails at 500 KB and 1 MB. **Decision:** ED-9a keeps the
    cautious 100 KB limit rather than measuring with runs of several hundred
    keystrokes; a file over it costs one tap, and preferences for the limit come
    after the MVP (`docs/wiki/todo.md`). The check is finished.
  - **Note of 2026-10-31, line numbers and the wrap-marker gutter (plan 38).**
    The typing test page gained the switches `linenumbers` (line numbers and the
    active-line gutter) and `wrapmarker`, on by default. In emulation (Chromium,
    Pixel 7, CPU slowed 4x, `1mb.md`, 50 letters typed in the middle) with
    everything on, the page's own meter read a median of 19 ms and a maximum of
    74 ms (one keystroke over 50 ms; browser timing maximum 77 ms); with
    `off=linenumbers,wrapmarker` a median of 19 ms and a maximum of 35 ms
    (browser timing maximum 37 ms). The 2026-10-28 run measured a median of 30
    ms and a maximum of 43 ms. The median is unchanged by the gutters; the
    single 74 ms keystroke was not repeated in the run without them, so it is
    within what one run of 50 keystrokes can show. Not repeated on a real phone
    yet.
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
