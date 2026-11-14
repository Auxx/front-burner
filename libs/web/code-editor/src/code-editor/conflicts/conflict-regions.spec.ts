import { describe, expect, it } from 'vitest';
import { type ConflictRegion, conflictRegions } from './conflict-regions';

/** The texts of a region's parts, easier to read in a test than offsets. */
function parts(text: string, region: ConflictRegion) {
  return {
    whole: text.slice(region.from, region.to),
    ours: text.slice(region.ours.from, region.ours.to),
    theirs: text.slice(region.theirs.from, region.theirs.to),
    oursLabel: region.oursLabel,
    theirsLabel: region.theirsLabel
  };
}

const CONFLICT = '<<<<<<< main\nmine 1\nmine 2\n=======\ntheirs\n>>>>>>> origin/main';

describe('conflictRegions', () => {
  it('finds each region, and its parts', () => {
    const text = `before\n${CONFLICT}\nmiddle\n<<<<<<< main\n=======\nonly theirs\n>>>>>>> origin/main\nafter\n`;

    const regions = conflictRegions(text);

    expect(regions.map(region => parts(text, region))).toEqual([
      {
        whole: CONFLICT,
        ours: 'mine 1\nmine 2\n',
        theirs: 'theirs\n',
        oursLabel: 'main',
        theirsLabel: 'origin/main'
      },
      {
        whole: '<<<<<<< main\n=======\nonly theirs\n>>>>>>> origin/main',
        ours: '',
        theirs: 'only theirs\n',
        oursLabel: 'main',
        theirsLabel: 'origin/main'
      }
    ]);
    expect(regions[0].from).toBe('before\n'.length);
  });

  it('reads the branch names', () => {
    const text = '<<<<<<< feature/a b\nx\n=======\ny\n>>>>>>> origin/feature/a b  \n';

    expect(
      conflictRegions(text).map(region => [
        region.oursLabel,
        region.theirsLabel
      ])
    ).toEqual([ [ 'feature/a b', 'origin/feature/a b' ] ]);
  });

  it('ignores a region with no end', () => {
    const text = `<<<<<<< x\nmine\n=======\ntheirs\nmore text\n${CONFLICT}`;

    const regions = conflictRegions(text);

    expect(regions.map(region => parts(text, region).whole)).toEqual([
      CONFLICT
    ]);
    expect(conflictRegions('<<<<<<< x\nmine\n=======\ntheirs\n')).toEqual([]);
  });

  it('ignores a region with no middle', () => {
    expect(
      conflictRegions('<<<<<<< main\nmine\n>>>>>>> origin/main\n')
    ).toEqual([]);
  });

  it('restarts at a nested start', () => {
    const text = `<<<<<<< x\nmine\n${CONFLICT}\n`;

    expect(
      conflictRegions(text).map(region => parts(text, region).whole)
    ).toEqual([ CONFLICT ]);
  });

  it('reads a region at the end of the file', () => {
    const text = `text\n${CONFLICT}`;

    const [ region ] = conflictRegions(text);

    expect(region.to).toBe(text.length);
    expect(parts(text, region).theirs).toBe('theirs\n');
  });

  it('has none in plain text', () => {
    expect(conflictRegions('')).toEqual([]);
    expect(
      conflictRegions(
        '# Title\n\n=======\n\nSome <<<<<<< text >>>>>>> here.\n'
      )
    ).toEqual([]);
  });

  it('needs a space after the start', () => {
    expect(conflictRegions('<<<<<<<main\nx\n=======\ny\n>>>>>>> t\n')).toEqual(
      []
    );
    expect(
      conflictRegions('<<<<<<<< main\nx\n=======\ny\n>>>>>>> t\n')
    ).toEqual([]);
    expect(conflictRegions('<<<<<<< main\nx\n=======\ny\n>>>>>>>t\n')).toEqual(
      []
    );
    expect(
      conflictRegions('<<<<<<< main\nx\n======= \ny\n>>>>>>> t\n')
    ).toEqual([]);
  });
});
