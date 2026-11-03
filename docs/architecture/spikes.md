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
- **Findings:** passed on 2026-11-03, with no git setting needed and one problem
  found: a stale index (below). Measured with a throwaway harness outside the
  workspace (plan 45), not kept, so there is no `spike/` branch.
  - **Machine: not the reference host.** Two threads of one core of an Intel
    i7-12700K and a 4 GB memory limit stood in for 2 vCPU and 4 GB; the disk was
    a Crucial P310 NVMe SSD in a USB enclosure, with btrfs (zstd). This core is
    probably faster than a typical vCPU, and git 2.56 was used, not the 2.47 of
    the image in spike 1, so **the numbers are re-checked with the release
    checks** (`docs/wiki/todo.md`).
  - **Method:** a shallow clone of Linux 7.4-rc1, with the engine's exact
    command lines and environment. Five runs each, three for the stale index;
    the median and the worst. Warm runs had 97,348 files. Cold runs had exactly
    100,000 (2,652 small files added), which adds about 8 ms to a warm clean
    status (105 ms against 97 ms). Cold means `drop_caches` before each run; a
    status then read about 126 MB from the disk. The clone has one commit, so a
    long history is not covered, and pull and push were not timed.

    | Command                                  | Warm, median / worst | Cold, median / worst |
    | ---------------------------------------- | -------------------- | -------------------- |
    | Status, clean                            | 97 / 99 ms           | 1,389 / 1,410 ms     |
    | Status, 10 changed files                 | 98 / 98 ms           | 1,449 / 1,668 ms     |
    | Status, 10,000 new files in one folder   | 112 / 113 ms         | 1,425 / 1,475 ms     |
    | Status limited to one file, clean        | 15 / 16 ms           | 95 / 173 ms          |
    | `git diff HEAD` of one file              | 10 / 11 ms           | 94 / 180 ms          |
    | The `git ls-files` of a save             | 10 / 11 ms           | 90 / 118 ms          |
    | A whole save of 50 KB, with its fsyncs   | 26 / 34 ms           | not taken            |
    | Commit of 2 files, all of plan 52's git  | 298 / 298 ms         | 1,665 / 1,760 ms     |
    | Status, stale index                      | 3,215 / 12,444 ms    | 13,993 / 13,997 ms   |
    | The same, after one refresh of the index | 98 / 98 ms           | 1,315 / 1,351 ms     |

  - **`core.untrackedCache`:** no gain, warm or cold, even with an index written
    with it first. Not needed.
  - **`core.fsmonitor`:** not usable. Debian trixie's git 2.47.3 refuses with
    `fsmonitor--daemon not supported on this platform`. With git 2.56 it took a
    warm status from 97 ms to 56 ms, for a daemon per repository of 4–6 MB,
    which the targets do not need. Its true cold time was not taken.
  - **Path-limited status** is about six times faster warm and about fifteen
    times faster cold, but it cannot replace the full status, which has to find
    changes anywhere. `GitEngine.diff` uses it already. No other use is needed.
  - **NF-2.3:** a save stays well inside 200 ms, except one that arrives during
    a commit, because both hold the working-tree lock: it waits up to 298 ms
    warm and 1.7 s cold. Accepted: typing is not blocked, the browser draft
    holds the edits, plan 53 flushes saves before a commit, and an automatic
    commit follows a minute without changes.
  - **NF-2.6:** not timed, since nothing here uses the network. A full cold
    status alone takes more than its 1 s, so nothing should run one on the way
    to a pull or a push without measuring it; plan 56's push plans none.
  - **NF-2.8:** a cold status and a cold commit (worst 1.76 s) are close to
    "about 2 seconds" on this machine, and may pass it on a slower host. The
    release checks decide.
  - **`STATUS_REFRESH_MS` is 2,000 ms:** warm status × 2 is about 200 ms, well
    under the default. A-5.14 records it.
  - **A stale index is the problem found.** After a restore (NF-6.5) every
    file's stat differs from the index, so git must read and hash every file. It
    was simulated by changing every file's modification time; a real restore was
    not tried. Status then takes 3.2 s warm and 14 s cold, **past the 10 s
    `LOCAL_TIMEOUT_MS`**. The warm worst of 12.4 s is the first of the three
    runs, which read the files from the disk. It does not get better by itself,
    since `--no-optional-locks` keeps status from writing what it learned. One
    `git update-index -q --refresh` fixes it, and takes 3.2 s warm and 14 s
    cold, one run each. **Decision:** recovery on start refreshes each index
    (A-5.15, NF-9.4).
