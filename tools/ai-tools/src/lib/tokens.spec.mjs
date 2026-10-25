import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkPairs,
  describePair,
  loadTokens,
  parseOverrides,
  parsePrimitives,
  parseSemantic,
  parseTokenValue,
  resolveToken
} from './tokens.mjs';
import { WORKSPACE_ROOT } from './workspace.mjs';

const PRIMITIVES = `
@layer tokens {
  :root {
    --ui-neutral-0: oklch(0% 0 0);
    --ui-neutral-50: oklch(50% 0 0);
    --ui-neutral-100: oklch(100% 0 0);
  }
}`;

const SEMANTIC = `
@use 'functions';

$tokens: (
  // Surfaces
  surface: (functions.ref(neutral-100), functions.ref(neutral-0)),
  hover: (functions.alpha(neutral-0, 5%), functions.alpha(neutral-100, 6%)),

  text: (functions.ref(neutral-0), functions.ref(neutral-100)), // trailing comment
  editor: (functions.ref(surface), functions.ref(surface)),
  literal: (#808080, oklch(50% 0 0))
);
`;

describe('tokens', () => {
  let fixture;
  let sources;

  beforeAll(() => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    fixture = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-tokens-'));
    sources = { primitives: join(fixture, '_primitives.scss'), semantic: [ join(fixture, '_color.scss') ] };
    writeFileSync(sources.primitives, PRIMITIVES);
    writeFileSync(sources.semantic[0], SEMANTIC);
  });

  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  it('parses token values', () => {
    expect(parseTokenValue('functions.ref(neutral-20)')).toEqual({ ref: 'neutral-20' });
    expect(parseTokenValue('alpha(neutral-0, 5%)')).toEqual({ ref: 'neutral-0', alpha: 0.05 });
    expect(parseTokenValue('--ui-text-muted')).toEqual({ ref: 'text-muted' });
    expect(parseTokenValue('white').colour).toMatchObject({ mode: 'rgb', r: 1 });
  });

  it('parses primitives and the semantic map', () => {
    expect([ ...parsePrimitives(PRIMITIVES).keys() ]).toEqual([ 'neutral-0', 'neutral-50', 'neutral-100' ]);
    const semantic = parseSemantic(SEMANTIC);
    expect([ ...semantic.keys() ]).toEqual([ 'surface', 'hover', 'text', 'editor', 'literal' ]);
    expect(semantic.get('hover')[1]).toEqual({ ref: 'neutral-100', alpha: 0.06 });
  });

  it('fails loudly on a map line it does not understand', () => {
    expect(() => parseSemantic('$tokens: (\n  odd: functions.ref(x),\n);')).toThrow('cannot parse token line 1');
    expect(() => parseSemantic('$tokens: (\n  a: (ref(b), ref(c)),\n')).toThrow('not closed');
    expect(() => parseSemantic('nothing here')).toThrow('no $tokens map');
  });

  it('resolves tokens through ref() and alpha() in each scheme', () => {
    const tokens = loadTokens({ sources });
    expect(resolveToken(tokens, 'editor', 'dark')).toMatchObject({
      chain: [ 'editor', 'surface', 'neutral-0' ],
      colour: { l: 0, alpha: 1 }
    });
    expect(resolveToken(tokens, '--ui-hover', 'light').colour.alpha).toBe(0.05);
  });

  it('reports unknown tokens and cycles', () => {
    const tokens = loadTokens({ sources });
    expect(() => resolveToken(tokens, 'missing', 'light')).toThrow('Unknown token: missing');
    const cyclic = loadTokens({ sources, overrides: parseOverrides([ 'surface=ref(editor)' ]) });
    expect(() => resolveToken(cyclic, 'editor', 'light')).toThrow('Token cycle');
  });

  it('applies overrides to one scheme, both schemes, a primitive or a new token', () => {
    const overrides = parseOverrides([ 'text@dark=neutral-50', 'neutral-100=#eeeeee', 'new-token=alpha(text, 50%)' ]);
    const tokens = loadTokens({ sources, overrides });
    expect(resolveToken(tokens, 'text', 'light').chain).toEqual([ 'text', 'neutral-0' ]);
    expect(resolveToken(tokens, 'text', 'dark').chain).toEqual([ 'text', 'neutral-50' ]);
    expect(resolveToken(tokens, 'surface', 'light').colour).toMatchObject({ mode: 'rgb' });
    expect(resolveToken(tokens, 'new-token', 'light').colour.alpha).toBe(0.5);
    expect(() => parseOverrides([ 'no-equals-sign' ])).toThrow('Not an override');
    expect(() => loadTokens({ sources, overrides: parseOverrides([ 'neutral-0@dark=white' ]) })).toThrow('primitive');
  });

  it('checks pairs in both schemes', () => {
    const tokens = loadTokens({ sources });
    const [ pass, fail, missing, translucent ] = checkPairs(tokens, [
      { foreground: 'text', background: [ 'surface' ], minimum: 4.5 },
      { foreground: 'literal', background: [ 'surface', 'hover' ], minimum: 4.5 },
      { foreground: 'text', background: [ 'nope' ], minimum: 3 },
      { foreground: 'text', background: [ 'hover' ], minimum: 3 }
    ]);
    expect(pass).toMatchObject({ status: 'pass', light: 21, dark: 21, ratio: 21, close: false });
    expect(fail.status).toBe('fail');
    expect(missing).toMatchObject({ status: 'missing', error: 'Unknown token: nope' });
    expect(translucent).toMatchObject({ status: 'missing', error: expect.stringContaining('not opaque') });
    expect(describePair(fail.pair)).toBe('literal on surface + hover');
  });
});
