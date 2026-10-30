# Front Burner — Architecture decisions

> Status: **Draft**

This document records product and technical decisions that shape the
architecture but are not yet written up as requirements. Each decision will
later move into a requirement (or into the architecture itself); until then,
this document is the source of truth for it.

Decisions marked _(My call.)_ were proposed during discussion and not explicitly
confirmed; they can be revisited cheaply.

## D-1: Saving edits

- **D-1.1** At every git control level, the web client sends the content of an
  edited file to the backend after the user stops typing for 1–2 seconds
  (debounce). The exact delay is left to the builder.
- **D-1.2** A save writes the file to the user's working copy and does nothing
  else: no commit, no git operation.
- **D-1.3** **Last save wins.** A save replaces the file on disk without
  checking whether it changed since the editor loaded it (for example by an
  automatic pull, a resolution, or the same user on another device). This is a
  deliberate simplification; a version check can be added later.

## D-2: Automatic synchronisation (Simple level)

- **D-2.1** At the Simple level, one minute after the last save to a repository,
  the backend:
  1. commits every change in the working copy (automatic commit, D-2.3);
  2. pulls from the remote (fetch + merge, D-5.1);
  3. pushes.
- **D-2.2** The one-minute timer runs on the backend, per repository per user.
  It does not depend on the browser: a phone that locks or a tab that closes
  does not leave changes uncommitted.
- **D-2.3** Automatic commit message: a subject naming the changed file (`Update
  shopping-list.md`), or the count when there are several (`Update 3 files`,
  with the files listed in the body), followed by a blank line and the trailer
  `Front-Burner-Auto-Commit: simple`. The commit author is the user's
  ([REQ-GIT-001](../requirements/commit-author.md)).
- **D-2.4** _(My call.)_ At the Simple level, opening a file also pulls when the
  working copy has no uncommitted changes and the pull is a fast-forward.
- **D-2.5** To keep the vision's rule that levels are a frontend concern only,
  the backend does not branch on the level. Automatic synchronisation is a
  separate per-repository **auto-sync** setting that the web client turns on
  when the user picks the Simple level and off for the other levels. D-2, D-3
  and D-4 describe what the backend does when auto-sync is on.
  - **D-2.5a** The level and auto-sync are changed in one API request, which
    updates both or neither, so they cannot drift apart.
  - **D-2.5b** The D-4a rules apply to auto-sync as well: it cannot be changed
    while a merge or rebase is in progress, and turning it off ends an open
    conflict episode (D-4a.3).

- **D-2.6** Automatic commits always happen, since they need no credentials.
  When the pull or push cannot run — a passphrase-protected key that is not
  unlocked (AR-31), a repository without credentials, the remote unreachable,
  credentials refused, or the push rejected — the commits are kept and the user
  gets a notification such as "Your changes are saved but not uploaded", with a
  way to fix the cause (for example, entering the passphrase). The cycle retries
  on the next run.
- **D-2.7** Background jobs never keep a key unlocked beyond what AR-31 allows.
  A sync failure is not a conflict episode and sends no reminder email.
- **D-2.8** Besides a save, a sync cycle also starts:
  - **every 15 minutes** while a repository has commits that were not uploaded
    and the cause may clear on its own (remote unreachable, timeout, push
    rejected because the remote has new commits), whether or not anyone is
    viewing the repository. Causes only the user can fix (a locked key with no
    usable unlock, missing or refused credentials, an open conflict episode) are
    not retried;
  - **at once** when the user fixes such a cause: unlocks the key or changes the
    repository's credentials;
  - **at once** when a background fetch (D-4.2) finds new remote commits and no
    save is waiting, so that a user viewing the repository sees remote changes
    within about two minutes and conflicts are caught early. D-2.4 still applies
    when a file is opened.

## D-3: Conflicts during automatic synchronisation (Simple level)

- **D-3.1** When the automatic pull conflicts, the backend aborts the merge at
  once. The working copy returns to a clean state on the user's own commits, so
  the user can keep editing every file, and automatic commits continue.
- **D-3.2** While a conflict is outstanding, automatic pushes are skipped rather
  than retried and refused every minute. _(My call.)_
- **D-3.3** The user sees a notification that a file changed on the remote and
  needs attention. It stays visible until the conflict is resolved. One
  notification per repository, since a merge takes all remote changes at once.
  _(My call.)_
- **D-3.4** When the user opens the notification, the backend tries the merge
  again against the latest remote. It may now succeed, or conflict on different
  files. For each conflicting file the user picks one of:
  - **Use my version**;
  - **Use their version**;
  - **Keep both** — theirs stays in place and the user's version is saved as a
    copy next to it (Markdown files only).

  The backend then commits the resolution and pushes.

- **D-3.5** While the resolution screen is open, the repository cannot be edited
  elsewhere (other tabs or devices) until the user finishes or cancels. _(My
  call.)_
- **D-3.5a** _(My call.)_ The resolution lock is a lease, not a permanent flag.
  The client renews it while the resolution screen is open; it expires after
  about two minutes without renewal, which undoes the half-finished resolution.
  Opening the notification on another device takes the lock over. Automatic
  synchronisation of that repository pauses while the lock is held.
- **D-3.6** **Conflict episode**: starts with the first conflicting automatic
  pull, ends when the user's changes are pushed successfully. Further failed
  pulls in the same episode do not start a new one. The backend stores each
  episode with its start time.
- **D-3.7** Two days after an episode starts, if it has not ended, the backend
  sends the user one reminder email. Only one email is sent per episode. If SMTP
  is not configured, no email is sent.

## D-4: Synchronisation at the Guided and Advanced levels

- **D-4.1** Nothing is committed, pulled or pushed automatically. Every such
  action is started by the user through the UI.
- **D-4.2** **Fetch first.** The backend fetches when a file is opened and
  periodically while the user is editing. Fetching never changes the user's
  files or branch. When the remote has new commits, the user is told; if the
  open file is among the changed files, the notice says so.
- **D-4.3** Merging or rebasing happens only when the user asks (Pull at
  Advanced, "Get latest changes" or similar at Guided). If there are uncommitted
  changes, the user is asked to commit them first ("Save version" at Guided).
  Nothing is stashed silently. _(My call.)_
- **D-4.4** When the merge or rebase conflicts, it stays in progress and the
  repository is locked to the resolution screen until every conflicting file is
  resolved or the operation is aborted.
- **D-4.4a** The merge or rebase in progress belongs to the repository, not to a
  device, and has no lease or expiry (unlike the Simple level's D-3.5a). Each
  resolved file is written to the working copy at once, so any of the user's
  devices can open the resolution screen and continue. Only finishing or
  aborting ends it.
- **D-4.5** Aborting puts the branch and working copy back exactly as they were
  before the operation. At Guided the action is labelled in plain language, for
  example "Cancel and go back to my version". _(My call.)_
- **D-4.6** Before any merge or rebase the backend records the user's current
  commit, so that any resolution can be undone (vision goal 5, "never lose
  work").

- **D-4.7** _(My call.)_ **Resolve on the provider** (Guided escape hatch)
  aborts the merge, pushes the user's commits to a new branch, and opens a pull
  request from that branch into the branch the user was pulling. The provider
  abstraction's "open pull request" call therefore takes a source branch, a
  target branch, a title and a description.

## D-4a: Changing the git control level

_(My calls.)_

- **D-4a.1** The level cannot be changed while a merge or rebase is in progress;
  the user must finish or abort it first.
- **D-4a.2** Switching to Simple with uncommitted changes is allowed: the next
  automatic cycle commits them. If the current branch has no upstream, the first
  automatic push sets it.
- **D-4a.3** Switching away from Simple with an open conflict episode ends the
  episode (no reminder email is sent). The outstanding remote changes are then
  reported as at the new level (D-4.2).

## D-5: Merge and rebase

- **D-5.1** The Simple and Guided levels always merge.
- **D-5.2** At the Advanced level the user chooses merge or rebase as a
  per-repository user preference, default merge. A single pull does not override
  it. _(My call.)_
- **D-5.3** During a rebase, conflicts can occur once per replayed commit. The
  resolution screen shows progress (for example "commit 2 of 5").
- **D-5.4** The descriptions of the git control levels, shown wherever a user or
  administrator chooses a level (AR-38 in REQ-REPO-001, and the administration
  pages), mention this: Simple and Guided always merge; Advanced merges or
  rebases, as the user chooses.

## D-6: Conflict resolution methods

- **D-6.1** The methods available at each level are those of vision goal 5,
  unchanged. This section only adds how they behave.
- **D-6.2** Non-Markdown files are resolved only by choosing a whole file (**Use
  my version** or **Use their version**) at every level, since non-Markdown
  files can only be uploaded or deleted.
- **D-6.3** **Three-way merge editor** goes through the conflicting files one by
  one.
- **D-6.4** **Edit conflict markers** first shows the list of conflicting files;
  each opens in the normal editor with the markers highlighted.
- **D-6.5** The UI labels for choosing a whole file and keeping both are **Use
  my version**, **Use their version** and **Keep both**. When one side deleted
  the file, they are **Keep the file** and **Delete the file**, for every kind
  of file (GC-16).

## D-7: Editor and live preview

- **D-7.1** The editor is **CodeMirror 6**, chosen for mobile and touch support.
- **D-7.2** The live preview is rendered **in the browser**. The API never
  serves rendered HTML.
- **D-7.3** Rendering pipeline: **remark** (`remark-parse` → `remark-rehype` →
  `rehype-raw`) → `rehype-sanitize` → **Shiki** (`@shikijs/rehype`) →
  **DOMPurify**. _(Spike 3 added `rehype-sanitize`; A-8.12.)_
- **D-7.4** What the preview shows:
  - front matter is not shown;
  - all standard Markdown is rendered. _(My call: CommonMark plus the GitHub
    extensions — tables, task lists, strikethrough, autolinks.)_;
  - fenced code blocks are syntax-highlighted;
  - HTML tags on a whitelist (for example `<strong>`, `<img>`) are rendered;
    every other tag, including `<script>`, is stripped. The whitelist is
    [REQ-EDIT-002](../requirements/preview-html.md);
  - blog-engine markup such as Hexo's `{% blockquote %}` is shown as plain text.
- **D-7.5** Shiki configuration:
  - output CSS classes instead of inline styles, so that neither Angular's
    sanitizer, the DOMPurify whitelist nor a strict Content Security Policy has
    to allow `style` attributes. _(Spike 3: a small transformer of our own,
    since `transformerStyleToClass` from `@shikijs/transformers` leaves token
    colours inline in Shiki 4; A-8.12.)_;
  - the fine-grained `shiki/core` build, with a few common languages bundled and
    the rest loaded on demand;
  - the JavaScript regex engine instead of the Oniguruma WebAssembly engine;
  - one highlighter instance created once, in the preview worker (A-8.13); only
    changed code blocks are re-highlighted.
- **D-7.6** HTML is sanitized with DOMPurify as the last step, after
  `rehype-sanitize` has removed hostile markup from the syntax tree (A-8.12),
  both configured from one whitelist
  ([REQ-EDIT-002](../requirements/preview-html.md)). It is written to the page
  by a single shared preview component, and nowhere else. _(My call. Spike 3:
  the component writes DOMPurify's `TrustedHTML` into one element per block
  instead of passing a string through `bypassSecurityTrustHtml`; A-8.12. Plan
  30's call: a `no-restricted-syntax` rule in the root ESLint config catches the
  common direct forms in the web client's code outside specs: `x.innerHTML =`
  and `x.outerHTML =`, `insertAdjacentHTML`, `setHTMLUnsafe` and any
  `bypassSecurityTrust…`, with one disable comment in the component's
  `patchBlocks`. It is a guard against mistakes, not the enforcement: it reads
  only TypeScript and only those spellings, so bracket access,
  `Renderer2.setProperty`, `document.write` or an `[innerHTML]` binding in a
  template pass it. What enforces D-7.6 at run time is Trusted Types
  (`require-trusted-types-for 'script'`, NF-11.1), under which only DOMPurify's
  `TrustedHTML` can be written as HTML, and Angular's sanitiser for template
  bindings.)_
- **D-7.7** How image paths are resolved and how the web client loads repository
  and remote images is [REQ-EDIT-003](../requirements/preview-images.md).
- **D-7.8** A small throwaway spike will confirm the Shiki + remark + Angular
  integration during the architecture phase.

## D-8: Pull requests

- **D-8.1** Pull requests are optional. Nothing needs to be set up until a user
  first submits for review. _(My call: the Simple level never shows pull
  requests.)_
- **D-8.2** Launch providers: **GitHub** (`github.com`) and **Bitbucket Cloud**
  (`bitbucket.org`). GitHub Enterprise Server, Bitbucket Data Center and OAuth
  sign-in come later, through the provider abstraction.
- **D-8.3** When a user submits for review and the repository has no API access
  set up, a guided page or dialog sets it up:
  - a **provider** selection, with the provider worked out from the remote URL's
    host preselected. For any other host nothing is preselected and the user
    must choose. _(My call: at launch, since neither provider can serve a
    self-hosted server, the dialog explains that pull requests are not supported
    for this server yet. Pushing still works.)_
  - a selection of the user's saved **provider tokens** for that provider, and
    an option to add a new one;
  - adding a new one shows a form with the fields that provider needs (a
    personal access token for GitHub; an API token for Bitbucket Cloud),
    including which permissions the token must have.
- **D-8.4** Before a new provider token is saved, the backend makes a test call
  that checks that the token works and can open pull requests on this
  repository, not just that it can log in.
- **D-8.5** Provider tokens are a third kind of saved credentials, alongside
  HTTPS credentials and SSH keys: named, encrypted at rest, private to their
  owner, reusable across that user's repositories, and never returned by the API
  after they are saved.
- **D-8.6** Pushing always uses the repository credentials; provider tokens are
  used only for the provider API.

## D-9: User interface

- **D-9.1** The web client uses **its own design system and component library**
  in the `ui` library, not an existing component library such as Angular
  Material. Existing libraries bring their own look, and the accessibility
  (NF-13), Content Security Policy (NF-11.1), bundle size (NF-2.9) and
  touch-plus-IDE density (NF-12.5, NF-13.5) targets would have to be fought
  rather than reused.
- **D-9.2** The look is inspired by **JetBrains' Islands theme** and **VS
  Code**, so that it is familiar to software developers: rounded panels on a
  darker canvas, compact density on desktop, an activity bar and a status bar.
- **D-9.3** Styling is **semantic CSS**: SCSS with design tokens as CSS custom
  properties, styled through elements and their ARIA state. No Tailwind or other
  utility-class framework, so that templates hold structure and not styling.
- **D-9.4** Behaviour that is hard to get right — keyboard navigation, focus
  management, ARIA patterns and overlays — comes from **Angular Aria** and the
  **Angular CDK**, both headless and first-party. Every visual is our own.
- **D-9.5** The look's starting points: **JetBrains blue** as the accent,
  **slightly cool** neutral greys, **13 px** UI text on desktop, and
  **Codicons** for icons. Design tokens are written by hand in SCSS, with no
  token build step.
- **D-9.6** The rules for all of this are in
  [design-system.md](design-system.md) (A-10).

## Consequences for the architecture

- **Job runner.** Background clones (REQ-REPO-001), the Simple-level one-minute
  timers, background fetches and conflict reminder emails need a job runner that
  keeps its state in the database and survives restarts.
- **Per-working-copy serialisation.** Saves, automatic commits, fetches, merges
  and the resolution lock all act on the same working copy; git operations on
  one working copy must run one at a time.
- **Push channel to the client.** Clone status (DS-23), remote-change notices
  and conflict notifications all need updates without a reload.
- **Provider abstraction.** Detects the provider from a host, validates a token
  against a repository, and opens pull requests; GitHub and Bitbucket Cloud at
  launch.
- **Shared secret storage.** HTTPS credentials, SSH keys and provider tokens use
  the same encryption at rest.
