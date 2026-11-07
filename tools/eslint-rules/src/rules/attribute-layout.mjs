import { scanStartTag } from '../lib/start-tag.mjs';

/** The column of `offset` on its line, counted in characters from 0. */
function columnOf(text, offset) {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1);
}

/**
 * The text of a multi-line attribute moved `delta` columns to the right (left
 * when negative), with its continuation lines shifted by the same amount so
 * that a bound expression keeps its shape. Blank lines stay as they are.
 * `undefined` when the text cannot be moved: a static value reaches the DOM, so
 * its continuation lines are never changed, and a line without enough leading
 * spaces cannot shift left.
 */
function shifted(attribute, delta) {
  if (delta === 0 || !attribute.text.includes('\n')) {
    return attribute.text;
  }
  if (!attribute.bound) {
    return undefined;
  }
  const [ first, ...rest ] = attribute.text.split('\n');
  const moved = [];
  for (const line of rest) {
    if (/^[ \t]*\r?$/.test(line)) {
      moved.push(line);
    } else if (delta > 0) {
      moved.push(' '.repeat(delta) + line);
    } else if (line.startsWith(' '.repeat(-delta))) {
      moved.push(line.slice(-delta));
    } else {
      return undefined;
    }
  }
  return [ first, ...moved ].join('\n');
}

/**
 * The start tag laid out as the rule wants it, from the end of its name to its
 * end: the first attribute one space after the name, each further one on its
 * own line aligned with the first, and the closing bracket after the last.
 * `undefined` when a multi-line value cannot be moved (see `shifted`).
 */
function expectedLayout(text, tag, offset, eol) {
  const closing = tag.closing === '>' ? '>' : ' />';
  if (!tag.attributes.length) {
    return closing;
  }
  const column = columnOf(text, offset) + 1 + tag.name.length + 1;
  const parts = [];
  for (const attribute of tag.attributes) {
    const moved = shifted(attribute, column - columnOf(text, attribute.start));
    if (moved === undefined) {
      return undefined;
    }
    parts.push(moved);
  }
  return ' ' + parts.join(eol + ' '.repeat(column)) + closing;
}

/**
 * The layout problems of a start tag as `[ messageId, offset ]` pairs, at most
 * one of each kind, in source order. Alignment is measured against the first
 * attribute where it stands now, so that a misplaced first attribute is
 * reported once rather than as a misalignment of every other one. Columns at
 * or before `unknownUntil` are not those of the real file (see `create`): when
 * the first attribute stands there, the others only have to align with the
 * second.
 */
function problemsOf(text, tag, eol, unknownUntil) {
  const { attributes } = tag;
  const problems = [];
  if (attributes.length && text.slice(tag.nameEnd, attributes[0].start) !== ' ') {
    problems.push([ 'firstAttribute', attributes[0].start ]);
  }
  if (attributes.length > 1) {
    const reference = attributes[0].start > unknownUntil ? attributes[0] : attributes[1];
    const indent = eol + ' '.repeat(columnOf(text, reference.start));
    const misaligned = attributes.slice(1).find((attribute, index) =>
      text.slice(attributes[index].end, attribute.start) !== indent
    );
    if (misaligned) {
      problems.push([ 'alignAttribute', misaligned.start ]);
    }
  }
  const last = attributes.at(-1)?.end ?? tag.nameEnd;
  if (text.slice(last, tag.closingStart) !== (tag.closing === '>' ? '' : ' ')) {
    problems.push([ 'closing', tag.closingStart ]);
  }
  return problems;
}

/**
 * `front-burner/attribute-layout`: the first attribute of a start tag sits on
 * the tag's line, one space after the name; each further attribute sits on its
 * own line, aligned with the first; and the closing `>` or `/>` follows the
 * last attribute. "Attribute" covers everything in the start tag: plain
 * attributes, bindings, references, structural directives and animations.
 */
export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    docs: { description: 'Lay out the attributes of a start tag one per line, aligned with the first.' },
    messages: {
      firstAttribute: 'The first attribute goes on the tag\'s line, one space after the tag name.',
      alignAttribute: 'Each further attribute goes on its own line, aligned with the first.',
      closing: 'The closing bracket follows the last attribute: `>` directly, `/>` after one space.'
    }
  },

  create(context) {
    const { sourceCode } = context;
    const { text } = sourceCode;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const handled = new Set();
    // An inline template that angular-eslint's processor extracts from a `.ts`
    // file starts after the opening quote, so the columns of its first line are
    // not those of the real file. Tags there are reported but not fixed.
    const lineBreak = text.indexOf('\n');
    const unknownUntil = context.physicalFilename === context.filename
      ? -1
      : lineBreak === -1
      ? text.length
      : lineBreak;

    function check(node) {
      const offset = node.startSourceSpan?.start.offset;
      // An element with a structural directive is both a Template and an Element node.
      if (offset === undefined || handled.has(offset) || text[offset] !== '<') {
        return;
      }
      handled.add(offset);
      const tag = scanStartTag(text, offset);
      const problems = problemsOf(text, tag, eol, unknownUntil);
      if (!problems.length) {
        return;
      }
      const expected = offset > unknownUntil ? expectedLayout(text, tag, offset, eol) : undefined;
      problems.forEach(([ messageId, at ], index) => {
        context.report({
          messageId,
          loc: sourceCode.getLocFromIndex(at),
          fix: index === 0 && expected !== undefined
            ? fixer => fixer.replaceTextRange([ tag.nameEnd, tag.end ], expected)
            : null
        });
      });
    }

    return { Element: check, Template: check, Content: check };
  }
};
