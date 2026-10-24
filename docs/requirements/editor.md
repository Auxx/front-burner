# REQ-EDIT-001: Markdown editor and live preview

> Status: **Accepted**

## Summary

A Markdown file opened from the file tree ([REQ-FILE-001](file-browser.md))
opens in the **editor**, a plain-text Markdown editor with syntax highlighting,
next to its **live preview**. The user types Markdown; the preview shows it
rendered.

Edits are **saved automatically** to the working copy shortly after the user
stops typing (D-1). A save writes the file and does nothing else: nothing is
committed, staged or pushed. Unsaved edits survive a lost connection, a reload
and a crashed tab (NF-3).

One file is open at a time. The editor is plain Markdown: there is no formatting
toolbar in the MVP.

Two parts of the preview are their own requirements: which HTML tags it renders
([REQ-EDIT-002](preview-html.md), the safe HTML whitelist) and how it shows
images ([REQ-EDIT-003](preview-images.md)).

## Context

- Users of every persona edit on phones as well as desktops (vision goal 3). The
  editor is CodeMirror 6 for its touch support (D-7.1), and on phones the
  preview is not on screen while typing, to keep typing fast (A-8.12).
- Phones lock, tabs close and connections drop. Saving shortly after typing
  stops, keeping unsaved content in the browser and retrying makes losing an
  edit unlikely (NF-3).
- A save does not check whether the file changed since it was loaded: the last
  save wins (D-1.3). To keep that from overwriting changes that arrived from a
  pull or another device, the editor reloads a file that changed on disk, or
  asks the user when they have unsaved edits.
- Markdown files in developer repositories are often edited by other tools too.
  Saving must not change anything the user did not change: line endings, a byte
  order mark, tabs and the final newline are kept.
- AI-agent files use YAML front matter; it is highlighted in the editor and not
  shown in the preview (vision goal 2).
- The preview renders repository content in the instance's origin, so it is
  sanitised and written to the page by a single component (D-7.6).
- A formatting toolbar and several open files (tabs) are planned after the MVP
  ([mvp.md](../product/mvp.md)). The design must not rule them out.

## Terms

**Editor**
: The CodeMirror 6 text editor on the repository screen in which the open
  Markdown file is edited as Markdown source.

**Live preview**
: The rendered view of the open file, updated as the user types (see the
  [glossary](../product/glossary.md)). _Short form_: preview.

**Open file**
: The one Markdown file shown in the editor.

**Save**
: Sending the open file's whole content to the backend, which writes it to the
  working copy (D-1.1, D-1.2).

**Unsaved edits**
: Content in the editor that the backend has not yet confirmed as saved.

**Browser draft**
: Unsaved edits kept in the browser's IndexedDB (NF-3.3, A-8.10). Not to be
  confused with the Guided level's **Draft**, which is a branch.

**View mode**
: Which of the editor and preview are on screen: **Split**, **Edit** or
  **Preview** on wide screens; **Edit** or **Preview** on narrow screens.

## Requirements

### General

- **ED-1** The editor and preview are part of the repository screen and follow
  its rules for login, ownership and backend enforcement (FB-1 to FB-6).
- **ED-2** Only a Markdown file (FB-21) of at most **1 MB** (NF-1.5) whose
  content is valid UTF-8 can be opened. The backend refuses to read or save any
  other file through the editor's API, including symbolic links and paths inside
  `.git` (A-7.6).
- **ED-3** One file is open at a time. Opening another file replaces it; a save
  waiting for the previous file is still sent (ED-17). _(Several open files, as
  tabs, come later. My call: the per-file state — content, undo history, save
  queue, browser draft — is kept per file, not per screen, so that tabs can be
  added without reworking it.)_
- **ED-4** The editor and preview are loaded on demand, not with the initial
  JavaScript (NF-2.9, A-8.12).

### Opening a file

- **ED-5** Opening a file of up to 100 KB makes the editor usable within the
  NF-2.2 targets. While the file loads, the editor area shows a loading state.
- **ED-6** When a file is opened, the backend returns its content and enough
  information to save it back unchanged (ED-12) and to tell later whether it
  changed on disk (ED-24). _(My call: for example a hash of its bytes.)_
- **ED-7** When a browser draft exists for the file, the user is offered it as
  in NF-3.4: "You have unsaved changes from _&lt;time&gt;_", with **Restore**
  and **Discard**. Until the user chooses, the editor shows the file as it is on
  disk and is read-only. _(My call.)_ **Restore** puts the browser draft in the
  editor and saves it; **Discard** deletes the browser draft.
- **ED-8** The undo history of a file is kept while the browser tab stays open,
  also when the user opens other files and comes back. It is not kept across a
  reload. _(My call.)_

### Editing

- **ED-9** The editor highlights Markdown syntax and YAML front matter. It does
  not change the text on its own: no automatic formatting, no autocompletion of
  brackets or list markers. _(My call: plain Markdown editing for the MVP.)_
- **ED-10** Long lines wrap softly; the file is not changed by wrapping. The
  browser's spell check and, on phones, autocorrect are on. _(My call.)_
- **ED-11** The editor offers find and replace within the open file, from a
  button and with the platform's shortcut (`Ctrl+F` / `Cmd+F`). _(My call.)_
  `Tab` inserts a tab; `Esc` then `Tab` moves focus out of the editor (NF-13.3).
- **ED-12** Saving keeps what the user did not change:
  - the line endings: a file that uses `\r\n` is saved with `\r\n`. A file with
    mixed line endings is saved with the one it uses most; _(My call.)_
  - a UTF-8 byte order mark at the start of the file, if it has one;
  - tabs, trailing spaces and whether the file ends with a newline.

  A file that is opened and saved without edits is byte for byte the same.
- **ED-13** The editor supports text in any language, including right-to-left
  scripts and mixed-direction lines (NF-14.4).
- **ED-14** The editor uses the platform's colour scheme (light or dark), and so
  does the preview. _(My call.)_
- **ED-15** The editor stays usable with the on-screen keyboard open: the cursor
  is never hidden behind it (NF-12.5).

### Saving

- **ED-16** Saving follows the save queue of A-8.9: a save is sent after the
  user stops typing for 1.5 seconds; saves for one file are sent one at a time,
  and while one is in flight only the newest content waits behind it. No save is
  sent when the content equals the last saved content.
- **ED-17** A waiting save is also sent at once, without waiting for the delay,
  when the user opens another file, leaves the repository screen, or the tab is
  hidden. _(My call.)_
- **ED-18** The screen's header always shows the save status of the open file
  (NF-3.1):
  - "Saved";
  - "Saving…";
  - "Not saved — offline, retrying" when the save could not reach the backend,
    which is retried with backoff (NF-3.2);
  - "Not saved" with the reason, when the backend refused the save (ED-19). Such
    a save is not retried; the content stays in the editor and in the browser
    draft.
- **ED-19** The backend refuses a save, with an error code, when:
  - the file no longer exists (ED-21);
  - the content is larger than 1 MB: "Not saved — the file is larger than 1 MB".
    Saving resumes when the content is small enough again;
  - the repository is locked by a merge or rebase in progress (A-5.3, D-4.4),
    unless the file is one of the merge's conflicting files (GC-12).
- **ED-20** Unsaved edits are written to a browser draft as in NF-3.3, and the
  browser draft is deleted once the backend confirms the save. Browser drafts
  are deleted on logout (NF-3.5).
- **ED-21** A save never creates a file. When the open file was deleted or
  renamed elsewhere (another tab, another device, or a git operation), the save
  is refused and the editor says "This file was deleted or renamed elsewhere."
  with **Recreate it**, which creates the file at its old path with the editor's
  content. The content stays in the browser draft until then. _(My call.)_ A
  delete or rename made from this tab's own file tree follows FB-36 and FB-39
  instead.
- **ED-22** Closing or reloading the tab with unsaved edits makes the browser
  ask the user to confirm (NF-3.5). Navigating inside the web client does not
  ask, since the waiting save is sent at once (ED-17) and the browser draft is
  kept.

### Changes on disk

- **ED-23** The open file can change on disk while it is open, through a pull, a
  branch switch, a discard, a conflict resolution, or a save from another tab or
  device. The web client learns of it without a reload (FB-41).
- **ED-24** When the open file changed on disk and is different from the content
  the editor last loaded or saved:
  - with **no unsaved edits**, the editor loads the new content and keeps the
    cursor and scroll position as close as it can. The undo history is cleared.
    A short notice says "This file was updated.";
  - with **unsaved edits**, the editor keeps the user's content and asks: "This
    file changed while you were editing." with **Reload**, which loads the new
    content and discards the unsaved edits, and **Keep mine**, which saves the
    editor's content over it (D-1.3).

  _(My call.)_ The user's own saves never trigger this.
- **ED-25** While the repository is locked by a merge or rebase in progress, the
  repository screen shows conflict resolution ([REQ-GIT-003](git-conflicts.md)).
  Only the merge's conflicting files can be edited (GC-12). A version opened
  read-only during the merge, with **Show mine** or **Show theirs** (GC-17),
  shows a banner that says so; other files cannot be opened, since the file tree
  is not shown (FB-26). Unsaved edits made before the lock stay in the browser
  draft.

### Live preview

- **ED-26** The preview renders the open file as D-7.4 describes: CommonMark
  with the GitHub extensions (tables, task lists, strikethrough, autolinks,
  footnotes), syntax-highlighted fenced code blocks, HTML tags on the safe HTML
  whitelist (REQ-EDIT-002), front matter not shown, and blog-engine markup as
  plain text. Nothing else is rendered: Mermaid, math and other diagram or
  formula blocks are shown as code blocks. _(My call: footnotes, as part of the
  GitHub extensions.)_
- **ED-27** The preview is rendered in the browser through the pipeline of
  D-7.3, incrementally as in A-8.12 and A-8.13, and written to the page only by
  the shared preview component (D-7.6). The API never serves rendered HTML.
- **ED-28** The preview updates within the NF-2.5 target after typing stops, for
  files up to 200 KB. Larger files update more slowly (A-8.12). Typing is never
  slowed down by the preview (NF-2.4).
- **ED-29** `.mdx` files are previewed as Markdown. Their `import` and `export`
  lines are shown as text, and JSX components are treated as HTML: their tags
  are dropped and their text is kept (SH-7, SH-8). _(My call.)_
- **ED-30** Each block of the preview takes its text direction from its content,
  so right-to-left paragraphs are shown right to left (NF-14.4).
- **ED-31** Links in the preview:
  - a relative link to a Markdown file in the repository opens that file on the
    repository screen, like selecting it in the file tree; a link to any other
    path in the repository behaves like selecting that entry (FB-21);
  - a link to a heading (`#section`), in the same file or another, scrolls to
    that heading. Headings get GitHub-style IDs, with a prefix so that they
    cannot clash with the page's own IDs;
  - an `http`, `https` or `mailto` link opens in a new tab, with no referrer and
    no access to the opener;
  - every other kind of link is removed by sanitising (D-7.6).

  _(My call.)_
- **ED-32** Task list checkboxes are shown but cannot be ticked in the preview.
  _(My call.)_
- **ED-33** Wide tables and code blocks scroll sideways inside the preview; the
  page itself never scrolls sideways.

### View modes and scrolling

- **ED-34** On wide screens the view mode is **Split** by default, with the
  editor and preview side by side; the user can switch to **Edit** or
  **Preview** only. On narrow screens the view mode is **Edit** or **Preview**,
  shown as tabs, with **Edit** by default (A-8.12). Each device remembers the
  last view mode it used for each screen size. _(My call.)_
- **ED-35** In **Split** mode, the editor and preview scroll together, both
  ways: scrolling either one brings the same block of the file into view in the
  other. Blocks are the top-level blocks of A-8.12.
- **ED-36** Switching between **Edit** and **Preview** on narrow screens keeps
  the user's place: the preview opens at the block at the top of the editor, and
  the editor opens at the block at the top of the preview.

### Accessibility

- **ED-37** The editor is labelled with the open file's name. The preview is a
  labelled region whose headings keep the file's heading levels.
- **ED-38** The save status (ED-18) and the notices of ED-21 and ED-24 are
  announced to screen readers without moving focus. Every action they offer can
  be reached with the keyboard.
- **ED-39** The editor, the preview and the view-mode controls meet NF-13 (WCAG
  2.2 AA).

## Acceptance criteria

1. Selecting a `.md` file in the tree opens it in the editor with Markdown and
   front matter highlighted, and the preview beside it on a desktop browser.
2. A 100 KB file is ready to edit within the NF-2.2 targets on desktop broadband
   and on slow 4G.
3. Typing and stopping for 1.5 seconds saves the file: the status shows
   "Saving…" then "Saved", and the file on disk has the new content. No commit
   is made.
4. Typing and opening another file within 1.5 seconds still saves the first
   file.
5. With the network off, typing shows "Not saved — offline, retrying". Turning
   the network back on saves the content without the user doing anything.
6. Reloading the tab during an offline edit, then opening the file again, offers
   "You have unsaved changes from …" with **Restore** and **Discard**.
   **Restore** brings the edit back and saves it.
7. Logging out deletes every browser draft.
8. Closing a tab with unsaved edits makes the browser ask for confirmation.
9. A file with `\r\n` line endings, a byte order mark, tabs and no final newline
   is saved after an edit with all four kept. Opening and saving a file without
   edits leaves it byte for byte unchanged.
10. A file grown past 1 MB shows "Not saved — the file is larger than 1 MB", and
    saves again once it is smaller.
11. A file deleted from another device shows "This file was deleted or renamed
    elsewhere." on the next save. **Recreate it** creates it again with the
    editor's content.
12. A pull that changes the open file while it has no unsaved edits updates the
    editor and shows "This file was updated." With unsaved edits it asks
    **Reload** or **Keep mine**, and each does what it says. The user's own
    saves never show either notice.
13. While a merge with conflicts is in progress, the conflicting files can be
    edited and saved, a version opened with **Show mine** is read-only with a
    banner, and the API refuses saves to any file that is not conflicting.
14. The preview renders headings, lists, tables, task lists, strikethrough,
    autolinks, footnotes and fenced code with highlighting. Front matter is not
    shown. A `mermaid` block is shown as a code block.
15. `<script>` and event-handler attributes in a file never run; the preview
    shows no trace of them.
16. A 200 KB file's preview updates within 300 ms after typing stops, and typing
    in a 1 MB file shows each keystroke within 50 ms on a mid-range phone
    (NF-2.4, NF-2.5).
17. In an `.mdx` file, `import` lines are shown as text.
18. A relative link to `../guide.md` opens that file; `#install` scrolls to the
    heading; `https://example.com` opens in a new tab.
19. An Arabic paragraph is shown right to left in the editor and the preview.
20. In **Split** mode, scrolling the editor scrolls the preview to the same
    block, and the other way round. **Edit** and **Preview** modes show one pane
    only.
21. On a phone, the editor and preview are **Edit** and **Preview** tabs.
    Switching keeps the place in the file. The cursor stays visible above the
    on-screen keyboard.
22. Find and replace works from a button and from `Ctrl+F` / `Cmd+F`. `Esc` then
    `Tab` moves focus out of the editor.
23. Undo after switching to another file and back undoes the last edit of the
    first file.
24. axe-core reports no violations in the editor, the preview or the view mode
    controls, and the save status is announced by a screen reader.

## Out of scope

- A formatting toolbar and formatting shortcuts (planned after the MVP).
- Basic formatting from the repository's `.editorconfig` (planned after the MVP;
  see `docs/wiki/todo.md`).
- Several open files, as tabs (planned after the MVP; ED-3).
- The safe HTML whitelist (REQ-EDIT-002) and preview images (REQ-EDIT-003).
- Mermaid diagrams, math, and other rendered extensions.
- MDX-aware preview (rendering JSX components or running MDX).
- Ticking task list checkboxes in the preview.
- Showing or editing front matter as a form or a table.
- Checking that the file is unchanged before a save (D-1.3).
- Real-time collaborative editing (vision non-goal).
- Export, print, word count and outline views.
- Remote-change notices and committing, which belong to REQ-GIT-002.

## Open questions

None at the moment.
