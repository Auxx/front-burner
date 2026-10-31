import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isClose, measureContrast, parseColour } from './colour.mjs';
import { readText, WORKSPACE_ROOT } from './workspace.mjs';

const TOKENS_DIR = join(WORKSPACE_ROOT, 'libs/ui/src/styles/tokens');

/** The token sources (A-10.15): primitives, and the `name: (light, dark)` maps. */
export const TOKEN_SOURCES = {
  primitives: join(TOKENS_DIR, '_primitives.scss'),
  semantic: [ join(TOKENS_DIR, '_color.scss'), join(TOKENS_DIR, '_syntax.scss') ]
};

/** The contrast pairs that the Storybook token page measures (A-10.10). */
export const CONTRAST_PAIRS_MODEL = join(WORKSPACE_ROOT, 'libs/ui/src/design-tokens/models/contrast-pairs.model.ts');

export const SCHEMES = [ 'light', 'dark' ];

const stripName = name => name.replace(/^--ui-/, '');

/**
 * Parses one value of a token map, or of an override: `functions.ref(name)`,
 * `functions.alpha(name, 5%)` (the `functions.` prefix is optional, and a bare
 * token name means `ref`), or a literal CSS colour.
 */
export function parseTokenValue(text) {
  const value = text.trim();
  const ref = value.match(/^(?:functions\.)?ref\(\s*([a-z0-9-]+)\s*\)$/);
  if (ref) {
    return { ref: stripName(ref[1]) };
  }
  const alpha = value.match(/^(?:functions\.)?alpha\(\s*([a-z0-9-]+)\s*,\s*([\d.]+)%\s*\)$/);
  if (alpha) {
    return { ref: stripName(alpha[1]), alpha: Number(alpha[2]) / 100 };
  }
  if (/^(--ui-)?[a-z]+(-[a-z0-9]+)+$/.test(value)) {
    return { ref: stripName(value) };
  }
  return { colour: parseColour(value) };
}

/** Splits `a, b` at commas that are not inside parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
    if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim());
}

/** Parses the `--ui-<name>: <colour>;` declarations of the primitives file. */
export function parsePrimitives(source) {
  const primitives = new Map();
  for (const [ , name, value ] of source.matchAll(/--ui-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    primitives.set(name, { colour: parseColour(value) });
  }
  return primitives;
}

/**
 * Parses the `$tokens: (name: (light, dark), …);` map of a semantic token
 * file. Throws on a line it does not understand, so that a change in the
 * files' format fails loudly rather than skipping tokens.
 */
export function parseSemantic(source, file = 'source') {
  const start = source.indexOf('$tokens: (');
  if (start < 0) {
    throw new Error(`${file}: no $tokens map`);
  }
  const semantic = new Map();
  const lines = source.slice(start).split('\n').slice(1);
  for (const [ index, raw ] of lines.entries()) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === '') {
      continue;
    }
    if (line === ');') {
      return semantic;
    }
    const entry = line.match(/^([a-z0-9-]+)\s*:\s*\((.*)\),?$/);
    const values = entry && splitTopLevel(entry[2]);
    if (!entry || values.length !== 2) {
      throw new Error(`${file}: cannot parse token line ${index + 1} of the map: ${raw.trim()}`);
    }
    semantic.set(entry[1], values.map(parseTokenValue));
  }
  throw new Error(`${file}: the $tokens map is not closed`);
}

/**
 * Parses overrides written as `token=value` or `token@light=value`, where the
 * value is as in `parseTokenValue`. Overrides without a scheme apply to both.
 */
export function parseOverrides(list = []) {
  return list.map(text => {
    const match = text.match(/^(?:--ui-)?([a-z0-9-]+)(?:@(light|dark))?=(.+)$/);
    if (!match) {
      throw new Error(`Not an override (token[@light|@dark]=value): ${text}`);
    }
    return { name: match[1], scheme: match[2], value: parseTokenValue(match[3]) };
  });
}

/** Reads the token files; `overrides` (from `parseOverrides`) replace or add tokens. */
export function loadTokens({ overrides = [], sources = TOKEN_SOURCES } = {}) {
  const primitives = parsePrimitives(readText(sources.primitives));
  const semantic = new Map();
  for (const file of sources.semantic) {
    for (const [ name, values ] of parseSemantic(readText(file), file)) {
      semantic.set(name, values);
    }
  }
  for (const { name, scheme, value } of overrides) {
    if (primitives.has(name) && !semantic.has(name)) {
      if (scheme) {
        throw new Error(`${name} is a primitive and has one value for both schemes`);
      }
      primitives.set(name, value);
      continue;
    }
    const values = semantic.get(name) ?? [ value, value ];
    semantic.set(name, SCHEMES.map((s, i) => (!scheme || scheme === s ? value : values[i])));
  }
  return { primitives, semantic };
}

/**
 * Resolves a token in a scheme to a colour, following `ref()` and `alpha()`.
 * Returns the culori colour and the chain of tokens it went through.
 */
export function resolveToken(tokens, name, scheme) {
  const chain = [];
  let alpha = 1;
  let value = { ref: stripName(name) };
  while (value.ref) {
    if (chain.includes(value.ref)) {
      throw new Error(`Token cycle: ${[ ...chain, value.ref ].join(' → ')}`);
    }
    chain.push(value.ref);
    alpha *= value.alpha ?? 1;
    const semantic = tokens.semantic.get(value.ref);
    const next = semantic ? semantic[SCHEMES.indexOf(scheme)] : tokens.primitives.get(value.ref);
    if (!next) {
      throw new Error(`Unknown token: ${value.ref}${chain.length > 1 ? ` (via ${chain.join(' → ')})` : ''}`);
    }
    value = next;
  }
  const colour = { ...value.colour, alpha: (value.colour.alpha ?? 1) * alpha };
  return { colour, chain };
}

/**
 * Loads the contrast pairs from `contrast-pairs.model.ts`. Node strips its
 * types on import, so the model must stay free of imports and of TypeScript
 * that is not erasable (enums, namespaces, parameter properties).
 */
export async function loadContrastPairs(file = CONTRAST_PAIRS_MODEL) {
  const { CONTRAST_PAIRS } = await import(pathToFileURL(file).href);
  return CONTRAST_PAIRS;
}

/**
 * Measures every pair in both schemes. Each result has the pair, `light` and
 * `dark` ratios (undefined when a token is missing), the lower `ratio`, a
 * `status` of `pass`, `fail` or `missing`, `close` when it passes by less than
 * `CLOSE_MARGIN`, and an `error` for missing tokens.
 */
export function checkPairs(tokens, pairs) {
  return pairs.map(pair => {
    const result = { pair };
    try {
      for (const scheme of SCHEMES) {
        const colour = name => resolveToken(tokens, name, scheme).colour;
        const measured = measureContrast(colour(pair.foreground), pair.background.map(colour));
        if (!measured.opaque) {
          throw new Error(`the background of ${describePair(pair)} is not opaque in ${scheme}`);
        }
        result[scheme] = measured.ratio;
      }
      result.ratio = Math.min(result.light, result.dark);
      result.status = result.ratio >= pair.minimum ? 'pass' : 'fail';
      result.close = isClose(result.ratio, pair.minimum);
    } catch (error) {
      result.status = 'missing';
      result.error = error.message;
    }
    return result;
  });
}

/** `text-muted on surface-island + surface-hover`. */
export function describePair(pair) {
  return `${pair.foreground} on ${pair.background.join(' + ')}`;
}
