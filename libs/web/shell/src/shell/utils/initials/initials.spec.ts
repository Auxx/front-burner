import { initials } from './initials';

describe('initials', () => {
  it.each([
    [ 'Ada Lovelace', 'AL' ],
    [ 'ada', 'A' ],
    [ 'Jean-Luc de Paul', 'JP' ],
    [ '  ', '?' ],
    [ '', '?' ],
    [ 'Émile Zola', 'ÉZ' ],
    [ '  grace   hopper ', 'GH' ],
    [ '𝒜da Lovelace', '𝒜L' ]
  ])('%j gives %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
