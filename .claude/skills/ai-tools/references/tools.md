# AI tools reference

Every tool in `tools/ai-tools/src/bin/`, run from the workspace root as `node
tools/ai-tools/src/bin/<tool>.mjs <command>`. `--help` gives the full options of
each command; this file says what each tool is for, how it works and what to
watch out for. The rules shared by all tools are in [SKILL.md](../SKILL.md).

| Tool                                | For                                                                |
| ----------------------------------- | ------------------------------------------------------------------ |
| [`colour`](#colour)                 | Converting colours, WCAG contrast, finding a lightness that passes |
| [`tokens`](#tokens)                 | The ui library's colour tokens and contrast pairs, without a build |
| [`story`](#story)                   | Screenshots of stories and values read from their pages            |
| [`icons`](#icons)                   | Finding Codicons and building the sprite of `ui-icon`              |
| [`doc-ids`](#doc-ids)               | Checking and renumbering IDs such as A-10.38 or REQ-EDIT-002       |
| [`nx-tags`](#nx-tags)               | Checking that every Nx project has a scope and a type tag          |
| [`typing-test`](#typing-test)       | The page for checking typing speed on a real phone (NF-2.4)        |
| [`mem-profile`](#mem-profile)       | The memory of a test run: peak, per kind of process, over time     |
| [`vitest-configs`](#vitest-configs) | Checking that every project's unit tests use the shared settings   |
| [`gen-large-repo`](#gen-large-repo) | A git repository of 100,000 files, for timing NF-2.8               |
| [`perf-api`](#perf-api)             | The API's NF-2 timings against a running instance, at NF-1's scale |
| [`perf-screen`](#perf-screen)       | NF-2's screen timings in a throttled Chromium, desktop or phone    |

## `colour`

Colour maths with [culori](https://culorijs.org/).

| Command                                            | Does                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `convert <value...>`                               | Prints OKLCH, hex and rgb, and whether the colour is inside sRGB    |
| `contrast <fg> <bg...> [--min 4.5]`                | The WCAG 2.2 ratio of `fg` on background layers, bottom layer first |
| `solve <bg...> --hue <h> --chroma <c> [--min 4.5]` | The OKLCH lightness ranges in which that hue and chroma passes      |

A value is any CSS colour (`oklch(55% 0.19 262)`, `#3574f0`, `white`) or a token
name without `--ui-` (`surface-island`, `neutral-45`, `alpha(neutral-0, 5%)`).
Names with a hyphen are tokens; CSS colour names have none. When a value is a
token, the command runs for both colour schemes, or the one given with `--scheme
light|dark`, and `--set token=value` changes tokens first (as in
[`tokens try`](#tokens)).

```shell
colour.mjs convert '#3574F0'
colour.mjs contrast text-muted surface-island surface-hover --min 4.5
colour.mjs solve surface-canvas --hue 265 --chroma 0.005 --min 4.5
```

- Colours outside sRGB are clipped per channel, as Chromium does; `convert`
  marks them `OUT (clipped)` and `solve` lists the clipped ranges.
- Layers are painted the way the Storybook token page paints them (see
  [How measuring works](#how-measuring-works)). The bottom layer must be opaque;
  the result says so when it is not.
- `contrast --min` exits with 1 when a ratio is below the minimum and marks
  ratios within 2 % of it as close (see below).

## `tokens`

Reads the colour tokens of the ui library from its SCSS sources (A-10.15):
`libs/ui/src/styles/tokens/_primitives.scss` and the `$tokens: (name: (light,
dark))` maps of `_color.scss` and `_syntax.scss`. The contrast pairs come from
`libs/ui/src/design-tokens/models/contrast-pairs.model.ts` (A-10.10).

| Command                | Does                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `list [filter]`        | Semantic tokens whose name contains the filter, with light and dark values |
| `resolve <token...>`   | Each token's final colour in each scheme, and the tokens it goes through   |
| `pairs [filter]`       | Measures every contrast pair in both schemes; exits with 1 if one fails    |
| `try <token=value...>` | The pairs that a change would affect, before and after; 1 if one fails     |
| `unknown [folder...]`  | `var(--ui-*)` references to tokens nothing defines; 1 if there are any     |

`pairs` takes `--failing` (failing pairs only), `--close` (close pairs only) and
`--set token=value` (repeatable). An override is `token=value` for both schemes
or `token@light=value` / `token@dark=value` for one. The value is a token,
`alpha(token, N%)` or a CSS colour. An unknown name adds a new token, which is
how to try a token before adding it to the SCSS.

```shell
tokens.mjs pairs --failing
tokens.mjs pairs 'on surface-raised'
tokens.mjs try text-subtle@light=neutral-50 border-strong=neutral-55
tokens.mjs try toast-background=neutral-20 --json
tokens.mjs unknown libs/web
```

`unknown` reads the SCSS, TypeScript and HTML files under the folders (default
`libs`). A token counts as defined by a declaration, a `$tokens` map key, a
`[style.--ui-*]` binding or a `setProperty` call; specs, stories and comments
define nothing, and a file instead of a folder is refused. References with a
fallback (`var(--ui-x, transparent)`) and names built by interpolation are not
checked. `unknown-tokens.spec.mjs` runs the same check on `libs` in the unit
tests, so a renamed token that a component still reads fails them; `ai-tools`
has implicit dependencies on `ui` and `web-*` for it.

- Use it while choosing token values: try candidates, then edit the SCSS.
- **The unit test.** `tools/ai-tools/src/lib/ui-contrast.spec.mjs` runs the same
  check in `npx nx run ai-tools:test`, so a token change that breaks a pair
  fails the unit tests. `ai-tools` has an implicit dependency on `ui`, so `nx
  affected` runs it when `ui` changes. Add a pair to the model when a component
  needs it, as before; the test picks it up.
- **The check of record is the Storybook token page** (`Design system/Tokens →
  Contrast`), measured in a real browser by `test-storybook` in CI. Results that
  pass by less than 2 % are shown as `pass (close)`: confirm them there, for
  example with `story.mjs eval design-system-tokens--contrast …` (below).
- **The model file is imported by Node**, which strips its types. It must stay
  free of imports and of TypeScript that cannot be erased (enums, namespaces,
  parameter properties). The tokens it names must be in the files above:
  component tokens in component stylesheets are not read.
- The forced-colours block of `_color.scss` (A-10.22) is not read: system
  colours have no fixed value.

### How measuring works

The token page paints each pair on a 1 × 1 canvas and reads the pixels back. The
tools do the same in JavaScript: each layer is converted to sRGB, clipped,
rounded to 8 bits and composited over the one below (source-over), then the WCAG
2.2 ratio is taken. Chromium's own conversion and rounding differ slightly, by
±1 in a channel at times, so ratios can differ from the page. The 2 % close
margin (`CLOSE_MARGIN` in `src/lib/colour.mjs`) covers the largest difference
measured, 1.6 % over all 332 readings of the 166 pairs.

To recheck the margin after the page's measuring or the token files change,
compare both lists of ratios in the same order:

```shell
npx nx run ui:build-storybook
node tools/ai-tools/src/bin/story.mjs eval design-system-tokens--contrast \
  "[...document.querySelectorAll('tr[data-status]')].map(tr => [...tr.cells].map(c => c.textContent.trim()))" \
  --wait 1500 > tmp/browser-contrast.json
node tools/ai-tools/src/bin/tokens.mjs pairs --json > tmp/offline-contrast.json
```

In the page's rows, cells 3 and 4 end with the light and dark ratios. Raise
`CLOSE_MARGIN` if the largest relative difference is above it.

## `story`

Opens stories of the **built** Storybook (`dist/storybook/ui`) in headless
Chromium through Playwright. It serves the build on a random local port, so it
needs no running Storybook.

| Command                        | Does                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `list [filter]`                | Story ids whose id or title contains the filter                  |
| `shot <story-id...>`           | Saves a PNG of each story in each variant: `<id>--<variant>.png` |
| `eval <story-id> <expression>` | Evaluates JavaScript in the story in each variant; prints JSON   |

Variant options, for `shot` and `eval`:

| Option                    | Default             |                                                    |
| ------------------------- | ------------------- | -------------------------------------------------- |
| `--theme light,dark`      | `light`             | One or more; sets the `theme` global and the media |
| `--density compact,touch` | `compact`           | One or more; sets the `density` global             |
| `--forced-colors`         | off                 | Emulates Windows contrast themes (A-10.22)         |
| `--reduced-motion`        | off                 | Emulates `prefers-reduced-motion: reduce`          |
| `--viewport WxH`          | `480x640`           | `320x640` for the narrowest screen (NF-12.4)       |
| `--wait ms`               | `300`               | Extra wait after rendering, for play functions     |
| `--set token=value`       | none                | Overrides a ui token on the root; repeatable       |
| `--storybook <dir>`       | `dist/storybook/ui` | Another build, inside the workspace                |

`shot` also takes `--selector <css>` to shoot one element instead of the page,
and `--out <dir>` (default `tmp/ai-tools/story`). It prints the paths of the
files; open them with the Read tool to look at them.

```shell
npx nx run ui:build-storybook
story.mjs list controls/select
story.mjs shot controls-button--variants --theme light,dark --density compact,touch
story.mjs shot controls-select--saved-keys --viewport 320x640 --selector '#storybook-root'
story.mjs eval controls-checkbox--states "getComputedStyle(document.querySelector('input:checked'), '::after').borderRightColor" --forced-colors
story.mjs eval controls-button--variants "matchMedia('(prefers-reduced-motion: reduce)').matches" --reduced-motion
story.mjs shot layout-app-shell--dashboard --theme dark --set surface-canvas=neutral-30 --out tmp/canvas-30
```

- `--set` tries a token value without rebuilding: the value is another token's
  name (`neutral-30`) or a CSS colour. It is set on the root element, so it
  applies in every scheme; shoot one `--theme` at a time when it should not. Use
  `--out` to keep each option's shots apart.
- **Rebuild Storybook after changing `ui`.** The tool warns when files in
  `libs/ui` are newer than the build.
- The expression runs in the story's page and may return a promise; its result
  must be JSON-serialisable. Wrap statements in `(() => { … })()`.
- A story that fails to render is reported with Storybook's error message.
- This is for looking and probing while working. Behaviour that must not regress
  belongs in the story's play function or a spec.

## `icons`

Looks up [Codicons](https://github.com/microsoft/vscode-codicons) (A-10.35) in
the `@vscode/codicons` package, and builds the sprite that `ui-icon` draws from.

| Command          | Does                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `find <word...>` | Icons matching every word, best first: names and aliases, tags, descriptions |
| `show <name...>` | The SVG of each icon (16 × 16, or 24 × 24 for a few; `fill="currentColor"`)  |
| `sprite`         | Builds `libs/ui/src/assets/icons.svg` from `ICON_NAMES`; 1 if out of date    |

```shell
icons.mjs find close
icons.mjs find git branch --limit 5
icons.mjs show loading eye
icons.mjs sprite --write
```

- Icons are named by their SVG file in the package (`warning`, `ellipsis`),
  which is the name `ui-icon` takes. `find` and `show` also accept an alias from
  the package's `mapping.json` (`alert`, `more`) and print the file name.
- Most icons are drawn on a 16 × 16 grid, but a few (`files`, `source-control`)
  on 24 × 24. Each `<symbol>` keeps its icon's own `viewBox`, so `ui-icon` draws
  every icon at the same size.
- The package's own `dist/codicon.svg` is not used: it lacks icons whose file is
  named by a later alias, such as `warning`, `sync` and `lock`.
- To give `ui-icon` a new icon, check it with `find`, add its name in order to
  `ICON_NAMES` in `libs/ui/src/content/models/icon-name.model.ts`, then run
  `sprite --write`. `sprite` writes only with `--write`; without it, it exits 1
  when the sprite is out of date. A spec fails while the sprite and the list
  differ, including after a Codicons upgrade that changes an icon. The
  `ai-tools` test target takes the installed `@vscode/codicons` version as an
  input, so Nx reruns that spec after an upgrade rather than replaying a cached
  pass.

## `doc-ids`

Checks and renumbers the IDs of requirements and architecture rules: `REQ-…`,
`A-x.y`, `D-x.y`, `NF-x.y` and the IDs inside requirements (`LG-12`, `FB-18`,
…), in the docs **and** in code comments that cite them.

| Command                                 | Does                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `check`                                 | Duplicates, references to undefined IDs, missing numbers; 1 on any |
| `find <id>`                             | Where an ID and its sub-IDs are defined and referenced             |
| `renumber <family> --from <n> --by <k>` | Shifts every ID of the family numbered `n` or more by `k`          |
| `rename <id> <new-id>`                  | Renames one ID and its sub-IDs                                     |
| `criteria`                              | MVP acceptance criteria that no test names, per requirement        |

`renumber` and `rename` print every change and write only with `--write`. They
refuse when a new ID is already in use. The family is the ID without its last
number: `A-10` for `A-10.x`, `LG` for `LG-x`, `REQ-EDIT` for `REQ-EDIT-00x`.
Zero padding is kept, sub-IDs (`A-10.21.1`) move with their parent, and all
files are changed in one pass, so shifts do not chain.

```shell
doc-ids.mjs check
doc-ids.mjs find A-10.38
doc-ids.mjs renumber A-10 --from 21 --by 1            # room for a new A-10.21
doc-ids.mjs renumber A-10 --from 21 --by 1 --write
doc-ids.mjs rename A-10.42 A-10.50                    # refused if A-10.50 is used
doc-ids.mjs criteria                                  # MVP criteria without a test
```

What counts as a definition:

- a list item that starts with the ID in bold: `- **A-10.5** …`;
- a heading `# REQ-FILE-001: …` (a `## A-10: …` heading names a group and may
  repeat);
- the first cell of a table row, `| NF-2.1 | … |`, unless a list item or heading
  defines the same ID (then the table only lists it).

A family's home is the file with most of its definitions. A bold ID at the start
of a list item in another file, such as `- **AR-31** says …` in a list of
follow-ups, is a reference when the home file defines it.

What is scanned, by default: `docs`, `libs`, `apps`, `tools`, `CLAUDE.md` and
`README.md`, in `.md`, `.ts`, `.mjs`, `.js`, `.scss` and `.html` files. Skipped:

- `node_modules`, `dist`, `tmp`, `coverage`, `.nx`, `.git`, `.angular`;
- `tools/ai-tools`, whose specs contain example IDs;
- `docs/superpowers`, whose plans are dated and keep the numbers they were
  written with. `--include-plans` scans them too.

`--path <path>` (repeatable) scans other files or folders inside the workspace
instead.

`criteria` reads the MVP criteria from the **In MVP** and **Limited in MVP**
columns of the In scope tables in `docs/product/mvp.md`, and the test titles in
the spec files under `apps` and `libs`. A criterion has a test when a test title
starts with its ID: `it('AC-REPO-001.2: …')`, or several IDs joined by `, ` and
`and`. IDs in comments or later in a title do not count. Consecutive IDs are
printed as ranges, ready for the **MVP criteria without a test** column of the
implementation status table.

- Run `check` after editing docs, and before committing a docs change.
- Run `criteria` after adding or renaming tests that cover MVP criteria, and
  copy its result into the implementation status table of `docs/product/mvp.md`.
- Prefer `renumber` to editing numbers by hand; read the printed changes before
  `--write`. After writing, run `check` and format the docs.
- Uppercase words joined by hyphens and numbers look like IDs (`UTF-8`). They
  are ignored unless their prefix has definitions.

## `nx-tags`

Checks that every Nx project has exactly one known `scope:` tag and one known
`type:` tag (A-2.4). The module boundary rules in `eslint.config.mjs` are keyed
on these tags, and Nx cannot require them, so a project created without tags
would escape every rule. CI runs it as `npm run check:tags`.

| Command          | Does                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `check [--json]` | Missing, unknown or duplicate `scope:`/`type:` tags; 1 if there is any |

The vocabulary is `scope:server|web|shared|tools` and
`type:app|feature|core|domain|data-access|ui|contracts|util`, in
`src/lib/nx-tags.mjs`. Tags with other prefixes are ignored. A new tag needs
both that list and the constraints in `eslint.config.mjs`.

```shell
nx-tags.mjs check
```

## `vitest-configs`

Checks that the unit tests of every project build on the shared settings in
`vitest.shared.mts` at the workspace root (such as `maxWorkers`), so that a
project created by a generator, which writes its own `vitest.config.mts`, is
caught. CI runs it as `npm run check:vitest`.

| Command          | Does                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `check [--json]` | `test` targets whose Vitest config skips the shared one; 1 if any is |

It reads the `test` target of each project from the Nx project graph, with the
target defaults applied:

- `nx:run-commands` with `vitest run`: the `vitest.config.*` of the folder it
  runs in must import `vitest.shared.mts`, and the command must not pass
  `--config`. Fix a new project's config by replacing it with `export default
  nodeConfig(import.meta.dirname);`: `nestConfig` for NestJS code (SWC, for
  decorator metadata), `angularConfig` for Angular code (Analog, jsdom,
  `src/test-setup.ts`). They take `{ include }` for other test files, and the
  result can go through Vitest's `mergeConfig` for anything else.
- `@angular/build:unit-test` and `@nx/angular:unit-test`: the builder reads a
  Vitest config only through `runnerConfig`, which `nx.json` sets to `true` for
  both executors. It then loads `vitest-base.config.*` from the project, or else
  the root's, which passes on the shared test options; a project's own must
  import `vitest.shared.mts` too. The builder sets the test files, environment
  and watch mode itself, so only test options belong there.
- Any other `test` target is reported, so that a new runner is taught to the
  tool rather than skipped.

Both shared files are in `sharedGlobals` in `nx.json`, so changing them reruns
the tests instead of taking them from the cache.

```shell
vitest-configs.mjs check
```

## `typing-test`

Builds and serves a page for checking typing speed on a real phone (NF-2.4,
A-8.11), for the person at the phone: the steps and the report are in
[docs/wiki/typing-test.md](../../../../docs/wiki/typing-test.md). The page is
CodeMirror 6 set up as A-8.11 plans for the editor (no `basicSetup`, Markdown
with YAML front matter, soft wrap, spell check), with five generated test files
(`2kb.md`, `100kb.md`, `200kb.md`, `500kb.md`, `1mb.md`, seeded so every build
is the same) and two meters. The address names the file and the parts of the
setup to switch off, `?file=1mb.md&off=frontmatter,wrap` (`SWITCHES`:
`frontmatter`, `language`, `wrap`, `linenumbers`, `wrapmarker`, `spellcheck`,
`direction`; `linenumbers` is line numbers with the active-line gutter,
`wrapmarker` the editor's wrap-marker gutter, which the page turns off whenever
`wrap` is off, as the product does); the page refuses unknown switches rather
than measure the wrong setup, and its menus offer the setups of `SETUPS`.
`&conflicts=on` (the **Conflicts** box) puts every 40th non-empty line of the
file in a conflict (`withConflicts`) and turns on the editor's conflict view.
The wrap-marker gutter, per-line direction and the conflict view are the
editor's real sources, not copies: the page imports them as `typing-test:<name>`
and the build bundles them from `libs/web/code-editor` (`EDITOR_SOURCES`), since
the page can't import a library by path.

| Command                                          | Does                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `build [--out tmp/typing-test] [--json]`         | Bundles the page with esbuild and writes the test files; prints sizes |
| `serve [--out …] [--host 0.0.0.0] [--port 8080]` | Builds, then serves the page to the local network until Ctrl+C        |

```shell
typing-test.mjs serve
```

- **How the meters measure.** The page's own meter starts a keystroke at the
  `timeStamp` of its `keydown` (keys that edit text only) or `beforeinput`
  event, whichever comes first, and ends it just after the main thread has made
  the first frame after the editor's text changed (a task queued from
  `requestAnimationFrame`): before the frame is on screen, so it reads low. Keys
  that change no text within 1 s are dropped. Where the browser has the Event
  Timing API (Chromium, not Safari), `keystrokeTimings` joins the key and input
  events of 16 ms or more whose frames end within 8 ms of each other into one
  keystroke, timed from its first event to the frame on screen: the measure of
  record for NF-2.4. `2kb.md` is the baseline of what the phone, browser and
  keyboard cost without editor work.
- The page's buttons never take the focus (`mousedown` is cancelled): on
  Android, focus moved away from the editor and back within one tap leaves the
  keyboard open but typing nowhere.
- The server serves only the four files of the site; anything else is 404.
- Over plain `http` on the LAN the clipboard API is not available, so **Copy
  results** falls back to selecting the text; `adb reverse tcp:8080 tcp:8080`
  makes `http://localhost:8080/` work on an Android phone, which is a secure
  context.
- Check it in emulation first (Chromium, Pixel 7, CPU slowed 4×): the 1 MB file
  measured a median of 30 ms and a maximum of 43 ms on 2026-10-28.

## `mem-profile`

Runs a test scenario and samples the memory of every process it starts, to find
what fills the machine's memory during test runs and to compare settings
(workers, `--parallel`, browsers). Each run writes three files to
`tmp/ai-tools/mem-profile/<scenario>/<time>[-<label>]`: a Markdown report
(`.md`), the data (`.json`) and the command's output (`.log`), each line of it
prefixed with the seconds since the start, as the report's timeline is.

| Command                                                           | Does                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `list [--json]`                                                   | The scenarios and what they run                                  |
| `run <scenario> [--interval 1000] [--label x] [--quiet] [--json]` | Runs the scenario and writes the report; 1 if the command failed |

The scenarios, in `SCENARIOS` of `src/lib/mem-profile.mjs`: `unit`, `unit-web`,
`unit-server`, `storybook`, `e2e-server`, `e2e-web`, `e2e-web-chromium` and
`all`. Every one runs Nx with `--skipNxCache` (a cached task runs nothing) and
`--outputStyle=stream` (log lines name their project). The e2e scenarios build
first with a `prepare` command that is not measured, and then run the e2e target
with `--excludeTaskDependencies`. Arguments after `--` are appended to the
command; `--env NAME=value` (repeatable) sets its environment and is recorded in
the report, which reaches targets whose executor refuses unknown options (the
Angular unit-test builder refuses `--maxWorkers`, but Vitest reads
`VITEST_MAX_WORKERS`); and `--label` tells the runs apart:

```shell
mem-profile.mjs run unit --quiet
mem-profile.mjs run unit --quiet --label parallel-1 -- --parallel=1
mem-profile.mjs run unit --quiet --label workers-4 --env VITEST_MAX_WORKERS=4
mem-profile.mjs run e2e-web-chromium --quiet --label workers-4 -- --workers=4
```

- **What it measures.** The process tree of the command, found by parent PID.
  Processes whose parent has exited are still found through the parent's PID; a
  PID that the system reuses (another start time) is left out. A process is
  known by PID and start time, not by name, since `sh -c` execs its command. On
  Windows a long-lived PowerShell lists the processes (`Win32_Process`) and the
  peak is measured by **private** (committed) memory, which is what runs out;
  the working set is reported beside it but counts shared pages once per
  process. Elsewhere `ps` gives RSS only, and the peak is RSS.
- **System memory in use** is the whole machine's, so close what you can before
  a run, and compare runs made in the same conditions.
- **The e2e scenarios need Linux.** The server's git runner, credential broker
  and SSH agent only run there, so on Windows the built server stops at its
  `git` startup step. Run them in a Linux container from a snapshot of the
  working tree (`node:24` on Debian 13 for git ≥ 2.47, `npx playwright install
  --with-deps chromium firefox`), with `--ipc=host`, and `--out` a folder that
  is bind-mounted, but not under `tmp/` (Docker would create `tmp/` as root, and
  the builds write there). The system memory is then the Docker VM's.
- **Categories** come from process names and command lines: `vitest` (runners
  and their workers), `browser`, `server instance` (the e2e servers),
  `playwright`, `angular`, `webpack`, `nx`, `npm`, `shell`, `node (other)`, and
  other programs by name.
- Extra arguments run in a shell, so the tool refuses quotes, spaces and other
  characters the shell would read; `%` is allowed only at the end
  (`--maxWorkers=50%`).
- Ctrl+C stops the command, and the report of what ran so far is still written.

## `gen-large-repo`

Writes a git repository of 100,000 files with one commit, for `perf-api.mjs
--large` (NF-2.8), since spike 4's harness was not kept. Its shape stands in for
spike 4's shallow Linux clone: one folder per 22 files (4,504 folders), at most
5 levels deep and bushy near the top; file sizes log-normal with a median of 4
KB, scaled so that the files total 1.2 GB (1000-based); 45 % `.c`, 30 % `.h`, 20
% `.md`, 5 % `.txt` and 1 % binary (`.png`, `.bin`). Text files start with their
path and are cut from seeded lines of C-like words, so git compresses them about
as it compresses source code. Author, committer and dates are fixed, and git
runs without the user's or the system's configuration, so one seed and set of
options always gives one commit ID.

| Command                                                                  | Does                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `generate [--out tmp/ai-tools/large-repo] [--seed 1] [--files] [--size]` | Writes the repository and prints its shape and commit ID      |
| `generate --from <path> [--json]`                                        | Prints the shape of an existing clone instead; writes nothing |

```shell
gen-large-repo.mjs generate
gen-large-repo.mjs generate --from tmp/linux
```

- **The shape is the record.** The checklist quotes the printed shape next to
  the numbers measured with it. On 2026-11-21 the defaults printed 100,000
  files, 4,504 folders, depth 5, 1200.0 MB, median 4.0 KB, mean 12.0 KB, largest
  2062.5 KB, commit `135e3c3a`, in 25 to 40 seconds.
- `--out` must be missing or empty; the tool never deletes. Delete the folder
  when done: it holds 1.2 GB of files and as much again in `.git`.
- `--from` takes a clone inside the workspace (clone Linux into `tmp/` to
  compare with spike 4), leaves out `.git` and does not follow symbolic links.

## `perf-api`

Measures NF-2's API targets against a running instance and prints p50, p95 and
max next to each target, with the host's CPUs, memory and git version, so that a
number is never quoted without the machine. Plan 152 runs it on the reference
host; a run anywhere else is only "indicative" in the release checklist
(`docs/wiki/release-checks.md`, "Plan 150").

| Command                                                                         | Does                                                                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `run --url <instance> (--email <e> \| --users <n>) [--large] [--cold] [--json]` | Prepares its repositories, times each operation, prints the table; 1 if a hard target is missed |
| `scale --data-dir <dir> [--repos-dir <dir>] [--users 49] [--repositories 50]`   | Fills a stopped instance with users and working copies (NF-1.1, NF-1.3)                         |
| `ready --url <instance> [--timeout 600]`                                        | Seconds from the command's start until `/api/health/ready` answers 200                          |

The instance runs with `FRONT_BURNER_SERVER_TIMING=true` (A-7.14), and its git
trusts the e2e suites' test certificate
(`GIT_SSL_CAINFO=libs/server/core/security/src/testing/fixtures/test.crt`): the
tool serves the remotes itself, from `--work` (default `tmp/ai-tools/perf-api`),
over HTTPS on `127.0.0.1` (`--git-host`, `--git-port`; the certificate is for
`localhost`, `127.0.0.1` and `::1`, so a container needs `--network host`). The
password is read from `PERF_PASSWORD`, never from the command line.

```shell
PERF_PASSWORD=… perf-api.mjs run --url http://127.0.0.1:3000 --email admin@example.com
PERF_PASSWORD=… perf-api.mjs run --url http://127.0.0.1:3000 --email admin@example.com --large
perf-api.mjs scale --data-dir tmp/perf-data          # the instance stopped
perf-api.mjs ready --url http://127.0.0.1:3000 & <start the instance>
PERF_PASSWORD=… perf-api.mjs run --url http://127.0.0.1:3000 --users 10
```

- **What it measures.** NF-2.1, NF-2.2 and NF-2.3 read the server's own duration
  from `Server-Timing`, so the client's network is left out, as NF-2's "API is
  measured on the server" says: a folder `many/` of 1,000 files, a 100 KB
  `big.md`, and saves of a 100 KB `saved.md`. NF-2.6 times a pull or push job
  from the request that got through (a `429`'s wait left out) to `job.finished`
  on the push channel, and subtracts the median of plain `git pull` or `git
  push` from this host against the same remote: what the instance adds. A job
  that was cancelled, failed or pulled into a conflict ends the run. Once the
  push channel has been down, its event may be lost, so the job's state is
  polled every 2 seconds; a job found finished that way is dropped, with a line
  on stderr, and the Runs column shows fewer runs. A push channel that refuses 5
  connections in a row ends the run. Before each pull, a clone on this host
  pushes a commit; before each push, the tool saves and commits through the API.
  `--large` adds the repository of `gen-large-repo.mjs` (`--large-repo`) and
  times warm status and commit (NF-2.8), and 10 pushes with no warm-up, the
  first of which sends every commit before it (NF-1.4, no target); `--cold` also
  drops the page cache before 5 status and 5 commit runs (`--cold-runs`), which
  needs Linux and root on the instance's host. Each other operation has 5
  warm-up runs (`--warmup`) and 50 measured ones (`--runs`).
- **Pass.** A hard target missed shows "NO" and makes `run` exit 1. NF-2.8's
  "about 2 seconds" is soft: over it shows "over" and fails nothing.
- **Its repositories.** `--name` (default `perf`) and `<name>-large` are created
  and refused when the user has one with that name. It never removes them:
  remove them in the web client, and delete `--work`, when done.
- **`--users n`** logs in as the first n users of `scale`
  (`perf-user-01@example.invalid` on, with the administrator's password), each
  with a repository `<name>-u<i>` of its own, and runs the measures of all of
  them at once (NF-1.2). Separate users, because NF-11.4 limits each user to 600
  requests a minute; a `429` is waited out (`Retry-After`), never counted. Only
  10 logins a minute are allowed from one address, which `--users 10` uses up.
- **`scale`** writes into the data directory directly, since the MVP has no API
  that creates users. It refuses one whose database is open (a `-shm` or `-wal`
  file) or that holds any user besides the first administrator. Every user gets
  50 ready repositories with a small working copy (20 pages), copied from one
  template; their remote, `https://git.example.invalid/perf/scale.git`, is never
  reachable, so no fetch of theirs reaches the network. The data directory must
  be in the workspace, like every path of these tools: for a container,
  bind-mount one under `tmp/`, and run `scale` as the container's UID so that
  the instance can write what it wrote.
- **The tool shares the machine** with the instance and its git server in a
  local run, and its own git work adds load, more so with `--users 10`. On the
  reference host it runs on the host too (plan 152), so that the remote is as
  near to the instance's git as to plain git, on both sides of NF-2.6's
  subtraction, and so that `scale` can reach the data directory.
- `--cold` was not run when the tool was written (no root on that machine).

## `perf-screen`

Measures NF-2's screen targets in Playwright's Chromium and prints p50, p95 and
max next to each target, with the host. Each time ends at a performance mark of
the web client (A-8.17 in `docs/architecture/web-client.md`), so the numbers are
the client's own moments, not guesses from the DOM. Plan 152 runs it on the
reference host; a run anywhere else is only "indicative" in the release
checklist (`docs/wiki/release-checks.md`, "Plan 151").

| Command                                                                                  | Does                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `run --url <instance> --email <e> [--profile desktop\|phone] [--runs 20] [--measures …]` | Adds its repository, times each measure in fresh contexts; 1 if a target is missed |

```shell
PERF_PASSWORD=… perf-screen.mjs run --url http://127.0.0.1:3000 --email admin@example.com
PERF_PASSWORD=… perf-screen.mjs run --url http://127.0.0.1:3000 --email admin@example.com --profile phone
PERF_PASSWORD=… perf-screen.mjs run --url … --email … --measures folder,preview --runs 5
```

The instance must serve the built web client (the image, or `node
dist/apps/server/main.js` after a production build), and its git must trust the
test certificate, as for [`perf-api`](#perf-api): the tool serves its remote
itself, from `--work` (default `tmp/ai-tools/perf-screen`). The password is read
from `PERF_PASSWORD`.

- **The measures.** `first-load` (NF-2.7): from the navigation to `/` to
  `fb:app-ready`, on slow 4G with an empty cache; then a reload in the same
  context, printed as the warm row for information. `folder` (NF-2.1): from the
  click on the folder `many/` (1,000 files) to `fb:tree-folder-shown` for it, on
  slow 4G. `editor-broadband` and `editor-slow-4g` (NF-2.2): from the click on
  the 100 KB `big.md` to `fb:editor-ready`, the editor's chunk not loaded yet;
  broadband is not throttled and runs on the desktop only. `preview` (NF-2.5):
  types a word at the end of the 200 KB `preview.md`, not throttled, and times
  until a `fb:preview-updated` whose render shows that word: from the last key
  on a desktop, where the preview is beside the editor; from the tap on the
  **Preview** tab on a phone, where the hidden preview does no work (A-8.12).
- **Throttling.** Slow 4G is Chrome DevTools' preset as DevTools sets it, the
  values NF-2 names: 562.5 ms per request, 180 KB/s down, 84 KB/s up
  (1000-based). It is set after the screen has opened, just before the measured
  click, except for the first load. `--profile phone` is Playwright's Pixel 7
  (touch, a narrow screen, so the tree is a drawer) with the CPU 4 times slower,
  as `typing-test.mjs` and the preview's e2e test take a mid-range phone to be.
- **Fresh contexts.** Every run, warm-up runs too (`--warmup`, default 1), is a
  new browser context, so the cache is cold. One login serves the whole run (10
  logins a minute are allowed per address): each context starts with the refresh
  token's cookie and the web client's `front-burner.auth`, and hands them on,
  since a refresh replaces the token. Nothing else the device remembers is
  handed on, such as the expanded folders (FB-14).
- **Its repository.** `--name` (default `screen`) is created and refused when it
  exists; the preview runs save the typed words into it. Remove it in the web
  client, and delete `--work`, when done.
- **A missed mark** ends the run after 60 seconds with the page's address and
  the `fb:` marks set so far, which tells a lost session (the login page) from a
  mark that never came.
- The run on a developer machine shares the CPU with the instance; the slow 4G
  rows hardly depend on it, the preview row does.
