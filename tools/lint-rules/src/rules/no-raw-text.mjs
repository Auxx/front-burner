/** A letter of any script: text with one is meant to be read, so it must be translated. */
const LETTER = /\p{L}/u;

/** Static attributes whose value a person reads or hears (NF-14.2). */
const READ_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title'
]);

/** Elements whose text is literal computer text, the same in every language. */
const LITERAL_ELEMENTS = new Set([ 'code', 'kbd', 'samp' ]);

/** Whether `node` is inside a `<code>`, `<kbd>` or `<samp>` element. */
function insideLiteral(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'Element' && LITERAL_ELEMENTS.has(current.name)) {
      return true;
    }
  }
  return false;
}

/**
 * `front-burner/no-raw-text`: a template shows no text that does not go
 * through Transloco (NF-14.2). It reports text with a letter between tags or
 * around an interpolation, and a static attribute that is read out, such as
 * `aria-label="Close"`. Punctuation and symbols alone, such as `·` or `/`, are
 * not words and pass, and so is the text of `<code>`, `<kbd>` and `<samp>`,
 * such as an example URL or a variable's name.
 */
export default {
  meta: {
    type: 'problem',
    schema: [],
    docs: { description: 'Show text in templates only through Transloco (NF-14.2).' },
    messages: {
      text: 'Text in a template must go through Transloco (NF-14.2): use t(\'…\') with a key in i18n/en.json.',
      attribute:
        'The "{{ name }}" attribute is read by people, so it must go through Transloco (NF-14.2): bind it to t(\'…\').'
    }
  },

  create(context) {
    return {
      Text(node) {
        if (LETTER.test(node.value) && !insideLiteral(node)) {
          context.report({ node, messageId: 'text' });
        }
      },
      BoundText(node) {
        const strings = node.value?.ast?.strings ?? [];
        if (strings.some(string => LETTER.test(string)) && !insideLiteral(node)) {
          context.report({ node, messageId: 'text' });
        }
      },
      TextAttribute(node) {
        if (READ_ATTRIBUTES.has(node.name.toLowerCase()) && LETTER.test(node.value)) {
          context.report({ node, messageId: 'attribute', data: { name: node.name } });
        }
      }
    };
  }
};
