# Typing speed check on a real phone

> Status: **Finished** on 2026-10-28. Typing in large files was too slow because
> of syntax highlighting, so on narrow screens files over 100 KB open without it
> (ED-9a). The rounds are recorded in spike 3's findings in
> `docs/architecture/spikes.md`. The steps below stay for checking again, for
> example on another phone or after upgrading CodeMirror.

How to check NF-2.4 ("keystroke shown within 50 ms on a mid-range phone", files
up to 1 MB) on a real phone, before the editor is built (`docs/product/mvp.md`,
Risks, "Typing speed on phones"). Spike 3 measured it only in emulation, at the
limit (A-8.11, `docs/architecture/spikes.md`). The result decides whether the
editor plans (step 2, part B) go ahead as outlined.

The check uses a test page, not the product: CodeMirror 6 set up as A-8.11 plans
for the editor, generated Markdown files of 2 KB to 1 MB, and two meters. It is
built and served by the `typing-test` tool in `tools/ai-tools`.

## What the meters measure

Both time each keystroke that changes the text, from its first key or input
event to the frame that shows the change:

- **The page's own meter** stops when the phone's main thread has made that
  frame, before the frame is drawn on the screen, so it reads low. It works in
  every browser, and its numbers are the ones in the header while you type.
- **The browser timing** comes from Chromium's Event Timing API, which stops
  when the frame is on the screen: that is what NF-2.4 calls "shown". The
  browser reports only events of 16 ms or more, so it counts the slower
  keystrokes, not all of them. Safari has no Event Timing, so on an iPhone only
  the page's own meter is given.

The 2 KB file is the **baseline**: what the phone, Chrome and the keyboard cost
on their own, with almost no editor work. Only time above the baseline is the
editor's.

## Step 1: Start the page

On the computer, from the workspace root:

```shell
node tools/ai-tools/src/bin/typing-test.mjs serve
```

It builds the page into `tmp/typing-test/` and prints the addresses to open on
the phone, such as `http://192.168.1.20:8080/`. Stop it with Ctrl+C.

- The phone must be on the same Wi-Fi as the computer. If the page does not
  open, the firewall is probably blocking the port; on Fedora: `sudo
  firewall-cmd --add-port=8080/tcp` (until the next reboot).
- **Android phone on USB** (optional, recommended): with USB debugging on, run
  `adb reverse tcp:8080 tcp:8080` and open `http://localhost:8080/` on the
  phone. This avoids the firewall, and **Copy results** can then use the
  clipboard directly.

## Step 2: Prepare the phone

1. Use a **mid-range Android phone** if you can, since that is what NF-2.4
   names, for example a Galaxy A5x or a Pixel "a" model. An iPhone is a useful
   extra data point, not a replacement.
2. Charge it above 50 %, turn off battery saver, and close other apps.
3. Use the current Chrome (Safari on an iPhone), in a fresh tab.
4. Use the phone's usual on-screen keyboard, with autocorrect as you normally
   have it.

## Step 3: Measure

The page has a file menu, a status ("Loading…", then "Ready: <file>"), the
buttons **Start**, **Middle**, **End**, **Reset** and **Copy results**, and the
running numbers.

Make each run with the on-screen keyboard, at your normal typing speed:

| Run | File       | Where you type                                                             | What you type                   |
| --- | ---------- | -------------------------------------------------------------------------- | ------------------------------- |
| 1   | `2kb.md`   | **Middle** (the baseline)                                                  | 50 letters (a few short words)  |
| 2   | `200kb.md` | **Middle**                                                                 | 50 letters                      |
| 3   | `1mb.md`   | **Start**                                                                  | 50 letters                      |
| 4   | `1mb.md`   | **Middle**                                                                 | 50 letters                      |
| 5   | `1mb.md`   | **End**                                                                    | 50 letters, then Enter 10 times |
| 6   | `1mb.md`   | Scroll quickly to about the middle, tap inside a paragraph, then **Reset** | 50 letters                      |

For each run:

1. Reload the page and choose the file.
2. Wait for "Ready: <file>".
3. Tap **Start**, **Middle** or **End** as the table says. That resets the
   numbers, puts the cursor in a paragraph and opens the keyboard. For run 6,
   tap in the text yourself and then **Reset**; the keyboard stays open and the
   cursor stays where you tapped.
4. Type.
5. Tap **Copy results**. If it says "Select and copy below", copy the text shown
   under the buttons by hand.
6. Paste the result into a note.

While typing, also notice:

- any lag you can see;
- the cursor hidden behind the keyboard (ED-15);
- autocorrect or word suggestions behaving oddly;
- the page jumping when you scroll.

## Step 4: Report

Paste this into the conversation with Claude, filled in:

```text
Typing check — NF-2.4
Date:
Phone: <make, model, year>
OS and browser: <e.g. Android 16, Chrome 157>
Keyboard: <e.g. Gboard>

Run 1 (2 KB, middle, baseline): <paste "Copy results" output>
Run 2 (200 KB, middle):
Run 3 (1 MB, start):
Run 4 (1 MB, middle):
Run 5 (1 MB, end + Enter):
Run 6 (1 MB, after scroll):

How it felt:
Anything odd (cursor hidden, autocorrect, scrolling jumps):
```

## Round 3: find what costs the time

Round 2 showed that the 1 MB file fails NF-2.4 and that typing gets slower the
further into the file it is (spike 3's findings). Round 3 finds which part of
the editor's setup costs the time, so that the cheapest fix can be chosen. The
page can switch off one part at a time:

| Switch        | What it turns off                                                                    |
| ------------- | ------------------------------------------------------------------------------------ |
| `frontmatter` | Highlighting YAML front matter: Markdown is still highlighted, by itself             |
| `language`    | All highlighting: no Markdown or YAML parser at all                                  |
| `wrap`        | Soft wrap: long lines scroll sideways instead                                        |
| `spellcheck`  | The browser's spell check, autocorrect and automatic capitals (Gboard keeps its own) |
| `direction`   | Working out each line's text direction for right-to-left scripts                     |

Choose the setup from the page's second menu (it shows "Everything on" at
first). The file menu and the setup menu each reload the page, and the address
keeps both, for example `?file=1mb.md&off=wrap`, so a reload keeps them too. The
status says what is off ("Ready: 1mb.md · off: wrap"), and **Copy results** has
a "switched off:" line.

Make every run of round 3 the same way as round 2's run 5: choose `1mb.md`, tap
**End**, type 50 letters, then press Enter 10 times. Only the setup changes,
except for run 1, the baseline:

| Run | File     | Setup (second menu)                                                |
| --- | -------- | ------------------------------------------------------------------ |
| 1   | `2kb.md` | Everything on; tap **Middle** instead of **End** (the baseline)    |
| 2   | `1mb.md` | Everything on                                                      |
| 3   | `1mb.md` | Without front matter highlighting                                  |
| 4   | `1mb.md` | Without Markdown highlighting, front matter included               |
| 5   | `1mb.md` | Without soft wrap                                                  |
| 6   | `1mb.md` | Without spell check and autocorrect                                |
| 7   | `1mb.md` | Without per-line text direction                                    |
| 8   | `1mb.md` | The last entry: everything above switched off (the editor's floor) |

Use the same phone, Chrome and Gboard as round 2, prepared as in step 2. Report
with this template:

```text
Typing check — NF-2.4, round 3
Date:
Phone, OS and browser, keyboard: <only if different from round 2>

Run 1 (2 KB, middle, everything on): <paste "Copy results" output>
Run 2 (1 MB, end + Enter, everything on):
Run 3 (1 MB, end + Enter, off: frontmatter):
Run 4 (1 MB, end + Enter, off: language):
Run 5 (1 MB, end + Enter, off: wrap):
Run 6 (1 MB, end + Enter, off: spellcheck):
Run 7 (1 MB, end + Enter, off: direction):
Run 8 (1 MB, end + Enter, off: all four):

How each felt, if any differed:
```

A part costs the time when switching it off brings the share of keystrokes over
50 ms (browser timing) down towards the baseline. Run 8 shows what the editor
costs with all of them off; if even run 8 fails, no switch is enough and the 1
MB limit on phones is the question.

## Round 4: set the size limit

Round 3 showed that Markdown highlighting is what makes typing in large files
slow. Large files therefore open without highlighting on narrow screens (ED-9a),
and round 4 sets the size above which that happens. ED-9a says 100 KB until this
round confirms it or moves it.

**Typing speed matters.** The faster you type, the longer each keystroke takes:
a keystroke that arrives while the editor is still busy with the last one waits
for it. That wait is real delay, so it counts, but it means runs can only be
compared at similar speeds. **Copy results** now has a "typing speed" line. Type
every run at the same steady, normal pace; if one run's speed is more than 1
key/s away from the others, do it again.

Keep the phone in **portrait**, as in round 2. Every run has everything on (the
second menu at "Everything on") and is typed like round 3: tap **End**, type 50
letters, then press Enter 10 times. Run 1 is the baseline, with **Middle**:

| Run | File       | Where                 |
| --- | ---------- | --------------------- |
| 1   | `2kb.md`   | **Middle** (baseline) |
| 2   | `100kb.md` | **End**, then Enter   |
| 3   | `200kb.md` | **End**, then Enter   |
| 4   | `500kb.md` | **End**, then Enter   |

```text
Typing check — NF-2.4, round 4
Date:
Phone, OS and browser, keyboard: <only if different from round 2>

Run 1 (2 KB, middle, baseline): <paste "Copy results" output>
Run 2 (100 KB, end + Enter):
Run 3 (200 KB, end + Enter):
Run 4 (500 KB, end + Enter):
```

A size passes when the page's own meter has no keystroke over 50 ms and its
share of keystrokes over 50 ms in the browser timing is at most 5 percentage
points above the baseline's (about 3 keystrokes in 60). ED-9a's limit becomes
the largest size that passes, and the sizes below it must pass too. If 100 KB
fails, a smaller limit is measured before the editor is built.

## What happens next

This was the plan before the first round; the outcome is in the status at the
top.

- **The check passes** when the page's own meter has no keystroke over 50 ms,
  and the browser timing of the 200 KB and 1 MB runs has no larger share of
  keystrokes over 50 ms than the 2 KB baseline. The share is the keystrokes over
  50 ms divided by all keystrokes typed (the page's own count). One slow first
  keystroke after a file loads is recorded but does not fail the check. On an
  iPhone, only the first condition applies. The result goes into spike 3's
  findings in `docs/architecture/spikes.md`, and the editor plans (23 to 33) are
  written as outlined in
  `docs/superpowers/plans/2026-10-28-00-roadmap-step-2.md`.
- **The 1 MB runs fail:** a change to the editor's design is chosen before its
  plans are written. Options include a lower limit for editing on phones, or
  turning off features such as spell check or soft wrapping above some file
  size. Each option is measured with this page before it is chosen.

## Results so far

Each round is recorded in spike 3's findings in `docs/architecture/spikes.md`.
