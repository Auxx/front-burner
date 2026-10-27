/**
 * The initials shown on the user menu's button (NV-7): the first character of
 * the first and of the last word of the display name, upper-cased. A name of
 * one word gives one character; an empty name gives `?`.
 */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(word => word !== '');
  if (words.length === 0) {
    return '?';
  }
  // Code points, not UTF-16 units, so that a character outside the BMP stays whole.
  const first = (word: string) => [ ...word ][0].toLocaleUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}
