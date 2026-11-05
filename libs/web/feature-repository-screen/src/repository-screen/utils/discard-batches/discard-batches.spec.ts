import { discardBatches } from './discard-batches';

describe('discardBatches', () => {
  it('sends a short list in one request, as it is', () => {
    expect(discardBatches([ 'a.md', 'b.md' ])).toEqual([ [ 'a.md', 'b.md' ] ]);
  });

  it('sends at most the largest number of paths in a request', () => {
    expect(discardBatches([ 'a', 'b', 'c', 'd', 'e' ], { maxPaths: 2 })).toEqual([ [ 'a', 'b' ], [ 'c', 'd' ], [
      'e'
    ] ]);
  });

  it('stays under the limit on a request body, counting encoded bytes', () => {
    // {"paths":[]} is 12 bytes; each of these takes 4 in JSON, and a comma.
    const batches = discardBatches([ 'é', '"', 'è', '\\' ], { maxBytes: 22 });

    expect(batches).toEqual([ [ 'é', '"' ], [ 'è', '\\' ] ]);
    for (const batch of batches) {
      expect(new TextEncoder().encode(JSON.stringify({ paths: batch })).length).toBeLessThanOrEqual(22);
    }
  });

  it('keeps a path with a listed entry on the way to it, whatever sorts between them', () => {
    const paths = [ 'a', 'a-b', 'a/deep/file', 'c' ];

    expect(discardBatches(paths, { maxPaths: 2 })).toEqual([ [ 'a', 'a/deep/file' ], [ 'a-b', 'c' ] ]);
  });

  it('does not count a sibling with the same start as an entry on the way', () => {
    expect(discardBatches([ 'a', 'ab/file', 'c' ], { maxPaths: 1 })).toEqual([ [ 'a' ], [ 'ab/file' ], [ 'c' ] ]);
  });

  it('starts a group too long for one request with the entry on the way, which must go first', () => {
    const batches = discardBatches([ 'a', 'a/1', 'a/2', 'a/3', 'b' ], { maxPaths: 2 });

    expect(batches).toEqual([ [ 'a', 'a/1' ], [ 'a/2', 'a/3' ], [ 'b' ] ]);
  });
});
