const WHITESPACE = /\s/;

/** The first characters of an attribute name that make it a binding rather than static text. */
const BOUND_PREFIXES = [ '[', '(', '*', '@' ];

/** Whether the start tag closes at `index`, with `>` or `/>`. */
function closesAt(text, index) {
  return text[index] === '>' || text.startsWith('/>', index);
}

/**
 * Reads the start tag that begins with the `<` at `offset` in `text`: its name,
 * its attributes as written (a quoted value may hold whitespace, `>` and line
 * breaks) and how it closes. All offsets are absolute in `text`. An attribute is
 * `bound` when its name starts with `[`, `(`, `*` or `@`, so that its value is
 * an Angular expression rather than text that reaches the DOM. Throws when the
 * tag does not close, so that a change in the parser's input fails loudly.
 */
export function scanStartTag(text, offset) {
  let index = offset + 1;
  while (index < text.length && !WHITESPACE.test(text[index]) && !closesAt(text, index)) {
    index++;
  }
  const name = text.slice(offset + 1, index);
  const nameEnd = index;
  const attributes = [];

  for (;;) {
    while (index < text.length && WHITESPACE.test(text[index])) {
      index++;
    }
    if (index >= text.length) {
      throw new Error(`The start tag <${name}> at offset ${offset} does not close.`);
    }
    if (closesAt(text, index)) {
      const closing = text[index] === '>' ? '>' : '/>';
      return { name, nameEnd, attributes, closing, closingStart: index, end: index + closing.length };
    }
    const start = index;
    let quote = null;
    while (index < text.length) {
      const character = text[index];
      if (quote) {
        quote = character === quote ? null : quote;
      } else if (character === '"' || character === '\'') {
        quote = character;
      } else if (WHITESPACE.test(character) || closesAt(text, index)) {
        break;
      }
      index++;
    }
    const attributeText = text.slice(start, index);
    attributes.push({
      text: attributeText,
      start,
      end: index,
      bound: BOUND_PREFIXES.includes(attributeText[0])
    });
  }
}
