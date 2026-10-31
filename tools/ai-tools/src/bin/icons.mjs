#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { buildSprite, findIcons, loadIcons, readIcon, readIconList, UI_SPRITE } from '../lib/icons.mjs';
import { readText, workspacePath } from '../lib/workspace.mjs';

main({
  name: 'icons',
  summary: 'Finds Codicons (A-10.35) by name, tag or description, and prints their SVG.',
  commands: {
    find: {
      usage: '<word...> [--limit 20] [--json]',
      summary: 'Lists the icons that match every word, best first.',
      options: { limit: { type: 'string', default: '20' }, json: { type: 'boolean' } },
      run(options, words) {
        if (!words.length) {
          throw new UsageError('Give at least one word');
        }
        const icons = findIcons(loadIcons(), words.join(' ')).slice(0, Number(options.limit));
        print(options.json, icons, () =>
          icons.length
            ? table([ [ 'name', 'category', 'description' ], ...icons.map(i => [ i.name, i.category, i.description ]) ])
            : 'No icons match.');
      }
    },
    sprite: {
      usage: '[--write]',
      summary: 'Builds ui-icon\'s sprite from ICON_NAMES; writes it only with --write.',
      help: [
        'Reads ICON_NAMES in libs/ui/src/content/models/icon-name.model.ts and builds',
        'libs/ui/src/assets/icons.svg from the SVG files of @vscode/codicons. Without',
        '--write it says whether the sprite is up to date and exits 1 if it is not.'
      ].join('\n'),
      options: { write: { type: 'boolean' } },
      run(options) {
        const names = readIconList();
        const sprite = buildSprite(loadIcons(), names);
        const current = existsSync(UI_SPRITE) ? readText(UI_SPRITE) : '';
        const target = workspacePath(UI_SPRITE);
        if (current === sprite) {
          console.log(`${target} is up to date (${names.length} icons).`);
          return 0;
        }
        if (!options.write) {
          console.log(`${target} is out of date: rerun with --write to build it (${names.length} icons).`);
          return 1;
        }
        mkdirSync(dirname(UI_SPRITE), { recursive: true });
        writeFileSync(UI_SPRITE, sprite);
        console.log(`Wrote ${target} (${names.length} icons).`);
        return 0;
      }
    },
    show: {
      usage: '<name...> [--json]',
      summary: 'Prints the SVG of each icon (16×16, fill="currentColor").',
      options: { json: { type: 'boolean' } },
      run(options, names) {
        if (!names.length) {
          throw new UsageError('Give at least one icon name');
        }
        const icons = loadIcons();
        const results = names.map(name => readIcon(icons, name));
        print(options.json, results, () => results.map(r => `${r.name} (${r.description})\n${r.svg}`).join('\n\n'));
      }
    }
  }
});
