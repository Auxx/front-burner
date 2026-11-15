import { compareRepositoryNames, sameRepositoryName } from './repository-name';

describe('repository names', () => {
  it('sorts ignoring case', () => {
    expect([ 'gamma', 'Beta', 'alpha' ].sort(compareRepositoryNames)).toEqual([ 'alpha', 'Beta', 'gamma' ]);
  });

  it('sorts non-ASCII names ignoring case, next to their base letter', () => {
    expect([ 'zeta', 'éclair-notes', 'Éclair', 'echo' ].sort(compareRepositoryNames)).toEqual(
      [ 'echo', 'Éclair', 'éclair-notes', 'zeta' ]
    );
  });

  it('sorts numbers by value', () => {
    expect([ 'repo-10', 'repo-2' ].sort(compareRepositoryNames)).toEqual([ 'repo-2', 'repo-10' ]);
  });

  it('compares names that differ only in case as equal, for the caller to break the tie', () => {
    expect(compareRepositoryNames('Über', 'über')).toBe(0);
    expect(compareRepositoryNames('Notes', 'notes')).toBe(0);
  });

  it('keeps names that differ in accent apart', () => {
    expect(compareRepositoryNames('resume', 'résumé')).not.toBe(0);
  });

  it('finds the same name ignoring case in every script', () => {
    expect(sameRepositoryName('Handbook', 'HANDBOOK')).toBe(true);
    expect(sameRepositoryName('Über', 'über')).toBe(true);
    expect(sameRepositoryName('Σημειώσεις', 'σημειώσεις')).toBe(true);
    expect(sameRepositoryName('resume', 'résumé')).toBe(false);
  });
});
