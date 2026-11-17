import { matchesRequiredClaim } from './required-claim';

const NAME = 'https://slack.com/team_id';
const required = { name: NAME, value: 'T123' };

describe('matchesRequiredClaim', () => {
  it('matches a string equal to the value', () => {
    expect(matchesRequiredClaim({ [NAME]: 'T123' }, required)).toBe(true);
  });

  it('compares case-sensitively', () => {
    expect(matchesRequiredClaim({ [NAME]: 't123' }, required)).toBe(false);
  });

  it('matches an array that contains the value', () => {
    expect(matchesRequiredClaim({ [NAME]: [ 'T999', 'T123' ] }, required)).toBe(true);
  });

  it('does not match an array without the value', () => {
    expect(matchesRequiredClaim({ [NAME]: [ 'T999' ] }, required)).toBe(false);
  });

  it('does not match a missing claim', () => {
    expect(matchesRequiredClaim({ team_id: 'T123' }, required)).toBe(false);
  });

  it('does not match a number, even one that reads as the value', () => {
    expect(matchesRequiredClaim({ hd: 123 }, { name: 'hd', value: '123' })).toBe(false);
  });

  it('does not match null or an object', () => {
    expect(matchesRequiredClaim({ [NAME]: null }, required)).toBe(false);
    expect(matchesRequiredClaim({ [NAME]: { id: 'T123' } }, required)).toBe(false);
  });

  it('does not match an inherited property', () => {
    expect(matchesRequiredClaim({}, { name: 'constructor', value: 'function Object() { [native code] }' })).toBe(
      false
    );
  });
});
