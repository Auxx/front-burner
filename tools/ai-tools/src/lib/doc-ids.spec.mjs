import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMapping,
  checkIds,
  criteriaCoverage,
  familyOf,
  findIds,
  formatCriteria,
  MVP,
  mvpCriteria,
  parseId,
  renameMapping,
  scan,
  shiftMapping,
  testedCriteria
} from './doc-ids.mjs';
import { OutsideWorkspaceError, WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

const file = (path, text) => ({ path, file: path, text });
const ids = files => [ ...new Set(files.flatMap(f => findIds(f.text).map(found => found.id))) ];

describe('doc-ids', () => {
  it('parses IDs and families', () => {
    expect(parseId('A-10.38')).toEqual({ prefix: 'A', numbers: [ '10', '38' ] });
    expect(parseId('REQ-EDIT-003')).toEqual({ prefix: 'REQ-EDIT', numbers: [ '003' ] });
    expect(parseId('a-1')).toBeNull();
    expect(familyOf('A-10.38')).toBe('A-10');
    expect(familyOf('LG-12')).toBe('LG');
  });

  it('finds IDs only as whole words', () => {
    const found = findIds('A-10.2, A-10.21 and (NF-1.4). XA-1 is not A-1; nor are A-1x or a-1. The A-10.2.5.').map(f =>
      f.id
    );
    expect(found).toEqual([ 'A-10.2', 'A-10.21', 'NF-1.4', 'XA-1', 'A-1', 'A-10.2.5' ]);
  });

  it('tells definitions from references', () => {
    const text = [
      '# REQ-FILE-001: File browser',
      '## A-10: Look',
      '- **A-10.5** The look follows (A-10.6).',
      '| NF-2.1 | Open a folder |',
      'See **LG-1** in the text.'
    ].join('\n');
    expect(findIds(text).map(f => [ f.id, f.definition ])).toEqual([
      [ 'REQ-FILE-001', 'title' ],
      [ 'A-10', 'heading' ],
      [ 'A-10.5', 'item' ],
      [ 'A-10.6', null ],
      [ 'NF-2.1', 'row' ],
      [ 'LG-1', null ]
    ]);
  });

  describe('check', () => {
    const home = [
      '## A-10: Look',
      '- **A-10.1** One.',
      '- **A-10.2** Two.',
      '- **A-10.4** Four, see A-10.9 and D-9.',
      '- **D-9.1** A decision.',
      '- **D-9.1** The same decision again.',
      '- **PP-3** A rule.',
      '',
      '| Rule | Code |',
      '| PP-3 | `too-short` |',
      'UTF-8 and CC-BY-4.0 are not IDs of ours.'
    ].join('\n');
    const followUps = '- **A-10.2** says something that should change.';

    it('reports duplicates, undefined references and gaps', () => {
      const result = checkIds([ file('docs/home.md', home), file('docs/follow-ups.md', followUps) ]);
      expect(result.duplicates).toEqual([
        {
          id: 'D-9.1',
          places: [
            { path: 'docs/home.md', line: 5, kind: 'item' },
            { path: 'docs/home.md', line: 6, kind: 'item' }
          ]
        }
      ]);
      expect(result.dangling).toEqual([ { id: 'A-10.9', path: 'docs/home.md', line: 4 } ]);
      expect(result.gaps).toEqual([ { family: 'A-10', missing: [ 3 ] }, { family: 'PP', missing: [ 1, 2 ] } ]);
    });

    it('treats a bold ID outside its home file as a reference', () => {
      const result = checkIds([ file('docs/home.md', home), file('docs/follow-ups.md', followUps) ]);
      expect(result.duplicates.map(d => d.id)).not.toContain('A-10.2');
    });

    it('treats a table that lists rules defined above it as references', () => {
      const result = checkIds([ file('docs/home.md', home) ]);
      expect(result.duplicates.map(d => d.id)).not.toContain('PP-3');
    });
  });

  describe('renumber', () => {
    const files = () => [
      file('docs/a.md', '- **A-10.20** Twenty.\n- **A-10.21** Twenty-one, with A-10.21.1.\n- **A-10.22** See A-10.21.'),
      file('libs/x.ts', '// A-10.22 and A-10.2 and A-1.21'),
      file('docs/req.md', '# REQ-EDIT-002: Two\nREQ-EDIT-003 and LG-9')
    ];

    it('shifts a family from a number, with sub-IDs, in one pass', () => {
      const mapping = shiftMapping(ids(files()), 'A-10', 21, 1);
      expect(Object.fromEntries(mapping)).toEqual({
        'A-10.21': 'A-10.22',
        'A-10.21.1': 'A-10.22.1',
        'A-10.22': 'A-10.23'
      });
      const { changed, changes } = applyMapping(files(), mapping);
      expect(changed.find(c => c.path === 'docs/a.md').text).toBe(
        '- **A-10.20** Twenty.\n- **A-10.22** Twenty-one, with A-10.22.1.\n- **A-10.23** See A-10.22.'
      );
      expect(changed.find(c => c.path === 'libs/x.ts').text).toBe('// A-10.23 and A-10.2 and A-1.21');
      expect(changes).toHaveLength(5);
    });

    it('keeps zero padding and handles families without a number', () => {
      expect(Object.fromEntries(shiftMapping(ids(files()), 'REQ-EDIT', 2, 1))).toEqual({
        'REQ-EDIT-002': 'REQ-EDIT-003',
        'REQ-EDIT-003': 'REQ-EDIT-004'
      });
      expect(Object.fromEntries(shiftMapping(ids(files()), 'LG', 1, 2))).toEqual({ 'LG-9': 'LG-11' });
    });

    it('refuses to merge IDs or go below 1', () => {
      expect(() => applyMapping(files(), shiftMapping(ids(files()), 'A-10', 21, -1))).toThrow('A-10.20');
      expect(() => shiftMapping(ids(files()), 'LG', 1, -9)).toThrow('number 0');
      expect(() => shiftMapping([], 'not a family', 1, 1)).toThrow('Not an ID family');
    });

    it('renames one ID with its sub-IDs', () => {
      expect(Object.fromEntries(renameMapping(ids(files()), 'A-10.21', 'A-10.30'))).toEqual({
        'A-10.21': 'A-10.30',
        'A-10.21.1': 'A-10.30.1'
      });
      expect(() => applyMapping(files(), renameMapping(ids(files()), 'A-10.21', 'A-10.22'))).toThrow('Already in use');
    });
  });

  describe('scan', () => {
    let fixture;

    beforeAll(() => {
      mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
      fixture = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-doc-ids-'));
      mkdirSync(join(fixture, 'docs', 'node_modules'), { recursive: true });
      writeFileSync(join(fixture, 'docs', 'a.md'), '- **A-1.1** One.');
      writeFileSync(join(fixture, 'docs', 'image.png'), 'A-1.1');
      writeFileSync(join(fixture, 'docs', 'node_modules', 'b.md'), 'A-1.1');
    });

    afterAll(() => rmSync(fixture, { recursive: true, force: true }));

    it('reads text files and skips dependencies below the roots it is given', () => {
      const files = scan({ roots: [ workspacePath(fixture) ] });
      expect(files.map(f => f.path)).toEqual([ workspacePath(join(fixture, 'docs', 'a.md')) ]);
    });

    it('skips build output and plans by default', () => {
      const paths = scan().map(f => f.path);
      expect(paths).toContain('docs/architecture/design-system.md');
      expect(paths.some(p => p.startsWith('docs/superpowers/') || p.startsWith('tmp/') || p.includes('node_modules')))
        .toBe(false);
      expect(scan({ includePlans: true }).some(f => f.path.startsWith('docs/superpowers/'))).toBe(true);
    });

    it('writes renumbered files only when asked', () => {
      const path = join(fixture, 'docs', 'a.md');
      const files = [ { path: workspacePath(path), file: path, text: readFileSync(path, 'utf8') } ];
      applyMapping(files, new Map([ [ 'A-1.1', 'A-1.2' ] ]));
      expect(readFileSync(path, 'utf8')).toBe('- **A-1.1** One.');
      applyMapping(files, new Map([ [ 'A-1.1', 'A-1.2' ] ]), { write: true });
      expect(readFileSync(path, 'utf8')).toBe('- **A-1.2** One.');
    });

    it('refuses paths outside the workspace', () => {
      expect(() => scan({ roots: [ '../' ] })).toThrow(OutsideWorkspaceError);
    });
  });

  describe('MVP criteria', () => {
    const mvp = [
      '## In scope',
      '',
      '| Requirement | Status | In MVP | Limited in MVP | Not in MVP | MVP notes |',
      '| --- | --- | --- | --- | --- | --- |',
      '| [REQ-AUTH-003](a.md) | Accepted | LG-2 to LG-4; AC-AUTH-003.2 to AC-AUTH-003.4, AC-AUTH-003.7 | LG-1; AC-AUTH-003.1 | AC-AUTH-003.5 | Note. |',
      '| [REQ-DASH-001](d.md) | Accepted | DS-1 to DS-3; AC-DASH-001.1 to AC-DASH-001.2 | — | — | — |',
      '| NF-1: Scale | NF-1.1 | — | — | |',
      '',
      '## Order of work'
    ].join('\n');

    it('reads the In MVP and Limited in MVP criteria, with ranges written out', () => {
      expect(mvpCriteria(mvp)).toEqual(
        new Map([
          [ 'REQ-AUTH-003', [ 'AC-AUTH-003.2', 'AC-AUTH-003.3', 'AC-AUTH-003.4', 'AC-AUTH-003.7', 'AC-AUTH-003.1' ] ],
          [ 'REQ-DASH-001', [ 'AC-DASH-001.1', 'AC-DASH-001.2' ] ]
        ])
      );
    });

    it('throws on a section or row it does not understand', () => {
      expect(() => mvpCriteria('## Goal')).toThrow('no "## In scope" section');
      expect(() => mvpCriteria('## In scope\n| [REQ-A-001](a.md) | Accepted | AC-A-001.1 |\n## End')).toThrow(
        '3 cells instead of 6'
      );
      expect(() => mvpCriteria('## In scope\n| [REQ-A-001](a) | x | AC-A-001.1 to AC-B-001.3 | | | |\n## End'))
        .toThrow('spans two requirements');
    });

    it('finds criteria at the start of test titles only', () => {
      const spec = [
        'it(\'AC-AUTH-003.2: one\', () => {});',
        'test(\'AC-AUTH-003.3, AC-AUTH-003.4 and AC-DASH-001.1: several\', () => {});',
        'it.each([ \'a\', \'b\' ])(\'AC-AUTH-003.7 with %s\', () => {});',
        'it(',
        '  \'AC-DASH-001.2: wrapped\',',
        '  () => {}',
        ');',
        'describe(\'AC-AUTH-003.1: a group\', () => {});',
        'it(\'checks AC-AUTH-003.1 in passing\', () => {});',
        '// AC-AUTH-003.1 in a comment'
      ].join('\n');
      const tested = testedCriteria([ file('a.spec.ts', spec) ]);
      expect([ ...tested.keys() ]).toEqual([
        'AC-AUTH-003.2',
        'AC-AUTH-003.3',
        'AC-AUTH-003.4',
        'AC-DASH-001.1',
        'AC-AUTH-003.7',
        'AC-DASH-001.2'
      ]);
      expect(tested.get('AC-DASH-001.2')).toEqual([ { path: 'a.spec.ts', line: 4 } ]);
    });

    it('lists the MVP criteria without a test', () => {
      const spec = file('a.spec.ts', 'it(\'AC-AUTH-003.2: x\', () => {}); it(\'AC-DASH-001.1: y\', () => {});');
      expect(criteriaCoverage(mvp, [ spec ]).map(c => [ c.requirement, c.untested ])).toEqual([
        [ 'REQ-AUTH-003', [ 'AC-AUTH-003.3', 'AC-AUTH-003.4', 'AC-AUTH-003.7', 'AC-AUTH-003.1' ] ],
        [ 'REQ-DASH-001', [ 'AC-DASH-001.2' ] ]
      ]);
    });

    it('writes consecutive criteria as ranges', () => {
      expect(formatCriteria([ 'AC-A-001.1', 'AC-A-001.2', 'AC-A-001.3', 'AC-A-001.5', 'AC-B-001.6' ])).toBe(
        'AC-A-001.1 to AC-A-001.3, AC-A-001.5, AC-B-001.6'
      );
      expect(formatCriteria([])).toBe('');
    });

    it('reads the workspace\'s MVP document, whose criteria are all defined', () => {
      const [ document ] = scan({ roots: [ MVP ] });
      const defined = new Set(
        scan({ roots: [ 'docs/requirements' ] }).flatMap(f => findIds(f.text).filter(x => x.definition).map(x => x.id))
      );
      const criteria = [ ...mvpCriteria(document.text).values() ].flat();
      expect(criteria.length).toBeGreaterThan(0);
      expect(criteria.filter(id => !defined.has(id))).toEqual([]);
    });
  });
});
