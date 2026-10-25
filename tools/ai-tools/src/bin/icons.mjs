#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { findIcons, loadIcons, readIcon } from '../lib/icons.mjs';

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
