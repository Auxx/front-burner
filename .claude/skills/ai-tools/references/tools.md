# AI tools reference

Every tool in `tools/ai-tools/src/bin/`, run from the workspace root as `node
tools/ai-tools/src/bin/<tool>.mjs <command>`. `--help` gives the full options of
each command; this file says what each tool is for, how it works and what to
watch out for. The rules shared by all tools are in [SKILL.md](../SKILL.md).

| Tool                          | For                                                                |
| ----------------------------- | ------------------------------------------------------------------ |
| [`colour`](#colour)           | Converting colours, WCAG contrast, finding a lightness that passes |
| [`tokens`](#tokens)           | The ui library's colour tokens and contrast pairs, without a build |
| [`story`](#story)             | Screenshots of stories and values read from their pages            |
| [`icons`](#icons)             | Finding Codicons and building the sprite of `ui-icon`              |
| [`doc-ids`](#doc-ids)         | Checking and renumbering IDs such as A-10.38 or REQ-EDIT-002       |
| [`nx-tags`](#nx-tags)         | Checking that every Nx project has a scope and a type tag          |
| [`typing-test`](#typing-test) | The page for checking typing speed on a real phone (NF-2.4)        |

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
```

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
```

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
| `show <name...>` | The SVG of each icon (16 × 16, `fill="currentColor"`)                        |
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

## `typing-test`

Builds and serves a page for checking typing speed on a real phone (NF-2.4,
A-8.11), for the person at the phone: the steps and the report are in
[docs/wiki/typing-test.md](../../../../docs/wiki/typing-test.md). The page is
CodeMirror 6 set up as A-8.11 plans for the editor (no `basicSetup`, Markdown
with YAML front matter, soft wrap, spell check), with five generated test files
(`2kb.md`, `100kb.md`, `200kb.md`, `500kb.md`, `1mb.md`, seeded so every build
is the same) and two meters. The address names the file and the parts of the
setup to switch off, `?file=1mb.md&off=frontmatter,wrap` (`SWITCHES`:
`frontmatter`, `language`, `wrap`, `spellcheck`, `direction`); the page refuses
unknown switches rather than measure the wrong setup, and its menus offer the
setups of `SETUPS`.

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
