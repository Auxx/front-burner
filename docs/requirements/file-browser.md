# REQ-FILE-001: File browser

> Status: **Draft**

## Summary

Opening a repository shows the **repository screen**: a **file tree** of the
working copy next to the editor and its live preview. This requirement covers
the screen's layout and the file tree. The editor and the preview are covered
by [REQ-EDIT-001](editor.md); git operations by a separate requirement.

In the file tree the user can:

- browse the working copy, expanding and collapsing any number of folders,
  as in any folder tree. Each folder's content is loaded when it is first
  expanded, so the tree stays fast in large repositories (FB-15);
- open a **Markdown file** (`.md`, `.markdown` or `.mdx`) in the editor;
- create Markdown files and folders;
- rename Markdown files and folders in place;
- delete files and folders.

Every other file is listed but cannot be opened. Files and folders ignored by
`.gitignore` are shown, with their names in a different colour and an icon
next to them, as code editors usually do.

## Context

- Developer repositories are code repositories (vision): Markdown files sit
  among many non-Markdown files, in repositories of up to 100,000 files
  (NF-1.4). The tree must stay fast however large the repository is, so it is
  loaded one folder at a time (NF-2.10).
- AI-agent files often live in dot-folders such as `.claude/` or `.github/`,
  so dot-folders are shown like any other folder.
- Non-Markdown files cannot be edited (vision goal 2), so they cannot be
  created or renamed either, but they can be deleted.
- Git does not track empty folders. A folder created in the file tree stays
  on the instance only, until a file is added to it and committed. The user
  is told so.
- A save writes to the working copy and does nothing else (D-1.2). The same
  holds for every change made in the file tree: nothing is committed, staged
  or pushed. Committing is covered by the git requirement.
- A malicious remote may contain symbolic links that point outside the
  working copy. Symbolic links are never followed (A-7.6).
- File names may use any Unicode, including right-to-left scripts (NF-14.4).
- The MVP has one user at the Advanced git control level
  ([mvp.md](../product/mvp.md)), but nothing in this requirement depends on
  the level.

## Terms

**Repository screen**
: The screen that shows one repository: the file tree, the editor and the
live preview. Opening it counts as opening the repository in the editor
(DS-7, DS-8).

**File tree**
: The tree of folders and files of the working copy's current branch, as they
are on disk, including changes not yet committed.

**Markdown file**
: A file whose name ends in `.md`, `.markdown` or `.mdx`, ignoring case. Only
Markdown files can be opened in the editor.

**Entry**
: One item in the file tree. Its **kind** is one of: folder, file, symbolic
link, or submodule.

**Ignored entry**
: A file or folder that is not tracked by git and matches a `.gitignore` rule
(in git terms, `git check-ignore`). A tracked file is never ignored, even if
a rule matches it.

**Empty folder**
: A folder that holds no files, directly or in any subfolder. Git does not
track it.

## Requirements

### General

- **FB-1** The repository screen needs a login. A visitor who is not logged
  in is sent to the login page as in LG-4. Its routes are
  `/repositories/<id>` and `/repositories/<id>/files/<path>`, where `<path>`
  is the open file's path in the working copy. Reloading or bookmarking the
  page reopens the same file. _(My call.)_
- **FB-2** A user can open only their own repositories. A request for another
  user's repository is refused as if it did not exist.
- **FB-3** Only an openable repository (see
  [REQ-DASH-001](dashboard.md)) can be opened. For a repository that is
  cloning or in an error status, the screen shows the status and a link to
  that repository on the repository management page instead of the tree.
- **FB-4** The backend enforces every rule in this requirement: which entries
  are listed, their kind and flags, which names are allowed, and which
  actions are allowed on which entries. The web client checks names so that
  the user gets quick feedback, but does not replace the backend checks
  (vision goal 12).
- **FB-5** Every path that comes from a client goes through the path rules of
  A-7.6. In particular, `.git` and everything inside it is never listed,
  opened, created, renamed or deleted.
- **FB-6** The repository screen is fully usable in desktop and mobile
  browsers, by touch, mouse or keyboard alone (NF-12.5, NF-13.3).

### Layout

- **FB-7** On wide screens the repository screen shows, side by side, the
  file tree, the editor and the live preview. The file tree can be collapsed
  and expanded again. _(My call: the breakpoints are left to the builder.)_
- **FB-8** The panes can be resized. Resizing also works without dragging,
  for example with the keyboard or with buttons (NF-13.6). Each device
  remembers the pane sizes and whether the tree is collapsed. _(My call.)_
- **FB-9** On narrow screens, such as phones, the file tree is a drawer that
  opens from a button in the screen's header and closes when a file is
  opened. How the editor and preview share a narrow screen is in
  REQ-EDIT-001.
- **FB-10** The screen's header shows the repository name and a link back to
  the dashboard. The current branch, git actions and the save status are
  added by REQ-GIT-002 and REQ-EDIT-001. The header is the app header and
  the repository's header in one bar ([REQ-APP-001](navigation.md), NV-9).

### Opening the repository screen

- **FB-11** Opening the repository screen sets the repository's last access
  time once (DS-7, DS-8). Opening files, browsing folders and reloading the
  file tree do not set it again.
- **FB-12** When the route names no file, the screen opens, in this order:
  1. the last file the user had open in this repository **on this device**,
     if it still exists and can be opened;
  2. otherwise, a Markdown file named `README` (any Markdown extension,
     ignoring case) in the root folder, if there is one;
  3. otherwise, nothing: the editor area shows "Choose a file from the tree,
     or create one" with a **New file** button.

  _(My call: the last file is remembered in the browser, so each device has
  its own.)_
- **FB-13** When the route names a file that does not exist or cannot be
  opened, the editor area says why (FB-21) and the tree is shown as usual.
- **FB-14** The file tree opens with the root folder expanded, and the
  folders that lead to the open file expanded, so that the open file is
  visible and highlighted in the tree. Each device remembers which folders
  were expanded in each repository. _(My call.)_

### Listing folders

- **FB-15** The file tree loads one folder at a time, when the folder is
  expanded. Listing a folder never walks its subfolders or the rest of the
  working copy (NF-2.10). A folder of up to 1,000 entries is listed within
  the NF-2.1 targets.
- **FB-16** A folder listing returns, for each entry:
  - its **name**;
  - its **kind**: folder, file, symbolic link or submodule;
  - for a file, its **size**, and whether it is a **Markdown file**;
  - whether it is an **ignored entry**.
- **FB-17** Entries are sorted folders first, then everything else, each
  group by name, ignoring case, with numbers in names in numeric order (for
  example `2-setup.md` before `10-deploy.md`). The backend sorts the entries.
  _(My call.)_
- **FB-18** A folder listing returns at most **5,000** entries. A folder with
  more shows the first 5,000 in sort order and a note, "_n_ more items not
  shown". _(My call.)_
- **FB-19** Every entry is listed, including dot-files and dot-folders such
  as `.github` and `.claude`, except `.git` (FB-5).
- **FB-20** Each entry shows an icon for its kind, and Markdown files are
  told apart from other files.
- **FB-20a** An ignored entry, file or folder, is shown:
  - with its name in a different colour from other entries, as code editors
    usually do. The colour meets the WCAG 2.2 AA contrast ratio in both the
    light and the dark colour scheme;
  - with an "ignored" icon (or a warning icon) next to its name, so that
    colour is never the only signal (NF-13.7).

  The icon explains itself: on desktop, hovering over it or focusing it with
  the keyboard shows a tooltip; on touch screens, tapping it shows the same
  message: "Ignored by .gitignore. Git won't commit this file." (for a
  folder: "… Git won't commit anything in this folder."). Tapping the icon
  does not open or select the entry, and the icon's touch target meets
  NF-13.5. The entry's name is never followed by the word "ignored" in the
  tree. _(My call: the exact colour and icon are left to the design.)_
- **FB-20b** Everything inside an ignored folder is ignored too, and is shown
  as in FB-20a.

### Opening files

- **FB-21** Selecting a Markdown file opens it in the editor (REQ-EDIT-001)
  and updates the route (FB-1). Selecting any other entry does not open the
  editor; the editor area instead shows the entry's name and why it cannot be
  opened:

  | Entry                              | Message                                                      |
  |------------------------------------|--------------------------------------------------------------|
  | Non-Markdown file                  | "Only Markdown files can be opened in Front Burner."         |
  | Symbolic link                      | "Symbolic links can't be opened."                            |
  | Submodule                          | "Submodules aren't supported."                               |
  | Markdown file larger than 1 MB     | "This file is too large to edit (the limit is 1 MB)."        |
  | Markdown file that is not UTF-8    | "This file isn't UTF-8 text, so it can't be edited safely."  |

  The last two are found when the file is opened; the rest are known from the
  listing. The panel offers **Delete** where FB-37 allows it. _(My call.)_
- **FB-22** Selecting a folder expands or collapses it.
- **FB-23** A submodule is shown as an entry that cannot be expanded,
  opened, renamed or deleted. _(Submodules are not cloned, AR-50.)_

### Actions on entries

- **FB-24** Each entry has an actions menu, opened from a button on the entry
  and from the keyboard. The menu offers only the actions allowed for that
  entry (FB-29 to FB-40). Actions never depend only on a right-click, long
  press or drag. _(My call.)_
- **FB-25** The top of the file tree has **New file** and **New folder**
  buttons, which create in the root folder. A folder's actions menu has the
  same actions, which create inside that folder.
- **FB-26** While a merge is in progress, or the repository is otherwise
  locked (A-5.3, D-4.4), the actions that change files are not offered, and
  the backend refuses them with an error code. Browsing and opening still
  work.

### Names

- **FB-27** A name for a new or renamed entry is refused, with the reason
  shown next to the field, when it:
  - is empty, or is `.` or `..`;
  - contains `/`, `\`, a NUL character or another control character;
  - begins or ends with a space;
  - is `.git`, ignoring case;
  - is longer than 255 bytes in UTF-8;
  - is the same as another entry in the same folder, ignoring case, so that
    the repository still works on case-insensitive file systems. Renaming an
    entry to a different case of its own name is allowed.

  _(My call.)_
- **FB-28** Names are stored exactly as typed, in Unicode NFC.
  _(My call: NFC avoids two names that look the same but are different
  bytes, which macOS users would otherwise create.)_

### Creating files

- **FB-29** **New file** asks for a name, with the field filled in as
  `untitled.md` and the part before `.md` selected. If the name does not end
  in a Markdown extension, `.md` is appended (`notes` becomes `notes.md`, and
  `notes.txt` becomes `notes.txt.md`). The field shows the final name before
  the user confirms. _(My call.)_
- **FB-30** The new file is empty. It is created in the working copy only,
  as an untracked file, and opens in the editor at once.
- **FB-31** If the folder is an ignored entry, or the new name would be one,
  the dialog warns: "This file matches a .gitignore rule, so git won't commit
  it." The user can still create it.

### Creating folders

- **FB-32** **New folder** asks for a name and creates an empty folder in the
  working copy. The folder is expanded and selected.
- **FB-33** The dialog, and an expanded empty folder in the tree, say:
  "Empty folders aren't saved in git. Add a file to keep this folder." An
  empty folder is shown as such in the tree.
- **FB-34** FB-31 applies to folders as well.

### Renaming

- **FB-35** **Rename** changes an entry's name in place: the entry stays in
  the same folder. It is offered for Markdown files and folders. It is not
  offered for non-Markdown files, symbolic links or submodules.
  - Renaming a Markdown file follows FB-29: the new name always ends in a
    Markdown extension, so a Markdown file never becomes a non-Markdown file.
  - Renaming a folder that contains non-Markdown files, at any depth, asks
    for a second confirmation, which says how many non-Markdown files will
    move with it. _(My call.)_
  - Renaming changes only the working copy. Git sees it as a deleted file and
    a new one until it is committed.
  - Links to the entry from other files are not updated.
- **FB-36** When the open file, or the folder that holds it, is renamed, the
  editor keeps the file open under its new path and updates the route. A
  save waiting for that file is sent before the rename. _(My call.)_

### Deleting

- **FB-37** **Delete** is offered for files of every kind (Markdown and
  non-Markdown), symbolic links, and folders. Deleting a symbolic link
  removes the link only, never what it points to. It is not offered for
  submodules.
- **FB-38** Delete always asks for confirmation:
  - for a file: its name, and, if the file is not committed, "This file
    isn't committed, so it can't be recovered.";
  - for a folder: its name and how many files it contains, how many of them
    are non-Markdown files, and, if any file in it is not committed, how many
    cannot be recovered.

  Committed files can be brought back by discarding the deletion (git
  requirement). _(My call.)_
- **FB-39** When the open file is deleted, or the folder that holds it, the
  editor closes it and the editor area shows the empty state of FB-12. A
  save waiting for that file is dropped, and its browser draft (NF-3.3) is
  deleted.
- **FB-40** Deleting a large folder may take longer than about 2 seconds; it
  then runs as a job (NF-2.8) and the folder is shown as "Deleting…" until it
  is gone.

### Keeping the tree up to date

- **FB-41** The tree updates without a reload when the working copy changes:
  after the user's own actions, after git operations that change files (for
  example a pull, a branch switch or a discard), and after changes made from
  another tab or device. Only expanded folders are listed again. _(My call:
  the mechanism is left to the builder, for example a push channel event
  naming the changed folders, A-3.11.)_
- **FB-42** When an expanded folder no longer exists, it is removed from the
  tree. When the open file no longer exists, FB-39 applies, except that the
  editor says "This file was deleted or renamed elsewhere."

### Loading and errors

- **FB-43** While a folder is loading, it shows a loading state in place.
  The rest of the tree stays usable.
- **FB-44** If a folder cannot be listed, it shows "This folder could not be
  loaded" with **Try again**.
- **FB-45** If an action fails, the dialog stays open with what the user
  entered and shows the error. Errors use the error codes of A-3.8.

### Accessibility

- **FB-46** The file tree follows the WAI-ARIA tree view pattern: arrow keys
  move between entries and expand and collapse folders, `Enter` opens an
  entry, and the actions menu opens from the keyboard. Every entry's kind and
  flags (Markdown, ignored, empty) are announced to screen readers.
  _(My call: other keyboard shortcuts, such as `F2` to rename, are left to
  the builder.)_

## Acceptance criteria

1. Opening an openable repository from the dashboard shows the repository
   screen with the file tree, and moves the repository to the top of the
   recent repositories list.
2. A visitor who is not logged in is sent to the login page. A request for
   another user's repository gets the same response as a repository that does
   not exist.
3. A repository that is still cloning shows its status and a link to the
   repository management page, not the tree.
4. On a desktop browser the tree, editor and preview are side by side; the
   tree collapses and expands, and the panes can be resized with the keyboard.
   On a phone the tree is a drawer that closes when a file is opened.
5. Opening a repository for the first time opens the root `README.md`. Opening
   it again on the same device opens the last file opened there. A repository
   with no README shows "Choose a file from the tree, or create one".
6. Reloading `/repositories/<id>/files/docs/guide.md` reopens that file, with
   `docs` expanded and `guide.md` highlighted.
7. Expanding a folder lists only that folder's entries, sorted folders first
   and in natural order (`2-setup.md` before `10-deploy.md`). In a repository
   of 100,000 files, a folder of 1,000 entries opens within NF-2.1.
8. `.github` and `.claude` are listed; `.git` is not, and requests for paths
   inside `.git` are refused.
9. `.md`, `.MARKDOWN` and `.mdx` files open in the editor. A `.png` file, a
   symbolic link and a submodule each show their message and do not open.
10. A 2 MB `.md` file shows "This file is too large to edit". A `.md` file in
    Latin-1 with non-ASCII characters shows "This file isn't UTF-8 text".
11. A symbolic link pointing to `/etc/passwd` is listed but cannot be opened,
    renamed onto or read through the API. Deleting it removes only the link.
12. A file and a folder matched by `.gitignore` are shown with their names
    in a different colour and the ignored icon. Hovering over the icon on a
    desktop, or tapping it on a phone, shows "Ignored by .gitignore…"
    without opening the entry. A tracked file that matches a rule looks like
    any other file.
13. **New file** with the name `notes` creates `notes.md`, empty and
    untracked, and opens it in the editor. Creating it inside an ignored
    folder shows the .gitignore warning first.
14. Creating `README.md` next to `readme.md` is refused. Renaming
    `readme.md` to `README.md` works.
15. **New folder** creates an empty folder, marked empty, with the note that
    empty folders aren't saved in git.
16. Renaming a Markdown file to `guide.txt` results in `guide.txt.md`.
    **Rename** is not offered for a `.png` file. Renaming a folder that
    holds images asks for a second confirmation with the number of images.
17. Renaming the open file keeps it open in the editor under its new name,
    and no edit made just before the rename is lost.
18. Deleting a committed file asks for confirmation; deleting an untracked
    file also warns that it can't be recovered. Deleting a folder says how
    many files, non-Markdown files and uncommitted files it holds.
19. Deleting the open file closes it in the editor.
20. While a merge with conflicts is in progress, create, rename and delete
    are not offered, and the API refuses them; browsing still works.
21. A file created from a second device appears in the first device's
    expanded folder without a reload. A file deleted there closes in the
    first device's editor with "This file was deleted or renamed
    elsewhere."
22. A folder that cannot be listed shows the error with **Try again**, and
    the rest of the tree still works.
23. Every action in the tree can be done with the keyboard alone and by touch
    alone. axe-core reports no violations on the repository screen.

## Out of scope

- Moving files or folders to another folder, including by dragging.
- Uploading files, and creating non-Markdown files.
- Viewing non-Markdown files, such as images or PDFs.
- The "hide non-Markdown files" user preference.
- Searching for files by name or content.
- Copying or duplicating files, and actions on several entries at once.
- Updating links to a renamed file.
- Showing git state (changed, new, deleted) in the tree. The changed files
  are listed by the git requirement.
- Undoing a delete other than by discarding it in git.
- Submodules and Git LFS.

## Open questions

None at the moment.
