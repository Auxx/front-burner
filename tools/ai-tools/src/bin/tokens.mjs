#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { CLOSE_MARGIN, describeColour } from '../lib/colour.mjs';
import {
  checkPairs,
  describePair,
  loadContrastPairs,
  loadTokens,
  parseOverrides,
  resolveToken,
  SCHEMES
} from '../lib/tokens.mjs';

// Importing contrast-pairs.model.ts makes Node warn that libs/ui/package.json
// has no "type"; the import itself works. Other warnings are still printed.
process.removeAllListeners('warning');
process.on('warning', warning => {
  if (warning.code !== 'MODULE_TYPELESS_PACKAGE_JSON') {
    console.error(`${warning.name}: ${warning.message}`);
  }
});

const OVERRIDE_HELP = `--set token=value (repeatable) changes a token before measuring: token@light=…
or token@dark=… changes one scheme. The value is a token (neutral-50,
alpha(neutral-0, 8%)) or a CSS colour. Unknown names add a new token.`;

const ratio = value => (value === undefined ? '-' : value.toFixed(2));

function pairRows(results) {
  return [
    [ 'pair', 'min', 'light', 'dark', 'status' ],
    ...results.map(r => [
      describePair(r.pair),
      r.pair.minimum,
      ratio(r.light),
      ratio(r.dark),
      status(r)
    ])
  ];
}

const jsonPair = r => ({ ...r, pair: describePair(r.pair), minimum: r.pair.minimum });

const status = r =>
  r.status === 'missing' ? `MISSING: ${r.error}` : r.status === 'fail' ? 'FAIL' : r.close ? 'pass (close)' : 'pass';

const CLOSE_NOTE = `"close" passes by less than ${CLOSE_MARGIN * 100} %: confirm it on the Storybook token page.`;

main({
  name: 'tokens',
  summary: 'Reads the colour tokens of libs/ui/src/styles/tokens without a browser.',
  commands: {
    list: {
      usage: '[filter] [--json]',
      summary: 'Lists the semantic colour tokens whose name contains the filter, with their light and dark values.',
      options: { json: { type: 'boolean' } },
      run(options, [ filter = '' ]) {
        const tokens = loadTokens();
        const show = value => (value.ref
          ? (value.alpha === undefined ? value.ref : `alpha(${value.ref}, ${value.alpha * 100}%)`)
          : describeColour(value.colour).oklch);
        const rows = [ ...tokens.semantic ]
          .filter(([ name ]) => name.includes(filter))
          .map(([ name, [ light, dark ] ]) => ({ name, light: show(light), dark: show(dark) }));
        print(
          options.json,
          rows,
          () => table([ [ 'token', 'light', 'dark' ], ...rows.map(r => [ r.name, r.light, r.dark ]) ])
        );
      }
    },
    resolve: {
      usage: '<token...> [--scheme light|dark] [--set token=value] [--json]',
      summary: 'Follows each token to its final colour in each scheme, through ref() and alpha().',
      help: OVERRIDE_HELP,
      options: { scheme: { type: 'string' }, set: { type: 'string', multiple: true }, json: { type: 'boolean' } },
      run(options, names) {
        if (!names.length) {
          throw new UsageError('Give at least one token');
        }
        const tokens = loadTokens({ overrides: parseOverrides(options.set) });
        const schemes = options.scheme ? [ options.scheme ] : SCHEMES;
        const results = names.flatMap(name =>
          schemes.map(scheme => {
            const { colour, chain } = resolveToken(tokens, name, scheme);
            return { token: name.replace(/^--ui-/, ''), scheme, chain, alpha: colour.alpha, ...describeColour(colour) };
          })
        );
        print(options.json, results, () =>
          table([
            [ 'token', 'scheme', 'via', 'oklch', 'hex' ],
            ...results.map(r => [ r.token, r.scheme, r.chain.slice(1).join(' → ') || '-', r.oklch, r.hex ])
          ]));
      }
    },
    pairs: {
      usage: '[filter] [--failing] [--close] [--set token=value] [--json]',
      summary: 'Measures every pair of contrast-pairs.model.ts in both schemes; exits with 1 when one fails.',
      help: `The filter keeps pairs whose description contains it, such as "text-muted" or
"on surface-raised". The Storybook token page is the check of record (A-10.10);
this one reads the SCSS sources and paints layers the same way, to within
${CLOSE_MARGIN * 100} %. --failing shows only failing pairs, --close only close ones.

${OVERRIDE_HELP}`,
      options: {
        failing: { type: 'boolean' },
        close: { type: 'boolean' },
        set: { type: 'string', multiple: true },
        json: { type: 'boolean' }
      },
      async run(options, [ filter = '' ]) {
        const tokens = loadTokens({ overrides: parseOverrides(options.set) });
        const all = checkPairs(tokens, await loadContrastPairs());
        const shown = all
          .filter(r => describePair(r.pair).includes(filter))
          .filter(r => !options.failing || r.status !== 'pass')
          .filter(r => !options.close || r.close);
        const failing = all.filter(r => r.status !== 'pass').length;
        const close = all.filter(r => r.close).length;
        print(options.json, { total: all.length, failing, close, pairs: shown.map(jsonPair) }, () =>
          [
            shown.length ? table(pairRows(shown)) : 'No pairs shown.',
            '',
            `${all.length} pairs, ${failing} failing, ${close} close.`,
            ...(close ? [ CLOSE_NOTE ] : [])
          ].join('\n'));
        return failing ? 1 : 0;
      }
    },
    try: {
      usage: '<token=value...> [--json]',
      summary:
        'Shows how changing tokens would change the contrast pairs, before and after; exits with 1 when one fails.',
      help: OVERRIDE_HELP.replace('--set token=value (repeatable)', 'Each token=value'),
      options: { json: { type: 'boolean' } },
      async run(options, sets) {
        if (!sets.length) {
          throw new UsageError('Give at least one token=value');
        }
        const pairs = await loadContrastPairs();
        const before = checkPairs(loadTokens(), pairs);
        const after = checkPairs(loadTokens({ overrides: parseOverrides(sets) }), pairs);
        const changed = after
          .map((r, i) => ({ before: before[i], after: r }))
          .filter(({ before: b, after: a }) => b.light !== a.light || b.dark !== a.dark || b.status !== a.status);
        const failing = after.filter(r => r.status !== 'pass').length;
        const cell = r => `${ratio(r.light)} / ${ratio(r.dark)}`;
        print(
          options.json,
          { changed: changed.map(c => ({ before: jsonPair(c.before), after: jsonPair(c.after) })), failing },
          () =>
            [
              changed.length
                ? table([
                  [ 'pair', 'min', 'before (light / dark)', 'after (light / dark)', 'status' ],
                  ...changed.map(({ before: b, after: a }) => [
                    describePair(a.pair),
                    a.pair.minimum,
                    cell(b),
                    cell(a),
                    status(a)
                  ])
                ])
                : 'No pair changes.',
              '',
              `${changed.length} pairs changed, ${failing} failing after the change.`,
              ...(changed.some(c => c.after.close) ? [ CLOSE_NOTE ] : [])
            ].join('\n')
        );
        return failing ? 1 : 0;
      }
    }
  }
});
