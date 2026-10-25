#!/usr/bin/env node
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { main, print, table, UsageError } from '../lib/cli.mjs';
import {
  builtAt,
  DEFAULT_STORYBOOK,
  launchBrowser,
  listStories,
  openStory,
  parseViewport,
  serve,
  storybookDir,
  variantLabel,
  variants
} from '../lib/storybook.mjs';
import { resolveInWorkspace, WORKSPACE_ROOT, workspacePath } from '../lib/workspace.mjs';

const VARIANT_OPTIONS = {
  theme: { type: 'string', default: 'light' },
  density: { type: 'string', default: 'compact' },
  'forced-colors': { type: 'boolean' },
  'reduced-motion': { type: 'boolean' },
  viewport: { type: 'string', default: '480x640' },
  wait: { type: 'string', default: '300' },
  storybook: { type: 'string', default: DEFAULT_STORYBOOK }
};

const VARIANT_HELP = `Options:
  --theme light,dark         one or more, comma-separated (default light)
  --density compact,touch    one or more (default compact)
  --forced-colors            emulate Windows contrast themes
  --reduced-motion           emulate prefers-reduced-motion: reduce
  --viewport 480x640         the page size (default 480x640)
  --wait 300                 milliseconds to wait after rendering, for play functions
  --storybook <dir>          the built Storybook (default ${DEFAULT_STORYBOOK})

Stories run from the built Storybook: build it first with
npx nx run ui:build-storybook. Find story ids with the list command.`;

function parseList(text, allowed, name) {
  const list = text.split(',').map(item => item.trim()).filter(Boolean);
  const wrong = list.filter(item => !allowed.includes(item));
  if (!list.length || wrong.length) {
    throw new UsageError(`--${name} takes ${allowed.join(', ')}; got ${text}`);
  }
  return list;
}

function readVariants(options) {
  return variants({
    theme: parseList(options.theme, [ 'light', 'dark' ], 'theme'),
    density: parseList(options.density, [ 'compact', 'touch' ], 'density'),
    forcedColors: options['forced-colors'],
    reducedMotion: options['reduced-motion'],
    viewport: parseViewport(options.viewport)
  });
}

/** The newest change to the ui library's sources, to warn about a stale Storybook build. */
function newestSource(dir = join(WORKSPACE_ROOT, 'libs/ui')) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSource(path) : entry.isFile() ? statSync(path).mtimeMs : 0);
  }
  return newest;
}

function warnIfStale(dir) {
  if (newestSource() > builtAt(dir).getTime()) {
    console.error(`Warning: libs/ui changed after ${workspacePath(dir)} was built; run npx nx run ui:build-storybook.`);
  }
}

/** Opens each story in each variant and passes the page to `visit`. */
async function eachStory(ids, options, visit) {
  const dir = storybookDir(options.storybook);
  warnIfStale(dir);
  const known = new Set(listStories(dir).map(story => story.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) {
    throw new Error(`Unknown stories: ${unknown.join(', ')} (see the list command)`);
  }
  const list = readVariants(options);
  const wait = Number(options.wait);
  const server = await serve(dir);
  const browser = await launchBrowser();
  try {
    for (const id of ids) {
      for (const variant of list) {
        const { page, close } = await openStory(browser, server.url, id, variant, { wait });
        try {
          await visit({ id, variant, page });
        } finally {
          await close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main({
  name: 'story',
  summary: 'Opens stories of the built Storybook in Chromium, to take screenshots or read values from the page.',
  commands: {
    list: {
      usage: '[filter] [--storybook <dir>] [--json]',
      summary: 'Lists the story ids whose id or title contains the filter.',
      options: { storybook: { type: 'string', default: DEFAULT_STORYBOOK }, json: { type: 'boolean' } },
      run(options, [ filter = '' ]) {
        const stories = listStories(storybookDir(options.storybook), filter);
        print(
          options.json,
          stories,
          () => table([ [ 'id', 'title', 'name' ], ...stories.map(s => [ s.id, s.title, s.name ]) ])
        );
      }
    },
    shot: {
      usage: '<story-id...> [variant options] [--selector <css>] [--out <dir>]',
      summary: 'Saves a PNG of each story in each variant, named <id>--<variant>.png.',
      help: `${VARIANT_HELP}
  --selector <css>           shoot one element instead of the page
  --out <dir>                where to save, inside the workspace (default tmp/ai-tools/story)`,
      options: {
        ...VARIANT_OPTIONS,
        selector: { type: 'string' },
        out: { type: 'string', default: 'tmp/ai-tools/story' }
      },
      async run(options, ids) {
        if (!ids.length) {
          throw new UsageError('Give at least one story id');
        }
        const out = resolveInWorkspace(options.out);
        mkdirSync(out, { recursive: true });
        await eachStory(ids, options, async ({ id, variant, page }) => {
          // Story ids are [a-z0-9-] already; anything else is dropped from the file name.
          const file = join(out, `${id.replace(/[^a-z0-9-]/g, '')}--${variantLabel(variant)}.png`);
          const target = options.selector ? page.locator(options.selector).first() : page;
          await target.screenshot({ path: file, ...(options.selector ? {} : { fullPage: true }) });
          console.log(workspacePath(file));
        });
      }
    },
    eval: {
      usage: '<story-id> <expression> [variant options]',
      summary: 'Evaluates a JavaScript expression in the story in each variant and prints the results as JSON.',
      help: `The expression runs in the story's page and may return a promise; its result
must be JSON-serialisable. For example:
  "getComputedStyle(document.querySelector('[role=status]')).animationName"

${VARIANT_HELP}`,
      options: VARIANT_OPTIONS,
      async run(options, [ id, expression, ...rest ]) {
        if (!id || !expression || rest.length) {
          throw new UsageError('Give one story id and one expression (quote it)');
        }
        const results = [];
        await eachStory([ id ], options, async ({ variant, page }) => {
          results.push({ variant: variantLabel(variant), result: await page.evaluate(expression) });
        });
        print(true, results);
      }
    }
  }
});
