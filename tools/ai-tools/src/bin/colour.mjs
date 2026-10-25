#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { describeColour, isClose, measureContrast, solveLightness } from '../lib/colour.mjs';
import { loadTokens, parseOverrides, parseTokenValue, resolveToken, SCHEMES } from '../lib/tokens.mjs';

const VALUE_HELP = `A value is any CSS colour (oklch(55% 0.19 262), #3574f0, rgb(…), white) or a
token without its --ui- prefix (surface-island, neutral-45, alpha(neutral-0, 5%)).
With a token, the command runs for each colour scheme; --scheme picks one.`;

const schemeOption = { scheme: { type: 'string' }, set: { type: 'string', multiple: true }, json: { type: 'boolean' } };

/** Resolves values (colours or tokens) for each scheme they depend on. */
function resolver(values, { scheme, set }) {
  const parsed = values.map(parseTokenValue);
  const usesTokens = parsed.some(value => value.ref);
  if (scheme && !SCHEMES.includes(scheme)) {
    throw new UsageError(`--scheme must be light or dark`);
  }
  const tokens = usesTokens ? loadTokens({ overrides: parseOverrides(set) }) : null;
  const schemes = usesTokens ? (scheme ? [ scheme ] : SCHEMES) : [ null ];
  return schemes.map(s => ({
    scheme: s,
    colours: parsed.map(value => {
      if (!value.ref) {
        return value.colour;
      }
      const { colour } = resolveToken(tokens, value.ref, s);
      return { ...colour, alpha: (colour.alpha ?? 1) * (value.alpha ?? 1) };
    })
  }));
}

const label = scheme => (scheme ? `${scheme}: ` : '');

main({
  name: 'colour',
  summary: 'Colour maths for the design tokens: conversion, WCAG contrast and lightness solving.',
  commands: {
    convert: {
      usage: '<value...> [--scheme light|dark] [--json]',
      summary: 'Prints each value as OKLCH, hex and rgb, and whether it is inside the sRGB gamut.',
      help: VALUE_HELP,
      options: schemeOption,
      run(options, values) {
        if (!values.length) {
          throw new UsageError('Give at least one value');
        }
        // A literal colour is the same in every scheme, so it is listed once.
        const isToken = values.map(value => Boolean(parseTokenValue(value).ref));
        const results = resolver(values, options).flatMap(({ scheme, colours }, s) =>
          colours
            .map((colour, i) => ({ value: values[i], scheme: isToken[i] ? scheme : null, ...describeColour(colour) }))
            .filter((_, i) => isToken[i] || s === 0)
        );
        print(options.json, results, () =>
          table([
            [ 'value', 'scheme', 'oklch', 'hex', 'rgb', 'sRGB' ],
            ...results.map(r => [ r.value, r.scheme ?? '-', r.oklch, r.hex, r.rgb, r.inGamut ? 'in' : 'OUT (clipped)' ])
          ]));
      }
    },
    contrast: {
      usage: '<foreground> <background...> [--min 4.5] [--scheme light|dark] [--set token=value] [--json]',
      summary: 'The WCAG 2.2 contrast ratio of a foreground on background layers, listed from the bottom up.',
      help: `${VALUE_HELP}

Layers are painted as the Storybook token page paints them: each one over the
last, in sRGB with 8 bits per channel. --set changes a token first, as in
tokens try. Exits with 1 when --min is given and a ratio is below it.`,
      options: { ...schemeOption, min: { type: 'string' } },
      run(options, values) {
        if (values.length < 2) {
          throw new UsageError('Give a foreground and at least one background layer');
        }
        const min = options.min === undefined ? undefined : Number(options.min);
        const results = resolver(values, options).map(({ scheme, colours }) => {
          const [ foreground, ...background ] = colours;
          const { ratio, opaque } = measureContrast(foreground, background);
          const pass = min === undefined ? undefined : ratio >= min;
          return {
            scheme,
            ratio: Number(ratio.toFixed(2)),
            opaque,
            pass,
            close: min !== undefined && isClose(ratio, min)
          };
        });
        print(
          options.json,
          results,
          () =>
            results.map(r =>
              `${label(r.scheme)}${r.ratio.toFixed(2)}:1${
                r.pass === undefined
                  ? ''
                  : r.close
                  ? ' pass (close: confirm in Storybook)'
                  : r.pass
                  ? ' pass'
                  : ` FAIL (< ${min})`
              }${r.opaque ? '' : ' (the background is not opaque; the bottom layer must be)'}`
            ).join('\n')
        );
        return results.some(r => r.pass === false) ? 1 : 0;
      }
    },
    solve: {
      usage: '<background...> --hue <deg> --chroma <c> [--min 4.5] [--alpha 1] [--scheme] [--json]',
      summary: 'The OKLCH lightness ranges in which a colour of that hue and chroma meets --min on the background.',
      help: `${VALUE_HELP}

Steps are 0.1 % of lightness. For a neutral, use --chroma 0.005 --hue 265.
Ranges where the chroma is outside sRGB (and so clipped) are listed too.`,
      options: {
        ...schemeOption,
        hue: { type: 'string' },
        chroma: { type: 'string' },
        min: { type: 'string', default: '4.5' },
        alpha: { type: 'string', default: '1' }
      },
      run(options, values) {
        if (!values.length || options.hue === undefined || options.chroma === undefined) {
          throw new UsageError('Give the background layers, --hue and --chroma');
        }
        const input = {
          hue: Number(options.hue),
          chroma: Number(options.chroma),
          minimum: Number(options.min),
          alpha: Number(options.alpha)
        };
        const results = resolver(values, options).map(({ scheme, colours }) => ({
          scheme,
          ...solveLightness({ ...input, background: colours })
        }));
        const range = ({ from, to }) => `${from}%–${to}%`;
        print(
          options.json,
          results,
          () =>
            results.map(r =>
              `${label(r.scheme)}${
                r.ranges.length ? r.ranges.map(range).join(', ') : 'no lightness meets the minimum'
              }${r.clipped.length ? ` (clipped: ${r.clipped.map(range).join(', ')})` : ''}`
            ).join('\n')
        );
      }
    }
  }
});
