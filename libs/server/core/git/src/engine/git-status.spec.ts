import { parseStatus } from './git-status';

const OID = 'a'.repeat(40);
const ordinary = (xy: string, path: string) => `1 ${xy} N... 100644 100644 100644 ${OID} ${OID} ${path}`;
const output = (...records: string[]) => records.map(record => `${record}\0`).join('');
const onMain = [ `# branch.oid ${OID}`, '# branch.head main' ];

describe('parseStatus', () => {
  it('reads a clean branch without an upstream', () => {
    expect(parseStatus(output(...onMain))).toEqual({
      branch: 'main',
      noCommits: false,
      upstream: null,
      upstreamGone: false,
      ahead: 0,
      behind: 0,
      changes: []
    });
  });

  it('reads the upstream and its counts', () => {
    const status = parseStatus(output(...onMain, '# branch.upstream origin/main', '# branch.ab +2 -3'));
    expect(status).toMatchObject({ upstream: 'origin/main', ahead: 2, behind: 3 });
  });

  it.each([
    [ '.M', 'modified' ],
    [ 'M.', 'modified' ],
    [ 'MM', 'modified' ],
    [ '.T', 'modified' ],
    [ 'A.', 'added' ],
    [ '.A', 'added' ],
    [ 'AM', 'added' ],
    [ 'AD', 'added' ],
    [ '.D', 'deleted' ],
    [ 'D.', 'deleted' ],
    [ 'MD', 'deleted' ]
  ])('reads %s as %s', (xy, state) => {
    expect(parseStatus(output(...onMain, ordinary(xy, 'a.md'))).changes).toEqual([ { path: 'a.md', state } ]);
  });

  it('reads an untracked file as added', () => {
    expect(parseStatus(output(...onMain, '? a.md')).changes).toEqual([ { path: 'a.md', state: 'added' } ]);
  });

  it('reads a conflict as modified, whatever its columns say', () => {
    for (const xy of [ 'UU', 'AA', 'DD', 'UD', 'DU', 'AU', 'UA' ]) {
      const record = `u ${xy} N... 100644 100644 100644 100644 ${OID} ${OID} ${OID} a b.md`;
      expect(parseStatus(output(...onMain, record)).changes).toEqual([ { path: 'a b.md', state: 'modified' } ]);
    }
  });

  it('keeps every space of a path', () => {
    const path = ' two  spaces .md';
    expect(parseStatus(output(...onMain, ordinary('.M', path), `? ${path}x`)).changes).toEqual([
      { path, state: 'modified' },
      { path: `${path}x`, state: 'added' }
    ]);
  });

  it('does not read a path as a record', () => {
    expect(parseStatus(output(...onMain, '? # branch.head other', '? 1 .M x')).changes.map(change => change.path))
      .toEqual([ '# branch.head other', '1 .M x' ]);
  });

  it('sorts by code unit, not by locale', () => {
    const paths = [ 'b.md', 'a/z.md', 'Z.md', 'é.md', 'a.md', '😀.md', '￿.md' ];
    const status = parseStatus(output(...onMain, ...paths.map(path => `? ${path}`)));
    expect(status.changes.map(change => change.path)).toEqual([
      'Z.md',
      'a.md',
      'a/z.md',
      'b.md',
      'é.md',
      '😀.md',
      '￿.md'
    ]);
  });

  it('leaves out an entry that is a folder', () => {
    expect(parseStatus(output(...onMain, '? nested/', '? a.md')).changes.map(change => change.path)).toEqual([
      'a.md'
    ]);
  });

  it('reports a file removed from the index but still on disk once, as modified', () => {
    expect(parseStatus(output(...onMain, ordinary('D.', 'a.md'), '? a.md')).changes).toEqual([
      { path: 'a.md', state: 'modified' }
    ]);
  });

  it('gives no branch, upstream or counts on a detached HEAD', () => {
    const status = parseStatus(
      output(`# branch.oid ${OID}`, '# branch.head (detached)', '# branch.upstream origin/main', '# branch.ab +1 -1')
    );
    expect(status).toMatchObject({ branch: null, noCommits: false, upstream: null, ahead: 0, behind: 0 });
  });

  it('gives main and no upstream without commits, whatever HEAD names', () => {
    const status = parseStatus(
      output('# branch.oid (initial)', '# branch.head trunk', '# branch.upstream origin/trunk', '? a.md')
    );
    expect(status).toEqual({
      branch: 'main',
      noCommits: true,
      upstream: null,
      upstreamGone: false,
      ahead: 0,
      behind: 0,
      changes: [ { path: 'a.md', state: 'added' } ]
    });
  });

  it('gives zero counts when git cannot count', () => {
    const status = parseStatus(output(...onMain, '# branch.upstream origin/main', '# branch.ab +? -?'));
    expect(status).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });
  });

  it('reads a branch whose upstream is gone', () => {
    // As after the first commit in a clone of an empty remote, or after the remote branch was deleted and pruned.
    const status = parseStatus(output(...onMain, '# branch.upstream origin/main'));
    expect(status).toMatchObject({ upstream: 'origin/main', upstreamGone: true, ahead: 0, behind: 0 });
  });

  it('reads an upstream that exists as not gone', () => {
    expect(parseStatus(output(...onMain, '# branch.upstream origin/main', '# branch.ab +0 -0')).upstreamGone)
      .toBe(false);
    expect(parseStatus(output(...onMain, '# branch.upstream origin/main', '# branch.ab +? -?')).upstreamGone)
      .toBe(false);
    expect(parseStatus(output(...onMain)).upstreamGone).toBe(false);
  });
});
