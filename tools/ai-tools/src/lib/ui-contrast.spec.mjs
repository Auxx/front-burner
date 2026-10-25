import { describe, expect, it } from 'vitest';
import { checkPairs, describePair, loadContrastPairs, loadTokens } from './tokens.mjs';

/**
 * The ui library's contrast pairs (A-10.10), measured from the SCSS sources
 * without a browser, so that a token change that breaks a pair fails the unit
 * tests. The Storybook token page stays the check of record: pairs within
 * CLOSE_MARGIN of their minimum pass here but must be confirmed there.
 *
 * ai-tools has an implicit dependency on ui, so Nx runs this test whenever ui
 * changes.
 */
describe('ui contrast pairs', async () => {
  const results = checkPairs(loadTokens(), await loadContrastPairs());

  it('finds the pairs', () => {
    expect(results.length).toBeGreaterThan(100);
  });

  it('resolves every token of every pair', () => {
    const missing = results.filter(r => r.status === 'missing').map(r => `${describePair(r.pair)}: ${r.error}`);
    expect(missing).toEqual([]);
  });

  it('meets every minimum in both schemes', () => {
    const failing = results
      .filter(r => r.status === 'fail')
      .map(r => `${describePair(r.pair)}: ${r.light.toFixed(2)} / ${r.dark.toFixed(2)} < ${r.pair.minimum}`);
    expect(failing).toEqual([]);
  });
});
