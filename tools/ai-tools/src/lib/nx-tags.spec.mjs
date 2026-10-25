import { describe, expect, it } from 'vitest';
import { findTagProblems, SCOPE_TAGS, TYPE_TAGS } from './nx-tags.mjs';

const problemsOf = tags => findTagProblems([ { name: 'lib', tags } ]).map(p => p.problem);

describe('nx-tags', () => {
  it('lists the A-2.4 vocabulary', () => {
    expect(SCOPE_TAGS).toEqual([ 'scope:server', 'scope:web', 'scope:shared', 'scope:tools' ]);
    expect(TYPE_TAGS).toEqual([
      'type:app',
      'type:feature',
      'type:core',
      'type:domain',
      'type:data-access',
      'type:ui',
      'type:contracts',
      'type:util'
    ]);
  });

  it('accepts one known scope and one known type', () => {
    expect(findTagProblems([ { name: 'ui', tags: [ 'scope:web', 'type:ui' ] } ])).toEqual([]);
  });

  it('reports a missing scope and a missing type, naming the project', () => {
    expect(findTagProblems([ { name: 'bare', tags: [] } ])).toEqual([
      { project: 'bare', problem: 'no scope: tag' },
      { project: 'bare', problem: 'no type: tag' }
    ]);
  });

  it('reports more than one scope tag', () => {
    expect(problemsOf([ 'scope:web', 'scope:server', 'type:ui' ])).toEqual([
      'more than one scope: tag (scope:web, scope:server)'
    ]);
  });

  it('reports an unknown type tag and the missing known one', () => {
    expect(problemsOf([ 'scope:web', 'type:widget' ])).toEqual([ 'unknown tag type:widget', 'no type: tag' ]);
  });

  it('ignores tags without a scope: or type: prefix', () => {
    expect(problemsOf([ 'npm:public', 'scope:shared', 'type:util' ])).toEqual([]);
  });

  it('sorts problems by project name', () => {
    const problems = findTagProblems([ { name: 'web', tags: [ 'type:app' ] }, { name: 'api', tags: [ 'type:app' ] } ]);
    expect(problems.map(p => p.project)).toEqual([ 'api', 'web' ]);
  });
});
